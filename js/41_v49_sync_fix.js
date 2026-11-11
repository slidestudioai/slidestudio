/* v49 — Sahifa raqami (Header/Footer) sinxroni.
 *  Muammo: tepadagi hisoblagich («6 / 8») jonli, lekin slayd ichidagi «5/8» matni slayd JSON'iga qotib qolgan edi —
 *  slayd qo'shilsa / o'chirilsa / ko'chirilsa yoki AI yaratganda raqam eskirib qolardi.
 *  Yechim: sahifa raqamiga o'xshagan matn (son/son, tepa yoki pastki chetda, kichik shrift) har doim
 *  «<joriy raqam> / <jami>» bo'lib turadi — slayd faollashganda, render bo'lganda va HAR QANDAY eksportdan oldin.
 *  Boshqa (faol bo'lmagan) slaydlarning JSON'i ham yangilanadi (PPTX / PDF / HTML / namoyish / eskizlar to'g'ri chiqadi).
 *  Istisno: obyektda ssNoPageSync = true bo'lsa tegilmaydi.
 */
(function () {
  'use strict';
  if (window.__ssV49Sync) return;
  window.__ssV49Sync = true;

  var PN = /^(\s*)(\d{1,3})(\s*(?:\/|⁄|of|из)\s*)(\d{1,3})(\s*)$/i;
  var PN_RAW = /"text":"\s*\d{1,3}\s*(?:\/|⁄|of|из)\s*\d{1,3}\s*"/i;
  var H = 540, BAND = 70;

  function isTextType(t) { return t === 'textbox' || t === 'i-text' || t === 'text'; }
  function isPageNum(o) {
    if (!o || !isTextType(o.type) || o.ssNoPageSync || o.isButton) return false;
    if (!PN.test(String(o.text == null ? '' : o.text))) return false;
    if (o.ssPageNum) return true;
    var sc = +o.scaleY || 1, top = +o.top || 0, h = (+o.height || 0) * sc;
    return (+o.fontSize || 0) * sc <= 26 && (top < BAND || top + h > H - BAND);      // faqat tepa/past chetdagi kichik yozuv
  }
  function format(old, idx, total) {
    var m = PN.exec(String(old));
    return m ? (m[1] + idx + m[3] + total + m[5]) : old;
  }

  function loading() {
    try { if (typeof _canvasLoadingUntil !== 'undefined' && Date.now() < _canvasLoadingUntil) return true; } catch (e) {}
    try { if (window.isAiApplyingCommands || window.isAiStreaming) return true; } catch (e) {}
    return false;
  }

  /** Faol slayd: jonli kanvasdagi obyektlar. */
  function syncActive() {
    if (typeof canvas === 'undefined' || !canvas || typeof slides === 'undefined' || !slides.length || loading()) return false;
    var idx = activeIndex + 1, total = slides.length, changed = false;
    canvas.getObjects().forEach(function (o) {
      if (!isPageNum(o)) return;
      o.ssPageNum = true;
      var nt = format(o.text, idx, total);
      if (nt === o.text) return;
      o.set('text', nt);
      try { o.initDimensions(); o.setCoords(); } catch (e) {}
      o.dirty = true; changed = true;
    });
    if (changed) {
      try { canvas.requestRenderAll(); } catch (e) {}
      try { saveCurrentSlideState(); } catch (e) {}
    }
    return changed;
  }

  /** Boshqa slaydlar: JSON darajasida (kanvasga yuklamasdan). Katta rasmli JSON'ni keraksiz parse qilmaslik uchun oldin regex. */
  function syncJson(i) {
    var s = slides[i];
    if (!s || typeof s.json !== 'string' || !PN_RAW.test(s.json)) return false;
    var p;
    try { p = JSON.parse(s.json); } catch (e) { return false; }
    var changed = false;
    (p.objects || []).forEach(function (o) {
      if (!isPageNum(o)) return;
      var nt = format(o.text, i + 1, slides.length);
      if (nt !== o.text) { o.text = nt; changed = true; }
    });
    if (changed) s.json = JSON.stringify(p);
    return changed;
  }

  var lastSig = '';
  function syncAll(force) {
    if (typeof slides === 'undefined' || !slides.length) return false;
    var any = false;
    try { any = syncActive() || any; } catch (e) { console.warn('[v49] sync active:', e); }
    var sig = activeIndex + '|' + slides.length;
    if (force || sig !== lastSig) {
      lastSig = sig;
      var other = false;
      for (var i = 0; i < slides.length; i++) {
        if (i === activeIndex) continue;
        try { other = syncJson(i) || other; } catch (e) {}
      }
      if (other) { any = true; try { renderSidebar(); } catch (e) {} try { hasUnsavedChanges = true; } catch (e) {} }
    }
    if (force) { try { saveCurrentSlideState(); } catch (e) {} }
    return any;
  }
  window.ssSyncPageNumbers = syncAll;

  var t = null;
  function soon() { clearTimeout(t); t = setTimeout(function () { syncAll(false); }, 140); }

  var tries = 0, iv = setInterval(function () {
    if (typeof canvas !== 'undefined' && canvas && canvas.on) {
      clearInterval(iv);
      canvas.on('after:render', soon);                 // slayd yuklanib chizilganda
      canvas.on('object:added', soon);
    } else if (++tries > 60) clearInterval(iv);
  }, 250);

  // Har qanday eksport / namoyishdan OLDIN (JSON'lar yangi raqamlar bilan ketishi uchun)
  ['exportPDF', 'exportHTML', 'exportPPTX', 'startPresentation', 'exportProjectJSON'].forEach(function (name) {
    try {
      var orig = window[name];
      if (typeof orig !== 'function' || orig.__ssPN) return;
      var w = function () { try { syncAll(true); } catch (e) {} return orig.apply(this, arguments); };
      w.__ssPN = true;
      window[name] = w;
    } catch (e) {}
  });
})();
