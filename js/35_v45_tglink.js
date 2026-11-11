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
  if (tgw && tgw.initData) return;

  function token() { try { return (typeof supabaseToken !== 'undefined') ? supabaseToken : ''; } catch (e) { return ''; } }
  function logged() { var t = token(); return !!t && t !== 'dev-token'; }
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'info'); } catch (e) {} }

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
    try { win = window.open('about:blank', '_blank'); } catch (e) { win = null; }      // bosish paytida ochiladi (brauzer bloklamasin)
    try {
      var st = await api('/api/telegram/link-status');
      if (st.ok && st.data && st.data.linked) {
        if (win && !win.closed) win.close();
        toast('✅ Telegram allaqachon ulangan — balans bot bilan bir xil.');
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
