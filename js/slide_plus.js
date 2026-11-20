/* js/slide_plus.js (v66) — slayd ustidagi «+» tugmasi: qurilmadan rasm qo'shish (eski skrepka o'rnida)
 *  Rasmlar «Rasmlar:» qatoriga raqamlanib tushadi (triggerSidebarImageUpload) — AI ularni slaydlarga joylaydi.
 *  Joyi: DOIM ish maydonining chap-yuqori burchagida (toolbar ostida, chap panel o'ngida), tepadan va chapdan
 *  bir xil 14 px. Kompyuterda ham, telefonda ham. Joyi aniqlanmaguncha ko'rinmaydi (sakramaydi).
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

    // undo / redo pill — top-right corner of the same work area, same row and margin as «+» (phones; see styles.css)
    var ur = document.getElementById('ssUndoRedo');
    if (!ur) {
      ur = document.createElement('div');
      ur.id = 'ssUndoRedo';
      ur.className = 'notranslate';
      ur.setAttribute('translate', 'no');
      ur.innerHTML = '<button type="button" id="mobUndoBtn" title="Ortga qaytarish" aria-label="Ortga qaytarish"><span class="material-symbols-outlined">undo</span></button>' +
        '<button type="button" id="mobRedoBtn" title="Oldinga qaytarish" aria-label="Oldinga qaytarish"><span class="material-symbols-outlined">redo</span></button>';
      ur.querySelector('#mobUndoBtn').addEventListener('click', function (e) { e.stopPropagation(); try { undo(); } catch (er) {} });
      ur.querySelector('#mobRedoBtn').addEventListener('click', function (e) { e.stopPropagation(); try { redo(); } catch (er) {} });
      document.body.appendChild(ur);
    }

    // v66: tugma DOIM ish maydonining (toolbar ostidagi, chap panel o'ngidagi joyning) CHAP-YUQORI burchagida,
    // tepadan va chapdan bir xil kichik masofa bilan. Chap panel ochilib-yopilsa, toolbar yashirinsa — burchak bilan birga
    // siljiydi (position:fixed). Ish maydoni tepasida «Rasmlar:» / previews qatori ochiq bo'lsa — uning ostida turadi.
    b.style.visibility = 'hidden';
    var M = 14, shown = false, last = '', stable = 0, raf = 0;
    function appReady() {
      var ov = document.getElementById('loadingOverlay');
      if (ov) { var cs = getComputedStyle(ov); if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return false; }
      return document.readyState === 'complete';
    }
    function visibleBottom(el) {
      if (!el) return 0;
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return (cs.display === 'none' || cs.visibility === 'hidden' || r.height < 2) ? 0 : r.bottom;
    }
    function place() {
      var wr = wrap.getBoundingClientRect();
      if (!wr.width || !wr.height || card.getBoundingClientRect().width === 0) { b.style.visibility = 'hidden'; ur.classList.remove('ss-ready'); shown = false; return false; }
      var top = Math.max(wr.top,
        visibleBottom(document.getElementById('pendingImagesBar')),
        visibleBottom(document.getElementById('workspacePreviewsBar')));
      var x = Math.round(Math.max(0, wr.left) + M);
      var y = Math.round(Math.max(0, top) + M);
      b.style.left = x + 'px';
      b.style.top = y + 'px';
      // the pill: same top, mirrored to the right edge of the visible work area
      var right = Math.min(wr.right, window.innerWidth || wr.right);
      var urW = ur.offsetWidth || 72;
      ur.style.left = Math.round(Math.max(x + 44, right - M - urW)) + 'px';
      ur.style.top = (y + Math.round(((b.offsetHeight || 34) - (ur.offsetHeight || 38)) / 2)) + 'px';
      var key = x + ',' + y;
      stable = key === last ? stable + 1 : 0;
      last = key;
      if (!shown && stable >= 8 && appReady()) { shown = true; b.style.visibility = ''; ur.classList.add('ss-ready'); }
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
    ['sidebar', 'ribbonToolbar', 'pendingImagesBar', 'workspacePreviewsBar'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      try { new ResizeObserver(schedule).observe(el); } catch (e) {}
      try { new MutationObserver(schedule).observe(el, { attributes: true, attributeFilter: ['style', 'class'] }); } catch (e) {}
      el.addEventListener('transitionend', schedule);
    });
    try { new MutationObserver(schedule).observe(card, { attributes: true, attributeFilter: ['style', 'class'] }); } catch (e) {}
    card.addEventListener('transitionend', schedule);
    setInterval(function () { if (!raf) { place(); if (!shown) schedule(); } }, 1000);   // zaxira
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPlus);
  else initPlus();
})();
