/* =====================================================================
 * 34_v44_mobile_fix.js  (v44) — telefonda "hamma narsa yon tomonga siljib ketishi" tuzatmasi
 *
 * SABAB: slaydagi matn ("Sarlavha Kiriting") bosilganda Fabric yashirin <textarea> yaratib unga focus() beradi.
 * Brauzer (Telegram WebView / Chrome Android) textarea ekranga ko'rinishi uchun HUJJATNI gorizontal suradi.
 * html/body da overflow:hidden bo'lsa ham dasturiy skroll ishlaydi => butun ilova chapga siljib, o'ng tomon bo'sh qoladi.
 *
 * YECHIM (ko'p qatlamli):
 *   1) Fabric textarea.focus() ga { preventScroll: true } beriladi.
 *   2) Hujjat / asosiy konteynerlar gorizontal (va html/body vertikal) skrollga ega bo'lib qolsa — darhol 0 ga qaytariladi.
 *   3) Klaviatura ochilib-yopilganda (visualViewport) ham shu tekshiruv ishlaydi.
 *   4) Telegram Mini App: viewport o'zgarganda balandlik CSS o'zgaruvchisiga yoziladi.
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssV44Fix) return;
  window.__ssV44Fix = true;

  /* ---------- 1) focus() — skrollsiz (faqat Fabric yashirin textarea'si uchun) ---------- */
  try {
    var origFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (opts) {
      try {
        if (this && this.getAttribute && this.getAttribute('data-fabric') === 'textarea') {
          opts = Object.assign({}, opts || {}, { preventScroll: true });
        }
      } catch (e) {}
      return origFocus.call(this, opts);
    };
  } catch (e) {}

  /* ---------- 2) Skroll qaytargich ---------- */
  var CONTAINERS = '.canvas-wrapper, .editor-container, .workspace, .app-root, #canvasWrapper, #editorContainer';
  var scheduled = false;

  function resetNow() {
    scheduled = false;
    try {
      var de = document.documentElement, b = document.body;
      if (de && (de.scrollLeft || de.scrollTop)) { de.scrollLeft = 0; de.scrollTop = 0; }
      if (b && (b.scrollLeft || b.scrollTop)) { b.scrollLeft = 0; b.scrollTop = 0; }
      var se = document.scrollingElement;
      if (se && (se.scrollLeft || se.scrollTop)) { se.scrollLeft = 0; se.scrollTop = 0; }
      if (window.pageXOffset || window.pageYOffset) window.scrollTo(0, 0);
      var list = document.querySelectorAll(CONTAINERS);
      for (var i = 0; i < list.length; i++) {
        if (list[i].scrollLeft) list[i].scrollLeft = 0;        // gorizontal: hech qachon
      }
    } catch (e) {}
  }
  function scheduleReset() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(resetNow);
  }
  function burst() {          // klaviatura animatsiyasi davomida bir necha marta
    scheduleReset();
    setTimeout(resetNow, 60);
    setTimeout(resetNow, 250);
    setTimeout(resetNow, 600);
  }

  window.addEventListener('scroll', scheduleReset, { passive: true });
  document.addEventListener('scroll', function (e) {
    var t = e.target;
    if (t === document || t === document.documentElement || t === document.body) { scheduleReset(); return; }
    try { if (t && t.matches && t.matches(CONTAINERS)) scheduleReset(); } catch (er) {}
  }, { capture: true, passive: true });
  document.addEventListener('focusin', burst, true);
  document.addEventListener('focusout', burst, true);
  window.addEventListener('resize', burst);
  window.addEventListener('orientationchange', burst);
  document.addEventListener('touchend', function () { setTimeout(resetNow, 0); }, { passive: true, capture: true });

  var vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', burst);
    vv.addEventListener('scroll', scheduleReset);
  }

  /* ---------- 3) Telegram Mini App: barqaror balandlik ---------- */
  try {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initData) {
      var applyVh = function () {
        try {
          var h = tg.viewportStableHeight || tg.viewportHeight;
          if (h) document.documentElement.style.setProperty('--tg-vh', h + 'px');
        } catch (e) {}
        burst();
      };
      if (tg.onEvent) { tg.onEvent('viewportChanged', applyVh); }
      applyVh();
    }
  } catch (e) {}
})();
