/* =====================================================================
 * 36_v45_tgdeck.js  (v45) — botdan keladigan havolalar
 *  ?tgdeck=TOKEN  — botdagi «Muharrirda ochish»: SHU slaydning o'zi PPTX qilib olinadi va editorga import qilinadi.
 *  ?tglink=TOKEN  — botdagi «Saytda ulash»: Google bilan kirilgach Telegram akkaunti o'zi ulanadi.
 * Token sahifa yangilansa / Google'ga o'tib qaytsa ham yo'qolmasin deb sessionStorage'da saqlanadi (vaqtincha).
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssTgDeckInit) return;
  window.__ssTgDeckInit = true;

  var tgw = window.Telegram && window.Telegram.WebApp;
  var inTg = !!(tgw && tgw.initData);
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'info'); } catch (e) {} }
  function token() { try { return (typeof supabaseToken !== 'undefined') ? supabaseToken : ''; } catch (e) { return ''; } }
  function logged() { var t = token(); return !!t && t !== 'dev-token'; }
  function ssGet(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  async function waitFor(fn, ms, step) {
    var t0 = Date.now();
    while (Date.now() - t0 < ms) { try { var v = fn(); if (v) return v; } catch (e) {} await sleep(step || 300); }
    return null;
  }

  var qs = new URLSearchParams(location.search);
  var deckTok = qs.get('tgdeck') || '', linkTok = qs.get('tglink') || '';
  if (deckTok || linkTok) {
    if (deckTok) ssSet('ssTgDeck', deckTok);
    if (linkTok) ssSet('ssTgLinkTok', linkTok);
    try {
      qs.delete('tgdeck'); qs.delete('tglink'); qs.delete('src');
      history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString() : '') + location.hash);
    } catch (e) {}
  }
  deckTok = deckTok || ssGet('ssTgDeck');
  linkTok = linkTok || ssGet('ssTgLinkTok');

  async function runDeck() {
    if (!deckTok) return;
    var ready = await waitFor(function () {
      return window.importPptxClient && window.JSZip && typeof slides !== 'undefined' && slides && slides.length;
    }, 45000);
    if (!ready) { toast('Muharrir yuklanmadi — sahifani yangilang.', 'error'); return; }
    if (inTg) await waitFor(logged, 20000);                       // Mini App: avtomatik kirish tugasin (u slaydlarni tegmaydi, lekin xavfsiz)
    await sleep(600);
    toast('Slaydlar muharrirga ochilmoqda…');
    for (var a = 0; a < 3; a++) {
      try {
        var r = await fetch('/api/telegram/deck-file?t=' + encodeURIComponent(deckTok));
        if (r.status === 410 || r.status === 404) { ssDel('ssTgDeck'); toast('Havola eskirgan yoki slayd o‘chirilgan. Botdan «Muharrirda ochish» ni qayta bosing.', 'error'); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var blob = await r.blob();
        var f = new File([blob], 'slayd.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
        ssDel('ssTgDeck');
        await window.importPptxClient(f);
        return;
      } catch (e) { await sleep(2500 * (a + 1)); }                // Render uyg'onguncha qayta urinadi
    }
    toast('Slaydni ochib bo‘lmadi. Keyinroq urinib ko‘ring.', 'error');
  }

  async function runLink() {
    if (!linkTok) return;
    var ok = await waitFor(logged, 5000);
    if (!ok) {
      toast('Google bilan kiring — Telegram ulash o‘zi tugaydi.');
      ok = await waitFor(logged, 600000, 1000);
    }
    if (!ok) return;
    try {
      var r = await fetch('/api/telegram/link-complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token(), link: linkTok }) });
      var j = {}; try { j = await r.json(); } catch (e) {}
      if (r.ok && j.ok) { ssDel('ssTgLinkTok'); toast('✅ Telegram ulandi! Balans endi bot bilan bir xil.'); }
      else if (r.status === 410) { ssDel('ssTgLinkTok'); toast('Havola eskirgan — botdan «Sayt akkauntini ulash» ni qayta bosing.', 'error'); }
      else if (r.status === 409) { ssDel('ssTgLinkTok'); toast('Bu havola allaqachon ishlatilgan.', 'error'); }
      else if (r.status === 400) { ssDel('ssTgLinkTok'); toast('Bu akkaunt Telegram akkaunti — Google bilan kirib ulang.', 'error'); }
      else toast('Ulab bo‘lmadi. Keyinroq urinib ko‘ring.', 'error');
    } catch (e) { toast('Ulab bo‘lmadi. Internetni tekshiring.', 'error'); }
  }

  runDeck();
  runLink();
})();
