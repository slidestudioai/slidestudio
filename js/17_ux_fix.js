/* v28 — UX tuzatishlar
 *  1. GIF endi kanvas ichida jonli chiziladi (video kabi): oldinga/orqaga, qatlam tartibi, eksport to'g'ri
 *  2. O'lcham o'zgartirish: matn cho'zilmaydi (kenglik o'zgaradi, matn qatorlarga bo'linadi),
 *     burchak tutqichi shrift+kenglikni birga o'zgartiradi, shakllarning yumaloq burchagi cho'zilmaydi,
 *     bir tomondan tortsangiz faqat shu tomon o'zgaradi (qarama-qarshi tomon joyida qoladi)
 *  3. Tutqichlar: bir xil, aniq va sensorda katta
 *  4. Yuklanish pardasi: sahifa to'liq tayyor bo'lgunicha yopilmaydi (1,2,3 sonli buzilgan dizayn ko'rinmaydi)
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // 1. GIF jonli chizish
  // ------------------------------------------------------------------
  window.GIF_NATIVE_RENDER = true;

  const GifLive = (function () {
    let host = null;
    function getHost() {
      if (host && host.isConnected) return host;
      host = document.getElementById('gifKeepAlive');
      if (!host) {
        host = document.createElement('div');
        host.id = 'gifKeepAlive';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1;';
        (document.body || document.documentElement).appendChild(host);
      }
      return host;
    }
    function sameOriginOrSafe(u) {
      if (!u) return true;
      if (/^(data:|blob:|\/)/i.test(u)) return true;
      try { return new URL(u, location.href).origin === location.origin; } catch (e) { return true; }
    }
    /** Brauzer animatsiyani davom ettirishi uchun element DOM da turishi kerak; CORS ham ta'minlanadi */
    function keepAlive(el) {
      if (!el || el.__ssKeep) return;
      el.__ssKeep = 1;
      try {
        const src = el.currentSrc || el.src || '';
        if (src && !sameOriginOrSafe(src) && !el.crossOrigin) {
          const orig = src;
          el.crossOrigin = 'anonymous';
          el.addEventListener('error', function onErr() {
            if (el.__ssProxied) return;
            el.__ssProxied = 1;
            el.removeAttribute('crossorigin');
            el.src = '/api/proxy-image?raw=1&url=' + encodeURIComponent(orig);
          });
          el.src = orig;
        }
        el.style.width = '2px'; el.style.height = '2px';
        getHost().appendChild(el);
        el.addEventListener('load', function () { try { canvas.requestRenderAll(); } catch (e) {} });
      } catch (e) {}
    }
    function hasLive() {
      try {
        const a = canvas.getObjects();
        for (let i = 0; i < a.length; i++) { if (a[i] && ((a[i].isGif || a[i].type === 'gifImage') || (a[i].type === 'embedVideo' && a[i]._vid && !a[i]._vidFailed)) && a[i].visible !== false) return true; }
      } catch (e) {}
      return false;
    }
    let last = 0;
    function loop(t) {
      requestAnimationFrame(loop);
      if (document.hidden || t - last < 40) return;     // ~25 kadr/s
      last = t;
      try {
        if (typeof canvas === 'undefined' || !canvas) return;
        const ao = canvas.getActiveObject && canvas.getActiveObject();
        if (ao && ao.isEditing) return;                  // matn yozilayotganda xalaqit bermaymiz
        if (hasLive()) canvas.requestRenderAll();
      } catch (e) {}
    }
    requestAnimationFrame(loop);
    return { keepAlive: keepAlive, hasLive: hasLive };
  })();
  window.GifLive = GifLive;

  window.VideoLive = (function () {
    // v30: video elementi faqat uzoq vaqt (3 tekshiruv = ~9 s) hech bir obyekt ishlatmasa o'chiriladi.
    // Avval slayd yuklanayotgan paytda (kanvas vaqtincha bo'sh) video o'chib qolardi — "chap tomonda yo'qolish" shundan.
    function register() {}
    setInterval(function () {
      try {
        const cache = window.__ssVidCache || {};
        const used = {};
        (typeof canvas !== 'undefined' && canvas ? canvas.getObjects() : []).forEach(function (o) {
          if (o && o.type === 'embedVideo' && o.embedUrl) used[o.embedUrl] = 1;
        });
        // boshqa slaydlardagi videolar ham darhol o'chirilmasin (slaydlar orasida tez almashganda)
        Object.keys(cache).forEach(function (u) {
          const c = cache[u];
          if (used[u]) { c.miss = 0; return; }
          c.miss = (c.miss || 0) + 1;
          if (c.miss >= 3) {
            try { c.v.pause(); c.v.removeAttribute('src'); c.v.load(); c.v.remove(); } catch (e) {}
            delete cache[u];
          }
        });
      } catch (e) {}
    }, 3000);
    return { register: register };
  })();

  // ------------------------------------------------------------------
  // 2. O'lcham o'zgartirish
  // ------------------------------------------------------------------
  const MIN_W = 24;

  function isPlainTextbox(o) { return !!o && o.type === 'textbox' && !o.isButton; }
  function isPlainRect(o) { return !!o && o.type === 'rect' && !o.isButton && !o.isEmbed; }

  function normalizeScaling(e) {
    const t = e && e.target;
    if (!t || t.type === 'activeSelection' || t.type === 'group') return;
    const corner = (e.transform && e.transform.corner) || '';
    const isCorner = corner.length === 2 && corner !== 'ml' && corner !== 'mr' && corner !== 'mt' && corner !== 'mb';
    try {
      if (isPlainTextbox(t)) {
        const sx = Math.abs(t.scaleX || 1), sy = Math.abs(t.scaleY || 1);
        if (sx === 1 && sy === 1) return;
        const tr = e.transform || {};
        const ox = tr.originX || 'left', oy = tr.originY || 'top';
        const anchor = t.getPointByOrigin(ox, oy);        // qo'zg'almas tomon
        const nw = sx !== 1 ? Math.max(MIN_W, t.width * sx) : t.width;
        if (sy !== 1) t._boxH = Math.max(10, t.height * sy);
        t.set({ width: nw, scaleX: 1, scaleY: 1 });      // shrift o'zgarmaydi, matn qatorlarga bo'linadi
        t.initDimensions();
        t.setPositionByOrigin(anchor, ox, oy);
        t.setCoords();
        return;
      }
      if (isPlainRect(t)) {
        const sx = Math.abs(t.scaleX || 1), sy = Math.abs(t.scaleY || 1);
        if (sx === 1 && sy === 1) return;
        const w = Math.max(2, t.width * sx), h = Math.max(2, t.height * sy);
        let rx = t.rx || 0, ry = t.ry || 0;
        if (t.mRadius) { rx = ry = t.mRadius / 100 * Math.min(w, h); }
        rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
        t.set({ width: w, height: h, scaleX: 1, scaleY: 1, rx: rx, ry: ry, strokeUniform: true });
        t.setCoords();
        return;
      }
      if (t.type === 'ellipse') {
        const sx = Math.abs(t.scaleX || 1), sy = Math.abs(t.scaleY || 1);
        if (sx === 1 && sy === 1) return;
        t.set({ rx: Math.max(1, t.rx * sx), ry: Math.max(1, t.ry * sy), scaleX: 1, scaleY: 1, strokeUniform: true });
        t.setCoords();
        return;
      }
      if (t.type === 'circle') {
        const k = Math.abs(t.scaleX || 1);
        if (k === 1 && (t.scaleY || 1) === 1) return;
        t.set({ radius: Math.max(1, t.radius * k), scaleX: 1, scaleY: 1, strokeUniform: true });
        t.setCoords();
        return;
      }
      if (t.type === 'triangle') {
        const sx = Math.abs(t.scaleX || 1), sy = Math.abs(t.scaleY || 1);
        if (sx === 1 && sy === 1) return;
        t.set({ width: Math.max(2, t.width * sx), height: Math.max(2, t.height * sy), scaleX: 1, scaleY: 1, strokeUniform: true });
        t.setCoords();
      }
    } catch (err) { /* jim */ }
  }

  // ------------------------------------------------------------------
  // 2b. Ramka (shakl) ichidagi matn: shakl bilan birga ko'chadi, o'lchanadi va ramkadan chiqmaydi
  // ------------------------------------------------------------------
  let frameState = null;
  function isFrame(o) {
    return !!o && !o.isButton && !o.isEmbed && !o.angle && (o.type === 'rect' || o.type === 'ellipse' || o.type === 'circle' || o.type === 'triangle');
  }
  function tl(o) { const p = o.getPointByOrigin('left', 'top'); return { x: p.x, y: p.y }; }
  function startFrame(e) {
    frameState = null;
    if (!window.SS_FRAME_FOLLOW) return;   // v36: shakl FAQAT o'zi suriladi/o'lchanadi — ostidagi matn va boshqa elementlar joyida qoladi
    const f = e && e.target;
    if (!isFrame(f) || f.type === 'activeSelection') return;
    // v34: shakl/fon ustidagi matn va elementlar HAR DOIM shakl bilan birga yuradi. Shaklni YOLG'IZ surish: Alt ni bosib turing.
    if (e.e && e.e.altKey) return;
    try {
      const objs = canvas.getObjects();
      const fi = objs.indexOf(f);
      const fb = f.getBoundingRect(true, true);
      if (fb.width < 20 || fb.height < 20) return;
      const kids = [];
      objs.forEach(function (o, i) {
        if (i <= fi || !o || o.angle || o.visible === false || o.isBackground || o._isBackground) return;
        if (o.type === 'activeSelection') return;
        const b = o.getBoundingRect(true, true);
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        if (cx < fb.left || cx > fb.left + fb.width || cy < fb.top || cy > fb.top + fb.height) return;
        const p = tl(o);
        kids.push({ o: o, sx0: o.scaleX, sy0: o.scaleY, rx: (p.x - fb.left) / fb.width, ry: (p.y - fb.top) / fb.height, rw: o.width / fb.width, fs: o.fontSize, pt: p, left0: o.left, top0: o.top });
      });
      if (!kids.length) return;
      frameState = { f: f, kids: kids, b0: fb, last: { left: f.left, top: f.top } };
    } catch (err) { frameState = null; }
  }
  function moveFrameKids(e) {
    const st = frameState;
    if (!st || !e || e.target !== st.f) return;
    const dx = st.f.left - st.last.left, dy = st.f.top - st.last.top;
    st.last = { left: st.f.left, top: st.f.top };
    if (!dx && !dy) return;
    st.kids.forEach(function (k) { k.o.set({ left: k.o.left + dx, top: k.o.top + dy }); k.o.setCoords(); });
  }
  function scaleFrameKids(e) {
    const st = frameState;
    if (!st || !e || e.target !== st.f) return;
    const corner = (e.transform && e.transform.corner) || '';
    const isCorner = corner.length === 2 && corner !== 'ml' && corner !== 'mr' && corner !== 'mt' && corner !== 'mb';
    const nb = st.f.getBoundingRect(true, true);
    const kx = nb.width / st.b0.width, ky = nb.height / st.b0.height;
    const pad = Math.max(6, Math.min(nb.width, nb.height) * 0.04);
    st.kids.forEach(function (k) {
      const o = k.o;
      if (!isPlainTextbox(o)) {   // v34: rasm/GIF/video/shakl — shakl bilan proporsional ko'chadi va o'lchanadi
        const p0 = k.pt;
        o.set({ scaleX: (k.sx0 != null ? k.sx0 : o.scaleX) * kx, scaleY: (k.sy0 != null ? k.sy0 : o.scaleY) * ky });
        o.setPositionByOrigin(new fabric.Point(nb.left + k.rx * nb.width, nb.top + k.ry * nb.height), 'left', 'top');
        o.setCoords();
        return;
      }
      const fs = isCorner ? Math.max(8, k.fs * Math.min(kx, ky)) : (o.fontSize || k.fs);
      o.set({ fontSize: fs, width: Math.max(MIN_W, k.rw * nb.width) });
      // ramkaga sig'masa shrift kichraytiriladi
      let guard = 80;
      while (guard-- > 0 && o.fontSize > 10 && (o.height + pad * 2 > nb.height || o.width + pad > nb.width + 0.5)) {
        o.set({ fontSize: o.fontSize - 1 });
      }
      let nl = nb.left + k.rx * nb.width, nt = nb.top + k.ry * nb.height;
      nt = Math.min(nt, nb.top + nb.height - o.height - pad); nt = Math.max(nt, nb.top + pad);
      o.setPositionByOrigin(new fabric.Point(nl, nt), 'left', 'top');
      o.setCoords();
    });
  }
  function endFrame() { frameState = null; try { canvas.requestRenderAll(); } catch (e) {} }

  function tuneSelection(e) {
    const objs = (e && e.selected) || [];
    objs.forEach(function (o) {
      try {
        if (o.setControlsVisibility && o.type !== 'activeSelection') {
          o.setControlsVisibility({ mt: true, mb: true, ml: true, mr: true, tl: true, tr: true, bl: true, br: true, mtr: true });
        }
      } catch (err) {}
    });
  }

  // ------------------------------------------------------------------
  // 3. Tutqichlar ko'rinishi
  // ------------------------------------------------------------------
  function styleHandles() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const props = {
      cornerStyle: 'circle', cornerColor: '#ffffff', cornerStrokeColor: '#2563eb',
      borderColor: '#2563eb', transparentCorners: false, padding: 0,
      cornerSize: coarse ? 16 : 11, touchCornerSize: coarse ? 36 : 24,
      borderScaleFactor: coarse ? 2 : 1.5, borderOpacityWhenMoving: 0.6, strokeUniform: true
    };
    try { fabric.Object.prototype.set(props); } catch (e) {}
    try { canvas.getObjects().forEach(function (o) { o.set(props); }); } catch (e) {}
    try { fabric.Object.prototype.lockScalingFlip = true; } catch (e) {}
    try { fabric.Object.prototype.centeredScaling = false; } catch (e) {}
  }

  (function patchTextbox() {
    try {
      const P = fabric.Textbox.prototype;
      if (P.__ssBoxPatched) return;
      P.__ssBoxPatched = true;
      const _init = P.initDimensions;
      P.initDimensions = function () {
        _init.apply(this, arguments);
        if (this._boxH && this.height < this._boxH) this.height = this._boxH;   // ramka balandligi
      };
      const _to = P.toObject;
      P.toObject = function () {
        const o = _to.apply(this, arguments);
        if (this._boxH) o._boxH = this._boxH;
        if (this.linkUrl) o.linkUrl = this.linkUrl;
        return o;
      };
    } catch (e) {}
  })();

  function initCanvasTweaks() {
    canvas.centeredKey = 'none';          // Alt bosilganda ham ikki tomonlama cho'zilmasin
    canvas.uniScaleKey = 'shiftKey';
    canvas.targetFindTolerance = 4;
    canvas.on('mouse:down', startFrame);
    canvas.on('object:moving', moveFrameKids);
    canvas.on('object:scaling', function (e) { normalizeScaling(e); scaleFrameKids(e); });
    canvas.on('mouse:up', function (e) {
      endFrame();
      try {
        const o = e && e.target, ev = e && e.e;
        if (o && o.linkUrl && ev && (ev.ctrlKey || ev.metaKey) && /^(https?:|mailto:|tel:)/i.test(o.linkUrl)) window.open(o.linkUrl, '_blank', 'noopener');
      } catch (err) {}
    });
    canvas.on('selection:created', tuneSelection);
    canvas.on('selection:updated', tuneSelection);
    canvas.on('object:added', function (e) {
      try {
        const o = e && e.target;
        if (o && o.type !== 'activeSelection') o.set({ strokeUniform: true });
        if (isPlainTextbox(o)) { o.set({ splitByGrapheme: false }); }
      } catch (err) {}
    });
    styleHandles();
    // Matn: so'z ichida emas, so'z chegarasida bo'linsin (avval grafema bo'yicha bo'linardi)
    try { canvas.getObjects().forEach(function (o) { if (isPlainTextbox(o)) o.set({ splitByGrapheme: false }); }); } catch (e) {}
    try { canvas.requestRenderAll(); } catch (e) {}
  }

  // ------------------------------------------------------------------
  // 4. Yuklanish pardasi — tayyor bo'lguncha yopilmaydi
  // ------------------------------------------------------------------
  const realHide = window.hideLoading;
  let wanted = false, shown = false, startedAt = Date.now();
  function appReady() {
    try {
      return document.readyState === 'complete' &&
        typeof slides !== 'undefined' && slides.length > 0 &&
        typeof canvas !== 'undefined' && canvas && canvas.getWidth() > 0 &&
        document.body.classList.contains('fonts-ready');
    } catch (e) { return false; }
  }
  function reveal() {
    if (shown) return;
    shown = true;
    try { if (typeof fitCanvasToScreen === 'function') fitCanvasToScreen(); } catch (e) {}
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.body.classList.add('ss-ready');
        try { if (typeof realHide === 'function') realHide(); } catch (e) {}
      });
    });
  }
  function poll() {
    if (shown) return;
    const age = Date.now() - startedAt;
    if ((wanted && appReady() && age > 250) || age > 6000) { reveal(); return; }
    setTimeout(poll, 100);
  }
  if (typeof realHide === 'function') {
    window.hideLoading = function () { wanted = true; };
    poll();
  }

  // ------------------------------------------------------------------
  // ishga tushirish
  // ------------------------------------------------------------------
  let tries = 0;
  const t = setInterval(function () {
    tries++;
    let ok = false;
    try { ok = typeof canvas !== 'undefined' && canvas && typeof canvas.on === 'function' && typeof fabric !== 'undefined'; } catch (e) {}
    if (ok) { clearInterval(t); if (!window._uxFixDone) { window._uxFixDone = true; try { initCanvasTweaks(); } catch (e) { console.warn('uxfix:', e); } } }
    else if (tries > 100) clearInterval(t);
  }, 100);
})();
