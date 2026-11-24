/* =====================================================================
 * 33_v43_telegram.js  (v43) — Telegram Mini App integratsiyasi
 *
 *  1) Telegram ichida ochilsa: to'liq ekran, pastga surib yopilib ketishdan himoya.
 *  2) Avtomatik kirish: Google OAuth Telegram WebView'da bloklanadi, shuning uchun
 *     serverga initData yuboriladi (/api/telegram/auth) va Supabase sessiyasi ochiladi.
 *  3) Botdan kelgan mavzu (?topic=...) AI'ga avtomatik yuboriladi.
 *
 * Oddiy brauzerda (Telegram tashqarisida) bu modul faqat ?topic= ni input'ga qo'yadi.
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssTgInit) return;
  window.__ssTgInit = true;

  var tg = window.Telegram && window.Telegram.WebApp;
  var inTg = !!(tg && tg.initData);
  var qs = new URLSearchParams(location.search);
  var topic = (qs.get('topic') || '').replace(/\s+/g, ' ').trim().slice(0, 200);

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'info'); } catch (e) {} }
  function client() { try { return (typeof supabaseClient !== 'undefined') ? supabaseClient : null; } catch (e) { return null; } }
  function token() { try { return (typeof supabaseToken !== 'undefined') ? supabaseToken : ''; } catch (e) { return ''; } }
  function isGuestToken(t) { return !t || t === 'dev-token'; }

  /* URL'dan ?topic= ni olib tashlaymiz — sahifa yangilanganda qayta yuborilmasin */
  if (topic || qs.has('src')) {
    try {
      qs.delete('topic'); qs.delete('src');
      var clean = location.pathname + (qs.toString() ? '?' + qs.toString() : '') + location.hash;
      history.replaceState(null, '', clean);
    } catch (e) {}
  }

  if (inTg) {
    document.documentElement.classList.add('in-telegram');
    var st = document.createElement('style');
    st.textContent =
      /* Telegram'da Google tugmasi va taklif oynasi ishlamaydi — avtomatik kirish bor */
      '.in-telegram #googleLoginBtn,.in-telegram .ss-gp-back{display:none!important}' +
      '.in-telegram body{overscroll-behavior:none}';
    document.head.appendChild(st);
    try { tg.ready(); } catch (e) {}
    try { tg.expand(); } catch (e) {}
    // v75: TELEFONDA to'liq ekran (fullscreen) YO'Q — faqat expand(). Avval pastki menyudagi tugma va chapdagi doimiy
    // «Muharrir» tugmasi ikki xil ochardi (biri fullscreen, biri oddiy). Endi qaysi tugmadan ochilsa ham bir xil:
    // Telegram sarlavhasi ko'rinib turadi, yuqori qism kesilmaydi. Telegram o'zi fullscreen'da ochsa — chiqaramiz.
    // Planshet / kompyuterda (qisqa tomoni >= 600px) v66 dagidek butun ekran.
    var plat = String(tg.platform || '').toLowerCase();
    var shortSide = Math.min(screen.width || 0, screen.height || 0) || Math.min(innerWidth, innerHeight);
    var isPhone = (plat === 'android' || plat === 'ios') && shortSide < 600;
    window.__ssTgPhone = isPhone;
    if (isPhone) {
      try { if (tg.isFullscreen && typeof tg.exitFullscreen === 'function') tg.exitFullscreen(); } catch (e) {}
    }
    // Bot API 8.0+ — to'liq ekran (faqat planshet / kompyuter). Eski versiyada yoki rad etilsa — jim o'tamiz.
    try {
      var canFs = !isPhone && typeof tg.requestFullscreen === 'function' &&
        (typeof tg.isVersionAtLeast !== 'function' || tg.isVersionAtLeast('8.0'));
      if (canFs && !tg.isFullscreen) {
        if (tg.onEvent) tg.onEvent('fullscreenFailed', function (e) {
          try { console.info('[tg] fullscreen:', e && e.error); } catch (x) {}
        });
        tg.requestFullscreen();
      }
    } catch (e) {}
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}   // tahrirlashda tasodifan yopilmasin
    try { if (tg.enableClosingConfirmation) tg.enableClosingConfirmation(); } catch (e) {}
  }

  async function waitFor(fn, ms, step) {
    var t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { var v = fn(); if (v) return v; } catch (e) {}
      await sleep(step || 250);
    }
    return null;
  }

  async function telegramLogin() {
    var c = await waitFor(client, 20000);
    if (!c) return false;
    var sess = null;
    try { var r = await c.auth.getSession(); sess = r && r.data ? r.data.session : null; } catch (e) {}
    if (sess) {
      // v81: sessiya TO'G'RI akkauntdami? Google ulangan bo'lsa Mini App Google akkaunt bilan ochilishi kerak
      // (avval eski Telegram sessiyasida qolib, balans va oxirgi slayd boshqa bo'lib ko'rinardi).
      var want = '';
      try {
        var a = await fetch('/api/telegram/account', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ init_data: tg.initData }) });
        if (a.ok) want = String((await a.json()).email || '').toLowerCase();
      } catch (e) {}
      var have = String((sess.user && sess.user.email) || '').toLowerCase();
      if (!want || want === have) return true;               // allaqachon to'g'ri akkauntda
    }

    for (var attempt = 0; attempt < 3; attempt++) {          // Render uyg'onguncha 2-3 marta urinadi
      try {
        var res = await fetch('/api/telegram/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ init_data: tg.initData })
        });
        if (res.status === 401 || res.status === 409) { toast('Telegram orqali kirib bo\u2018lmadi. Botdan qayta oching.', 'error'); return false; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var j = await res.json();
        if (!j || !j.token_hash) throw new Error('token_hash yo\u2018q');
        window.__ssUserLogout = false;
        var v = await c.auth.verifyOtp({ token_hash: j.token_hash, type: j.type || 'magiclink' });
        if (v && v.error) throw v.error;
        return true;
      } catch (e) {
        if (attempt === 2) { toast('Kirishda xatolik. Mini App\u2019ni yopib qayta oching.', 'error'); console.warn('[tg] login', e); return false; }
        await sleep(1500 * (attempt + 1));
      }
    }
    return false;
  }

  function openAiSidebar() {
    try { var s = document.getElementById('aiSidebar'); if (s && !s.classList.contains('open')) s.classList.add('open'); } catch (e) {}
  }

  async function runTopic() {
    if (!topic) return;
    var input = await waitFor(function () { return document.getElementById('aiSidebarInput'); }, 15000);
    if (!input || typeof sendSidebarAiPrompt !== 'function') return;
    openAiSidebar();
    input.value = topic + ' mavzusida taqdimot yarat';
    try { if (typeof autoGrowSidebarInput === 'function') autoGrowSidebarInput(input); } catch (e) {}
    var logged = await waitFor(function () { return !isGuestToken(token()); }, inTg ? 15000 : 600, 300);
    if (!logged) { toast('AI ishlashi uchun avval tizimga kiring \u2014 mavzu yozib qo\u2018yildi.', 'info'); return; }
    await sleep(700);                                        // slaydlar/WS tayyor bo'lsin
    if (typeof isAiStreaming !== 'undefined' && isAiStreaming) return;
    try { sendSidebarAiPrompt(); } catch (e) { console.warn('[tg] topic', e); }
  }

  (async function main() {
    if (inTg) await telegramLogin();
    await runTopic();
  })();
})();
