/* js/slide_plus.js (v66) — slayd ustidagi «+» tugmasi: qurilmadan rasm qo'shish (eski skrepka o'rnida)
 *  Rasmlar «Rasmlar:» qatoriga raqamlanib tushadi (triggerSidebarImageUpload) — AI ularni slaydlarga joylaydi.
 *  Joyi: slaydning chap-yuqori burchagidan TASHQARIDA (biroz chapda va tepada), slaydga yopishmaydi.
 *  Chapda joy yetmasa — slayd burchagining ustida; umuman joy bo'lmasa (telefon) — slayd ichida, burchakdan 12 px nariroqda.
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

    var raf = 0;
    function place() {
      raf = 0;
      var wr = wrap.getBoundingClientRect(), cr = card.getBoundingClientRect();
      if (!cr.width || !wr.width) { b.style.display = 'none'; return; }
      b.style.display = '';
      var S = 34, GAP = 20;
      var x = cr.left - wr.left + wrap.scrollLeft - S - GAP;      // slayd chap chetidan tashqarida
      var y = cr.top - wr.top + wrap.scrollTop - S - 4;           // yuqori chetidan biroz tepada
      if (x < 4 && y >= 4) {                                      // chapda joy yo'q — slayd burchagining USTIDA
        x = cr.left - wr.left + wrap.scrollLeft;
      } else if (x < 4 || y < 4) {                                // umuman joy yo'q (telefon) — slayd ichida, burchakdan nariroq
        x = cr.left - wr.left + wrap.scrollLeft + 12;
        y = cr.top - wr.top + wrap.scrollTop + 12;
      }
      b.style.left = Math.round(x) + 'px';
      b.style.top = Math.round(y) + 'px';
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(place); }
    window.addEventListener('resize', schedule);
    wrap.addEventListener('scroll', schedule, { passive: true });
    if (scroller !== wrap) scroller.addEventListener('scroll', schedule, { passive: true });
    try { new ResizeObserver(schedule).observe(wrap); } catch (e) {}
    try { new MutationObserver(schedule).observe(card, { attributes: true, attributeFilter: ['style', 'class'] }); } catch (e) {}
    setInterval(schedule, 1500);                        // zaxira: boshqa modullar o'lchamni o'zgartirsa ham
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPlus);
  else initPlus();
})();
