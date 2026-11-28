/* =====================================================================
 * 55_support.js  (v70) — 💬 YORDAM (Support)
 *
 *  ⚙️ Sozlamalar → «💬 Yordam» tugmasi shu oynani ochadi. Foydalanuvchi adminga shaxsiy xabar yozadi,
 *  admin «Admin panel → 💬 Yordam» da o'qiydi va javob beradi. Javob shu oynada ko'rinadi
 *  (Telegram ulangan bo'lsa botga ham xabar boradi).
 *
 *  Server: POST /api/support/send · /api/support/my · /api/support/unread  (backend/support.py)
 *  Global: window.ssOpenSupport(), window.ssSupportUnread()
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssSupport) return;
  window.__ssSupport = true;

  var MAX_LEN = 2000;
  var pollTimer = null, busy = false, lastUnread = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function token() { try { return (typeof supabaseToken !== 'undefined' && supabaseToken) ? supabaseToken : ''; } catch (e) { return ''; } }
  function logged() { var t = token(); return !!t && t !== 'dev-token'; }
  function tr(s) { try { return window.SSI18n && SSI18n.t ? (SSI18n.t(s) || s) : s; } catch (e) { return s; } }
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(tr(m), k || 'info'); } catch (e) {} }
  function fdate(v) {
    var d = new Date(v); if (isNaN(d)) return '';
    try { return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  async function api(path, body) {
    var t = token();
    var r = await fetch('/api/support/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
      body: JSON.stringify(Object.assign({ token: t }, body || {}))
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || ('Xato ' + r.status)); e.status = r.status; throw e; }
    return j;
  }

  /* ------------------------------------------------------------------ CSS */
  var css = document.createElement('style');
  css.textContent = [
    '#ssSup .ssset{display:flex;flex-direction:column;max-height:88vh}',
    '.sssup-h{display:flex;align-items:center;gap:10px;margin-bottom:4px}',
    '.sssup-h b{font-size:17px;flex:1}',
    '.sssup-sub{color:#6b7280;font-size:13px;margin:0 0 10px}',
    '.sssup-list{flex:1;min-height:120px;max-height:46vh;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:10px;background:#f6f7f9;border-radius:14px;border:1px solid #e5e7eb}',
    '.sssup-m{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.4}',
    '.sssup-m.me{align-self:flex-end;background:#1a73e8;color:#fff;border-bottom-right-radius:4px}',
    '.sssup-m.adm{align-self:flex-start;background:#fff;color:#1f2937;border:1px solid #e5e7eb;border-bottom-left-radius:4px}',
    '#ssSup .sssup-m small{display:block;font-size:11px;margin-top:3px;color:#6b7280}',
    '#ssSup .sssup-m.me small{color:rgba(255,255,255,.85)}',
    '.sssup-empty{margin:auto;text-align:center;color:#9ca3af;font-size:13px;padding:16px}',
    '.sssup-form{margin-top:10px}',
    '.sssup-form textarea{width:100%;box-sizing:border-box;min-height:84px;max-height:200px;resize:vertical;border:1px solid #d1d5db;border-radius:12px;padding:10px 12px;font:inherit;font-size:14px;outline:none;color:#1f2937;background:#fff}',
    '.sssup-form textarea:focus{border-color:#1a73e8;box-shadow:0 0 0 3px rgba(26,115,232,.15)}',
    '.sssup-row{display:flex;align-items:center;gap:10px;margin-top:6px}',
    '.sssup-row small{flex:1;color:#9ca3af;font-size:12px}',
    '.sssup-row .ssset-btn{width:auto;margin:0;padding:10px 18px}',
    '.ss-sup-badge{display:inline-block;min-width:18px;height:18px;line-height:18px;padding:0 5px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;margin-left:4px}',
    'body.ss-sup-unread #sidebarSettingsBtn::after{content:"";position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 2px #e8eaed}'
  ].join('\n');
  document.head.appendChild(css);

  /* ------------------------------------------------------------------ oyna */
  function close() {
    var o = $('ssSup'); if (o) o.remove();
    document.removeEventListener('keydown', onKey);
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function renderMessages(list, msgs) {
    if (!msgs || !msgs.length) {
      list.innerHTML = '<div class="sssup-empty">Hali xabar yo‘q. Savolingizni pastga yozing — admin shu yerda javob beradi.</div>';
      return;
    }
    var atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = msgs.map(function (m) {
      return '<div class="sssup-m ' + (m.from_admin ? 'adm' : 'me') + '" data-no-i18n>' + esc(m.body) +
        '<small>' + (m.from_admin ? esc(tr('Admin')) + ' · ' : (m.id != null ? '№' + esc(String(m.id)) + ' · ' : '')) + esc(fdate(m.created_at)) + '</small></div>';
    }).join('');
    if (atBottom || list.__first !== false) { list.scrollTop = list.scrollHeight; list.__first = false; }
  }

  async function load(list) {
    try {
      var r = await api('my');
      renderMessages(list, r.messages || []);
      setUnread(0);
    } catch (e) {
      if (e.status === 401) { close(); toast('Avval tizimga kiring', 'warning'); return; }
      list.innerHTML = '<div class="sssup-empty">' + esc(tr(e.message || 'Yuklab bo‘lmadi')) + '</div>';
    }
  }

  function openSupport() {
    close();
    var o = $('ssSet'); if (o) o.remove();       // sozlamalar oynasi yopiladi
    var ov = document.createElement('div'); ov.id = 'ssSup'; ov.className = 'ssset-ov';
    var li = logged();
    ov.innerHTML = '<div class="ssset" role="dialog" aria-modal="true" aria-label="Yordam">' +
      '<div class="sssup-h"><b>💬 Yordam</b><button type="button" class="ssset-x" aria-label="Yopish">×</button></div>' +
      '<p class="sssup-sub">Savol, taklif yoki muammo bo‘lsa yozing — admin javob beradi. Javob shu oynada ko‘rinadi.</p>' +
      (li ?
        '<div class="sssup-list" id="ssSupList"><div class="sssup-empty">Yuklanmoqda…</div></div>' +
        '<div class="sssup-form"><textarea id="ssSupText" maxlength="' + MAX_LEN + '" placeholder="Xabaringizni yozing…" aria-label="Xabar matni"></textarea>' +
        '<div class="sssup-row"><small id="ssSupCnt">0 / ' + MAX_LEN + '</small><button type="button" class="ssset-btn pri" id="ssSupSend">Yuborish</button></div></div>'
        :
        '<div class="ssset-card"><small>Yordamga yozish uchun avval tizimga kiring — shunda admin javobini shu yerda ko‘ra olasiz.</small></div>' +
        '<button type="button" class="ssset-btn pri" id="ssSupLogin">Google bilan kirish</button>') +
      '</div>';
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.ssset-x').onclick = close;

    if (!li) {
      var lb = $('ssSupLogin');
      if (lb) lb.onclick = function () { close(); try { handleGoogleLogin(); } catch (e) {} };
      return;
    }
    var list = $('ssSupList'), ta = $('ssSupText'), cnt = $('ssSupCnt'), send = $('ssSupSend');
    ta.addEventListener('input', function () { cnt.textContent = ta.value.length + ' / ' + MAX_LEN; });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSend(); }
    });
    send.onclick = doSend;
    async function doSend() {
      if (busy) return;
      var body = ta.value.trim();
      if (body.length < 2) { toast('Xabar juda qisqa', 'warning'); ta.focus(); return; }
      busy = true; send.disabled = true;
      try {
        var sent = await api('send', { body: body });
        ta.value = ''; cnt.textContent = '0 / ' + MAX_LEN;
        var no = sent && sent.message && sent.message.id;              // v83: the message number («Murojaat №…»)
        if (no != null) toast(tr('Murojaatingiz') + ' №' + no + ' ' + tr('adminga yuborildi. Javob shu yerga keladi'), 'success');
        else toast('Xabar yuborildi. Admin tez orada javob beradi', 'success');
        await load(list);
      } catch (e) {
        toast(e.message || 'Yuborib bo‘lmadi', 'error');
      } finally { busy = false; send.disabled = false; }
    }
    load(list);
    pollTimer = setInterval(function () { if (!document.hidden && $('ssSup')) load(list); }, 20000);
    setTimeout(function () { try { ta.focus(); } catch (e) {} }, 60);
  }

  /* ------------------------------------------------------------------ o'qilmagan javoblar belgisi */
  function setUnread(n) {
    lastUnread = n | 0;
    document.body.classList.toggle('ss-sup-unread', lastUnread > 0);
    var b = document.querySelector('#ssSupport .ss-sup-badge');
    if (b) { b.textContent = lastUnread; b.style.display = lastUnread > 0 ? '' : 'none'; }
  }
  async function checkUnread() {
    if (!logged()) { setUnread(0); return 0; }
    try {
      var r = await api('unread');
      var n = +r.unread || 0;
      if (n > lastUnread && n > 0 && !$('ssSup')) toast('Yordam xizmatidan javob keldi: ⚙️ Sozlamalar → 💬 Yordam', 'info');
      setUnread(n);
      return n;
    } catch (e) { return 0; }
  }

  window.ssOpenSupport = openSupport;
  window.ssSupportUnread = function () { return lastUnread; };
  window.ssSupportCheck = checkUnread;

  // sahifa ochilgandan keyin (login tiklangach) va har 3 daqiqada bir tekshiradi
  setTimeout(checkUnread, 5000);
  setInterval(function () { if (!document.hidden) checkUnread(); }, 180000);
})();
