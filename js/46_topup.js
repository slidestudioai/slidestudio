/* js/46_topup.js — "Balansni to'ldirish" modal (Lemon Squeezy overlay checkout)
 *
 * Narx: foydalanuvchi NETTO summa N ni tanlaydi (paket yoki o'z miqdori).
 * Lemon Squeezy komissiyasi (6.5% + $0.50) ustiga qo'shiladi:
 *     gross = ceil((N + 0.50) / 0.935)   (cent aniqligida)
 * Server (/api/payment/create-checkout) xuddi shu formulani qayta hisoblaydi, kreditlarni o'zi belgilaydi
 * va custom_data ga net_amount + credits ni imzo bilan yozadi. Webhook kreditni N bo'yicha beradi.
 */
(function () {
  'use strict';

  var CREDITS_PER_USD = 100;
  var FEE_PERMILLE = 65;          // 6.5%
  var FEE_FIXED_CENTS = 50;       // $0.50
  var MIN_CENTS = 100;            // $1.00
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
  var lemonReady = false;
  var pollToken = 0;
  var els = {};

  /* ---------------- hisob-kitob ---------------- */
  function grossCents(netCents) {
    // Butun sonlarda: float xatosiz va serverdagi topup_gross_cents() bilan bir xil natija.
    return Math.ceil(((netCents + FEE_FIXED_CENTS) * 1000) / (1000 - FEE_PERMILLE));
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
    try { if (typeof loadUserStats === 'function') await loadUserStats(); } catch (_) {}
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

  /* ---------------- holatlar: forma / kutish / muvaffaqiyat ---------------- */
  var ICON_WAIT = '<div class="tu-ring"></div>';
  var ICON_OK = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#34d399" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function showForm() {
    els.formView.hidden = false;
    els.stateView.hidden = true;
    els.stateView.classList.remove('tu-success');
  }
  function showState(kind, title, text, btnLabel) {
    els.formView.hidden = true;
    els.stateView.hidden = false;
    els.stateView.classList.toggle('tu-success', kind === 'success');
    els.stateIcon.innerHTML = kind === 'success' ? ICON_OK : ICON_WAIT;
    els.stateTitle.textContent = title;
    els.stateText.textContent = text;
    els.stateBtn.textContent = btnLabel || 'Yopish';
    els.stateBtn.setAttribute('data-action', kind === 'waiting' ? 'back' : 'close');
  }

  /* ---------------- ochish / yopish ---------------- */
  function open() {
    if (!els.modal) return;
    lastFocus = document.activeElement;
    showForm();
    hideError();
    setBusy(false);
    if (!sel) selectPackage('popular');
    else render();
    renderBalance(false);
    refreshBalance();
    ensureLemon();
    els.modal.hidden = false;
    requestAnimationFrame(function () { els.modal.classList.add('tu-open'); });
    setTimeout(function () {
      var cur = els.grid.querySelector('[aria-checked="true"]') || els.grid.firstElementChild;
      try { cur.focus({ preventScroll: true }); } catch (_) {}
    }, 60);
    document.addEventListener('keydown', onKey, true);
  }
  function close() {
    if (!els.modal || els.modal.hidden) return;
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

  /* ---------------- Lemon Squeezy ---------------- */
  function ensureLemon() {
    try {
      if (!window.LemonSqueezy && typeof window.createLemonSqueezy === 'function') window.createLemonSqueezy();
      if (window.LemonSqueezy && !lemonReady && typeof window.LemonSqueezy.Setup === 'function') {
        window.LemonSqueezy.Setup({ eventHandler: onLemonEvent });
        lemonReady = true;
      }
    } catch (e) { console.warn('[topup] lemon.js', e); }
    return !!(window.LemonSqueezy && window.LemonSqueezy.Url && typeof window.LemonSqueezy.Url.Open === 'function');
  }

  function onLemonEvent(ev) {
    var name = ev && (ev.event || ev.type);
    if (name === 'Checkout.Success') onPaid(ev.data);
  }

  function onPaid() {
    var credits = sel ? sel.credits : 0;
    if (els.modal.hidden) {
      els.modal.hidden = false;
      requestAnimationFrame(function () { els.modal.classList.add('tu-open'); });
      document.addEventListener('keydown', onKey, true);
    }
    showState('success', "To'lov muvaffaqiyatli!", 'Kreditlar qo\'shilmoqda… Bu bir necha soniya olishi mumkin.', 'Davom etish');
    toast("✅ To'lov muvaffaqiyatli! Kreditlar qo'shilmoqda...");
    // Lemon o'z "rahmat" oynasini ko'rsatadi — biroz kutib yopamiz, bizning holat ko'rinadi
    setTimeout(function () { try { window.LemonSqueezy.Url.Close(); } catch (_) {} }, 2600);
    waitForCredits(credits);
  }

  async function waitForCredits(expected) {
    var my = ++pollToken;
    var st = balanceState();
    var before = st ? (st.paid_credits | 0) : 0;
    for (var i = 0; i < 12; i++) {
      await new Promise(function (r) { setTimeout(r, i === 0 ? 1200 : 2500); });
      if (my !== pollToken) return;
      await refreshBalance();
      var now = balanceState();
      if (now && (now.paid_credits | 0) > before) {
        renderBalance(true);
        var added = expected ? num(expected) : '';
        els.stateText.textContent = (added ? '+' + added + ' kredit balansingizga qo\'shildi. ' : 'Balansingiz yangilandi. ') + 'Rahmat!';
        toast('🎉 ' + (added ? '+' + added + ' kredit qo\'shildi!' : 'Balans yangilandi!'));
        return;
      }
    }
    if (my === pollToken) {
      els.stateText.textContent = "To'lov qabul qilindi. Kreditlar bir necha daqiqada ko'rinadi — sahifani yangilab ko'ring.";
    }
  }

  async function checkout() {
    if (busy || !sel) return;
    hideError();
    var tk = token();
    if (!tk) { showError("To'lov uchun avval tizimga kiring."); return; }

    var gross = grossCents(sel.netCents);
    var body = {
      token: tk,
      email: userEmail(),
      package: sel.package,
      net_amount: (sel.netCents / 100).toFixed(2),
      gross_amount: (gross / 100).toFixed(2),
      return_url: window.location.origin,
      embed: true
    };
    setBusy(true);
    try {
      var r = await fetch('/api/payment/create-checkout', {
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

      var tgw = null;
      try { tgw = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null; } catch (_) {}
      if (tgw && typeof tgw.openLink === 'function') {
        tgw.openLink(data.checkout_url);
        showState('waiting', "To'lov oynasi ochildi", "To'lovni yakunlang — kreditlar avtomatik qo'shiladi.", 'Ortga');
        waitForCredits(sel.credits);
      } else if (ensureLemon()) {
        showState('waiting', "To'lov oynasi ochildi", "Xavfsiz oynada to'lovni yakunlang. Bu sahifadan chiqmaysiz.", 'Ortga');
        window.LemonSqueezy.Url.Open(data.checkout_url);
      } else {
        window.location.href = data.checkout_url;      // lemon.js yuklanmagan bo'lsa — oddiy o'tish
      }
    } catch (err) {
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
      net: document.getElementById('tuNet'),
      fee: document.getElementById('tuFee'),
      gross: document.getElementById('tuGross'),
      credits: document.getElementById('tuCredits'),
      error: document.getElementById('tuError'),
      pay: document.getElementById('tuPayBtn'),
      payText: m.querySelector('.tu-cta-text'),
      payAmount: document.getElementById('tuPayAmount'),
      balance: document.getElementById('tuBalance'),
      formView: document.getElementById('tuFormView'),
      stateView: document.getElementById('tuStateView'),
      stateIcon: document.getElementById('tuStateIcon'),
      stateTitle: document.getElementById('tuStateTitle'),
      stateText: document.getElementById('tuStateText'),
      stateBtn: document.getElementById('tuStateBtn'),
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
    els.input.addEventListener('input', onCustomInput);
    els.input.addEventListener('focus', function () { if (els.input.value) onCustomInput(); });
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); checkout(); } });
    els.pay.addEventListener('click', checkout);
    els.stateBtn.addEventListener('click', function () {
      if (els.stateBtn.getAttribute('data-action') === 'back') { pollToken++; showForm(); }
      else close();
    });
    document.addEventListener('ss:usage', function () { if (!m.hidden) renderBalance(false); });
    ensureLemon();
  }

  window.openTopUpModal = open;
  window.closeTopUpModal = close;
  window.TopUp = { open: open, close: close, grossCents: grossCents, packages: PACKAGES };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
