/* =====================================================================
 * 35_v45_tglink.js  (v45, v81) — Telegram bot bilan BIR XIL balans
 *  v81: saytdagi «Telegram botni ulash / Uzish» tugmalari va kod bilan ulash OLIB TASHLANDI. Yagona ulash yo'li —
 *  botdagi «🔗 Google akkauntni ulash» (36_v45_tgdeck.js ?tglink=). Bu fayl faqat balansni yangilab turadi:
 *  Botda varaq sarflansa / to'lov qilinsa — sayt balansi avtomatik yangilanadi (oynaga qaytganda va har 30 soniyada;
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

  if (tgw && tgw.initData) return;           // Mini App balansni o'zi yangilaydi
  function token() { try { return (typeof supabaseToken !== 'undefined') ? supabaseToken : ''; } catch (e) { return ''; } }
  function logged() { var t = token(); return !!t && t !== 'dev-token'; }

  /* Balansni bot bilan sinxron saqlash (jimgina; xato bo'lsa siyraklashadi) */
  var last = 0, fails = 0;
  async function sync() {
    if (document.hidden || !logged() || navigator.onLine === false) return;
    var now = Date.now();
    if (now - last < 30000) return;            // Audit H4: at most 1 call / 30 s on focus
    last = now;
    try {
      var r = await fetch('/api/user/usage', { headers: { Authorization: 'Bearer ' + token() } });
      if (!r.ok) throw new Error('http');
      var d = await r.json();
      if (d && !d.error && window.Monitoring && typeof window.Monitoring.applyServerUsage === 'function') window.Monitoring.applyServerUsage(d);
      fails = 0;
    } catch (e) { fails++; }
  }
  function loop() { setTimeout(function () { sync().then(loop, loop); }, Math.min(600000, 120000 * Math.pow(2, Math.min(fails, 2)))); }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  loop();
})();
