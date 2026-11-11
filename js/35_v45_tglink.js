/* =====================================================================
 * 35_v45_tglink.js  (v45) — Telegram bot bilan BIR XIL balans
 *  1) window.ssTgLink(): bir bosishda Telegram ochiladi (Start bosilsa akkaunt ulanadi). Tugma: Sozlamalar va balans oynasida.
 *  2) Botda varaq sarflansa / to'lov qilinsa — sayt balansi avtomatik yangilanadi (oynaga qaytganda va har 30 soniyada;
 *     server javob bermasa so'rovlar siyraklashadi — konsolni to'ldirmaydi).
 * Telegram Mini App ichida ishlamaydi (u allaqachon bot akkaunti bilan kirgan).
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssTgLinkInit) return;
  window.__ssTgLinkInit = true;
  var tgw = window.Telegram && window.Telegram.WebApp;
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'info'); } catch (e) {} }
  async function ask(title, text, okText) {
    try {
      if (window.Swal) { var r = await Swal.fire({ title: title, text: text, icon: 'question', showCancelButton: true, confirmButtonText: okText, cancelButtonText: 'Bekor', confirmButtonColor: '#d93025', reverseButtons: true, heightAuto: false }); return !!r.isConfirmed; }
    } catch (e) {}
    return confirm(title + '\n' + text);
  }

  /* v61: Mini App ichida — Google akkaunt holati: ulangan bo'lsa «Uzish», bo'lmasa «Google akkauntni ulash» */
  if (tgw && tgw.initData) {
    var gState = null, gAt = 0;
    var mpost = async function (action) {
      var r = await fetch('/api/telegram/miniapp-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ init_data: tgw.initData, action: action }) });
      var j = {}; try { j = await r.json(); } catch (e) {}
      return { ok: r.ok, data: j };
    };
    window.ssGoogleStatus = async function (force) {
      if (!force && gState && Date.now() - gAt < 60000) return gState;
      try { var r = await mpost('status'); if (r.ok) { gState = r.data; gAt = Date.now(); } } catch (e) {}
      return gState || { linked: false };
    };
    window.ssGoogleDecorate = async function (root) {
      var els = (root || document).querySelectorAll('[data-google-link]');
      if (!els.length) return;
      var st = await window.ssGoogleStatus();
      els.forEach(function (el) {
        el.textContent = st.linked ? ('✅ Google ulangan' + (st.email ? ' (' + st.email + ')' : '') + ' · Uzish') : '🔗 Google akkauntni ulash';
        el.classList.toggle('is-linked', !!st.linked);
      });
    };
    window.ssGoogleLink = async function () {
      var st = await window.ssGoogleStatus(true);
      if (st.linked) {
        if (!(await ask('Google akkaunt uzilsinmi?', 'Bot va sayt balansi ajraladi. Keyin /link bilan qayta ulash mumkin.', 'Uzish'))) return;
        var u = await mpost('unlink');
        if (u.ok) { toast('Google akkaunt uzildi.'); setTimeout(function () { location.reload(); }, 900); }
        else toast('Uzib bo\u2018lmadi. Keyinroq urinib ko\u2018ring.', 'error');
        return;
      }
      var r = await mpost('link');
      if (!r.ok || !r.data.url) { toast('Ulab bo\u2018lmadi. Keyinroq urinib ko\u2018ring.', 'error'); return; }
      toast('Brauzer ochiladi — Google bilan kiring, ulash o\u2018zi tugaydi.');
      try { tgw.openLink(r.data.url); } catch (e) { window.open(r.data.url, '_blank'); }
    };
    return;
  }

  function token() { try { return (typeof supabaseToken !== 'undefined') ? supabaseToken : ''; } catch (e) { return ''; } }
  function logged() { var t = token(); return !!t && t !== 'dev-token'; }

  /* v61: holat oldindan bilinadi — ulangan bo'lsa tugmada «Ulash» emas «Uzish» yoziladi */
  var tState = null, tAt = 0, tTok = '';
  window.ssTgStatus = async function (force) {
    if (!logged()) return { linked: false };
    if (!force && tState && tTok === token() && Date.now() - tAt < 60000) return tState;
    try { var r = await api('/api/telegram/link-status'); if (r.ok) { tState = r.data; tAt = Date.now(); tTok = token(); } } catch (e) {}
    return tState || { linked: false };
  };
  window.ssTgDecorate = async function (root) {
    var els = (root || document).querySelectorAll('[data-tg-link]');
    if (!els.length) return;
    var st = await window.ssTgStatus();
    els.forEach(function (el) {
      var short = el.getAttribute('data-tg-link') === 'short';
      el.textContent = st.linked ? (short ? 'Uzish' : '✅ Telegram ulangan · Uzish') : (short ? 'Ulash' : '✈️ Telegram botni ulash');
      el.classList.toggle('is-linked', !!st.linked);
      var lab = el.closest('.ss-set-row') && el.closest('.ss-set-row').querySelector('span');
      if (lab && short) lab.firstChild.textContent = st.linked ? 'Bot ulangan ✅' : 'Botni ulash';
    });
  };

  async function api(url) {
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token() }) });
    var j = {}; try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data: j };
  }

  var busy = false;
  window.ssTgLink = async function () {
    if (busy) return;
    if (!logged()) { toast('Avval Google bilan tizimga kiring.', 'error'); return; }
    busy = true;
    var win = null;
    var knownLinked = !!(tState && tState.linked && tTok === token());               // v61: ulanganligi ma'lum — bo'sh oyna ochilmaydi
    if (!knownLinked) { try { win = window.open('about:blank', '_blank'); } catch (e) { win = null; } }      // bosish paytida ochiladi (brauzer bloklamasin)
    try {
      var st = await api('/api/telegram/link-status');
      if (st.ok && st.data && st.data.linked) {
        if (win && !win.closed) win.close();
        // v61: allaqachon ulangan — uzishni taklif qilamiz
        if (await ask('Telegram bot ulangan', 'Uzsangiz bot va sayt balansi ajraladi. Uzilsinmi?', 'Uzish')) {
          var u = await api('/api/telegram/unlink');
          if (u.ok) { tState = { linked: false, enabled: true }; tAt = Date.now(); toast('Telegram bot uzildi.'); }
          else toast('Uzib bo\u2018lmadi. Keyinroq urinib ko\u2018ring.', 'error');
          try { window.ssTgDecorate(); } catch (e) {}
        }
        return;
      }
      var r = await api('/api/telegram/link-code');
      if (!r.ok || !r.data.url) {
        if (win && !win.closed) win.close();
        var m = r.data && r.data.error === 'db_not_ready' ? 'Server sozlanmagan (SUPABASE_SCHEMA.sql ishga tushirilmagan).'
          : (r.data && r.data.error === 'telegram_disabled' ? 'Telegram bot o‘chiq.' : 'Ulab bo‘lmadi. Keyinroq urinib ko‘ring.');
        toast(m, 'error');
        return;
      }
      toast('Telegram ochilmoqda… botda «Start» ni bosing.');
      if (win && !win.closed) win.location.href = r.data.url; else window.location.href = r.data.url;
    } catch (e) {
      if (win && !win.closed) win.close();
      toast('Ulab bo‘lmadi. Keyinroq urinib ko‘ring.', 'error');
    } finally { busy = false; }
  };

  /* Balansni bot bilan sinxron saqlash (jimgina; xato bo'lsa siyraklashadi) */
  var last = 0, fails = 0;
  async function sync() {
    if (document.hidden || !logged() || navigator.onLine === false) return;
    var now = Date.now();
    if (now - last < 15000) return;
    last = now;
    try {
      var r = await fetch('/api/user/usage?token=' + encodeURIComponent(token()));
      if (!r.ok) throw new Error('http');
      var d = await r.json();
      if (d && !d.error && window.Monitoring && typeof window.Monitoring.applyServerUsage === 'function') window.Monitoring.applyServerUsage(d);
      fails = 0;
    } catch (e) { fails++; }
  }
  function loop() { setTimeout(function () { sync().then(loop, loop); }, Math.min(300000, 30000 * Math.pow(2, Math.min(fails, 4)))); }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  loop();
})();
