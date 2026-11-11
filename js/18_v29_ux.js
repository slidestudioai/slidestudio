/* v29 — taqdimot boshqaruvi: tugmalar boshida 2 soniya ko'rinadi, keyin yo'qoladi;
 * sichqoncha/barmoq qimirlasa qaytadi va 2 soniyadan keyin yana yo'qoladi.
 * Slayd chetiga bosish endi keyingi slaydga o'tkazmaydi (faqat skroll, tugma, klaviatura, surish). */
(function () {
  'use strict';
  const HIDE_MS = 2000;
  let timer = null, hover = false;
  const ov = function () { return document.getElementById('presentationOverlay'); };
  function hide() {
    const o = ov(); if (!o) return;
    if (hover) { timer = setTimeout(hide, HIDE_MS); return; }   // tugma ustida turganda yo'qolmaydi
    o.classList.remove('pres-ui-on');
  }
  function show() {
    const o = ov(); if (!o) return;
    o.classList.add('pres-ui-on');
    clearTimeout(timer);
    timer = setTimeout(hide, HIDE_MS);
  }
  function init() {
    const o = ov(); if (!o || o._uiReady) return;
    o._uiReady = true;
    ['mousemove', 'pointermove', 'pointerdown', 'touchstart', 'wheel'].forEach(function (ev) {
      o.addEventListener(ev, show, { passive: true });
    });
    window.addEventListener('keydown', function () { if (o.style.display === 'flex') show(); });
    const c = o.querySelector('.pres-controls');
    if (c) {
      c.addEventListener('mouseenter', function () { hover = true; });
      c.addEventListener('mouseleave', function () { hover = false; show(); });
    }
  }
  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__v29) return;
    const w = function () { const r = orig.apply(this, arguments); try { after(); } catch (e) {} return r; };
    w.__v29 = true;
    window[name] = w;
  }
  function boot() {
    init();
    wrap('startPresentation', function () { init(); show(); });
    wrap('closePresentation', function () {
      clearTimeout(timer); hover = false;
      const o = ov(); if (o) o.classList.remove('pres-ui-on');
    });
  }
  if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot);
})();
