/* v50 — UI scale (ixtiyoriy).
 * Eslatma: documentElement.style.zoom butun sahifaga berilganda
 * position:fixed (loading overlay, pastki panel) va 100vh buziladi.
 * Shuning uchun DEFAULT o‘chirilgan. Kerak bo‘lsa:
 *   localStorage.setItem('ss-ui-scale', 'on'); location.reload();
 * yoki konsolda: ssSetUiScale(true)
 */
(function () {
  'use strict';
  var lastZoom = 1;
  var timer = null;

  function isMobile() {
    return window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function enabled() {
    try {
      var v = localStorage.getItem('ss-ui-scale');
      return v === 'on' || v === '1' || v === 'true';
    } catch (e) { return false; }
  }

  function targetZoom() {
    if (isMobile()) return 1;
    var w = window.innerWidth || document.documentElement.clientWidth || 1280;
    if (w <= 1366) return 0.85;
    if (w <= 1536) return 0.90;
    if (w <= 1680) return 0.95;
    return 1;
  }

  function clearZoom() {
    try {
      document.documentElement.style.zoom = '';
      document.documentElement.style.removeProperty('zoom');
    } catch (e) {}
    lastZoom = 1;
  }

  function apply() {
    try {
      if (!enabled() || isMobile()) {
        clearZoom();
        return;
      }
      var z = targetZoom();
      if (Math.abs(z - lastZoom) < 0.01) return;
      lastZoom = z;
      if (z === 1) clearZoom();
      else document.documentElement.style.zoom = String(z);

      setTimeout(function () {
        try {
          if (typeof scheduleFitCanvas === 'function') scheduleFitCanvas();
          else if (typeof fitCanvasToScreen === 'function') fitCanvasToScreen();
        } catch (e) {}
      }, 50);
    } catch (e) {
      console.warn('[ui-scale]', e);
      clearZoom();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(apply, 80);
  }

  function boot() {
    // Har doim avval tozalaymiz — eski sessiyadan qolgan zoom bo‘lmasin
    clearZoom();
    if (enabled()) {
      apply();
      window.addEventListener('resize', schedule);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  window.addEventListener('load', function () {
    clearZoom();
    if (enabled()) setTimeout(apply, 80);
  });

  window.ssSetUiScale = function (on) {
    try {
      if (on === true || on === 'on' || on === 1) {
        localStorage.setItem('ss-ui-scale', 'on');
        apply();
        window.addEventListener('resize', schedule);
      } else {
        localStorage.setItem('ss-ui-scale', 'off');
        clearZoom();
      }
    } catch (e) {}
  };
})();
