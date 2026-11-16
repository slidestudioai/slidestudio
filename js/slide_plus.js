/* js/slide_plus.js (v66) — slayd ustidagi «+» tugmasi: qurilmadan rasm qo'shish (eski skrepka o'rnida)
 *  Rasmlar «Rasmlar:» qatoriga raqamlanib tushadi (triggerSidebarImageUpload) — AI ularni slaydlarga joylaydi.
 *  Joyi (hamma qurilmada bir xil): slaydning chap-yuqori burchagi USTIDA, chap chetiga tekis.
 *  Tepada joy bo'lmasa — burchak ichida. Joyi aniqlanmaguncha ko'rinmaydi (sakrab ko'chmaydi).
 */
(function () {
  'use strict';
  if (window.__ssSlidePlus) return;
  window.__ssSlidePlus = true;
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'success'); } catch (e) {} }
  var css = document.createElement('style');
  css.textContent = [
    '#ssSlidePlus{position:absolute;z-index:30;width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;',
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
    wrap.appendChild(b);

    // v66: BITTA qoida, hamma qurilmada: slaydning chap-yuqori burchagi USTIDA (chap chetiga tekis).
    // Joyi aniq bo'lmaguncha ko'rinmaydi — keyin to'g'ridan-to'g'ri o'z joyida paydo bo'ladi (sakramaydi).
    b.style.visibility = 'hidden';
    var S = 34, GAP = 8, shown = false, last = '', stable = 0, raf = 0, idle = 0;
    // ilova to'liq tayyor (yuklanish oynasi yopilgan) — undan oldin slayd vaqtincha boshqa joyda turadi
    function appReady() {
      var ov = document.getElementById('loadingOverlay');
      if (ov) { var cs = getComputedStyle(ov); if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return false; }
      return document.readyState === 'complete';
    }
    function place() {
      var wr = wrap.getBoundingClientRect(), cr = card.getBoundingClientRect();
      if (!cr.width || !cr.height || !wr.width) { b.style.visibility = 'hidden'; shown = false; return false; }
      var x = cr.left - wr.left + wrap.scrollLeft;                 // slayd chap chetiga tekis
      var y = cr.top - wr.top + wrap.scrollTop - S - GAP;          // slayd ustida
      if (y < 2) y = cr.top - wr.top + wrap.scrollTop + GAP;       // tepada joy yo'q — burchak ichida
      x = Math.round(Math.max(2, x)); y = Math.round(y);
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
