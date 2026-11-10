/* v50 — Interfeysni ekranga avtomatik moslash (80–100%).
 * Noutbuk / o‘rtacha monitorlarda brauzer 100% bo‘lsa ham UI ixcham (≈0.82–0.9) ko‘rinadi.
 * Katta ekranlarda (≈1800px+) asl 100% qoladi. Mobilga tegmaydi.
 * CSS zoom ishlatiladi — canvas fitCanvasToScreen keyin qayta hisoblanadi. */
(function () {
  'use strict';
  var MOBILE_MAX = 768;
  var lastZoom = 1;
  var timer = null;

  function isMobile() {
    return window.innerWidth <= MOBILE_MAX || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function targetZoom() {
    if (isMobile()) return 1;
    var w = window.innerWidth || document.documentElement.clientWidth || 1280;
    // 1366–1536 noutbuklar: 0.82, 1600 atrofida 0.88, 1800+ 1.0
    if (w <= 1366) return 0.80;
    if (w <= 1440) return 0.84;
    if (w <= 1536) return 0.88;
    if (w <= 1680) return 0.92;
    if (w < 1800) return 0.96;
    return 1;
  }

  function apply() {
    try {
      if (isMobile()) {
        if (lastZoom !== 1) {
          document.documentElement.style.zoom = '';
          lastZoom = 1;
        }
        return;
      }
      var z = targetZoom();
      if (Math.abs(z - lastZoom) < 0.01) return;
      lastZoom = z;
      if (z === 1) {
        document.documentElement.style.zoom = '';
      } else {
        document.documentElement.style.zoom = String(z);
      }
      // Canvas o‘lchamini yangi viewportga moslashtirish
      setTimeout(function () {
        try {
          if (typeof scheduleFitCanvas === 'function') scheduleFitCanvas();
          else if (typeof fitCanvasToScreen === 'function') fitCanvasToScreen();
        } catch (e) {}
      }, 40);
      setTimeout(function () {
        try {
          if (typeof scheduleFitCanvas === 'function') scheduleFitCanvas();
          else if (typeof fitCanvasToScreen === 'function') fitCanvasToScreen();
        } catch (e) {}
      }, 280);
    } catch (e) {
      console.warn('[ui-scale]', e);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(apply, 80);
  }

  // Foydalanuvchi brauzer zoomini o‘zi o‘zgartirganini aniqlash qiyin — shuning uchun faqat ekran kengligiga qaramiz.
  // Agar foydalanuvchi "har doim 100%" xohlasa: localStorage.setItem('ss-ui-scale', 'off')
  function enabled() {
    try {
      var v = localStorage.getItem('ss-ui-scale');
      if (v === 'off' || v === '0') return false;
    } catch (e) {}
    return true;
  }

  function boot() {
    if (!enabled()) return;
    apply();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', function () { setTimeout(apply, 200); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  // Keyinroq yuklangan skriptlar uchun ham
  window.addEventListener('load', function () { if (enabled()) setTimeout(apply, 100); });

  // Tashqi API: o‘chirish / yoqish
  window.ssSetUiScale = function (on) {
    try {
      if (on === false || on === 'off') {
        localStorage.setItem('ss-ui-scale', 'off');
        document.documentElement.style.zoom = '';
        lastZoom = 1;
      } else {
        localStorage.removeItem('ss-ui-scale');
        apply();
      }
    } catch (e) {}
  };
})();
