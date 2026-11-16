/* js/slide_plus.js (v66) — slayd ustidagi «+» tugmasi: qurilmadan rasm qo'shish (eski skrepka o'rnida)
 *  Rasmlar «Rasmlar:» qatoriga raqamlanib tushadi (triggerSidebarImageUpload) — AI ularni slaydlarga joylaydi.
 *  Joyi: DOIM slayddan tashqarida, chap-yuqori burchakda. Kompyuterda — burchakdan chap-tepada (diagonal),
 *  telefonda (chapda joy yo'q) — slayd ustida, chap chetiga tekis. Joyi aniqlanmaguncha ko'rinmaydi (sakramaydi).
 */
(function () {
  'use strict';
  if (window.__ssSlidePlus) return;
  window.__ssSlidePlus = true;
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'success'); } catch (e) {} }
  var css = document.createElement('style');
  css.textContent = [
    '#ssSlidePlus{position:fixed;z-index:50;width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;',
    ' display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#7c3aed,#2563eb);',
    ' box-shadow:0 4px 14px rgba(37,99,235,.35);transition:transform .15s ease,box-shadow .2s ease;padding:0}',
    '#ssSlidePlus:hover{transform:scale(1.08);box-shadow:0 6px 18px rgba(37,99,235,.45)}',
    '#ssSlidePlus:focus-visible{outline:2px solid #1d4ed8;outline-offset:2px}',
    '#ssSlidePlus .material-symbols-outlined{font-size:22px}'
  ].join('');
  document.head.appendChild(css);

  function initPlus() {
    // slayd ustidagi bo'sh joy ham kirsin: tugma canvasWrapper emas, uning ota-bloki (editorContainer) ichida
    var wrap = document.getElementById('editorContainer') || document.getElementById('canvasWrapper');
    var scroller = document.getElementById('canvasWrapper') || wrap;
    var card = document.getElementById('canvasCard');
    if (!wrap || !card || document.getElementById('ssSlidePlus')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'ssSlidePlus';
    b.title = "Rasm qo'shish (AI joylashtiradi)";
    b.setAttribute('aria-label', "Rasm qo'shish (AI joylashtiradi)");
    b.innerHTML = '<span class="material-symbols-outlined">add</span>';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      // Eski skrepka bilan bir xil: rasmlar tepadagi «Rasmlar:» qatoriga RAQAMLANIB qo'shiladi,
      // keyin AI ularni tanlab slaydga joylaydi (to'g'ridan-to'g'ri slaydga emas).
      if (typeof window.triggerSidebarImageUpload === 'function') window.triggerSidebarImageUpload();
      else if (typeof window.triggerDirectImageUpload === 'function') window.triggerDirectImageUpload();
      else toast("Rasm yuklash hozircha tayyor emas.", 'error');
    });
    document.body.appendChild(b);        // v66: fixed — hech qanday blok (overflow:hidden) tugmani kesmaydi

    // v66: tugma DOIM slayddan TASHQARIDA, chap-yuqori burchakda (ekranga nisbatan, position:fixed):
    //   • chapda joy bo'lsa (kompyuter/planshet) — burchakdan chapga va tepaga (diagonal);
    //   • chapda joy bo'lmasa (telefon) — slayd USTIDA, chap chetiga tekis.
    //   • toolbar/header ustiga chiqmaydi. Joyi aniqlanmaguncha ko'rinmaydi (sakramaydi).
    b.style.visibility = 'hidden';
    var S = 34, GAP = 10, shown = false, last = '', stable = 0, raf = 0;
    function appReady() {
      var ov = document.getElementById('loadingOverlay');
      if (ov) { var cs = getComputedStyle(ov); if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return false; }
      return document.readyState === 'complete';
    }
    function visibleBottom(el) {
      if (!el) return 0;
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return (cs.display === 'none' || cs.visibility === 'hidden' || !r.height) ? 0 : r.bottom;
    }
    function place() {
      var cr = card.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      if (!cr.width || !cr.height || cr.bottom < 0 || cr.top > innerHeight) { b.style.visibility = 'hidden'; shown = false; return false; }
      var hdr = document.querySelector('.header-actions');
      var topLimit = Math.max(visibleBottom(document.getElementById('ribbonToolbar')), visibleBottom(hdr && hdr.parentElement), 0) + 4;
      var leftLimit = Math.max(wr.left, 0) + 4;
      var x, y = cr.top - S - 6;                                     // slayd ustida
      if (cr.left - S - GAP >= leftLimit) x = cr.left - S - GAP;     // chapda joy bor — diagonal (burchakdan chap-tepa)
      else x = Math.max(leftLimit, cr.left);                         // telefon — slayd ustida, chap chetiga tekis
      if (y < topLimit) y = topLimit;                                // toolbar ustiga chiqmasin
      if (y + S > cr.top && x + S > cr.left) {                       // baribir slayd ustiga tushsa — chap tomonga suramiz
        x = Math.max(2, cr.left - S - 4);
      }
      x = Math.round(x); y = Math.round(y);
      b.style.left = x + 'px';
      b.style.top = y + 'px';
      var key = x + ',' + y;
      stable = key === last ? stable + 1 : 0;
      last = key;
      if (!shown && stable >= 8 && appReady()) { shown = true; b.style.visibility = ''; }
      return true;
    }
    // slayd o'lchami/joyi o'zgarayotgan paytda (fit animatsiyasi) har kadrda ergashadi, to'xtagach tinchiydi
    function loop() {
      raf = 0;
      place();
      if (stable < 12 || !shown) raf = requestAnimationFrame(loop);
    }
    function schedule() { stable = 0; if (!raf) raf = requestAnimationFrame(loop); }
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    wrap.addEventListener('scroll', schedule, { passive: true });
    if (scroller !== wrap) scroller.addEventListener('scroll', schedule, { passive: true });
    try { new ResizeObserver(schedule).observe(wrap); new ResizeObserver(schedule).observe(card); } catch (e) {}
    try { new MutationObserver(schedule).observe(card, { attributes: true, attributeFilter: ['style', 'class'] }); } catch (e) {}
    card.addEventListener('transitionend', schedule);
    setInterval(function () { if (!raf) { place(); if (!shown) schedule(); } }, 1000);   // zaxira
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPlus);
  else initPlus();
})();
