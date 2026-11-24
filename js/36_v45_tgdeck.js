/* =====================================================================
 * 36_v45_tgdeck.js  (v45) — botdan keladigan havolalar
 *  ?tgdeck=TOKEN  — botdagi «Muharrirda ochish»: SHU slaydning o'zi PPTX qilib olinadi va editorga import qilinadi.
 *  ?tglink=TOKEN  — botdagi YAGONA «🔗 Google akkauntni ulash» (v81): Google bilan kirilgach ulash o'zi tugaydi.
 * Token sahifa yangilansa / Google'ga o'tib qaytsa ham yo'qolmasin deb 'ss-auth-v39-*' kaliti ostida saqlanadi (vaqtincha).
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
  async function waitFor(fn, ms, step) {
    var t0 = Date.now();
    while (Date.now() - t0 < ms) { try { var v = fn(); if (v) return v; } catch (e) {} await sleep(step || 300); }
    return null;
  }

  // v69: plain localStorage / sessionStorage do NOT work on this site — index.html's storage lock (v39) makes setItem a
  // no-op and clears sessionStorage on every load. That is why the link token was lost after the Google sign-in and
  // the user had to press the bot button a second time. Only 'ss-auth-v39*' keys survive (window.__ssAuthStorage).
  var AS = window.__ssAuthStorage;
  function lsGet(k) { try { return (AS && AS.getItem('ss-auth-v39-' + k)) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (AS) AS.setItem('ss-auth-v39-' + k, v); } catch (e) {} }
  function lsDel(k) { try { if (AS) AS.removeItem('ss-auth-v39-' + k); } catch (e) {} }
  // v69: the link token (L.<tg_id>.0.<exp>.<sig>) carries its own expiry
  function tokExp(t) { var e = +String(t || '').split('.')[3]; return e > 0 ? e * 1000 : Date.now() + 30 * 60000; }
  function storedLink() {
    try { var o = JSON.parse(lsGet('tglink') || 'null'); if (o && o.t && o.exp > Date.now()) return o.t; } catch (e) {}
    lsDel('tglink');
    return '';
  }
  function stripParams(keys) {
    try {
      var q = new URLSearchParams(location.search), had = false;
      keys.forEach(function (k) { if (q.has(k)) { q.delete(k); had = true; } });
      if (had) history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash);
    } catch (e) {}
  }

  var qs = new URLSearchParams(location.search);
  var deckTok = qs.get('tgdeck') || '', linkTok = qs.get('tglink') || '';
  if (deckTok) { lsSet('tgdeck', JSON.stringify({ t: deckTok, exp: Date.now() + 30 * 60000 })); stripParams(['tgdeck', 'src']); }
  // v69: the link token is kept in localStorage (survives the Google redirect, a closed tab, opening the site again)
  // and STAYS in the address bar until linking is finished — «⋮ → Open in browser» from Telegram must carry it along.
  // (Before it was removed at once, so the page opened in Chrome had no token and the user had to start again.)
  if (linkTok) lsSet('tglink', JSON.stringify({ t: linkTok, exp: tokExp(linkTok) }));
  if (!deckTok) { try { var dk = JSON.parse(lsGet('tgdeck') || 'null'); if (dk && dk.t && dk.exp > Date.now()) deckTok = dk.t; else lsDel('tgdeck'); } catch (e) {} }
  linkTok = linkTok || storedLink();
  function linkFinished() { lsDel('tglink'); stripParams(['tglink', 'src']); }
  // Telegram's own in-app browser (not the Mini App): Google refuses to sign in there
  function inTgBrowser() {
    if (inTg) return false;
    try { return typeof window.TelegramWebviewProxy !== 'undefined' || /Telegram/i.test(navigator.userAgent || ''); } catch (e) { return false; }
  }
  async function askLogin() {
    var inApp = inTgBrowser();
    var title = 'Google akkauntni ulash';
    var text = inApp
      ? "Google Telegram ichidagi brauzerda kirishga ruxsat bermaydi. Yuqoridagi ⋮ (yoki ⋯) tugmasini bosing → «Brauzerda ochish». Ulash o'sha yerda o'zi tugaydi."
      : 'Ulash uchun Google bilan kiring — qolgani o\u2018zi bajariladi.';
    if (!window.Swal) { toast(text); return; }
    try {
      var r = await Swal.fire({ title: title, text: text, icon: 'info', heightAuto: false,
        showCancelButton: true, cancelButtonText: 'Keyinroq',
        confirmButtonText: inApp ? 'Havolani nusxalash' : 'Google bilan kirish', confirmButtonColor: '#1a73e8' });
      if (!r.isConfirmed) return;
      if (inApp) {
        try { await navigator.clipboard.writeText(location.href); toast('Havola nusxalandi — brauzerga qo\u2018ying.'); }
        catch (e) { toast('Yuqoridagi ⋮ → «Brauzerda ochish» ni bosing.'); }
      } else if (typeof window.handleGoogleLogin === 'function') {
        window.handleGoogleLogin();
      }
    } catch (e) {}
  }

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
        if (r.status === 410 || r.status === 404) { lsDel('tgdeck'); toast('Havola eskirgan yoki slayd o‘chirilgan. Botdan «Muharrirda ochish» ni qayta bosing.', 'error'); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var blob = await r.blob();
        var f = new File([blob], 'slayd.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
        lsDel('tgdeck');
        await window.importPptxClient(f);
        return;
      } catch (e) { await sleep(2500 * (a + 1)); }                // Render uyg'onguncha qayta urinadi
    }
    toast('Slaydni ochib bo‘lmadi. Keyinroq urinib ko‘ring.', 'error');
  }

  async function runLink() {
    if (!linkTok) return;
    if (tokExp(linkTok) < Date.now()) { linkFinished(); toast('Havola eskirgan — botdagi «🔗 Google ulash» ni qayta bosing.', 'error'); return; }
    var ok = await waitFor(logged, 6000);
    if (!ok) {
      askLogin();
      ok = await waitFor(logged, Math.max(60000, tokExp(linkTok) - Date.now()), 1000);   // as long as the link lives
    }
    if (!ok) return;
    // v69: a sleeping server (Render free plan) or a short network error must not cost the user a second try:
    // up to 5 attempts with a growing pause; the server answers «ok» again if this account is already linked.
    for (var a = 0; a < 5; a++) {
      try {
        var tk = window.ssFreshToken ? await window.ssFreshToken(a > 0) : token();      // v81.3: eskirgan token 401 berardi
        var r = await fetch('/api/telegram/link-complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tk, link: linkTok }) });
        var j = {}; try { j = await r.json(); } catch (e) {}
        if (r.ok && j.ok) {
          linkFinished(); toast('✅ Google akkaunt ulandi! Balans va oxirgi taqdimot endi bot bilan bir xil.');
          try { window.ssTgDecorate && window.ssTgDecorate(); } catch (e) {}
          try { if (typeof loadUserStats === 'function') loadUserStats(true); } catch (e) {}
          deckTok = ''; runLatest();                                // botdagi oxirgi taqdimot shu yerda ham
          return;
        }
        if (r.status === 410) { linkFinished(); toast('Havola eskirgan — botdagi «🔗 Google ulash» ni qayta bosing.', 'error'); return; }
        if (r.status === 409) {                                     // v81: ulanish doimiy — boshqasiga o'tkazilmaydi
          linkFinished();
          toast(j.error === 'used' ? 'Bu havola allaqachon ishlatilgan.' : (j.error === 'google_taken' ? 'Bu Google akkaunt boshqa Telegram\u2019ga ulangan.'
            : 'Bu Telegram allaqachon boshqa Google akkauntga ulangan.'), 'error');
          return;
        }
        if (r.status === 400) { linkFinished(); toast('Bu akkaunt Telegram akkaunti — Google bilan kirib ulang.', 'error'); return; }
        if (r.status === 401) await waitFor(logged, 8000);        // session was refreshing — try again with the new token
      } catch (e) {}
      if (a === 0) toast('Ulanmoqda… server javobini kutyapmiz.');
      await sleep(2000 * (a + 1));
    }
    toast('Ulab bo‘lmadi. Sahifani yangilang — havola hali ishlaydi.', 'error');      // token kept: a reload retries
  }

  /* v79: «🚀 Muharrir» (havolasiz) ochilganda — botdagi OXIRGI taqdimot muharrirdagi qoralamadan yangiroq bo'lsa, o'sha
   * ochiladi: bot va muharrir bitta akkaunt, doim eng oxirgi ish ko'rinadi. Qoralamada ish bo'lsa — avval so'raladi
   * (eski ish bexosdan almashmasin). Rad etilgan taqdimot qayta so'ralmaydi. */
  async function runLatest() {
    if (deckTok) return;
    // v81: saytda ham (Google bilan kirgan, Telegram'i ulangan) — botdagi oxirgi taqdimot shu yerda ham eng oxirgisi
    if (!inTg && !(await waitFor(logged, 20000, 500))) return;
    var ready = await waitFor(function () {
      return window.importPptxClient && window.JSZip && typeof slides !== 'undefined' && slides && slides.length && window.__ssRestoreChecked;
    }, 45000);
    if (!ready) return;
    var j = null;
    try {
      var r = await fetch('/api/telegram/latest-deck', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inTg ? { init_data: tgw.initData } : { token: (window.ssFreshToken ? await window.ssFreshToken(false) : token()) }) });
      if (r.ok) j = await r.json();
    } catch (e) { return; }
    var d = j && j.deck;
    if (!d || !d.token || !d.updated_ms) return;
    var mark = d.id + ':' + d.updated_ms;
    if (lsGet('tglatest') === mark) return;                         // shu taqdimot allaqachon ochilgan / rad etilgan
    var draftAt = 0;
    try { draftAt = window.ssDraftSavedAt ? await window.ssDraftSavedAt() : 0; } catch (e) {}
    if (draftAt && draftAt >= d.updated_ms) return;                 // muharrirdagi ish yangiroq — o'sha qoladi
    var pristine = false;
    try { pristine = !!(window.ssIsPristineDeck && window.ssIsPristineDeck()); } catch (e) {}
    lsSet('tglatest', mark);
    if (draftAt && !pristine && window.Swal) {
      try {
        var q = await Swal.fire({ title: 'Botdagi oxirgi taqdimot', text: '«' + (d.title || 'Taqdimot') + '» botda yangiroq. Uni ochaymi? (muharrirdagi oldingi ish almashtiriladi)',
          icon: 'question', showCancelButton: true, confirmButtonText: 'Ochish', cancelButtonText: 'Yo\u2018q', heightAuto: false });
        if (!q.isConfirmed) return;
      } catch (e) { return; }
    }
    deckTok = d.token;
    await runDeck();
  }

  runDeck();
  runLink();
  runLatest();
})();
