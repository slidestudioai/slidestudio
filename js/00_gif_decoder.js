/* =====================================================================
 * 00_gif_decoder.js  (v29)
 * GIF ni o'zimiz dekodlaymiz va kadrlarni o'zimiz almashtiramiz.
 *
 * Nega: avval muharrirda GIF kanvasga <img> orqali chizilardi. Brauzer ko'rinmas (2px) <img> ning
 * animatsiyasini to'xtatib qo'yadi — natijada GIF muharrirda oddiy rasm bo'lib qolardi
 * (taqdimotda esa ko'rinadigan <img> bo'lgani uchun ishlardi). Endi kadrlar bizning soatimiz
 * bo'yicha almashadi — brauzerga bog'liq emas.
 *
 *   GifDecoder.decode(Uint8Array) -> { width, height, frames:[{ delay(ms), rgba:Uint8ClampedArray }] }
 *   GifPlayer.frameFor(url)       -> <canvas> (hozirgi kadr) yoki null (hali yuklanmagan / GIF emas)
 * ===================================================================== */
(function (root) {
  'use strict';

  // ------------------------------ LZW ------------------------------
  function lzwDecode(minCode, data, npix) {
    const out = new Uint8Array(npix);
    const clear = 1 << minCode, eoi = clear + 1;
    let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1;
    const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
    for (let i = 0; i < clear; i++) suffix[i] = i;
    let op = 0, ip = 0, bits = 0, datum = 0, old = -1, first = 0;
    const len = data.length;
    while (op < npix) {
      while (bits < size) {
        if (ip >= len) return out;
        datum |= data[ip++] << bits;
        bits += 8;
      }
      let code = datum & mask;
      datum >>= size;
      bits -= size;
      if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
      if (code === eoi) break;
      if (old === -1) {
        out[op++] = suffix[code];
        old = code; first = code;
        continue;
      }
      const inCode = code;
      let sp = 0;
      if (code >= next) { stack[sp++] = first; code = old; }
      while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
      first = suffix[code];
      stack[sp++] = first;
      if (next < 4096) {
        prefix[next] = old; suffix[next] = first; next++;
        if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; }
      }
      old = inCode;
      while (sp > 0 && op < npix) out[op++] = stack[--sp];
    }
    return out;
  }

  // ------------------------------ GIF parser ------------------------------
  function decode(bytes, opts) {
    opts = opts || {};
    const maxPixels = opts.maxPixels || 48e6;     // barcha kadrlar yig'indisi (RGBA = x4 bayt)
    let p = 0;
    const u8 = bytes;
    const sig = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('GIF emas');
    const W = u8[6] | (u8[7] << 8), H = u8[8] | (u8[9] << 8);
    const flags = u8[10];
    p = 13;
    let gct = null;
    if (flags & 0x80) {
      const n = 1 << ((flags & 7) + 1);
      gct = u8.subarray(p, p + n * 3);
      p += n * 3;
    }
    if (!W || !H) throw new Error('GIF o\'lchami 0');

    const raw = [];   // { x,y,w,h, indices, ct, trans, disposal, delay }
    let gce = null;
    function skipBlocks() {
      while (p < u8.length) { const n = u8[p++]; if (!n) break; p += n; }
    }
    while (p < u8.length) {
      const b = u8[p++];
      if (b === 0x3B) break;
      if (b === 0x21) {
        const label = u8[p++];
        if (label === 0xF9) {
          const sz = u8[p++];
          const pk = u8[p];
          gce = {
            disposal: (pk >> 2) & 7,
            hasTrans: !!(pk & 1),
            delay: (u8[p + 1] | (u8[p + 2] << 8)) * 10,
            trans: u8[p + 3]
          };
          p += sz;
          skipBlocks();
        } else skipBlocks();
        continue;
      }
      if (b === 0x2C) {
        const x = u8[p] | (u8[p + 1] << 8), y = u8[p + 2] | (u8[p + 3] << 8);
        const w = u8[p + 4] | (u8[p + 5] << 8), h = u8[p + 6] | (u8[p + 7] << 8);
        const pk = u8[p + 8];
        p += 9;
        let ct = gct;
        if (pk & 0x80) {
          const n = 1 << ((pk & 7) + 1);
          ct = u8.subarray(p, p + n * 3);
          p += n * 3;
        }
        const interlace = !!(pk & 0x40);
        const minCode = u8[p++];
        const chunks = []; let total = 0;
        while (p < u8.length) {
          const n = u8[p++];
          if (!n) break;
          chunks.push(u8.subarray(p, p + n));
          total += n; p += n;
        }
        const data = new Uint8Array(total);
        let o = 0;
        for (let i = 0; i < chunks.length; i++) { data.set(chunks[i], o); o += chunks[i].length; }
        let idx = lzwDecode(minCode, data, w * h);
        if (interlace) {
          const de = new Uint8Array(w * h);
          const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];
          let src = 0;
          for (let pi = 0; pi < 4; pi++) {
            for (let row = passes[pi][0]; row < h; row += passes[pi][1]) {
              de.set(idx.subarray(src, src + w), row * w);
              src += w;
            }
          }
          idx = de;
        }
        raw.push({ x: x, y: y, w: w, h: h, indices: idx, ct: ct, trans: gce && gce.hasTrans ? gce.trans : -1,
          disposal: gce ? gce.disposal : 0, delay: gce ? gce.delay : 0 });
        gce = null;
        continue;
      }
      // noma'lum bayt — to'xtaymiz
      break;
    }
    if (!raw.length) throw new Error('GIF da kadr yo\'q');

    // kadrlarni yig'ish (disposal bilan)
    const buf = new Uint8ClampedArray(W * H * 4);
    let snapshot = null;
    let prev = null;
    let step = 1;
    if (W * H * raw.length > maxPixels) step = Math.ceil((W * H * raw.length) / maxPixels);
    const frames = [];
    let carry = 0;
    for (let i = 0; i < raw.length; i++) {
      const f = raw[i];
      // oldingi kadrning disposal i
      if (prev) {
        if (prev.disposal === 2) {
          for (let yy = 0; yy < prev.h; yy++) {
            const py = prev.y + yy;
            if (py >= H) break;
            for (let xx = 0; xx < prev.w; xx++) {
              const px = prev.x + xx;
              if (px >= W) break;
              const o = (py * W + px) * 4;
              buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 0;
            }
          }
        } else if (prev.disposal === 3 && snapshot) {
          buf.set(snapshot);
        }
      }
      if (f.disposal === 3) snapshot = new Uint8ClampedArray(buf); else snapshot = null;
      // chizish
      const ct = f.ct;
      for (let yy = 0; yy < f.h; yy++) {
        const py = f.y + yy;
        if (py >= H) break;
        for (let xx = 0; xx < f.w; xx++) {
          const px = f.x + xx;
          if (px >= W) break;
          const ci = f.indices[yy * f.w + xx];
          if (ci === f.trans) continue;
          if (!ct) continue;
          const o = (py * W + px) * 4;
          buf[o] = ct[ci * 3]; buf[o + 1] = ct[ci * 3 + 1]; buf[o + 2] = ct[ci * 3 + 2]; buf[o + 3] = 255;
        }
      }
      prev = f;
      let delay = f.delay;
      if (delay < 20) delay = 100;     // brauzerlar kabi: 0/10ms -> 100ms
      carry += delay;
      if (i % step === 0) {
        frames.push({ delay: carry, rgba: new Uint8ClampedArray(buf) });
        carry = 0;
      }
    }
    if (carry && frames.length) frames[frames.length - 1].delay += carry;
    return { width: W, height: H, frames: frames };
  }

  const GifDecoder = { decode: decode, lzwDecode: lzwDecode };
  root.GifDecoder = GifDecoder;

  // ------------------------------ Player (faqat brauzerda) ------------------------------
  if (typeof document === 'undefined') return;

  // v37: LRU (xotira byudjeti bilan) + doimiy Cache API + xatoda avtomatik qayta urinish.
  // Bir marta ochilgan GIF qayta yuklanmaydi va qayta dekodlanmaydi — sahifani yangilasangiz ham saqlanadi.
  const cache = new Map();          // fetchUrl -> entry
  const MAX_ENTRIES = 80;
  const BYTE_BUDGET = 320 * 1024 * 1024;   // dekodlangan kadrlar uchun taxminiy RAM chegarasi
  const CACHE_NAME = 'ss-gif-v1';
  const CACHE_MAX_FILES = 120;
  const MAX_TRIES = 4;
  let t0 = performance.now();
  let usedBytes = 0;

  function toFetchUrl(u) {
    if (!u || typeof u !== 'string') return '';
    u = u.trim();
    if (!u) return '';
    if (/^(data:|blob:)/i.test(u)) return u;
    if (u.charAt(0) === '/' && u.charAt(1) !== '/') return u;
    try {
      const a = new URL(u, location.href);
      if (a.origin === location.origin) return a.href;
    } catch (e) {}
    if (/^https?:\/\//i.test(u)) return '/api/proxy-image?raw=1&url=' + encodeURIComponent(u);
    return '';
  }

  function requestRender() {
    try { if (typeof canvas !== 'undefined' && canvas && canvas.requestRenderAll) canvas.requestRenderAll(); } catch (e) {}
  }

  function persistable(url) { return !!root.caches && !/^(data|blob):/i.test(url) && /^(https?:|\/)/i.test(url); }

  function diskGet(url) {
    if (!persistable(url)) return Promise.resolve(null);
    return root.caches.open(CACHE_NAME).then(function (c) { return c.match(url); })
      .then(function (r) { return r ? r.arrayBuffer() : null; }).catch(function () { return null; });
  }

  function diskPut(url, ab) {
    if (!persistable(url) || !ab || ab.byteLength > 25 * 1024 * 1024) return;
    root.caches.open(CACHE_NAME).then(function (c) {
      return c.put(url, new Response(ab.slice(0), { headers: { 'Content-Type': 'image/gif' } })).then(function () {
        return c.keys().then(function (keys) {
          if (keys.length > CACHE_MAX_FILES) return Promise.all(keys.slice(0, keys.length - CACHE_MAX_FILES).map(function (k) { return c.delete(k); }));
        });
      });
    }).catch(function () {});
  }

  function netGet(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (ab) { diskPut(url, ab); return ab; });
  }

  function tick() { return new Promise(function (res) { setTimeout(res, 0); }); }

  function evict(keep) {
    if (cache.size <= MAX_ENTRIES && usedBytes <= BYTE_BUDGET) return;
    const keys = Array.from(cache.keys());          // eng eskisi birinchi
    for (let n = 0; n < keys.length && (cache.size > MAX_ENTRIES || usedBytes > BYTE_BUDGET); n++) {
      const k = keys[n];
      if (k === keep) continue;
      const old = cache.get(k);
      cache.delete(k);
      if (old && old.bytes) usedBytes -= old.bytes;
    }
  }

  function load(entry) {
    entry.state = 'loading';
    entry.tries = (entry.tries || 0) + 1;
    diskGet(entry.url).then(function (hit) { return hit || netGet(entry.url); }).then(function (ab) {
      const g = decode(new Uint8Array(ab));
      const frames = [];
      entry.frames = frames; entry.width = g.width; entry.height = g.height;
      entry.state = 'building';
      let chain = Promise.resolve();
      g.frames.forEach(function (f, idx) {
        chain = chain.then(function () {
          const c = document.createElement('canvas');
          c.width = g.width; c.height = g.height;
          c.getContext('2d').putImageData(new ImageData(f.rgba, g.width, g.height), 0, 0);
          frames.push({ delay: f.delay, canvas: c });
          f.rgba = null;
          if (idx === 0) requestRender();           // birinchi kadr darhol ko'rinadi
          return (idx % 3 === 2) ? tick() : null;   // UI qotmasligi uchun bo'laklab
        });
      });
      return chain.then(function () {
        let total = 0;
        frames.forEach(function (f) { total += f.delay; f.end = total; });
        entry.total = total || 1;
        entry.bytes = g.width * g.height * 4 * frames.length;
        usedBytes += entry.bytes;
        entry.state = 'ready';
        evict(entry.url);
        requestRender();
      });
    }).catch(function (e) {
      entry.state = 'failed';
      entry.error = e;
      entry.failedAt = Date.now();
    });
  }

  function entryFor(url) {
    const key = toFetchUrl(url);
    if (!key) return null;
    let e = cache.get(key);
    if (!e) {
      e = { url: key, state: 'new', frames: null, total: 1, width: 0, height: 0, tries: 0 };
      cache.set(key, e);
      evict(key);
      load(e);
    } else {
      cache.delete(key); cache.set(key, e);          // LRU: eng oxirgi ishlatilgan
      if (e.state === 'failed' && e.tries < MAX_TRIES && Date.now() - e.failedAt > 2500 * e.tries) load(e);
    }
    return e;
  }

  /** Hozirgi kadr (canvas) — tayyor bo'lmasa null (chaqiruvchi <img> ga qaytadi) */
  function frameFor(url, now) {
    const e = entryFor(url);
    if (e && e.state === 'building' && e.frames && e.frames.length) return e.frames[0].canvas;
    if (!e || e.state !== 'ready' || !e.frames.length) return null;
    if (e.frames.length === 1) return e.frames[0].canvas;
    const t = ((now == null ? performance.now() : now) - t0) % e.total;
    const fr = e.frames;
    for (let i = 0; i < fr.length; i++) if (t < fr[i].end) return fr[i].canvas;
    return fr[fr.length - 1].canvas;
  }

  root.GifPlayer = {
    frameFor: frameFor,
    entryFor: entryFor,
    state: function (url) { const e = entryFor(url); return e ? e.state : 'none'; },
    size: function (url) { const e = entryFor(url); return e && e.state === 'ready' ? { w: e.width, h: e.height } : null; },
    isAnimated: function (url) { const e = entryFor(url); return !!(e && e.state === 'ready' && e.frames.length > 1); },
    clear: function () { cache.clear(); usedBytes = 0; },
    preload: function (url) { try { entryFor(url); } catch (e) {} }
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
