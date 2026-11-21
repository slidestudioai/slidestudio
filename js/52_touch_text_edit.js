/* js/52_touch_text_edit.js (v68) — KLAVIATURASIZ qurilmalarda (telefon, planshet) slayddagi matnni tahrirlash.
 *
 * Muammo: matn tahrirlash faqat sichqonchaning «dblclick» hodisasiga bog'langan edi (22_v31_fixes.js). Telefon
 * brauzerlari (ayniqsa iOS Safari) barmoq bilan ikki marta tegishda dblclick yubormaydi — matn hech qachon tahrirlash
 * rejimiga o'tmasdi va ekranda klaviatura chiqmasdi.
 *
 * Endi barmoq bilan:
 *   - matnga IKKI MARTA tez tegish, yoki
 *   - allaqachon tanlangan matnga YANA BIR MARTA tegish
 * → tahrirlash rejimi ochiladi va ekran klaviaturasi chiqadi. Kursor matn oxirida turadi.
 * Klaviatura faqat foydalanuvchi tegishi ICHIDA (touchend) focus berilsa chiqadi — shuning uchun hammasi shu yerda, sinxron.
 * iOS: 16px dan kichik maydonga focus berilsa sahifa kattalashib ketadi — yashirin maydon 16px qilinadi.
 */
(function () {
  'use strict';
  if (window.__ssTouchTextEdit) return;
  window.__ssTouchTextEdit = true;

  var TAP_MS = 350, TAP_MOVE = 12, DOUBLE_MS = 380;
  function isText(o) { return !!o && (o.type === 'textbox' || o.type === 'i-text') && !o.isButton && !o.isEmbed && o.ssRole !== 'bgdecor'; }
  function toast(m) { try { if (typeof showToast === 'function') showToast(m); } catch (e) {} }

  function edit(t) {
    var c = window.canvas;
    try {
      if (typeof window.startTextEditing === 'function') window.startTextEditing(t, false);
      else { t.editable = true; c.setActiveObject(t); t.enterEditing(); }
      if (!t.isEditing) return false;
      t.__ssTouchEditing = true;
      var n = (t.text || '').length;
      t.selectionStart = n; t.selectionEnd = n;
      var ta = t.hiddenTextarea;
      if (ta) {
        ta.style.fontSize = '16px';                     // iOS: focus paytida sahifa kattalashmasin
        ta.setAttribute('autocapitalize', 'sentences');
        ta.setAttribute('enterkeyhint', 'enter');
        try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
        try { ta.setSelectionRange(n, n); } catch (e) {}
      }
      try { t._updateTextarea && t._updateTextarea(); } catch (e) {}
      c.requestRenderAll();
      return true;
    } catch (e) { console.warn('[touch-edit]', e); return false; }
  }

  function init() {
    var c = window.canvas;
    if (!c || !c.upperCanvasEl || c.__ssTouchEdit) return !!(c && c.__ssTouchEdit);
    c.__ssTouchEdit = true;
    var up = c.upperCanvasEl;
    var start = null, last = { t: null, time: 0 }, hinted = false;
    try { hinted = !!(window.ssPref && ssPref.get('touchEditHint') === '1'); } catch (e) {}

    up.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length !== 1) { start = null; return; }
      var p = e.touches[0];
      // tegishdan OLDIN qaysi obyekt tanlangan edi (fabric mouse:down tanlovni o'zgartirmasdan)
      start = { x: p.clientX, y: p.clientY, time: Date.now(), prev: c.getActiveObject() };
    }, { passive: true, capture: true });

    up.addEventListener('touchend', function (e) {
      var s = start; start = null;
      if (!s || (e.touches && e.touches.length)) return;
      var ch = e.changedTouches && e.changedTouches[0]; if (!ch) return;
      if (Date.now() - s.time > TAP_MS || Math.abs(ch.clientX - s.x) > TAP_MOVE || Math.abs(ch.clientY - s.y) > TAP_MOVE) { last.t = null; return; }
      var t = null;
      try { t = c.findTarget(e, false); } catch (er) {}
      if (!isText(t) || t.isEditing) { last.t = null; return; }
      var now = Date.now();
      var dbl = last.t === t && now - last.time < DOUBLE_MS;
      var again = s.prev === t;                                  // tanlangan matnga yana tegish
      last = { t: t, time: now };
      if (dbl || again) {
        if (edit(t)) { last.t = null; return; }
      }
      if (!hinted) {
        hinted = true;
        try { if (window.ssPref) ssPref.set('touchEditHint', '1'); } catch (er) {}
        toast("Matnni o'zgartirish uchun unga yana bir marta bosing");
      }
    }, { passive: true, capture: false });

    // tahrirlash tugagach (klaviatura yopilganda) — Fabric holatini to'g'rilaymiz
    try {
      c.on('text:editing:exited', function (ev) { if (ev && ev.target) ev.target.__ssTouchEditing = false; });
      c.on('text:editing:entered', function (ev) {
        var t = ev && ev.target; if (!t || !t.hiddenTextarea) return;
        t.hiddenTextarea.style.fontSize = '16px';
        // faqat barmoq bilan ochilgan tahrirlash: kompyuterda toolbar tugmasi bosilganda tahrirlash uzilmasin
        if (t.__ssTouchEditing && !t.hiddenTextarea.__ssBlur) {
          t.hiddenTextarea.__ssBlur = true;
          t.hiddenTextarea.addEventListener('blur', function () {
            // telefon «Tayyor» / klaviaturani yopdi — matn saqlanadi, tahrirlash rejimidan chiqiladi
            setTimeout(function () {
              try { if (t.isEditing && t.hiddenTextarea && document.activeElement !== t.hiddenTextarea) { t.exitEditing(); c.requestRenderAll(); if (typeof saveCurrentSlideState === 'function') saveCurrentSlideState(); } } catch (er) {}
            }, 150);
          });
        }
      });
    } catch (e) {}
    return true;
  }
  if (!init()) {
    var n = 0, iv = setInterval(function () { if (init() || ++n > 60) clearInterval(iv); }, 250);
  }
})();
