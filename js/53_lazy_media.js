/* =====================================================================
 * 53_lazy_media.js — fast AI slides: text first, media later (no waiting, no layout shift)
 *
 *  1) Fonts are loaded when the page opens (AI slides no longer wait up to 2.5 s for them).
 *  2) An AI image / video element does NOT block its slide any more: a light shimmer "media slot" is placed
 *     at exactly the same position and size, the slide (text, shapes) appears at once, and the real media is
 *     loaded in the background. When it is ready it replaces the slot with a 0.3 s fade-in (same box = no jump).
 *     It works even if the user already moved to another slide (the slide JSON + thumbnail are updated).
 *  3) Preload: as soon as a media URL appears in the AI stream, the download starts in the background.
 *  4) A slot saved in a project (page closed while loading) is loaded again when its slide is opened.
 *  5) Duplicate guard: one image URL is used only once per presentation (server pool: window._ssImagePool).
 * ===================================================================== */
(function () {
  'use strict';
  if (window.SSLazyMedia) return;
  const FADE_MS = 300;
  const slots = new Map();           // slotId -> { el, promise }
  const cancelled = new Set();       // slots whose slide was rebuilt / deleted — their media is not needed any more
  const early = new Map();           // slotId -> loaded object whose slot is not stored anywhere YET (race: image faster than the slide)
  let seq = 0;

  // ------------------------------------------------------------------ 1) fonts
  const PRELOAD_FONTS = ['Roboto', 'Montserrat', 'Pacifico', 'Caveat', 'Courier Prime'];
  function preloadFonts() {
    try {
      if (!document.fonts || !document.fonts.load) return;
      PRELOAD_FONTS.forEach(function (f) {
        document.fonts.load('400 16px "' + f + '"').catch(function () {});
        document.fonts.load('700 16px "' + f + '"').catch(function () {});
      });
    } catch (e) {}
  }
  function reflowWhenFontsReady(promise) {
    if (!promise || typeof promise.then !== 'function') return;
    promise.then(function () {
      try {
        if (typeof canvas === 'undefined' || !canvas) return;
        let changed = false;
        canvas.getObjects().forEach(function (o) {
          if (o && o.initDimensions && (o.type === 'textbox' || o.type === 'i-text')) {
            try { o.initDimensions(); o.setCoords(); changed = true; } catch (e) {}
          }
        });
        if (changed) canvas.requestRenderAll();
      } catch (e) {}
    }).catch(function () {});
  }

  // ------------------------------------------------------------------ helpers
  function isHttp(u) { return typeof u === 'string' && /^https?:\/\//i.test(u); }
  function looksGif(u) {
    return /\.gif(\?|#|$)/i.test(u) || /media\.giphy\.com|i\.giphy\.com|klipy\.com|tenor\.com/i.test(u) || /^data:image\/gif/i.test(u);
  }
  function looksVideo(u) { return /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i.test(u); }
  function unwrapUrl(u) {
    u = String(u || '');
    const m = u.match(/[?&]url=([^&]+)/);
    if (u.indexOf('/api/proxy-image') >= 0 && m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    return u;
  }
  function normUrl(u) { return unwrapUrl(u).trim().replace(/#.*$/, ''); }
  function elUrl(el) {
    if (!el) return '';
    return el.ssSrcUrl || el.videoUrl || el.gifUrl || el.src || '';
  }
  function aiActive() {
    try { return !!(isAiStreaming || isAiApplyingCommands || window.isAiApplyingCommands); } catch (e) { return false; }
  }
  function shouldDefer(el) {
    if (!el || window.__ssLazyMediaOff || !aiActive()) return false;
    if (el.type === 'videoImage' || el.isVideo) return isHttp(el.videoUrl || el.src) || /^\//.test(el.videoUrl || el.src || '');
    if (el.type !== 'image' || !isHttp(el.src)) return false;
    return !(el.isGif || looksGif(String(el.src)));          // GIFs are already non-blocking (overlay + skeleton)
  }

  // ------------------------------------------------------------------ 2) the media slot (fabric object)
  let SlotClass = null;
  function defineSlot() {
    if (SlotClass || typeof fabric === 'undefined') return SlotClass;
    SlotClass = fabric.util.createClass(fabric.Rect, {
      type: 'ssMediaSlot',
      initialize: function (options) {
        options = options || {};
        this.callSuper('initialize', Object.assign({ fill: '#e9eef5', rx: 10, ry: 10, objectCaching: false,
          selectable: false, evented: false, hoverCursor: 'default' }, options));
        this.ssMediaSlot = true;
      },
      toObject: function (extra) {
        return fabric.util.object.extend(this.callSuper('toObject', extra), {
          ssMediaSlot: true, ssSlotId: this.ssSlotId, ssSlotEl: this.ssSlotEl,
        });
      },
      _render: function (ctx) {
        const w = this.width, h = this.height, r = Math.min(12, w / 8, h / 8);
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, r); else ctx.rect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#e9eef5';
        ctx.fill();
        ctx.clip();
        // moving shimmer band (time based -> animates while the shimmer loop re-renders)
        const t = (performance.now() % 1400) / 1400;
        const x = -w / 2 - w * 0.6 + t * w * 2.2;
        const g = ctx.createLinearGradient(x, 0, x + w * 0.6, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.75)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        // small picture icon in the middle
        const s = Math.max(14, Math.min(34, Math.min(w, h) / 5));
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = Math.max(1.5, s / 12);
        ctx.strokeRect(-s / 2, -s / 2.6, s, s / 1.3);
        ctx.beginPath();
        ctx.moveTo(-s / 2, s / 4); ctx.lineTo(-s / 8, -s / 10); ctx.lineTo(s / 6, s / 6); ctx.lineTo(s / 2, -s / 10);
        ctx.stroke();
        ctx.restore();
      },
    });
    SlotClass.fromObject = function (obj, cb) {
      const o = new SlotClass(obj);
      if (cb) cb(o);
      return o;
    };
    fabric.SsMediaSlot = SlotClass;
    fabric.SsMediaSlot.fromObject = SlotClass.fromObject;
    return SlotClass;
  }

  // one light animation loop, only while the live canvas shows a slot
  let loopOn = false;
  function shimmerLoop() {
    if (loopOn) return;
    loopOn = true;
    let last = 0;
    const tick = function (now) {
      let any = false;
      try { any = typeof canvas !== 'undefined' && canvas && canvas.getObjects().some(function (o) { return o && o.ssMediaSlot; }); } catch (e) {}
      if (!any) { loopOn = false; return; }
      if (now - last > 40) { last = now; try { canvas.requestRenderAll(); } catch (e) {} }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function slotBox(el) {
    const sx = (typeof el.scaleX === 'number') ? el.scaleX : 1;
    const sy = (typeof el.scaleY === 'number') ? el.scaleY : 1;
    let w = Number(el.width), h = Number(el.height);
    if (!(w > 0)) w = (el.type === 'videoImage' || el.isVideo) ? 480 : 200;
    if (!(h > 0)) h = (el.type === 'videoImage' || el.isVideo) ? 270 : 150;
    // parseElementToFabric shows an image at el.width x el.height (scale computed from the natural size), unless
    // explicit scaleX/scaleY are given — then the natural size is unknown here; width/height stay the best guess.
    return { w: w, h: h, sx: (el.type === 'image' && el.scaleX != null && el.scaleY != null && !el.width) ? sx : 1,
             sy: (el.type === 'image' && el.scaleX != null && el.scaleY != null && !el.height) ? sy : 1 };
  }

  function slotFor(el) {
    const C = defineSlot();
    if (!C) return null;
    const id = 'mslot_' + Date.now().toString(36) + '_' + (++seq);
    const b = slotBox(el);
    const keep = Object.assign({}, el);
    if (keep.type === 'image' && isHttp(keep.src)) keep.ssSrcUrl = keep.ssSrcUrl || keep.src;
    const o = new C({
      left: el.left != null ? el.left : 50, top: el.top != null ? el.top : 50,
      width: b.w, height: b.h, scaleX: b.sx, scaleY: b.sy, angle: el.angle || 0,
      ssSlotId: id, ssSlotEl: JSON.stringify(keep),
    });
    if (el.imageNumber != null) o.imageNumber = el.imageNumber;
    if (el._oid != null) o._oid = el._oid;
    startLoad(id, keep);
    return o;
  }

  // ------------------------------------------------------------------ loading + replacing
  function serialize(obj) {
    try { return obj.toObject(typeof SERIALIZE_PROPS !== 'undefined' ? SERIALIZE_PROPS : []); } catch (e) { return null; }
  }
  function findSlideWithSlot(id) {
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i];
      if (s && typeof s.json === 'string' && s.json.indexOf(id) >= 0) return i;
    }
    return -1;
  }
  function patchSlideJson(i, id, newObjJson) {
    try {
      const d = JSON.parse(slides[i].json || '{}');
      const arr = Array.isArray(d.objects) ? d.objects : [];
      const k = arr.findIndex(function (o) { return o && o.ssSlotId === id; });
      if (k < 0) return false;
      if (newObjJson) arr.splice(k, 1, newObjJson); else arr.splice(k, 1);
      d.objects = arr;
      slides[i].json = JSON.stringify(d);
      return true;
    } catch (e) { return false; }
  }

  async function realObject(el) {
    if (typeof parseElementToFabric !== 'function') return null;
    const o = await parseElementToFabric(el);
    if (o && el.ssSrcUrl) { try { o.ssSrcUrl = el.ssSrcUrl; o.set('ssSrcUrl', el.ssSrcUrl); } catch (e) {} }
    if (o && el.imageNumber != null) { try { o.imageNumber = el.imageNumber; o.set({ imageNumber: el.imageNumber }); } catch (e) {} }
    return o;
  }

  // A deck of 16 slides x 4 pictures asked for 64 pictures at once: the proxy queue overflowed (busy / timeout),
  // a picture that failed once was dropped and its slide stayed empty. Now: max LOAD_PARALLEL loads at a time (first
  // slides first), each picture is tried again (RETRY_DELAYS), and if it still fails an unused picture of the
  // same kind from this presentation's pool takes its place. Only when all of that fails the slot is removed.
  const LOAD_PARALLEL = 6;
  const RETRY_DELAYS = [0, 1500, 4000];
  const LOAD_WAIT_MS = 20000;               // the slide is already shown -> the picture may take its time
  let loading = 0;
  const waiters = [];
  const takenAlt = new Set();
  function acquire() {
    if (loading < LOAD_PARALLEL) { loading++; return Promise.resolve(); }
    return new Promise(function (r) { waiters.push(r); });
  }
  function release() { const w = waiters.shift(); if (w) w(); else loading = Math.max(0, loading - 1); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function tryLoad(id, el) {
    for (let k = 0; k < RETRY_DELAYS.length; k++) {
      if (cancelled.has(id)) return null;
      if (RETRY_DELAYS[k]) await sleep(RETRY_DELAYS[k]);
      if (k > 0) { try { if (window.ssForgetProxyFail) window.ssForgetProxyFail(elUrl(el)); } catch (e) {} }
      await acquire();
      let o = null;
      try { o = await realObject(Object.assign({}, el, { _ssLoadMs: LOAD_WAIT_MS })); } catch (e) { o = null; } finally { release(); }
      if (o) return o;
      if (cancelled.has(id)) return null;
    }
    return null;
  }
  function altFor(el) {
    if (!el || el.type !== 'image') return null;
    const pool = Array.isArray(window._ssImagePool) ? window._ssImagePool : [];
    if (!pool.length) return null;
    const used = deckUsedUrls(-1);
    const p = pool.find(function (x) {
      const u = normUrl(x && x.url);
      return isHttp(u) && !used.has(u) && !takenAlt.has(u) && x.kind !== 'gif' && x.kind !== 'video' && !looksGif(u) && !looksVideo(u);
    });
    if (!p) return null;
    const u = normUrl(p.url);
    takenAlt.add(u);
    return Object.assign({}, el, { src: u, ssSrcUrl: u });
  }
  async function loadMedia(id, el) {
    let obj = await tryLoad(id, el);
    for (let n = 0; !obj && n < 2 && !cancelled.has(id); n++) {
      const alt = altFor(el);
      if (!alt) break;
      console.info('[lazy-media] picture failed, using another one from the pool:', elUrl(el), '->', alt.src);
      obj = await tryLoad(id, alt);
    }
    if (!obj && !cancelled.has(id)) console.warn('[lazy-media] picture could not be loaded, slot removed:', elUrl(el));
    return obj;
  }

  function startLoad(id, el) {
    if (slots.has(id)) return slots.get(id).promise;
    const rec = { el: el, promise: null };
    rec.promise = (async function () {
      let obj = null;
      try { obj = await loadMedia(id, el); } catch (e) { obj = null; }
      // the slide that holds this slot may not be stored yet (the image came from the preload cache very fast):
      // keep the result and retry until the slot shows up (max ~30 s)
      for (let attempt = 0; attempt < 250; attempt++) {
        let placed = false;
        try { placed = swapIn(id, obj); } catch (e) { console.warn('[lazy-media] swap:', e); placed = true; }
        if (placed || cancelled.has(id)) break;
        early.set(id, obj);
        await new Promise(function (r) { setTimeout(r, 120); });
        if (!early.has(id)) break;           // placed by the object:added hook meanwhile
      }
      early.delete(id);
      slots.delete(id);
      cancelled.delete(id);
      return obj;
    })();
    slots.set(id, rec);
    shimmerLoop();
    return rec.promise;
  }

  function swapIn(id, obj) {
    const json = obj ? serialize(obj) : null;
    if (obj && json) {
      try { json.opacity = (obj.opacity == null ? 1 : obj.opacity); } catch (e) {}
    }
    // 1) the stored slide (any slide, even if the user is looking at another one)
    const i = findSlideWithSlot(id);
    let liveSlot = null;
    try { liveSlot = (typeof canvas !== 'undefined' && canvas) ? canvas.getObjects().find(function (o) { return o && o.ssSlotId === id; }) : null; } catch (e) {}
    if (i < 0 && !liveSlot) return false;          // not stored anywhere yet -> caller retries
    if (i >= 0) patchSlideJson(i, id, json);
    // 2) the live canvas, with a fade-in in exactly the same box
    let live = false;
    try {
      if (typeof canvas !== 'undefined' && canvas) {
        const list = canvas.getObjects();
        const slot = list.find(function (o) { return o && o.ssSlotId === id; });
        if (slot) {
          live = true;
          const z = list.indexOf(slot);
          canvas.remove(slot);
          if (obj) {
            const target = (obj.opacity == null ? 1 : obj.opacity);
            obj.set({ opacity: 0 });
            canvas.insertAt(obj, z);
            try { if (obj.isVideo || obj.type === 'videoImage') obj.dirty = true; } catch (e) {}
            obj.animate('opacity', target, {
              duration: FADE_MS, easing: fabric.util.ease.easeOutQuad,
              onChange: function () { canvas.requestRenderAll(); },
              onComplete: function () { canvas.requestRenderAll(); },
            });
          }
          canvas.requestRenderAll();
        }
      }
    } catch (e) {}
    if (i >= 0) {
      try { if (typeof window.refreshSlideThumb === 'function') window.refreshSlideThumb(i); } catch (e) {}
    }
    try { document.dispatchEvent(new CustomEvent('ss:media-slot', { detail: { id: id, ok: !!obj, slide: i, live: live } })); } catch (e) {}
    return true;
  }

  // a slot that came back from a saved project / undo -> load it again
  function revive(o) {
    if (!o || !o.ssMediaSlot || !o.ssSlotId) return;
    if (early.has(o.ssSlotId)) {                      // its media is already here -> place it right away
      const obj = early.get(o.ssSlotId);
      setTimeout(function () { try { if (swapIn(o.ssSlotId, obj)) early.delete(o.ssSlotId); } catch (e) {} }, 0);
      return;
    }
    if (slots.has(o.ssSlotId)) return;
    let el = null;
    try { el = JSON.parse(o.ssSlotEl || 'null'); } catch (e) { el = null; }
    if (!el) return;
    startLoad(o.ssSlotId, el);
  }
  function hookCanvas() {
    try {
      if (typeof canvas === 'undefined' || !canvas) return false;
      if (canvas.__ssLazyHooked) return true;
      canvas.__ssLazyHooked = true;
      canvas.on('object:added', function (e) { if (e && e.target && e.target.ssMediaSlot) { revive(e.target); shimmerLoop(); } });
      return true;
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ 3) preload from the stream
  const seen = new Set();
  const queue = [];
  let running = 0;
  const MAX_PARALLEL = 4;
  function pump() {
    while (running < MAX_PARALLEL && queue.length) {
      const job = queue.shift();
      running++;
      Promise.resolve().then(job).catch(function () {}).then(function () { running--; pump(); });
    }
  }
  function preload(url) {
    url = normUrl(url);
    if (!isHttp(url) || seen.has(url)) return;
    seen.add(url);
    if (seen.size > 400) seen.clear();
    if (looksGif(url)) {
      const im = new Image();
      im.decoding = 'async';
      im.src = /(tenor|giphy|klipy)\.com|\.gif(\?|#|$)/i.test(url) ? url : ('/api/proxy-image?raw=1&url=' + encodeURIComponent(url));
      return;
    }
    if (looksVideo(url)) {
      queue.push(function () {
        return new Promise(function (res) {
          try {
            const v = document.createElement('video');
            v.preload = 'auto'; v.muted = true; v.src = url;
            const done = function () { res(); };
            v.onloadeddata = done; v.onerror = done;
            setTimeout(done, 8000);
          } catch (e) { res(); }
        });
      });
      return pump();
    }
    // static image: the same function the slide uses -> its cache makes the later load instant
    queue.push(function () {
      return (typeof resolveRemoteToDataUrl === 'function') ? resolveRemoteToDataUrl(url) : Promise.resolve();
    });
    pump();
  }
  const URL_RE = /"(?:src|url|gifUrl|videoUrl|image|imageUrl|backgroundImage|background|bg)"\s*:\s*"(https?:\/\/[^"\\\s]+)"/g;
  let scanPos = 0;
  function scanStream(buf) {
    buf = String(buf || '');
    if (buf.length < scanPos) scanPos = 0;                 // new stream
    const from = Math.max(0, scanPos - 400);              // overlap: a URL may be split between chunks
    const part = buf.slice(from);
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(part))) preload(m[1]);
    scanPos = buf.length;
  }
  function resetStream() { scanPos = 0; }

  // ------------------------------------------------------------------ 5) one URL once per presentation
  function deckUsedUrls(skipIndex) {
    const used = new Set();
    try {
      (slides || []).forEach(function (s, i) {
        // the slide being rebuilt (replace_slide, also applied a 2nd time when its JSON block closes) does not count
        if (!s || typeof s.json !== 'string' || i === skipIndex || s._ssPH) return;
        let d = null;
        try { d = JSON.parse(s.json); } catch (e) { return; }
        (d.objects || []).forEach(function (o) {
          if (!o) return;
          [o.ssSrcUrl, o.gifUrl, o.videoUrl, isHttp(o.src) ? o.src : ''].forEach(function (u) { if (u && isHttp(normUrl(u))) used.add(normUrl(u)); });
          if (o.ssSlotEl) { try { const e = JSON.parse(o.ssSlotEl); const u = normUrl(elUrl(e)); if (isHttp(u)) used.add(u); } catch (e2) {} }
        });
      });
    } catch (e) {}
    return used;
  }
  /** Before an AI slide is built: an image URL already used in this presentation is replaced by an unused one
   *  from the server's session pool (same kind), or the element is dropped. Text is never touched. */
  function dedupeElements(elements) {
    if (!Array.isArray(elements) || !aiActive()) return elements;
    const used = deckUsedUrls(typeof window._ssBuildTargetIdx === 'number' ? window._ssBuildTargetIdx : -1);
    const pool = Array.isArray(window._ssImagePool) ? window._ssImagePool : [];
    const out = [];
    elements.forEach(function (el) {
      const isMedia = el && (el.type === 'image' || el.type === 'gifImage' || el.isGif || el.type === 'videoImage' || el.isVideo);
      if (!isMedia) { out.push(el); return; }
      const u = normUrl(elUrl(el));
      if (!isHttp(u) || !used.has(u)) { if (isHttp(u)) used.add(u); out.push(el); return; }
      const gif = !!(el.isGif || el.type === 'gifImage' || looksGif(u));
      const alt = pool.find(function (p) {
        const pu = normUrl(p && p.url);
        return isHttp(pu) && !used.has(pu) && (!!(p.kind === 'gif') === gif);
      });
      if (!alt) { console.info('[lazy-media] duplicate image dropped:', u); return; }
      const nu = normUrl(alt.url);
      used.add(nu);
      const copy = Object.assign({}, el);
      if (copy.gifUrl) copy.gifUrl = nu;
      if (copy.videoUrl) copy.videoUrl = nu;
      copy.src = nu;
      if (copy.ssSrcUrl) copy.ssSrcUrl = nu;
      out.push(copy);
    });
    return out;
  }

  window.SSLazyMedia = {
    shouldDefer: shouldDefer, slotFor: slotFor, preload: preload, scanStream: scanStream, resetStream: resetStream,
    reflowWhenFontsReady: reflowWhenFontsReady, dedupeElements: dedupeElements, deckUsedUrls: deckUsedUrls,
    pending: function () { let n = 0; slots.forEach(function (_r, id) { if (!cancelled.has(id)) n++; }); return n; },
    /** a slide is rebuilt/removed: its old slots will never be shown */
    forgetSlotsIn: function (json) {
      try {
        const d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
        (d.objects || []).forEach(function (o) { if (o && o.ssSlotId && slots.has(o.ssSlotId)) cancelled.add(o.ssSlotId); });
      } catch (e) {}
    },
    whenIdle: function () { return Promise.all(Array.from(slots.values()).map(function (r) { return r.promise; })); },
    FADE_MS: FADE_MS,
  };

  preloadFonts();
  defineSlot();
  // the app may create (or re-create) the main canvas after this file ran -> keep the hook attached
  hookCanvas();
  setInterval(hookCanvas, 1000);
})();
