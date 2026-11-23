/* =====================================================================
 * 57_smart_resize.js  (v73) — «aqlli» cho'zish
 *
 *  Muammo: bitta matn / shakl cho'zilsa 17_ux_fix.js uni to'g'ri qayta joylaydi, lekin BIR NECHTA belgilangan narsa
 *  (ActiveSelection), GURUH, JADVAL va KROSSVORD yon tomonga / pastga cho'zilsa — hammasi rasmdek cho'zilib, harflar
 *  buzilib ketardi.
 *
 *  Endi cho'zish tugagach (object:modified):
 *   • matn — harflar cho'zilmaydi: eni kengayadi (matn qatorlarga qayta bo'linadi), burchakdan tortilsa shrift ham
 *     mutanosib kattalashadi;
 *   • rasm / GIF / video / ichki guruh — o'z nisbatini saqlaydi va yangi joyining markaziga qo'yiladi;
 *   • oddiy shakllar (to'rtburchak, ellips, chiziq…) — cho'ziladi (shakl uchun bu tabiiy), lekin chegarasi qalinlashmaydi;
 *   • jadval / grafik — yangi o'lchamda QAYTA QURILADI (ustunlar kengayadi, shrift buzilmaydi);
 *   • krossvord to'ri — faqat burchakdan, nisbatni saqlab kattalashadi (yon tutqichlar yashirin).
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssSmartResize) return;
  window.__ssSmartResize = true;

  var GROUP_KEEP = ['_oid', 'id', 'ssKit', 'ssRole', 'ssKitItem', 'cwData', 'animName', 'animDur', 'animDelay', 'animLoop', 'animation',
    'animDuration', 'opacity', 'linkUrl', 'imageNumber'];
  var TC_KEEP = ['_oid', 'id', 'imageNumber', 'animName', 'animDur', 'animDelay', 'animLoop', 'opacity', 'angle', 'flipX', 'flipY', 'visible'];

  function cv() { return (typeof canvas !== 'undefined' && canvas) ? canvas : null; }
  function isText(o) { return o && (o.type === 'textbox' || o.type === 'i-text'); }
  function isTC(o) { return !!o && (o.ssKind === 'table' || o.ssKind === 'chart') && !!o.ssSpec && o.type === 'group'; }
  function isCwGrid(o) { return !!o && o.type === 'group' && (o.ssRole === 'cw_grid' || o.ssRole === 'cw_all'); }
  // nisbat saqlanadigan narsalar: rasm, GIF/video kadri, ichki guruh (stiker, kartochka), doira
  function keepsRatio(o) {
    if (!o) return false;
    if (o.type === 'image' || o.isGif || o.isVideo || o.isEmbed || o.type === 'circle') return true;
    if (o.type === 'group' && !isTC(o)) return true;
    return false;
  }
  function near1(v) { return Math.abs((v || 1) - 1) < 0.004; }

  /* ------------------------------------------------------------------ 1) jadval / grafik: qayta qurish */
  function rebuildTC(o, fx, fy, corner) {
    var sp = o.ssSpec, ng = null;
    var w = (o.width || sp.w || 300) * Math.abs(o.scaleX || 1), h = (o.height || sp.h || 200) * Math.abs(o.scaleY || 1);
    var k = corner ? Math.min(Math.abs(fx), Math.abs(fy)) : 1;
    try {
      if (o.ssKind === 'table' && window.ssBuildTable) {
        var fs0 = (sp.fs0 || sp.fs || 16) * k;
        ng = window.ssBuildTable({ rows: sp.rows, header: sp.header, headerFill: sp.headerFill, headerColor: sp.headerColor, stripe: sp.stripe,
          bodyFill: sp.bodyFill, stripeColor: sp.stripeColor, bodyColor: sp.bodyColor, borderColor: sp.borderColor, cellStyles: sp.cellStyles,
          left: o.left, top: o.top, width: Math.max(240, Math.min(900, w)), maxH: Math.max(120, Math.min(420, h)), fs0: fs0 });
      } else if (o.ssKind === 'chart' && window.ssBuildChart) {
        ng = window.ssBuildChart({ chart: sp.chart, title: sp.title, labels: sp.labels, series: sp.series, colors: sp.colors, textColor: sp.textColor,
          left: o.left, top: o.top, width: w, height: h });
      }
    } catch (e) { console.warn('[resize] table/chart', e); ng = null; }
    if (!ng) return null;
    TC_KEEP.forEach(function (key) { if (o[key] !== undefined) ng[key] = o[key]; });
    var tl = o.getPointByOrigin('left', 'top');
    ng.set({ scaleX: 1, scaleY: 1 });
    ng.setPositionByOrigin(tl, 'left', 'top');
    ng.setCoords();
    return ng;
  }

  /* ------------------------------------------------------------------ 2) bitta bo'lak (selection/guruh ichidan chiqqach) */
  /** o — absolyut koordinatada (scale = o'z masshtabi × fx/fy). Qaytaradi: o'rniga qo'yiladigan obyekt (yoki o'zi). */
  function normalize(o, fx, fy, corner) {
    fx = Math.abs(fx || 1); fy = Math.abs(fy || 1);
    var m = Math.min(fx, fy);
    if (isText(o)) {
      var c = o.getPointByOrigin('left', 'top');
      var sx = Math.abs(o.scaleX || 1), sy = Math.abs(o.scaleY || 1);
      // shrift = matnning o'z masshtabi (odatda 1) × ikki yo'nalishda BIR XIL kattalashgan qism min(fx, fy):
      // yonga cho'zilsa (fy = 1) shrift o'zgarmaydi, burchakdan tortilsa mutanosib kattalashadi
      var fs = Math.max(8, Math.round((o.fontSize || 16) * Math.min(sx / fx, sy / fy) * m * 100) / 100);
      var w = Math.max(30, (o.width || 100) * sx);
      try { if (o.styles && m !== 1) Object.keys(o.styles).forEach(function (ln) { Object.keys(o.styles[ln] || {}).forEach(function (ch) { var st = o.styles[ln][ch]; if (st && st.fontSize) st.fontSize = Math.max(8, st.fontSize * m); }); }); } catch (e) {}
      if (o._boxH) o._boxH = Math.max(10, o._boxH * sy);
      o.set({ fontSize: fs, width: w, scaleX: 1, scaleY: 1 });
      try { o.initDimensions(); } catch (e) {}
      o.setPositionByOrigin(c, 'left', 'top');
      o.setCoords();
      return o;
    }
    if (isTC(o)) return rebuildTC(o, fx, fy, corner || near1(fx / fy)) || o;
    if (keepsRatio(o)) {
      if (near1(fx / fy)) return o;                         // bir xil kattalashgan — hammasi joyida
      var ctr = o.getCenterPoint();
      o.set({ scaleX: (o.scaleX / fx) * m, scaleY: (o.scaleY / fy) * m });
      o.setPositionByOrigin(ctr, 'center', 'center');
      o.setCoords();
      return o;
    }
    if (o.type === 'rect') {
      var tl = o.getPointByOrigin('left', 'top');
      var rw = Math.max(2, o.width * Math.abs(o.scaleX || 1)), rh = Math.max(2, o.height * Math.abs(o.scaleY || 1));
      var rx = Math.min((o.rx || 0) * m, rw / 2), ry = Math.min((o.ry || 0) * m, rh / 2);
      o.set({ width: rw, height: rh, scaleX: 1, scaleY: 1, rx: rx, ry: ry, strokeUniform: true });
      o.setPositionByOrigin(tl, 'left', 'top');
      o.setCoords();
      return o;
    }
    try { o.set('strokeUniform', true); } catch (e) {}
    return o;
  }

  /* ------------------------------------------------------------------ 3) ActiveSelection / guruh */
  function needsWork(list) {
    return list.some(function (o) { return isText(o) || isTC(o) || keepsRatio(o) || o.type === 'rect'; });
  }
  function fixSelection(c, sel, fx, fy, corner) {
    var objs = sel.getObjects().slice();
    if (!needsWork(objs)) return false;
    c.discardActiveObject();                                 // bo'laklar absolyut koordinataga qaytadi
    var out = [];
    objs.forEach(function (o) {
      var r = normalize(o, fx, fy, corner);
      if (r && r !== o) { var idx = c.getObjects().indexOf(o); c.remove(o); c.insertAt(r, Math.max(0, idx), false); }
      out.push(r || o);
    });
    try { c.setActiveObject(new fabric.ActiveSelection(out, { canvas: c })); } catch (e) {}
    return true;
  }
  function fixGroup(c, g, fx, fy, corner) {
    if (typeof g.toActiveSelection !== 'function') return false;
    var objs = g.getObjects();
    if (!needsWork(objs)) return false;
    var keep = {};
    GROUP_KEEP.forEach(function (k) { if (g[k] !== undefined) keep[k] = g[k]; });
    var sel = g.toActiveSelection();                         // guruh bo'laklarga ajraydi (absolyut koordinata)
    var out = [];
    sel.getObjects().slice().forEach(function (o) {
      var r = normalize(o, fx, fy, corner);
      if (r && r !== o) { var idx = c.getObjects().indexOf(o); c.remove(o); c.insertAt(r, Math.max(0, idx), false); }
      out.push(r || o);
    });
    c.discardActiveObject();
    var ng = new fabric.Group(out.map(function (o) { c.remove(o); return o; }), { subTargetCheck: !!g.subTargetCheck });
    Object.keys(keep).forEach(function (k) { ng[k] = keep[k]; });
    c.add(ng);
    c.setActiveObject(ng);
    return true;
  }

  /* ------------------------------------------------------------------ 4) ulanish */
  function onBefore(e) {
    var t = e && e.transform && e.transform.target;
    if (t) t.__ssS0 = { sx: t.scaleX || 1, sy: t.scaleY || 1 };
  }
  function onModified(e) {
    var t = e && e.target, c = cv();
    if (!t || !c) return;
    var act = String((e.transform && e.transform.action) || e.action || '');
    if (!/scale/i.test(act)) return;
    var s0 = t.__ssS0 || { sx: 1, sy: 1 }; t.__ssS0 = null;
    var fx = (t.scaleX || 1) / s0.sx, fy = (t.scaleY || 1) / s0.sy;
    if (near1(fx) && near1(fy)) return;
    var corner = String((e.transform && e.transform.corner) || '');
    var isCorner = corner.length === 2 && ['ml', 'mr', 'mt', 'mb'].indexOf(corner) < 0;
    var changed = false;
    try {
      if (t.type === 'activeSelection') changed = fixSelection(c, t, fx, fy, isCorner);
      else if (isTC(t)) {
        var ng = rebuildTC(t, fx, fy, isCorner || near1(fx / fy));
        if (ng) { var idx = c.getObjects().indexOf(t); c.remove(t); c.insertAt(ng, Math.max(0, idx), false); c.setActiveObject(ng); changed = true; }
      } else if (t.type === 'group' && !isCwGrid(t) && !t.ssKind && !near1(fx / fy)) changed = fixGroup(c, t, fx, fy, isCorner);
    } catch (err) { console.warn('[resize]', err); }
    if (changed) c.requestRenderAll();
  }
  // krossvord to'ri: faqat burchak tutqichlari (nisbat saqlanadi)
  function lockRatio(o) {
    if (!o || !isCwGrid(o) || !o.setControlsVisibility) return;
    o.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
    o.lockSkewingX = o.lockSkewingY = true;
  }
  window.ssLockRatio = lockRatio;

  function hook() {
    var c = cv();
    if (!c || c.__ssSmartResize) return !!c;
    c.__ssSmartResize = true;
    c.on('before:transform', onBefore);
    // BIRINCHI bo'lib ishlaydi: saqlash / undo tarixi allaqachon tuzatilgan holatni yozadi
    c.on('object:modified', onModified);
    try {
      var L = c.__eventListeners && c.__eventListeners['object:modified'];
      if (L && L.length > 1) { L.splice(L.indexOf(onModified), 1); L.unshift(onModified); }
    } catch (e) {}
    var lockSel = function (e) { ((e && e.selected) || []).forEach(lockRatio); try { lockRatio(c.getActiveObject()); } catch (x) {} };
    c.on('selection:created', function (e) { setTimeout(function () { lockSel(e); c.requestRenderAll(); }, 0); });
    c.on('selection:updated', function (e) { setTimeout(function () { lockSel(e); c.requestRenderAll(); }, 0); });
    c.on('object:added', function (e) { lockRatio(e && e.target); });
    return true;
  }
  if (!hook()) { var iv = setInterval(function () { if (hook()) clearInterval(iv); }, 300); setTimeout(function () { clearInterval(iv); }, 30000); }
})();
