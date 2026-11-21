/* js/46_topup.js — "Balansni to'ldirish" modal (Dodo Payments checkout)
 *
 * Narx: foydalanuvchi NETTO summa N ni tanlaydi (paket yoki o'z miqdori, kamida $1).
 * Dodo komissiyasi (standart 5.5% + $0.40) ustiga qo'shiladi:
 *     gross = ceil((N + 0.40) / 0.945)   (cent aniqligida; $1 -> $1.49)
 * Komissiya qiymatlari serverdan (/api/billing/plans -> fee) olinadi, server xuddi shu formulani qayta hisoblaydi.
 * 1 USD netto = 100 kredit (+ paket bonusi). Kreditlar metadata ga imzo bilan yoziladi.
 * To'lovdan keyin Dodo /?payment=success ga qaytaradi; kreditni webhook (payment.succeeded) qo'shadi.
 */
(function () {
  'use strict';

  var CREDITS_PER_USD = 100;
  var FEE_PERMILLE = 55;          // 5.5%  (serverdan yangilanadi)
  var FEE_FIXED_CENTS = 40;       // $0.40 (serverdan yangilanadi)
  var MIN_CENTS = 100;            // $1.00 netto
  var MAX_CENTS = 100000;         // $1000.00

  var PACKAGES = [
    { id: 'starter',  name: 'Starter',  netCents: 100,  credits: 100,  bonus: 0 },
    { id: 'popular',  name: 'Popular',  netCents: 500,  credits: 550,  bonus: 10, tag: 'Eng ommabop' },
    { id: 'pro',      name: 'Pro',      netCents: 1000, credits: 1200, bonus: 20 },
    { id: 'business', name: 'Business', netCents: 2000, credits: 2600, bonus: 30 }
  ];

  // Hozirgi tanlov: { package: 'popular' | 'custom', netCents, credits } yoki null
  var sel = null;
  var busy = false;
  var lastFocus = null;
  var pollToken = 0;
  var els = {};

  /* ---------------- hisob-kitob ---------------- */
  function grossCents(netCents) {
    // Butun sonlarda: float xatosiz va serverdagi topup_gross_cents() bilan bir xil natija.
    return Math.ceil(((netCents + FEE_FIXED_CENTS) * 1000) / (1000 - FEE_PERMILLE));
  }
  var feeLoaded = false;
  function loadFee() {
    if (feeLoaded) return;
    fetch('/api/billing/plans').then(function (r) { return r.json(); }).then(function (d) {
      var f = d && d.fee;
      if (f && typeof f.permille === 'number' && typeof f.fixed_cents === 'number') {
        FEE_PERMILLE = f.permille; FEE_FIXED_CENTS = f.fixed_cents; feeLoaded = true;
        if (els.modal && !els.modal.hidden) { if (sel && sel.package === 'custom') onCustomInput(); else render(); }
      }
    }).catch(function () {});
  }
  function usd(cents) { return '$' + (cents / 100).toFixed(2); }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }

  function parseAmount(raw) {
    var s = String(raw || '').trim().replace(',', '.').replace(/^\$/, '');
    if (!s) return { empty: true };
    if (!/^\d{0,5}(\.\d{0,2})?$/.test(s) || s === '.') return { error: "Faqat raqam kiriting (masalan, 7.50)" };
    var cents = Math.round(parseFloat(s) * 100);
    if (!(cents >= MIN_CENTS)) return { error: 'Eng kam miqdor — $1.00', cents: cents };
    if (cents > MAX_CENTS) return { error: 'Eng ko\'p miqdor — $' + (MAX_CENTS / 100), cents: cents };
    return { cents: cents };
  }

  /* ---------------- sessiya / balans ---------------- */
  function token() {
    try { if (typeof supabaseToken !== 'undefined' && supabaseToken && supabaseToken !== 'dev-token') return supabaseToken; } catch (_) {}
    return '';
  }
  function userEmail() {
    try { return typeof currentUserEmail !== 'undefined' ? (currentUserEmail || '') : ''; } catch (_) { return ''; }
  }
  function balanceState() {
    try { return (window.Monitoring && window.Monitoring.getState) ? window.Monitoring.getState() : null; } catch (_) { return null; }
  }
  function renderBalance(bump) {
    if (!els.balance) return;
    var st = balanceState();
    els.balance.textContent = st && typeof st.total === 'number' ? num(st.total) : '—';
    if (bump) {
      var pill = els.balance.closest('.tu-balance');
      pill.classList.remove('tu-bump'); void pill.offsetWidth; pill.classList.add('tu-bump');
    }
  }
  async function refreshBalance() {
    try { if (typeof loadUserStats === 'function') await loadUserStats(true); } catch (_) {}
    renderBalance(false);
  }

  /* ---------------- toast ---------------- */
  var toastTimer = 0;
  function toast(msg, isErr) {
    var t = els.toast; if (!t) return;
    clearTimeout(toastTimer);
    t.textContent = msg;
    t.classList.toggle('tu-err', !!isErr);
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('tu-show'); });
    toastTimer = setTimeout(function () {
      t.classList.remove('tu-show');
      setTimeout(function () { t.hidden = true; }, 320);
    }, isErr ? 5000 : 4200);
  }

  /* ---------------- render ---------------- */
  function buildGrid() {
    var html = PACKAGES.map(function (p) {
      return '<button type="button" class="tu-pkg" role="radio" aria-checked="false" data-pkg="' + p.id + '">' +
        (p.tag ? '<span class="tu-pkg-tag">' + p.tag + '</span>' : '') +
        '<span class="tu-pkg-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="11" height="11"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '<div class="tu-pkg-name">' + p.name + '</div>' +
        '<div class="tu-pkg-price">' + usd(p.netCents) + '</div>' +
        '<div class="tu-pkg-credits">' + num(p.credits) + ' kredit</div>' +
        (p.bonus ? '<span class="tu-pkg-bonus">+' + p.bonus + '% bonus</span>' : '') +
        '</button>';
    }).join('');
    els.grid.innerHTML = html;
  }

  function setText(el, txt) {
    if (el.textContent === txt) return;
    el.textContent = txt;
    el.classList.remove('tu-flash'); void el.offsetWidth; el.classList.add('tu-flash');
  }

  function render() {
    els.grid.querySelectorAll('.tu-pkg').forEach(function (b) {
      var on = !!sel && sel.package === b.getAttribute('data-pkg');
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on || (!sel || sel.package === 'custom') && b === els.grid.firstElementChild ? 0 : -1;
    });
    els.custom.classList.toggle('tu-active', !!sel && sel.package === 'custom');

    var net = sel ? sel.netCents : 0;
    var gross = sel ? grossCents(net) : 0;
    setText(els.net, usd(net));
    setText(els.fee, '+' + usd(gross - net));
    setText(els.gross, usd(gross));
    setText(els.credits, num(sel ? sel.credits : 0));
    els.payAmount.textContent = sel ? usd(gross) : '';
    els.pay.disabled = !sel || busy;
  }

  function selectPackage(id) {
    var p = PACKAGES.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    sel = { package: p.id, netCents: p.netCents, credits: p.credits };
    els.input.value = '';
    els.custom.classList.remove('tu-invalid');
    els.customCredits.textContent = '0 kredit';
    els.hint.textContent = 'Eng kam miqdor — $1.00';
    hideError();
    render();
  }

  function onCustomInput() {
    var r = parseAmount(els.input.value);
    hideError();
    if (r.empty) {
      els.custom.classList.remove('tu-invalid');
      els.customCredits.textContent = '0 kredit';
      els.hint.textContent = 'Eng kam miqdor — $1.00';
      if (sel && sel.package === 'custom') sel = null;
      render();
      return;
    }
    var shownCredits = r.cents > 0 ? Math.round(r.cents * CREDITS_PER_USD / 100) : 0;
    els.customCredits.textContent = num(shownCredits) + ' kredit';
    if (r.error) {
      els.custom.classList.add('tu-invalid');
      els.hint.textContent = r.error;
      sel = null;
    } else {
      els.custom.classList.remove('tu-invalid');
      els.hint.textContent = usd(r.cents) + ' = ' + num(shownCredits) + ' kredit · komissiya bilan ' + usd(grossCents(r.cents));
      sel = { package: 'custom', netCents: r.cents, credits: shownCredits };
    }
    render();
  }

  function showError(msg) {
    els.error.textContent = msg; els.error.hidden = false;
    try { els.error.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
  }
  function hideError() { els.error.hidden = true; els.error.textContent = ''; }

  function setBusy(on) {
    busy = on;
    els.pay.classList.toggle('tu-loading', on);
    els.payText.textContent = on ? 'Yuklanmoqda…' : "To'lovga o'tish";
    render();
  }

  /* ---------------- ochish / yopish ---------------- */
  function open() {
    if (!els.modal) return;
    lastFocus = document.activeElement;
    hideError();
    setBusy(false);
    if (!sel) selectPackage('popular');
    else render();
    renderBalance(false);
    refreshBalance();
    loadFee();
    els.modal.hidden = false;
    vvStart();
    requestAnimationFrame(function () { els.modal.classList.add('tu-open'); });
    setTimeout(function () {
      var cur = els.grid.querySelector('[aria-checked="true"]') || els.grid.firstElementChild;
      try { cur.focus({ preventScroll: true }); } catch (_) {}
    }, 60);
    document.addEventListener('keydown', onKey, true);
  }
  /* ---------------- mobil klaviatura: summa inputi ko'rinib tursin ----------------
   * Telefonda klaviatura ochilganda (iOS Safari: faqat visualViewport qisqaradi; Android: butun sahifa) modal
   * KO'RINADIGAN qismga joylashadi (--tu-vv-h / --tu-vv-top), to'lov tugmasi input ustiga yopishmaydi (.tu-kb) va
   * input ekran o'rtasiga silliq suriladi. */
  var vvOn = false, revealTimer = 0, kbOffTimer = 0;
  function revealInput() {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(function () {          // klaviatura animatsiyasi tugagach
      try { els.input.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    }, 300);
  }
  function vvSync() {
    if (!els.modal || els.modal.hidden) return;
    var vv = window.visualViewport;
    if (vv) {
      els.modal.style.setProperty('--tu-vv-h', Math.round(vv.height) + 'px');
      els.modal.style.setProperty('--tu-vv-top', Math.round(vv.offsetTop) + 'px');
    }
    // keyboard = the visible height dropped well below the tallest height seen (iOS: visualViewport shrinks;
    // Android with interactive-widget=resizes-content: the whole window shrinks)
    var visH = vv ? vv.height : window.innerHeight;
    baseH = Math.max(baseH, window.innerHeight, visH);
    var kbOpen = visH < baseH - 120;
    var typing = document.activeElement === els.input;
    if (typing && kbOpen) { clearTimeout(kbOffTimer); els.modal.classList.add('tu-kb'); kbSeen = true; }
    else if (kbSeen && !kbOpen) { kbSeen = false; els.modal.classList.remove('tu-kb'); }   // keyboard closed, input may stay focused
    if (typing) revealInput();
  }
  var baseH = 0, kbSeen = false;
  function vvStart() {
    if (vvOn) return;
    vvOn = true;
    var vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', vvSync); vv.addEventListener('scroll', vvSync); }
    window.addEventListener('resize', vvSync);
    vvSync();
  }
  function vvStop() {
    if (!vvOn) return;
    vvOn = false;
    var vv = window.visualViewport;
    if (vv) { vv.removeEventListener('resize', vvSync); vv.removeEventListener('scroll', vvSync); }
    window.removeEventListener('resize', vvSync);
    els.modal.classList.remove('tu-kb');
    kbSeen = false;
    els.modal.style.removeProperty('--tu-vv-h');
    els.modal.style.removeProperty('--tu-vv-top');
  }
  function onInputFocus() {
    if (els.input.value) onCustomInput();
    vvSync();
    revealInput();
  }
  function onInputBlur() {
    // kechiktirib: «To'lovga o'tish» ga tegilganda tugma joyidan siljib ketmasin (bosish o'tib bo'lgach)
    clearTimeout(kbOffTimer);
    kbOffTimer = setTimeout(function () {
      if (document.activeElement !== els.input) els.modal.classList.remove('tu-kb');
    }, 350);
  }
  function onInputTyping() {
    // raqam yozila boshladi — tayyor paket (masalan «Popular») tanlovi va belgisi darhol yechiladi
    if (els.input.value.trim()) {
      els.grid.querySelectorAll('.tu-pkg[aria-checked="true"]').forEach(function (b) { b.setAttribute('aria-checked', 'false'); });
    }
    onCustomInput();
  }

  function close() {
    if (!els.modal || els.modal.hidden) return;
    vvStop();
    els.modal.classList.remove('tu-open');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(function () { els.modal.hidden = true; }, 220);
    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (_) {}
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {               // fokus modal ichida qoladi
      var f = Array.prototype.filter.call(
        els.card.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'),
        function (n) { return !n.disabled && n.offsetParent !== null && n.tabIndex !== -1; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function onGridKey(e) {
    var keys = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var btns = Array.prototype.slice.call(els.grid.querySelectorAll('.tu-pkg'));
    var i = btns.indexOf(document.activeElement);
    var n = btns[(Math.max(0, i) + keys[e.key] + btns.length) % btns.length];
    selectPackage(n.getAttribute('data-pkg'));
    n.focus();
  }

  /* ---------------- to'lovni kuzatish (sahifa yangilanmaydi) ----------------
   * To'lov oynasi ochilgach bizning modal yopiladi. Fonda balans tekshirib turiladi:
   * kredit tushishi bilan to'lov oynasi (alohida oyna) o'zi yopiladi va pastda xabar chiqadi. */
  var watch = null;

  function startWatch(expected, win) {
    var st = balanceState();
    watch = { id: ++pollToken, expected: expected || 0, win: win || null, fast: false,
              beforePaid: st ? (st.paid_credits | 0) : 0, beforeTotal: st && typeof st.total === 'number' ? st.total : null,
              started: Date.now(), closedAt: 0 };
    setTimeout(function () { tick(watch && watch.id); }, 2500);
  }

  function paymentConfirmed() {
    toast("✅ To'lov qabul qilindi. Kreditlar qo'shilmoqda…");
    if (watch) { watch.fast = true; tick(watch.id); }
    else { startWatch(sel ? sel.credits : 0, null); if (watch) watch.fast = true; }
  }

  async function tick(id) {
    var w = watch;
    if (!w || w.id !== id || w.busy) return;
    if (w.win && w.win.closed && !w.closedAt) w.closedAt = Date.now();
    // oyna yopilgan bo'lsa ham 5 daqiqa kutamiz (webhook kechikishi mumkin); umumiy chegara 25 daqiqa
    var stopAt = w.closedAt ? w.closedAt + 5 * 60000 : w.started + 25 * 60000;
    if (Date.now() > stopAt) { if (watch === w) watch = null; return; }
    w.busy = true;
    try { await refreshBalance(); } finally { w.busy = false; }
    if (watch !== w) return;
    var now = balanceState();
    if (now && (now.paid_credits | 0) > w.beforePaid) { paidDone(w, now); return; }
    setTimeout(function () { tick(id); }, w.fast ? 1500 : 3000);
  }

  function paidDone(w, now) {
    if (watch === w) watch = null;
    pollToken++;
    try { if (w.win && !w.win.closed) w.win.close(); } catch (_) {}
    close();
    renderBalance(true);
    var added = (w.beforeTotal != null && now && typeof now.total === 'number') ? Math.max(0, now.total - w.beforeTotal) : w.expected;
    toast("🎉 To'lov muvaffaqiyatli! " + (added ? '+' + num(added) + ' kredit qo\'shildi.' : 'Balans yangilandi.'));
  }

  // Alohida oynadagi to'lov sahifasi redirect bo'lib bizning saytga qaytsa (/?payment=success) — index.html
  // boshidagi skript shu yerga xabar beradi va o'zini yopadi.
  function onPaySignal(data) {
    if (data && data.type === 'ss-payment-success') paymentConfirmed();
  }
  window.addEventListener('message', function (e) { if (e.origin === location.origin) onPaySignal(e.data); });
  try { var bc = new BroadcastChannel('ss-pay'); bc.onmessage = function (e) { onPaySignal(e.data); }; } catch (_) {}

  /* ---------------- qayerda ochiladi ---------------- */
  function isDesktop() {
    try { return window.matchMedia('(min-width: 900px)').matches && window.matchMedia('(pointer: fine)').matches; }
    catch (_) { return false; }
  }

  // Kompyuterda: Dodo to'lov sahifasi alohida katta oynada (sayt yopilmaydi). Telefonda — shu oynada o'tiladi.
  // MUHIM: tugma bosilgan zahoti (await'dan oldin) ochiladi, aks holda brauzer popup'ni bloklaydi.
  function openPayWindow() {
    var w = Math.min(1120, (screen.availWidth || 1280) - 40);
    var h = Math.min(860, (screen.availHeight || 900) - 60);
    var left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || w) - w) / 2));
    var top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || h) - h) / 2));
    var win = null;
    try { win = window.open('', 'ss-pay', 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top); } catch (_) { win = null; }
    if (!win) return null;
    try {
      win.document.write('<!doctype html><meta charset="utf-8"><title>To‘lov — Slide Studio</title>' +
        '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0f1220;color:#c9cfe0;font:15px system-ui,sans-serif">' +
        'Xavfsiz to‘lov sahifasi ochilmoqda…</body>');
      win.document.close();
    } catch (_) {}
    return win;
  }

  async function checkout() {
    if (busy || !sel) return;
    hideError();
    var tk = token();
    if (!tk) { showError("To'lov uchun avval tizimga kiring."); return; }

    var tgw = null;
    try { tgw = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null; } catch (_) {}
    var mode = tgw && typeof tgw.openLink === 'function' ? 'telegram' : (isDesktop() ? 'window' : 'redirect');
    var win = null;
    if (mode === 'window') { win = openPayWindow(); if (!win) mode = 'redirect'; }   // popup bloklansa — shu oynada

    var gross = grossCents(sel.netCents);
    var expected = sel.credits;
    var body = {
      token: tk,
      email: userEmail(),
      package: sel.package,
      amount: (sel.netCents / 100).toFixed(2),
      gross_amount: (gross / 100).toFixed(2),
      return_url: window.location.origin
    };
    setBusy(true);
    try {
      var r = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var data = {};
      try { data = await r.json(); } catch (_) { data = { error: "Server javobi noto'g'ri (HTTP " + r.status + ')' }; }
      if (!r.ok || !data.checkout_url) {
        console.warn('[topup] create-checkout', r.status, data);
        throw new Error((data.error || data.hint || 'Checkout havolasi olinmadi') + (r.status ? ' [HTTP ' + r.status + ']' : ''));
      }

      if (mode === 'telegram') {
        tgw.openLink(data.checkout_url);
        close();
        toast("To'lovni yakunlang — kreditlar o'zi qo'shiladi.");
        startWatch(expected, null);
      } else if (mode === 'window') {
        win.location.href = data.checkout_url;
        try { win.focus(); } catch (_) {}
        close();
        startWatch(expected, win);
      } else {
        // telefon: shu oynada Dodo sahifasiga o'tiladi — avval slaydlar saqlanadi (qaytganda tiklanadi)
        try { if (window.ssPersistNow) await Promise.race([window.ssPersistNow(), new Promise(function (r) { setTimeout(r, 2500); })]); } catch (_) {}
        // v69: balance BEFORE paying is remembered — after the return the site waits until the credits really arrive
        try {
          var st0 = balanceState();
          window.__ssAuthStorage.setItem('ss-auth-v39-pay', JSON.stringify({      // plain localStorage is locked (index.html v39) at: Date.now(), expected: expected,
            beforePaid: st0 ? (st0.paid_credits | 0) : 0, beforeTotal: st0 && typeof st0.total === 'number' ? st0.total : null }));
        } catch (_) {}
        window.location.href = data.checkout_url;        // keyin /?payment=success
      }
    } catch (err) {
      try { if (win && !win.closed) win.close(); } catch (_) {}
      showError((err && err.message) || "Xatolik yuz berdi. Qaytadan urinib ko'ring.");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- init ---------------- */
  function init() {
    var m = document.getElementById('topUpModal');
    if (!m) return;
    els = {
      modal: m,
      card: m.querySelector('.tu-card'),
      grid: document.getElementById('tuGrid'),
      custom: document.getElementById('tuCustom'),
      input: document.getElementById('tuCustomInput'),
      customCredits: document.getElementById('tuCustomCredits'),
      hint: document.getElementById('tuCustomHint'),
      gross: document.getElementById('tuGross'),
      credits: document.getElementById('tuCredits'),
      error: document.getElementById('tuError'),
      pay: document.getElementById('tuPayBtn'),
      payText: m.querySelector('.tu-cta-text'),
      payAmount: document.getElementById('tuPayAmount'),
      net: document.getElementById('tuNet'),
      fee: document.getElementById('tuFee'),
      balance: document.getElementById('tuBalance'),
      toast: document.getElementById('tuToast')
    };
    buildGrid();
    render();

    m.addEventListener('mousedown', function (e) { if (e.target === m) close(); });
    m.querySelectorAll('[data-tu-close]').forEach(function (b) { b.addEventListener('click', close); });
    els.grid.addEventListener('click', function (e) {
      var b = e.target.closest('.tu-pkg'); if (b) selectPackage(b.getAttribute('data-pkg'));
    });
    els.grid.addEventListener('keydown', onGridKey);
    els.input.addEventListener('input', onInputTyping);
    els.input.addEventListener('focus', onInputFocus);
    els.input.addEventListener('blur', onInputBlur);
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); checkout(); } });
    els.pay.addEventListener('click', checkout);
    document.addEventListener('ss:usage', function () { if (!m.hidden) renderBalance(false); });
    handleReturn();
    loadFee();
  }

  // Shu oynada to'lovdan qaytilganda (/?payment=success&payment_id=...&status=...): xabar + balansni kuzatish.
  // Alohida oyna (popup) bo'lsa — index.html boshidagi skript asosiy oynaga xabar berib, o'zini yopadi.
  function handleReturn() {
    var q;
    try { q = new URLSearchParams(window.location.search); } catch (_) { return; }
    if (q.get('payment') !== 'success') return;
    try { if (window.opener && window.opener !== window) return; } catch (_) {}
    var status = String(q.get('status') || 'succeeded').toLowerCase();
    try {
      ['payment', 'payment_id', 'status', 'subscription_id', 'email'].forEach(function (k) { q.delete(k); });
      var rest = q.toString();
      history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
    } catch (_) {}
    if (status !== 'succeeded' && status !== 'active' && status !== 'processing') {
      toast("To'lov yakunlanmadi. Qaytadan urinib ko'ring.", true);
      return;
    }
    // v69: phone (same tab) — before, the balance was checked only for 40 s; if the bank / webhook was slower the user
    // saw nothing. Now the same watcher as on a computer runs (up to 5 min) and says «+N credits added» when they arrive.
    var saved = null;
    try { saved = JSON.parse(window.__ssAuthStorage.getItem('ss-auth-v39-pay') || 'null'); window.__ssAuthStorage.removeItem('ss-auth-v39-pay'); } catch (_) {}
    if (saved && Date.now() - (saved.at || 0) < 2 * 3600 * 1000) {
      toast("✅ To'lov qabul qilindi. Kreditlar qo'shilmoqda…");
      watch = { id: ++pollToken, expected: saved.expected || 0, win: null, fast: true,
                beforePaid: saved.beforePaid | 0, beforeTotal: typeof saved.beforeTotal === 'number' ? saved.beforeTotal : null,
                started: Date.now(), closedAt: Date.now() };
      setTimeout(function () { tick(watch && watch.id); }, 1500);
      return;
    }
    toast("✅ To'lov qabul qilindi. Kreditlar bir necha soniyada qo'shiladi.");
    [1500, 5000, 10000, 20000, 40000, 80000, 150000].forEach(function (ms) {
      setTimeout(function () { refreshBalance(); }, ms);
    });
  }

  window.openTopUpModal = open;
  window.closeTopUpModal = close;
  window.TopUp = { open: open, close: close, grossCents: grossCents, packages: PACKAGES };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
