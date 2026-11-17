/* js/50_v68_ui.js (v68) — tepadagi tugmalar paneli kichik ekranda.
 *  - .header-actions sig'masa barmoq / g'ildirak bilan chapga-o'ngga suriladi (v68.css).
 *    Qaysi tomonda yashirin tugma bo'lsa, o'sha chet xiralashadi (ss-more-left / ss-more-right).
 *  - Sichqoncha g'ildiragi (vertikal) ham gorizontal suradi.
 *  - Til menyusi (#ssLangMenu) surilayotgan blok ichida kesilmasligi uchun ochilganda position:fixed bo'ladi.
 */
(function () {
  'use strict';
  if (window.__ssV68Ui) return;
  window.__ssV68Ui = true;

  function init() {
    var bar = document.querySelector('.header-actions');
    if (!bar) return false;

    function update() {
      var max = bar.scrollWidth - bar.clientWidth;
      var scrollable = max > 2;
      bar.classList.toggle('ss-hscroll', scrollable);
      bar.classList.toggle('ss-more-left', scrollable && bar.scrollLeft > 2);
      bar.classList.toggle('ss-more-right', scrollable && bar.scrollLeft < max - 2);
    }
    bar.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    try { new ResizeObserver(update).observe(bar); } catch (e) {}
    // tugmalar keyinroq qo'shiladi / yashiriladi (login, kvota, til) — kuzatamiz
    try { new MutationObserver(update).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] }); } catch (e) {}

    bar.addEventListener('wheel', function (e) {
      if (!bar.classList.contains('ss-hscroll')) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      bar.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    // Til menyusi: ochilganda tugma ostiga fixed joylashadi
    function placeLang() {
      var menu = document.getElementById('ssLangMenu');
      var btn = document.getElementById('ssLangBtn');
      if (!menu || !btn) return;
      if (!bar.contains(menu)) return;     // i18n.js now keeps the menu in <body> and positions it itself
      var on = menu.classList.contains('open') && getComputedStyle(bar).overflowX !== 'visible';
      menu.classList.toggle('ss-fixed', on);
      if (!on) { menu.style.left = ''; menu.style.top = ''; return; }
      var r = btn.getBoundingClientRect();
      var mw = menu.offsetWidth || 160;
      menu.style.top = Math.round(r.bottom + 6) + 'px';
      menu.style.left = Math.round(Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8))) + 'px';
    }
    function hookLang() {
      var menu = document.getElementById('ssLangMenu');
      if (!menu || menu.__ssV68) return !!menu;
      menu.__ssV68 = true;
      new MutationObserver(placeLang).observe(menu, { attributes: true, attributeFilter: ['class'] });
      bar.addEventListener('scroll', function () { if (menu.classList.contains('open')) menu.classList.remove('open'); }, { passive: true });
      return true;
    }
    if (!hookLang()) { var n = 0, t = setInterval(function () { if (hookLang() || ++n > 40) clearInterval(t); }, 250); }

    update();
    setTimeout(update, 800);
    setTimeout(update, 2500);
    return true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
