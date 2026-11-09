(function () {
  'use strict';
  var isMobile = function () { return window.innerWidth <= 768; };
  var $ = function (id) { return document.getElementById(id); };
  var safe = function (fn) { try { return fn(); } catch (e) { console.warn('[mobile]', e); } };

  var handMode = false;
  var gesture = null;
  var swallowUntilEnd = false;
  var panDrag = null;
  var spaceDown = false;

  function wrapRect() { return $('canvasWrapper').getBoundingClientRect(); }
  function setCardAnim(on) {
    var card = $('canvasCard');
    if (card) card.style.transition = on ? '' : 'none';
  }
  function abortFabricTransform() {
    try {
      if (typeof canvas !== 'undefined' && canvas) {
        canvas._currentTransform = null;
        canvas._groupSelector = null;
        canvas.isDrawingMode = false;
      }
    } catch (e) {}
  }
  function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
  function mid(t) { return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }; }

  function initGestures() {
    var wrap = $('canvasWrapper');
    if (!wrap || wrap._gesturesReady) return;
    wrap._gesturesReady = true;

    wrap.addEventListener('touchstart', function (e) {
      if (swallowUntilEnd) { e.stopPropagation(); e.preventDefault(); return; }
      if (e.touches.length >= 2) {
        e.preventDefault(); e.stopPropagation();
        abortFabricTransform();
        var r = wrapRect(), m = mid(e.touches);
        gesture = { startDist: dist(e.touches) || 1, startMul: (typeof getCanvasZoom === 'function' ? getCanvasZoom() : 1), lastMid: { x: m.x - r.left, y: m.y - r.top } };
        setCardAnim(false);
        return;
      }

      var onBackdrop = (e.target === wrap);
      if (handMode || onBackdrop) {
        e.preventDefault(); e.stopPropagation();
        var t = e.touches[0];
        panDrag = { x: t.clientX, y: t.clientY };
        setCardAnim(false);
      }
    }, { capture: true, passive: false });

    wrap.addEventListener('touchmove', function (e) {
      if (gesture && e.touches.length >= 2) {
        e.preventDefault(); e.stopPropagation();
        var r = wrapRect(), m = mid(e.touches), cur = { x: m.x - r.left, y: m.y - r.top };
        var mul = gesture.startMul * (dist(e.touches) / gesture.startDist);
        safe(function () { zoomCanvasAt(mul, cur.x, cur.y); });
        safe(function () { panCanvasBy(cur.x - gesture.lastMid.x, cur.y - gesture.lastMid.y); });
        gesture.lastMid = cur;
        return;
      }
      if (swallowUntilEnd) { e.preventDefault(); e.stopPropagation(); return; }
      if (panDrag && e.touches.length === 1) {
        e.preventDefault(); e.stopPropagation();
        var t = e.touches[0];
        safe(function () { panCanvasBy(t.clientX - panDrag.x, t.clientY - panDrag.y); });
        panDrag.x = t.clientX; panDrag.y = t.clientY;
      }
    }, { capture: true, passive: false });

    var end = function (e) {
      if (gesture && e.touches.length < 2) {
        gesture = null; setCardAnim(true);

        if (e.touches.length === 1) swallowUntilEnd = true;
      }
      if (e.touches.length === 0) { swallowUntilEnd = false; panDrag = null; setCardAnim(true); }
      if (swallowUntilEnd || panDrag) { e.stopPropagation(); }
    };
    wrap.addEventListener('touchend', end, { capture: true, passive: false });
    wrap.addEventListener('touchcancel', end, { capture: true, passive: false });

    wrap.addEventListener('wheel', function (e) {
      var zoom = (typeof getCanvasZoom === 'function') ? getCanvasZoom() : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        var r = wrapRect();
        var f = Math.exp(-e.deltaY * 0.01);
        zoomCanvasAt(zoom * f, e.clientX - r.left, e.clientY - r.top);
      } else if (zoom > 1.001) {
        e.preventDefault();
        panCanvasBy(-(e.shiftKey ? e.deltaY : e.deltaX), -(e.shiftKey ? 0 : e.deltaY));
      }
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '') && !(e.target || {}).isContentEditable) {
        var ao = (typeof canvas !== 'undefined' && canvas) ? canvas.getActiveObject() : null;
        if (!(ao && ao.isEditing)) { spaceDown = true; wrap.classList.add('space-pan'); e.preventDefault(); }
      }
    });
    window.addEventListener('keyup', function (e) { if (e.code === 'Space') { spaceDown = false; wrap.classList.remove('space-pan'); } });
    wrap.addEventListener('mousedown', function (e) {
      if (spaceDown || e.button === 1 || e.target === wrap) {
        if (e.target === wrap && !(spaceDown || e.button === 1) && (typeof getCanvasZoom !== 'function' || getCanvasZoom() <= 1.001)) return;
        e.preventDefault(); e.stopPropagation();
        panDrag = { x: e.clientX, y: e.clientY, mouse: true };
        setCardAnim(false);
        wrap.classList.add('panning');
      }
    }, true);
    window.addEventListener('mousemove', function (e) {
      if (panDrag && panDrag.mouse) {
        safe(function () { panCanvasBy(e.clientX - panDrag.x, e.clientY - panDrag.y); });
        panDrag.x = e.clientX; panDrag.y = e.clientY;
      }
    });
    window.addEventListener('mouseup', function () {
      if (panDrag && panDrag.mouse) { panDrag = null; setCardAnim(true); wrap.classList.remove('panning'); }
    });
  }

  function setHandMode(on) {
    handMode = !!on;
    var wrap = $('canvasWrapper');
    if (wrap) wrap.classList.toggle('hand-mode', handMode);
    var b = $('mzHand'); if (b) b.classList.toggle('active', handMode);
    safe(function () { canvas.selection = !handMode; if (handMode) canvas.discardActiveObject(); canvas.requestRenderAll(); });
    if (typeof showToast === 'function') showToast(handMode ? 'Surish rejimi yoqildi (bir barmoq bilan suring)' : 'Surish rejimi o\'chirildi');
  }

  function buildZoomControls() {
    if ($('mobileZoomCtl')) return;
    var host = $('editorContainer'); if (!host) return;
    var d = document.createElement('div');
    d.id = 'mobileZoomCtl';
    d.innerHTML =
      '<button type="button" id="mzIn" aria-label="Kattalashtirish"><span class="material-symbols-outlined">add</span></button>' +
      '<button type="button" id="mzOut" aria-label="Kichraytirish"><span class="material-symbols-outlined">remove</span></button>' +
      '<button type="button" id="mzFit" aria-label="Sig\'dirish"><span class="material-symbols-outlined">fit_screen</span></button>' +
      '<button type="button" id="mzHand" aria-label="Surish rejimi"><span class="material-symbols-outlined">pan_tool</span></button>';
    host.appendChild(d);
    $('mzIn').onclick = function () { zoomCanvasIn(); };
    $('mzOut').onclick = function () { zoomCanvasOut(); };
    $('mzFit').onclick = function () { resetCanvasZoom(); };
    $('mzHand').onclick = function () { setHandMode(!handMode); };
  }


  // ===== v27: ikki barmoq bilan tanlangan obyektni kattalashtirish, slaydlar orasida surish =====
  function zoomNow() { return (typeof getCanvasZoom === 'function') ? getCanvasZoom() : 1; }
  function pt(touch) {
    return canvas.getPointer({ clientX: touch.clientX, clientY: touch.clientY, target: canvas.upperCanvasEl, type: 'touchstart' }, true);
  }
  function initObjectPinch() {
    var wrap = $('canvasWrapper');
    if (!wrap || wrap._objPinchReady) return;
    wrap._objPinchReady = true;
    var op = null;
    document.addEventListener('touchstart', function (e) {
      if (!wrap.contains(e.target) || e.touches.length !== 2) return;
      var obj = null;
      try { obj = canvas.getActiveObject(); } catch (er) {}
      if (!obj || obj.type === 'activeSelection' || obj.isEditing || obj.lockScalingX) return;
      try {
        var a = pt(e.touches[0]), b = pt(e.touches[1]);
        if (!obj.containsPoint(a) && !obj.containsPoint(b)) return;
      } catch (er) { return; }
      e.preventDefault(); e.stopPropagation();
      abortFabricTransform();
      op = { obj: obj, d0: dist(e.touches) || 1, sx: obj.scaleX || 1, sy: obj.scaleY || 1, fs: obj.fontSize || null, ang: Math.atan2(e.touches[1].clientY - e.touches[0].clientY, e.touches[1].clientX - e.touches[0].clientX), a0: obj.angle || 0 };
    }, { capture: true, passive: false });
    document.addEventListener('touchmove', function (e) {
      if (!op) return;
      if (e.touches.length < 2) return;
      e.preventDefault(); e.stopPropagation();
      var k = dist(e.touches) / op.d0;
      k = Math.max(0.1, Math.min(8, k));
      var o = op.obj;
      o.set({ scaleX: op.sx * k, scaleY: op.sy * k });
      var ang = Math.atan2(e.touches[1].clientY - e.touches[0].clientY, e.touches[1].clientX - e.touches[0].clientX);
      var da = (ang - op.ang) * 180 / Math.PI;
      if (Math.abs(da) > 6) o.set('angle', op.a0 + da);   // kichik qo'l titrashi burchakni buzmasin
      try { o.setCoords(); canvas.requestRenderAll(); } catch (er) {}
    }, { capture: true, passive: false });
    var fin = function (e) {
      if (!op) return;
      if (e.touches.length < 2) {
        e.stopPropagation();
        op = null;
        if (e.touches.length === 0) { /* hammasi ko'tarildi */ }
        try { saveCurrentSlideState(); recordGlobalState(); } catch (er) {}
      }
    };
    document.addEventListener('touchend', fin, { capture: true, passive: false });
    document.addEventListener('touchcancel', fin, { capture: true, passive: false });
  }
  function initSwipeSlides() {
    var wrap = $('canvasWrapper');
    if (!wrap || wrap._swipeReady) return;
    wrap._swipeReady = true;
    var st = null;
    wrap.addEventListener('touchstart', function (e) {
      st = null;
      if (e.touches.length !== 1 || e.target !== wrap || zoomNow() > 1.001) return;   // faqat bo'sh joydan
      st = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { capture: true, passive: true });
    wrap.addEventListener('touchend', function (e) {
      if (!st) return;
      var t = e.changedTouches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
      var fast = Date.now() - st.t < 700;
      st = null;
      if (fast && Math.abs(dx) > 60 && Math.abs(dy) < 45) {
        try { switchSlide(activeIndex + (dx < 0 ? 1 : -1)); } catch (er) {}
      }
    }, { capture: true, passive: true });
  }
  function initPresentationSwipe() {
    var ov = $('presentationOverlay');
    if (!ov || ov._swipeReady) return;
    ov._swipeReady = true;
    var st = null;
    ov.addEventListener('touchstart', function (e) {
      st = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }, { passive: true });
    ov.addEventListener('touchend', function (e) {
      if (!st) return;
      var t = e.changedTouches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
      st = null;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 60) {
        try { if (dx < 0) nextPresentationSlide(); else prevPresentationSlide(); } catch (er) {}
        ov._swiped = Date.now();
      }
    }, { passive: true });
    // swipe dan keyin tasodifiy "click" keyingi slaydga o'tkazmasin
    ov.addEventListener('click', function (e) {
      if (ov._swiped && Date.now() - ov._swiped < 400) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  function init() {
    initGestures();
    safe(initObjectPinch);
    safe(initSwipeSlides);
    safe(initPresentationSwipe);
    buildZoomControls();

    safe(function () {
      if (window.matchMedia('(pointer: coarse)').matches) {
        fabric.Object.prototype.set({
          cornerSize: 16, touchCornerSize: 36, transparentCorners: false,
          cornerColor: '#ffffff', cornerStrokeColor: '#2563eb', borderColor: '#2563eb', cornerStyle: 'circle', borderScaleFactor: 2,
        });
        canvas.getObjects().forEach(function (o) { o.set({ cornerSize: 16, touchCornerSize: 36 }); });
      }
    });

    if (isMobile()) safe(function () { toggleRibbonToolbar(false); });
    window.addEventListener('resize', function () { if (typeof scheduleFitCanvas === 'function') scheduleFitCanvas(); });
    window.addEventListener('orientationchange', function () { setTimeout(function () { if (typeof fitCanvasToScreen === 'function') fitCanvasToScreen(); }, 250); });
  }

  var tries = 0;
  var poll = setInterval(function () {
    tries++;
    var ready = false;
    try { ready = (typeof canvas !== 'undefined') && canvas && typeof canvas.on === 'function' && $('canvasWrapper'); } catch (e) { ready = false; }
    if (ready) { clearInterval(poll); if (!window._mobileInitDone) { window._mobileInitDone = true; init(); } }
    else if (tries > 120) clearInterval(poll);
  }, 250);
})();
