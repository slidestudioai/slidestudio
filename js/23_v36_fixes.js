/* v36 — matn qutisi, tahrirlash va shrift o'lchamlari
 *  1. Matn qutisi ANIQ (qat'iy) o'lchamli: width + height (_boxH). Matn so'zma-so'z pastga tushadi,
 *     sig'maganda shrift (fontSize) kichrayadi (auto-fit), joy ko'paysa asl o'lchamgacha qaytadi (_baseFont),
 *     eng kichik shriftda ham sig'masa — quti chegarasida kesiladi (overflow: hidden), boshqa elementlarga chiqmaydi.
 *  2. Shrift yuklangach Fabric "harf kengligi keshi" eskirib qolardi → matn oxiridagi 1-2 harf belgilanmas,
 *     kursor oxirga bormasdi. Endi shrift yuklanganda va tahrirlashga kirganda kesh yangilanadi.
 *  3. Matn ichida harflarga alohida fontSize yozilib qolishi ("boshida bitta katta harf") — tozalanadi.
 *  4. AI yaratgan matn quti balandligi CardFit.fit dan keyin qat'iylanadi (qo'lda yozilganidek ishlaydi).
 */
(function () {
  'use strict';

  var MIN_RATIO = 0.35, MIN_PX = 9;
  // Matn belgilanganda ko'k "bo'yoq" matn rangini ko'k ko'rsatardi — neytral kulrang
  try { fabric.IText.prototype.selectionColor = 'rgba(0,0,0,0.14)'; fabric.Textbox.prototype.selectionColor = 'rgba(0,0,0,0.14)'; } catch (e) {}

  // ------------------------------------------------------------------
  // 0. dispose() qilingan vaqtinchalik kanvasda kechikib ishga tushadigan render:
  //    "Cannot read properties of null (reading 'clearRect')" xatolarining (yuzlab) manbai
  // ------------------------------------------------------------------
  try {
    [fabric.StaticCanvas.prototype, fabric.Canvas.prototype].forEach(function (P) {
      ['renderAll', 'renderAndReset', 'renderTop'].forEach(function (n) {
        if (!Object.prototype.hasOwnProperty.call(P, n) || P[n].__ssSafe) return;
        var orig = P[n];
        P[n] = function () { if (!this.contextContainer || !this.lowerCanvasEl) return this; return orig.apply(this, arguments); };
        P[n].__ssSafe = true;
      });
    });
    var _cc = fabric.StaticCanvas.prototype.clearContext;
    fabric.StaticCanvas.prototype.clearContext = function (ctx) { if (!ctx) return this; return _cc.apply(this, arguments); };
  } catch (e) { console.warn('v36 safe render:', e); }

  function isTB(o) { return !!o && o.type === 'textbox' && !o.isButton && !o.isEmbed; }
  function isAnyText(o) { return !!o && (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text'); }

  // ------------------------------------------------------------------
  // 2. Shrift o'lchov keshi
  // ------------------------------------------------------------------
  function flushFontCache(fam) {
    try {
      if (!fabric.charWidthsCache) return;
      if (fam) delete fabric.charWidthsCache[String(fam).toLowerCase()];
      else fabric.charWidthsCache = {};
    } catch (e) {}
  }
  function remeasure(o) { try { o.initDimensions(); o.setCoords(); o.dirty = true; } catch (e) {} }
  function flushAll() {
    flushFontCache();
    try {
      if (typeof canvas === 'undefined' || !canvas) return;
      canvas.getObjects().forEach(function (o) { if (isAnyText(o)) remeasure(o); });
      canvas.requestRenderAll();
    } catch (e) {}
  }
  window.ssFlushTextMetrics = flushAll;
  var flushTimer = null;
  function flushSoon() { clearTimeout(flushTimer); flushTimer = setTimeout(flushAll, 30); }
  try {
    if (document.fonts) {
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', flushSoon);
      if (document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(flushSoon);
    }
    // document.fonts.load(...) va FontFace.load() tugagach ham (loadingdone har doim ham kelmaydi)
    if (document.fonts && typeof document.fonts.load === 'function' && !document.fonts.__ssWrapped) {
      var _dfl = document.fonts.load.bind(document.fonts);
      document.fonts.load = function () { var pr = _dfl.apply(null, arguments); try { pr.then(flushSoon, function () {}); } catch (e) {} return pr; };
      document.fonts.__ssWrapped = true;
    }
    if (window.FontFace && FontFace.prototype && !FontFace.prototype.__ssWrapped) {
      var _ffl = FontFace.prototype.load;
      FontFace.prototype.load = function () { var pr = _ffl.apply(this, arguments); try { pr.then(flushSoon, function () {}); } catch (e) {} return pr; };
      FontFace.prototype.__ssWrapped = true;
    }
  } catch (e) {}

  // ------------------------------------------------------------------
  // 3. Harflarga alohida fontSize yozilib qolishini tozalash
  // ------------------------------------------------------------------
  function stripSizeStyles(o) {
    var changed = false;
    try {
      var st = o && o.styles;
      if (!st) return false;
      Object.keys(st).forEach(function (ln) {
        var row = st[ln];
        Object.keys(row).forEach(function (ch) {
          if (row[ch] && row[ch].fontSize !== undefined) { delete row[ch].fontSize; changed = true; }
          if (row[ch] && !Object.keys(row[ch]).length) delete row[ch];
        });
        if (!Object.keys(row).length) delete st[ln];
      });
    } catch (e) {}
    return changed;
  }

  // ------------------------------------------------------------------
  // 1. Aniq o'lchamli quti + auto-fit + overflow:hidden
  // ------------------------------------------------------------------
  function naturalH(o) { o.initDimensions(); return o.calcTextHeight(); }

  function fit(o) {
    if (!isTB(o) || !o._boxH || o.__ssFitting) return;
    o.__ssFitting = true;
    try {
      stripSizeStyles(o);
      var base = o._baseFont || o.fontSize || 24;
      o._baseFont = base;
      var minF = Math.min(base, Math.max(MIN_PX, Math.round(base * MIN_RATIO)));
      var box = o._boxH;
      o.fontSize = base;
      if (naturalH(o) > box + 0.5) {
        var lo = minF, hi = base, best = minF;
        while (lo <= hi) {
          var mid = (lo + hi) >> 1;
          o.fontSize = mid;
          if (naturalH(o) <= box + 0.5) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        o.fontSize = best;
        o.initDimensions();
      }
      o.height = box;          // quti balandligi o'zgarmaydi
      o.dirty = true;
      try { o.setCoords(); } catch (e) {}
    } finally { o.__ssFitting = false; }
  }
  // grow=true: foydalanuvchi o'zi o'lcham/uslub tanladi → quti kerak bo'lsa KENGAYADI (tanlov orqaga kichraymaydi)
  window.SSTextFit = function (o, grow) {
    if (!isTB(o)) return;
    if (grow) {
      o.__ssFitting = true;
      var h = 24;
      try { o.initDimensions(); h = o.calcTextHeight(); } finally { o.__ssFitting = false; }
      o._boxH = Math.max(o._boxH || 0, h, 24);
    }
    fit(o);
  };

  (function patchTextbox() {
    try {
      var P = fabric.Textbox.prototype;
      if (P.__ssV36) return;
      P.__ssV36 = true;

      var _init = P.initDimensions;           // (17_ux_fix.js dagi _boxH yamog'i ham shu yerda)
      P.initDimensions = function () {
        _init.apply(this, arguments);
        if (this._boxH && !this.__ssFitting && !window.__ssNoFit) fit(this);
      };

      var _to = P.toObject;
      P.toObject = function () {
        var out = _to.apply(this, arguments);
        if (this._baseFont) out._baseFont = this._baseFont;
        return out;
      };

      var _rn = P._render;
      P._render = function (ctx) {
        if (this._boxH && !this.isEditing && this.height > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(-this.width / 2 - 60, -this.height / 2 - 60, this.width + 120, this.height + 60);   // faqat pastdan kesadi
          ctx.clip();
          try { _rn.apply(this, arguments); } finally { ctx.restore(); }
        } else {
          _rn.apply(this, arguments);
        }
      };
    } catch (e) { console.warn('v36 patchTextbox:', e); }
  })();

  // ------------------------------------------------------------------
  // 4. AI slaydi: CardFit.fit dan keyin matn qutilarini qat'iylash
  // ------------------------------------------------------------------
  function freezeBoxes(cv) {
    try {
      (cv.getObjects ? cv.getObjects() : []).forEach(function (o) {
        if (!isTB(o) || o._boxH) return;
        o.initDimensions();
        var h = o.calcTextHeight();
        o._baseFont = o.fontSize;
        o._boxH = Math.max(h, (o._aiBoxH && o._aiBoxH > h) ? o._aiBoxH : 0, 24);
        delete o._aiBoxH;
        o.initDimensions();
      });
    } catch (e) { console.warn('v36 freezeBoxes:', e); }
  }
  // ------------------------------------------------------------------
  // 5. AI slaydida ustma-ust tushgan elementlarni avtomatik ajratish (kod darajasida kafolat)
  // ------------------------------------------------------------------
  var SW = 960, SH = 540, GAP = 14, EDGE = 24;
  function fillAlpha(f) {
    if (f == null || f === '' || f === 'transparent') return 0;
    if (typeof f !== 'string') return 1;
    var m = /rgba?\(([^)]+)\)/i.exec(f);
    if (m) { var p = m[1].split(','); return p.length > 3 ? (parseFloat(p[3]) || 0) : 1; }
    var h = /^#([0-9a-f]{8})$/i.exec(f);
    if (h) return parseInt(h[1].slice(6), 16) / 255;
    return 1;
  }
  // AI ba'zan butun slayd kattaligidagi, lekin siljigan (chap-yuqori ochiq, pastga/o'ngga chiqib ketgan) yoki
  // shaffof to'rtburchak qo'yadi. Shaffof bo'lsa o'chiriladi; chiqib ketgan bo'lsa slayd ichiga to'g'rilanadi.
  function fixBigRects(cv) {
    try {
      (cv.getObjects ? cv.getObjects().slice() : []).forEach(function (o) {
        if (!o || o.type !== 'rect' || o.isButton || o.isEmbed || o.visible === false) return;
        var sx = o.scaleX || 1, sy = o.scaleY || 1, w = (o.width || 0) * sx, h = (o.height || 0) * sy, l = o.left || 0, t = o.top || 0;
        if (w < SW * 0.9 || h < SH * 0.9) return;
        var a = fillAlpha(o.fill) * (o.opacity == null ? 1 : o.opacity);
        if (a < 0.08 && !(o.stroke && o.strokeWidth > 0)) { cv.remove(o); return; }
        var over = l < -2 || t < -2 || l + w > SW + 2 || t + h > SH + 2;
        if (!over) return;
        if (w >= SW * 0.97 && h >= SH * 0.97) o.set({ left: 0, top: 0, width: SW / sx, height: SH / sy });
        else o.set({ left: 40, top: 40, width: (SW - 80) / sx, height: (SH - 80) / sy });
        o.setCoords();
      });
    } catch (e) { console.warn('v36 fixBigRects:', e); }
  }
  window.SSFixBigRects = fixBigRects;
  function box(o) {
    var w = (o.width || 0) * (o.scaleX || 1), h = (o.height || 0) * (o.scaleY || 1);
    return { l: o.left || 0, t: o.top || 0, w: w, h: h, r: (o.left || 0) + w, b: (o.top || 0) + h };
  }
  function isItem(o) {
    if (!o || o.visible === false) return false;
    if (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') return !!String(o.text || '').trim();
    return o.type === 'image' || o.type === 'gifImage' || o.isGif || o.isVideo || o.isEmbed || o.isButton || o.type === 'videoImage' || o.type === 'embedVideo' || o.type === 'slideButton';
  }
  function isShape(o) { return o && /^(rect|circle|ellipse|triangle|polygon|path|line)$/.test(o.type) && !isItem(o); }
  function inter(a, b) {
    var ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    return (ox > 3 && oy > 3) ? { ox: ox, oy: oy } : null;
  }
  function resolveOverlaps(cv) {
    try {
      var objs = (cv.getObjects ? cv.getObjects() : []);
      var items = objs.filter(isItem);
      if (items.length < 2) return;
      var cards = objs.filter(function (o) { if (!isShape(o)) return false; var bb = box(o); return bb.w * bb.h >= 0.06 * SW * SH || (bb.w >= 160 && bb.h >= 90); });
      function cardOf(o) {      // elementni to'liq o'z ichiga olgan eng kichik karta
        var bo = box(o), best = null, ba = 1e12;
        cards.forEach(function (c) { var bc = box(c); if (bo.l >= bc.l - 2 && bo.t >= bc.t - 2 && bo.r <= bc.r + 2 && bo.b <= bc.b + 2) { var a = bc.w * bc.h; if (a < ba) { ba = a; best = bc; } } });
        return best;
      }
      for (var pass = 0; pass < 4; pass++) {
        var moved = false;
        items.sort(function (a, b) { return (a.top || 0) - (b.top || 0) || (a.left || 0) - (b.left || 0); });
        for (var i = 0; i < items.length; i++) {
          for (var j = i + 1; j < items.length; j++) {
            var A = items[i], B = items[j], a = box(A), b = box(B);
            var x = inter(a, b);
            if (!x) continue;
            // B ni A ning tagiga suramiz (karta ichida bo'lsa — karta pastki chegarasigacha)
            var c = cardOf(B), limit = c ? c.b - 24 : SH - EDGE;
            var newTop = a.b + GAP;
            if (newTop + b.h <= limit) { B.top = newTop; B.setCoords && B.setCoords(); moved = true; continue; }
            // sig'masa: yonma-yon (o'ngga) surib ko'ramiz
            var newLeft = a.r + GAP, rlimit = c ? c.r - 24 : SW - EDGE;
            if (x.oy > 3 && newLeft + b.w <= rlimit) { B.left = newLeft; B.setCoords && B.setCoords(); moved = true; continue; }
            // baribir sig'masa: matn bo'lsa balandligini/shriftini kamaytirib pastga joylaymiz
            if (isTB(B) && B._boxH && limit - newTop >= 28) {
              B.top = newTop; B._boxH = Math.max(24, limit - newTop); B.initDimensions(); B.setCoords && B.setCoords(); moved = true;
            }
          }
        }
        if (!moved) break;
      }
    } catch (e) { console.warn('v36 resolveOverlaps:', e); }
  }
  window.SSResolveOverlaps = resolveOverlaps;

  (function wrapCardFit() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (window.CardFit && typeof window.CardFit.fit === 'function') {
        clearInterval(t);
        if (window.CardFit.__ssV36) return;
        var orig = window.CardFit.fit;
        window.CardFit.fit = function (cv) { fixBigRects(cv); var r = orig.apply(this, arguments); freezeBoxes(cv); resolveOverlaps(cv); return r; };
        window.CardFit.__ssV36 = true;
      } else if (tries > 100) clearInterval(t);
    }, 100);
  })();

  // ------------------------------------------------------------------
  // Tahrirlash seansi
  // ------------------------------------------------------------------
  function init() {
    canvas.on('text:editing:entered', function (e) {
      var o = e && e.target; if (!isAnyText(o)) return;
      flushFontCache(o.fontFamily);
      if (isTB(o) && !o._boxH) {            // eski (qat'iylanmagan) quti: hozirgi o'lchami quti sifatida qotiriladi
        o.initDimensions();
        o._baseFont = o._baseFont || o.fontSize;
        o._boxH = Math.max(o.height, 24);
      }
      stripSizeStyles(o);
      remeasure(o);
      canvas.requestRenderAll();
    });
    canvas.on('text:changed', function (e) {
      var o = e && e.target; if (!isAnyText(o)) return;
      if (stripSizeStyles(o)) { remeasure(o); canvas.requestRenderAll(); }
    });
    canvas.on('text:editing:exited', function (e) {
      var o = e && e.target; if (!isTB(o)) return;
      stripSizeStyles(o); fit(o); canvas.requestRenderAll();
    });
    // slayd almashganda / yuklanganda mavjud matnlarni qayta o'lchash (shrift keshi eskirgan bo'lishi mumkin)
    setTimeout(flushAll, 400);
    try {
      if (typeof loadSlideCanvasAsync === 'function' && !loadSlideCanvasAsync.__ssWrapped) {
        var _ls = loadSlideCanvasAsync;
        var wl = function () { var pr = _ls.apply(this, arguments); try { Promise.resolve(pr).then(function () { flushSoon(); setTimeout(flushSoon, 500); }); } catch (e) {} return pr; };
        wl.__ssWrapped = true;
        window.loadSlideCanvasAsync = wl;
      }
    } catch (e) {}
  }

  var tries = 0;
  var ti = setInterval(function () {
    tries++;
    var ok = false;
    try { ok = typeof canvas !== 'undefined' && canvas && typeof canvas.on === 'function' && typeof fabric !== 'undefined'; } catch (e) {}
    if (ok) { clearInterval(ti); try { init(); } catch (e) { console.warn('v36 init:', e); } }
    else if (tries > 100) clearInterval(ti);
  }, 100);
})();

/* v36 — har qanday tahrirlash tugmasi (o'chirish, tepaga/pastga, kattalashtirish/kichraytirish, rang, shrift, animatsiya ...)
 * bosilgan SONIYADA slayd holati saqlanadi va chap paneldagi varaq (miniatyura) yangilanadi —
 * boshqa elementga tegib "turtish" shart emas. */
(function () {
  'use strict';
  var SEL = '#ribbonToolbar, .context-menu, #shapesMenu, #colorModal, #animPanel, .anim-panel, [id*="mediaFx"], [class*="media-fx"], [class*="mfx"]';
  var busy = false;
  function aiBusy() {
    try { return !!(window.isAiStreaming || window.isAiApplyingCommands || (typeof isAiStreaming !== 'undefined' && isAiStreaming) || (typeof isAiApplyingCommands !== 'undefined' && isAiApplyingCommands)); } catch (e) { return false; }
  }
  function commit() {
    if (busy || aiBusy()) return;
    busy = true;
    try {
      if (typeof saveCurrentSlideState === 'function') saveCurrentSlideState({ force: true });
      // (recordGlobalState bu yerda CHAQIRILMAYDI — aks holda Ctrl+Z tarixida bir xil nusxalar ko'payib, Undo "ishlamayotgandek" bo'ladi)
      if (typeof refreshSlideThumb === 'function' && typeof activeIndex === 'number') refreshSlideThumb(activeIndex);
      else if (typeof renderSidebar === 'function') renderSidebar();
    } catch (e) { console.warn('v36 commit:', e); }
    busy = false;
  }
  window.ssCommitNow = commit;
  function schedule() { setTimeout(commit, 0); setTimeout(commit, 220); }
  function inPanel(t) { try { return !!(t && t.closest && t.closest(SEL)); } catch (e) { return false; } }
  ['click', 'change', 'input'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (inPanel(e.target)) schedule(); }, true);
  });
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'Delete' || k === 'Backspace' || (e.ctrlKey || e.metaKey) && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      schedule();
    }
  }, true);
  var tries = 0;
  var ti = setInterval(function () {
    tries++;
    var ok = false;
    try { ok = typeof canvas !== 'undefined' && canvas && typeof canvas.on === 'function'; } catch (e) {}
    if (ok) {
      clearInterval(ti);
      canvas.on('object:removed', function () { if (!aiBusy() && !window.isUndoRedoAction) schedule(); });
      canvas.on('object:modified', function () { if (!aiBusy()) setTimeout(commit, 0); });
    } else if (tries > 100) clearInterval(ti);
  }, 100);
})();
