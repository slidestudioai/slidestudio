/* =====================================================================
 * 00a_media_ram.js  (v38)  —  MediaRAM: rasm / GIF / video lar FAQAT foydalanuvchi qurilmasining RAM xotirasida
 *
 * Maqsad
 *   • Serverga yuk tushmasin: rasm/GIF lar CDN dan brauzerning o'zi to'g'ridan-to'g'ri oladi (CORS ruxsat bersa).
 *     Server proksi (/api/proxy-image) faqat CORS bermaydigan saytlar uchun ZAXIRA yo'l.
 *   • Bir marta yuklangan media Blob sifatida RAM da turadi (Blob URL) — qayta ochilganda DARHOL ko'rinadi,
 *     slaydlar almashganda qayta yuklanib miltillamaydi.
 *   • Diskka / localStorage / sessionStorage / IndexedDB / Cache API ga HECH NARSA yozilmaydi.
 *
 * Qanday ulanadi (eski kodni o'zgartirmasdan)
 *   • window.fetch  — '/api/proxy-image?raw=1&url=X' so'rovlari avval RAM ga, keyin to'g'ridan-to'g'ri CDN ga yo'naltiriladi.
 *   • <img>.src     — http(s) / proksi manzillar RAM dan Blob URL bilan almashtiriladi (yuklanguncha kutadi).
 *   • <video>.src   — oldindan RAM ga olingan video bo'lsa Blob URL ishlatiladi.
 *
 * API: MediaRAM.load(url,{priority,onProgress}) · peek(url) · warm(urls) · setPinned(urls) · on(fn) · stats() · clear()
 * ===================================================================== */
(function (root) {
  'use strict';
  if (root.MediaRAM) return;

  const MAX_BYTES = 384 * 1024 * 1024;          // RAM chegarasi (pin qilingan = joriy taqdimot media'si hech qachon chiqarib yuborilmaydi)
  const MAX_VIDEO_BYTES = 150 * 1024 * 1024;    // bitta video uchun chegara
  const DIRECT_TIMEOUT = 20000;
  const PROXY_TIMEOUT = 30000;
  const MAX_PARALLEL = 6;
  const RETRY_AFTER_ERROR_MS = 4000;

  const nativeFetch = root.fetch ? root.fetch.bind(root) : null;
  const store = new Map();                       // url -> entry
  const blockedHosts = new Map();                // CORS bermaydigan xostlar: xost -> vaqt (to'g'ridan-to'g'ri urinish 15 daqiqa o'tkazib yuboriladi)
  const BLOCK_TTL = 15 * 60 * 1000;
  function isBlocked(h) { const t = blockedHosts.get(h); if (!t) return false; if (Date.now() - t > BLOCK_TTL) { blockedHosts.delete(h); return false; } return true; }
  const listeners = new Set();
  let pinned = new Set();
  let totalBytes = 0;
  let active = 0;
  const queueHigh = [];
  const queueLow = [];

  // ---------------------------------------------------------------- yordamchilar
  function emit(type, entry, extra) {
    if (!listeners.size) return;
    const ev = Object.assign({ type: type, url: entry.url, loaded: entry.loaded, total: entry.total, status: entry.status }, extra || {});
    listeners.forEach(function (fn) { try { fn(ev); } catch (e) {} });
  }

  /** Har xil ko'rinishdagi manzildan HAQIQIY tashqi http(s) manzilni ajratadi. Boshqasi (data:, blob:, o'z sayt) -> null */
  function unwrap(u) {
    if (typeof u !== 'string' || !u) return null;
    const s = u.trim();
    if (!s || /^(data|blob):/i.test(s)) return null;
    let m = s.match(/^(?:https?:\/\/[^/]+)?\/api\/proxy-image\?(.*)$/i);
    if (m && (/^\//.test(s) || s.indexOf(location.origin) === 0)) {
      try {
        const inner = new URLSearchParams(m[1]).get('url');
        return /^https?:\/\//i.test(inner || '') ? inner : null;
      } catch (e) { return null; }
    }
    if (/^https?:\/\//i.test(s)) {
      if (s.indexOf(location.origin + '/') === 0 || s === location.origin) return null;
      return s;
    }
    return null;
  }

  function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } }

  function sniffMime(bytes, fallback) {
    const b = bytes;
    if (b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b.length > 7 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b.length > 11 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return fallback && /^video\//.test(fallback) ? fallback : 'video/mp4';
    if (b.length > 3 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
    if (b.length > 4 && b[0] === 0x3c) {
      const head = String.fromCharCode.apply(null, Array.prototype.slice.call(b, 0, 64)).toLowerCase();
      if (head.indexOf('<svg') >= 0 || head.indexOf('<?xml') >= 0) return 'image/svg+xml';
      return '';                                   // HTML sahifa — rasm emas
    }
    return fallback || '';
  }

  async function readWithProgress(res, entry, signal) {
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    entry.total = total;
    if (!res.body || !res.body.getReader) {
      const blob = await res.blob();
      entry.loaded = entry.total = blob.size;
      return blob;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    let lastEmit = 0;
    for (;;) {
      if (signal && signal.aborted) throw new Error('timeout');
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
      loaded += r.value.length;
      entry.loaded = loaded;
      const now = Date.now();
      if (now - lastEmit > 60) { lastEmit = now; emit('progress', entry); }
      if (entry.maxBytes && loaded > entry.maxBytes) { try { reader.cancel(); } catch (e) {} throw new Error('too-big'); }
    }
    entry.loaded = loaded;
    if (!entry.total) entry.total = loaded;
    return new Blob(chunks, { type: res.headers.get('content-type') || '' });
  }

  async function fetchBlob(url, entry, mode) {
    const ctl = new AbortController();
    const timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, mode === 'proxy' ? PROXY_TIMEOUT : DIRECT_TIMEOUT);
    try {
      let res;
      if (mode === 'proxy') {
        res = await nativeFetch('/api/proxy-image?raw=1&url=' + encodeURIComponent(url), { signal: ctl.signal });
      } else {
        res = await nativeFetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await readWithProgress(res, entry, ctl.signal);
    } finally { clearTimeout(timer); }
  }

  async function runLoad(entry) {
    const url = entry.url;
    const host = hostOf(url);
    const isVideo = entry.kind === 'video';
    let blob = null;
    let lastErr = null;

    if (nativeFetch && !isBlocked(host)) {
      try { blob = await fetchBlob(url, entry, 'direct'); }
      catch (e) {
        lastErr = e;
        // CORS xatosi TypeError beradi — shu xostni eslab qolamiz (keyingi safar vaqt yo'qotmaymiz)
        if (e && e.name === 'TypeError' && navigator.onLine !== false) blockedHosts.set(host, Date.now());
      }
    }
    if (!blob && !isVideo && nativeFetch) {          // video server orqali O'TKAZILMAYDI (og'ir) — brauzer o'zi oqimli o'ynaydi
      entry.loaded = 0; entry.total = 0;
      try { blob = await fetchBlob(url, entry, 'proxy'); entry.viaProxy = true; }
      catch (e2) { lastErr = e2; }
    }
    if (!blob) throw (lastErr || new Error('load-failed'));

    // Haqiqiy turni baytlardan aniqlaymiz (server noto'g'ri Content-Type bersa ham GIF animatsiyasi yo'qolmasin)
    const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    const mime = sniffMime(head, (blob.type || '').split(';')[0].trim().toLowerCase());
    if (!mime) throw new Error('not-media');
    if (!isVideo && !/^image\//.test(mime)) throw new Error('not-image');
    if (blob.type !== mime) blob = new Blob([blob], { type: mime });

    entry.blob = blob;
    entry.mime = mime;
    entry.size = blob.size;
    entry.objectUrl = URL.createObjectURL(blob);
    if (!isVideo) {
      // Oldindan dekodlab qo'yamiz — birinchi chizishda kechikish bo'lmasin
      try {
        const im = new Image();
        im.decoding = 'async';
        Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src').set.call(im, entry.objectUrl);
        await Promise.race([im.decode(), new Promise(function (r) { setTimeout(r, 4000); })]);
        entry.img = im;
        entry.w = im.naturalWidth || 0;
        entry.h = im.naturalHeight || 0;
      } catch (e) { /* dekod xatosi muhim emas — <img> o'zi ham ochadi */ }
    }
  }

  function pump() {
    while (active < MAX_PARALLEL && (queueHigh.length || queueLow.length)) {
      const entry = queueHigh.length ? queueHigh.shift() : queueLow.shift();
      if (entry.status !== 'queued') continue;
      active++;
      entry.status = 'loading';
      emit('start', entry);
      runLoad(entry).then(function () {
        entry.status = 'ready';
        entry.last = Date.now();
        totalBytes += entry.size || 0;
        emit('ready', entry);
        entry.resolve(entry);
        evictIfNeeded();
      }).catch(function (err) {
        entry.status = 'error';
        entry.error = err;
        entry.failedAt = Date.now();
        emit('error', entry, { error: String(err && err.message || err) });
        entry.reject(err);
      }).then(function () { active--; pump(); });
    }
  }

  function evictIfNeeded() {
    if (totalBytes <= MAX_BYTES) return;
    const cand = [];
    store.forEach(function (e) { if (e.status === 'ready' && !pinned.has(e.url) && !e.hold) cand.push(e); });
    cand.sort(function (a, b) { return a.last - b.last; });
    for (let i = 0; i < cand.length && totalBytes > MAX_BYTES * 0.8; i++) drop(cand[i]);
  }

  function drop(entry) {
    store.delete(entry.url);
    totalBytes -= entry.size || 0;
    const ou = entry.objectUrl;
    entry.objectUrl = null; entry.blob = null; entry.img = null;
    if (ou) setTimeout(function () { try { URL.revokeObjectURL(ou); } catch (e) {} }, 30000);
  }

  // ---------------------------------------------------------------- ochiq API
  function load(url, opts) {
    opts = opts || {};
    const key = unwrap(url) || (/^https?:\/\//i.test(url || '') ? url : null);
    if (!key) return Promise.reject(new Error('unsupported-url'));
    let entry = store.get(key);
    if (entry && entry.status === 'error' && Date.now() - entry.failedAt > RETRY_AFTER_ERROR_MS) {
      store.delete(key); entry = null;
    }
    if (!entry) {
      entry = { url: key, kind: opts.kind === 'video' ? 'video' : 'image', status: 'queued', loaded: 0, total: 0, size: 0, last: Date.now(), maxBytes: opts.kind === 'video' ? MAX_VIDEO_BYTES : 0 };
      entry.promise = new Promise(function (res, rej) { entry.resolve = res; entry.reject = rej; });
      entry.promise.catch(function () {});         // "unhandled rejection" bo'lmasin
      store.set(key, entry);
      (opts.priority === 'low' ? queueLow : queueHigh).push(entry);
      pump();
    } else if (opts.priority !== 'low' && entry.status === 'queued') {
      // past ustuvorlikdagi navbatdan yuqorisiga ko'taramiz
      const i = queueLow.indexOf(entry);
      if (i >= 0) { queueLow.splice(i, 1); queueHigh.push(entry); }
    }
    entry.last = Date.now();
    if (typeof opts.onProgress === 'function') {
      const off = on(function (ev) { if (ev.url === key) { try { opts.onProgress(ev); } catch (e) {} if (ev.type === 'ready' || ev.type === 'error') off(); } });
      if (entry.status === 'ready') { try { opts.onProgress({ type: 'ready', url: key, loaded: entry.size, total: entry.size, status: 'ready' }); } catch (e) {} off(); }
    }
    return entry.promise;
  }

  function peek(url) {
    const key = unwrap(url) || (/^https?:\/\//i.test(url || '') ? url : null);
    const e = key && store.get(key);
    if (e && e.status === 'ready' && e.objectUrl) { e.last = Date.now(); return e; }
    return null;
  }

  function state(url) {
    const key = unwrap(url) || (/^https?:\/\//i.test(url || '') ? url : null);
    const e = key && store.get(key);
    return e ? e.status : 'none';
  }

  function warm(urls, opts) {
    (urls || []).forEach(function (u) {
      const k = unwrap(u);
      if (k) load(k, Object.assign({ priority: 'low' }, opts || {})).catch(function () {});
    });
  }

  function setPinned(urls) {
    const s = new Set();
    (urls || []).forEach(function (u) { const k = unwrap(u); if (k) s.add(k); });
    pinned = s;
  }

  function on(fn) { listeners.add(fn); return function () { listeners.delete(fn); }; }

  function stats() {
    let n = 0, v = 0;
    store.forEach(function (e) { if (e.status === 'ready') { n++; if (e.kind === 'video') v++; } });
    return { count: n, videos: v, bytes: totalBytes, active: active, queued: queueHigh.length + queueLow.length };
  }

  function clear() {
    queueHigh.length = 0; queueLow.length = 0;
    store.forEach(function (e) { if (e.objectUrl) { try { URL.revokeObjectURL(e.objectUrl); } catch (x) {} } });
    store.clear(); totalBytes = 0; blockedHosts.clear();
  }

  /** Bir nechta URL tayyor bo'lguncha kutadi; onStep(done,total) — taqdimot oldidan "tayyorlanmoqda" uchun */
  async function ready(urls, onStep, opts) {
    const list = Array.from(new Set((urls || []).map(unwrap).filter(Boolean)));
    let done = 0;
    if (onStep) onStep(0, list.length);
    await Promise.all(list.map(function (u) {
      return load(u, opts).then(function () {}, function () {}).then(function () { done++; if (onStep) onStep(done, list.length); });
    }));
    return list.length;
  }

  // ---------------------------------------------------------------- avtomatik ulanish: fetch
  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) { const r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); });
  }

  if (nativeFetch) {
    root.fetch = function (input, init) {
      try {
        let u = '';
        let method = 'GET';
        if (typeof input === 'string') u = input;
        else if (input && typeof input.url === 'string') { u = input.url; method = input.method || 'GET'; }
        else if (input && typeof input.href === 'string') u = input.href;
        if (init && init.method) method = init.method;
        if (method.toUpperCase() === 'GET' && u.indexOf('/api/proxy-image') >= 0) {
          const inner = unwrap(u);
          if (inner) {
            const wantsJson = !/[?&]raw=1/.test(u);
            return load(inner, { priority: 'high' }).then(function (e) {
              if (wantsJson) {
                return blobToDataUrl(e.blob).then(function (du) {
                  return new Response(JSON.stringify({ data_url: du, content_type: e.mime, final_url: inner }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                });
              }
              return new Response(e.blob, { status: 200, headers: { 'Content-Type': e.mime } });
            }, function (err) {
              return new Response(wantsJson ? JSON.stringify({ error: 'Rasm olinmadi: ' + (err && err.message || err) }) : '', { status: wantsJson ? 200 : 502, headers: { 'Content-Type': wantsJson ? 'application/json' : 'text/plain' } });
            });
          }
        }
      } catch (e) { /* oddiy fetch ga tushamiz */ }
      return nativeFetch(input, init);
    };
  }

  // ---------------------------------------------------------------- avtomatik ulanish: <img>.src
  try {
    const imgDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (imgDesc && imgDesc.set && !imgDesc.set._ssRam) {
      const nativeSet = imgDesc.set;
      const patched = function (v) {
        const inner = unwrap(typeof v === 'string' ? v : (v == null ? '' : String(v)));
        if (!inner) { this.__ssTok = (this.__ssTok || 0) + 1; return nativeSet.call(this, v); }
        const el = this;
        const tok = el.__ssTok = (el.__ssTok || 0) + 1;
        el.__ssRaw = v;
        const hit = peek(inner);
        if (hit) return nativeSet.call(el, hit.objectUrl);
        load(inner, { priority: 'high' }).then(function (e) {
          if (el.__ssTok === tok && e.objectUrl) nativeSet.call(el, e.objectUrl);
        }, function () {
          if (el.__ssTok === tok) nativeSet.call(el, v);      // RAM yo'li ishlamadi — oddiy brauzer yuklashi (eski xatti-harakat)
        });
      };
      patched._ssRam = true;
      Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, enumerable: imgDesc.enumerable, get: imgDesc.get, set: patched });
      const nativeSetAttr = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') { this.src = value; return; }
        return nativeSetAttr.call(this, name, value);
      };
    }
  } catch (e) { console.warn('MediaRAM img patch:', e); }

  // ---------------------------------------------------------------- avtomatik ulanish: <video>.src (faqat oldindan RAM ga olingan bo'lsa)
  try {
    const vd = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (vd && vd.set && !vd.set._ssRam) {
      const vset = function (v) {
        const hit = typeof v === 'string' && /^https?:/i.test(v) ? peek(v) : null;
        return vd.set.call(this, hit && hit.kind === 'video' ? hit.objectUrl : v);
      };
      vset._ssRam = true;
      Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, enumerable: vd.enumerable, get: vd.get, set: vset });
    }
  } catch (e) { console.warn('MediaRAM video patch:', e); }

  root.MediaRAM = { load: load, peek: peek, state: state, warm: warm, ready: ready, setPinned: setPinned, on: on, stats: stats, clear: clear, unwrap: unwrap, isBlockedHost: function (u) { return isBlocked(hostOf(u)); } };
})(window);
