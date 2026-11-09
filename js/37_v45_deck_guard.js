/* =====================================================================
 * 37_v45_deck_guard.js  (v45) — slaydlar yo'qolib ketmasin
 * Muammo: «matnni qaytadan qil» deyilganda AI reset_deck beradi (hamma slaydni 1 taga tushiradi), keyin varaq/limit
 * yetmay yoki oqim uzilib, yangi slaydlar to'liq yaratilmay qolardi.
 *  1) Varaq yetmasa (<2) reset_deck bajarilmaydi — mavjud slaydlar saqlanadi.
 *  2) AI tugagach slaydlar keskin kamayib ketgan bo'lsa — «Oldingi holatni qaytarish» taklif qilinadi
 *     (AI'dan oldin olingan nusxa bor: window._preAiSlidesSnapshot).
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssGuardInit) return;
  window.__ssGuardInit = true;

  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'info'); } catch (e) {} }
  function isReset(a) { return a && (a.action === 'reset_deck' || a.action === 'delete_extra_slides'); }
  function pagesLeft() { try { return (window.Monitoring && window.Monitoring.totalCredits) ? window.Monitoring.totalCredits() : 99; } catch (e) { return 99; } }
  function deckLen() { try { return (typeof slides !== 'undefined' && slides) ? slides.length : 0; } catch (e) { return 0; } }

  var warned = false;
  var origExec = window.executeAiCommands;
  if (typeof origExec === 'function') {
    window.executeAiCommands = function (payload) {
      try {
        var arr = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.actions) ? payload.actions : null);
        if (arr && arr.some(isReset) && deckLen() > 1 && pagesLeft() < 2) {
          if (!warned) { warned = true; toast('Varaq yetarli emas — mavjud slaydlaringiz o‘chirilmadi. Varaq sotib oling yoki 24 soat kuting.', 'error'); setTimeout(function () { warned = false; }, 15000); }
          var kept = arr.filter(function (a) { return !isReset(a); });
          payload = Array.isArray(payload) ? kept : Object.assign({}, payload, { actions: kept });
        }
      } catch (e) {}
      return origExec.call(this, payload);
    };
  }

  var askedFor = null;
  function check() {
    var snap = window._preAiSlidesSnapshot;
    if (!snap || askedFor === snap) return;
    var before = 0;
    try { before = JSON.parse(snap).slides.length; } catch (e) { return; }
    var now = deckLen();
    var collapsed = (now <= 1 && before >= 2) || (before >= 4 && now * 2 <= before && window.__ssTurnWarned);
    if (!collapsed) return;
    askedFor = snap;
    var html = 'Oldin <b>' + before + '</b> ta slayd edi, hozir <b>' + now + '</b> ta qoldi.<br>Oldingi holatni qaytaraymi?';
    if (typeof Swal !== 'undefined' && Swal.fire) {
      Swal.fire({ icon: 'warning', title: 'Slaydlar kamayib ketdi', html: html, showCancelButton: true,
        confirmButtonText: '↩️ Qaytarish', cancelButtonText: 'Yo‘q, qolsin', heightAuto: false })
        .then(function (r) { if (r && r.isConfirmed && typeof window.undoAiChanges === 'function') window.undoAiChanges(); });
    } else if (confirm('Slaydlar ' + before + ' tadan ' + now + ' taga tushdi. Oldingi holatni qaytaraymi?') && typeof window.undoAiChanges === 'function') {
      window.undoAiChanges();
    }
  }

  var origFinish = window.finishAiStream;
  if (typeof origFinish === 'function') {
    window.finishAiStream = async function () {
      var r = await origFinish.apply(this, arguments);
      setTimeout(function () { try { check(); } catch (e) {} }, 700);
      return r;
    };
  }
})();
