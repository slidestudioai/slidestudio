/* v30 — Rasm / GIF yuklanish holati
 * Overlay ichiga qo'shilgan <img> to'liq yuklanmaguncha spinner ko'rsatiladi, so'ng silliq paydo bo'ladi
 * (qora quti yoki yarim yuklangan "qotgan" kadr o'rniga).
 */
(function () {
  'use strict';
  var SEL = '.gif-overlay-item, .gif-bg-overlay, .pres-gif-bg, .pres-gif-overlay .gif-overlay-item';
  function hostOf(img) {
    var p = img.parentNode;
    return p && p.nodeType === 1 && p.matches && p.matches(SEL) ? p : null;
  }
  function watch(img) {
    if (!img || img.__ssWatched || img.tagName !== 'IMG') return;
    var host = hostOf(img);
    if (!host) return;
    img.__ssWatched = true;
    if (img.complete && img.naturalWidth) return;
    host.classList.add('ss-loading');
    var sp = document.createElement('div');
    sp.className = 'ss-spin light';
    sp.innerHTML = '<i></i>';
    host.appendChild(sp);
    var done = function () {
      host.classList.remove('ss-loading');
      sp.classList.add('done');
      setTimeout(function () { try { sp.remove(); } catch (e) {} }, 500);
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    setTimeout(done, 20000);
  }
  function scan(root) {
    try {
      if (root.nodeType !== 1) return;
      if (root.tagName === 'IMG') watch(root);
      else root.querySelectorAll && root.querySelectorAll('img').forEach(watch);
    } catch (e) {}
  }
  function start() {
    var mo = new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes && m.addedNodes.forEach(scan); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll(SEL).forEach(function (h) { scan(h); });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
