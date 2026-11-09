/* v42 — tezkor javob: sozlash tugmalari (matn o'lchami, tugma/link, media paneli, obyektni siljitish)
 * ko'rinishni DARHOL yangilaydi, og'ir saqlash (toJSON + tarix) esa kadr chizilgandan KEYIN bajariladi.
 * Sabab: katta GIF/video bor slaydda saveCurrentSlideState()+recordGlobalState() bir necha yuz ms bloklaydi,
 * canvas esa requestRenderAll() orqali keyingi kadrga qoldirilgani uchun o'zgarish keyingi bosishdagina ko'rinardi. */
(function () {
  'use strict';
  var timer = null, maxTimer = null, pend = null;
  function gen() { try { return _canvasLoadGeneration; } catch (e) { return 0; } }
  function busy() { return !!(window.isAiApplyingCommands || window.isAiStreaming || window.isUndoRedoAction || window.isRedoUndoAction); }
  function run() {
    clearTimeout(timer); clearTimeout(maxTimer); timer = maxTimer = null;
    if (!pend) return;
    var p = pend; pend = null;
    try {
      // slayd almashgan bo'lsa — almashtirish paytida o'sha holat allaqachon saqlangan
      if (p.idx !== activeIndex || p.gen !== gen() || slides[activeIndex] !== p.slide || busy()) return;
      saveCurrentSlideState();
      recordGlobalState();
      if (typeof p.after === 'function') p.after();
    } catch (e) { console.warn('[v42] saqlash:', e); }
  }
  /** Saqlashni kechiktiradi (qayta chaqirilsa birlashtiriladi). */
  window.ssDeferSave = function (after) {
    try {
      if (!pend) pend = { idx: activeIndex, gen: gen(), slide: slides[activeIndex], after: null };
      if (typeof after === 'function') pend.after = after;
      clearTimeout(timer);
      timer = setTimeout(run, 120);                       // tez-tez bosilsa — oxirgisidan keyin
      if (!maxTimer) maxTimer = setTimeout(run, 900);     // lekin 0.9 s dan ortiq kechikmaydi
    } catch (e) { try { saveCurrentSlideState(); recordGlobalState(); } catch (er) {} }
  };
  window.ssFlushSave = run;
  document.addEventListener('visibilitychange', function () { if (document.hidden) run(); });
  window.addEventListener('pagehide', run);
  window.addEventListener('beforeunload', run);
})();

/* v42 — AI slayd yaratganda "fon + xuddi shu rasm/rang obyekt sifatida ustidan" takrorini avtomatik tozalash.
 * AI ba'zan bir rasmni ham set_background*, ham element sifatida beradi (yoki fon rangiga teng butun-slayd to'rtburchak qo'shadi).
 * AI buyruqlari tugagach: fon bilan BIR XIL manbali rasm/GIF obyektlari va fon rangidagi butun-slayd to'rtburchaklar olib tashlanadi. */
(function () {
  'use strict';
  function norm(u) {
    if (typeof u !== 'string' || !u) return '';
    if (u.indexOf('data:') === 0) return 'd' + u.length + ':' + u.slice(0, 120) + u.slice(-120);
    if (u.indexOf('blob:') === 0) return u;
    return u.split('#')[0].split('?')[0];
  }
  function srcOf(o) {
    var s = o && (o.gifUrl || o.src || (typeof o.getSrc === 'function' ? o.getSrc() : '') || (o._element && o._element.src) || '');
    return norm(s);
  }
  function isImg(o) { return !!o && (o.type === 'image' || o.type === 'gifImage' || o.isGif) && !o.isEmbed && !o.isVideo; }
  function colorKey(c) { return typeof c === 'string' ? c.replace(/\s+/g, '').toLowerCase() : ''; }
  function bgInfo(p) {
    var srcs = [];
    if (p.backgroundImage && p.backgroundImage.src) srcs.push(norm(p.backgroundImage.src));
    if (p.backgroundGif && (p.backgroundGif.src || p.backgroundGif.url)) srcs.push(norm(p.backgroundGif.src || p.backgroundGif.url));
    var hasMediaBg = srcs.length > 0 || !!(p.backgroundVideo && p.backgroundVideo.url);
    var color = (!hasMediaBg && typeof p.background === 'string') ? colorKey(p.background) : '';
    return { srcs: srcs.filter(Boolean), color: color };
  }
  function isDup(o, bg) {
    if (!o) return false;
    if (isImg(o) && bg.srcs.length && bg.srcs.indexOf(srcOf(o)) >= 0) return true;
    if (bg.color && (o.type === 'rect') && colorKey(o.fill) === bg.color && !o.stroke) {
      var w = (o.width || 0) * (o.scaleX || 1), h = (o.height || 0) * (o.scaleY || 1);
      if (w >= 960 * 0.98 && h >= 540 * 0.98 && (o.opacity == null || o.opacity === 1)) return true;
    }
    return false;
  }
  function dedupeAll() {
    var removed = 0;
    try {
      if (!window.slides && typeof slides === 'undefined') return 0;
      try { if (typeof saveCurrentSlideState === 'function') saveCurrentSlideState({ force: true }); } catch (e) {}
      for (var i = 0; i < slides.length; i++) {
        var p = null; try { p = JSON.parse(slides[i].json || '{}'); } catch (e) { continue; }
        if (!p.objects || !p.objects.length) continue;
        var bg = bgInfo(p);
        if (!bg.srcs.length && !bg.color) continue;
        var keep = p.objects.filter(function (o) { return !isDup(o, bg); });
        var n = p.objects.length - keep.length;
        if (!n) continue;
        removed += n;
        p.objects = keep;
        slides[i].json = JSON.stringify(p);
        if (slides[i].imageNumbers) slides[i].imageNumbers = [];
        if (i === activeIndex && typeof canvas !== 'undefined' && canvas) {
          canvas.getObjects().slice().forEach(function (o) { if (isDup(o, bg)) { try { canvas.remove(o); } catch (e) {} } });
          try { canvas.requestRenderAll(); } catch (e) {}
          try { if (window.GifOverlay && GifOverlay.scheduleSync) GifOverlay.scheduleSync(); } catch (e) {}
        }
        try { refreshSlideThumb(i); } catch (e) {}
      }
      if (removed) console.info('[v42] fon bilan takrorlangan ' + removed + ' ta obyekt olib tashlandi');
    } catch (e) { console.warn('[v42] dedupe:', e); }
    return removed;
  }
  window.ssDedupeBackgrounds = dedupeAll;
  function wrap() {
    if (typeof window.executeAiCommands !== 'function' || window.executeAiCommands.__ssDedupe) return false;
    var orig = window.executeAiCommands;
    window.executeAiCommands = async function () {
      var r = await orig.apply(this, arguments);
      setTimeout(dedupeAll, 150);               // AI buyruqlari to'liq tugab, kanvas yangilangandan keyin
      return r;
    };
    window.executeAiCommands.__ssDedupe = true;
    return true;
  }
  if (!wrap()) window.addEventListener('load', wrap);
})();
