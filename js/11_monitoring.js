(function () {
  'use strict';

  // v38: YAGONA KREDIT HISOBI. Server balansni BIRLIKda yuritadi (1 Tez-varaq = 20, 1 Chuqur-varaq = 60 birlik).
  // Brauzer faqat ko'rsatadi — hisob-kitob va limitlar faqat serverda (backend/monitoring.py).
  let FREE_UNITS = 200;       // kunlik bepul (birlik) = 10 varaq; serverdan kelgach yangilanadi
  let PACK_UNITS = 2000;      // paket (birlik) = 100 varaq
  let PACK_PRICE = 1.58;      // 100 varaq = $1.58
  let MODES = {
    fast: { page_units: 20, chat_units: 5, search_units: 4, chat_per_page: 4, search_per_page: 5 },
    deep: { page_units: 60, chat_units: 15, search_units: 15, chat_per_page: 4, search_per_page: 4 }
  };
  const PAGES_PER_PACK_FAST = function () { return Math.round(PACK_UNITS / MODES.fast.page_units); };

  let _state = {
    free_credits: FREE_UNITS,
    paid_credits: 0,
    next_reset_in_seconds: 0,
    window_started: false,
    is_pro: false,
    plan: 'free',          // free | vip
    plan_until: null,
    unlimited: false,      // v47: VIP / admin / "cheksiz"
    ad_free: false,
    total_tokens: 0,
    spent_units: 0
  };

  fetch('/api/config/public').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
    if (!c) return;
    if (c.pack_price_usd > 0) PACK_PRICE = Number(c.pack_price_usd);
    if (c.modes) { Object.keys(c.modes).forEach(function (k) { MODES[k] = Object.assign({}, MODES[k], c.modes[k]); }); }
    if (c.unit && c.free_daily) FREE_UNITS = c.free_daily * c.unit;
    if (c.unit && c.pack_pages) PACK_UNITS = c.pack_pages * c.unit;
    try { renderUI(); } catch (_) {}
  }).catch(function () {});

  function esc(x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function curMode() {
    try { const el = document.getElementById('aiModelSelect'); return el && el.value === 'deep' ? 'deep' : 'fast'; } catch (_) { return 'fast'; }
  }
  function pu(mode) { return (MODES[mode || curMode()] || MODES.fast).page_units; }
  function toPages(units, mode) { return units / pu(mode); }
  function fmt(n) { n = Math.round(n * 100) / 100; return String(n % 1 === 0 ? n : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')); }

  function totalUnits() { return Math.max(0, (_state.free_credits | 0) + (_state.paid_credits | 0)); }
  function totalCredits() { return Math.floor(totalUnits() / MODES.fast.page_units); }   // moslik: Tez-varaq (butun)

  function formatReset(sec) {
    sec = Math.max(0, sec | 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + ' soat ' + m + ' daq';
    return m + ' daqiqa';
  }

  function ensureBar() {
    let bar = document.getElementById('tokenStatusBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'tokenStatusBar'; document.body.appendChild(bar); }
    if (!document.getElementById('creditBadge')) {
      bar.innerHTML = '<span id="creditBadge" class="credit-badge free">FREE</span> <span id="creditDetail" class="credit-detail-text">—</span> ' +
        '<button type="button" id="btnBuyCredits" class="btn-buy-credits">Sotib olish</button>';
      const btn = document.getElementById('btnBuyCredits');
      if (btn) btn.onclick = function () { startCheckout(); };
    }
  }

  function isLoggedIn() {
    try { return typeof supabaseToken !== 'undefined' && !!supabaseToken && supabaseToken !== 'dev-token'; } catch (_) { return false; }
  }

  // raqamli + animatsiyali bar (joriy rejim varaqlarida)
  function meterHTML(name, leftU, totalU, cls, foot) {
    const m = curMode();
    const left = toPages(leftU, m), total = Math.max(0.01, toPages(totalU, m));
    const pct = Math.max(0, Math.min(100, Math.round(leftU / Math.max(1, totalU) * 100)));
    const state = leftU <= 0 ? ' empty' : (pct <= 20 ? ' low' : '');
    return '<div class="ss-meter ' + (cls || '') + state + '"><div class="ss-meter-row"><span class="ss-meter-name">' + esc(name) +
      '</span><b>' + fmt(left) + '/' + fmt(total) + '</b></div><div class="ss-meter-track"><div class="ss-meter-fill" data-pct="' + pct + '" style="width:0"></div></div>' +
      (foot ? '<div class="ss-meter-foot">' + foot + '</div>' : '') + '</div>';
  }
  function animateMeters(root) {
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      (root || document).querySelectorAll('.ss-meter-fill[data-pct]').forEach(function (f) { f.style.width = f.getAttribute('data-pct') + '%'; });
    }); });
  }
  function crossLine() {
    const t = totalUnits();
    return '<div class="ss-meter-foot ss-cross"><span>Tez AI: <b>' + fmt(toPages(t, 'fast')) + '</b> varaq</span><span>Chuqur AI: <b>' + fmt(toPages(t, 'deep')) + '</b> varaq</span></div>';
  }
  function metersHTML() {
    if (_state.unlimited) {
      return '<div class="ss-meter-wrap"><div class="ss-meter"><div class="ss-meter-row"><span class="ss-meter-name">' + (_state.plan === 'vip' ? 'VIP' : 'Cheksiz') +
        '</span><b>∞</b></div><div class="ss-meter-track"><div class="ss-meter-fill" data-pct="100" style="width:0"></div></div><div class="ss-meter-foot"><span>Varaq cheklovsiz · reklamasiz</span></div></div></div>';
    }
    const paid = _state.paid_credits | 0;
    const m = MODES[curMode()];
    const resetTxt = _state.window_started ? 'yangilanishiga: ' + formatReset(_state.next_reset_in_seconds) : "24 soat birinchi AI so'rovdan boshlanadi";
    let h = '<div class="ss-meter-wrap">' + meterHTML('Bepul (bugun)', _state.free_credits, FREE_UNITS, 'free',
      '<span>' + resetTxt + '</span><span>bugun sarflandi: ' + fmt(toPages(_state.spent_units | 0, curMode())) + '</span>');
    if (paid > 0) h += meterHTML('Pullik paket', paid, Math.max(PACK_UNITS, paid), 'paid', "<span>muddatsiz, reset bo'lmaydi</span>");
    h += crossLine();
    h += '<div class="ss-meter-foot"><span>' + m.chat_per_page + ' ta savol = 1 varaq</span><span>' + m.search_per_page + ' ta qidiruv = 1 varaq</span></div>';
    return h + '</div>';
  }
  window.ssMetersHTML = metersHTML;
  window.ssAnimateMeters = animateMeters;

  // ixcham limit tugmasi (sarlavhada): "12/15" + mini bar; bosilsa — to'liq ma'lumot
  function ensurePill() {
    let b = document.getElementById('ssQuota');
    if (b) return b;
    const host = document.querySelector('.header-actions');
    if (!host) return null;
    b = document.createElement('button');
    b.type = 'button'; b.id = 'ssQuota'; b.title = 'AI varaqlar';
    b.innerHTML = '<span class="material-symbols-outlined">bolt</span><b class="q-n">–</b><i class="q-bar"><u></u></i>';
    host.insertBefore(b, host.firstChild);
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      let pop = document.getElementById('ssQuotaPop');
      if (pop) { pop.remove(); return; }
      pop = document.createElement('div'); pop.id = 'ssQuotaPop';
      pop.style.cssText = 'position:fixed;z-index:2147483000';   // v42: CSS keshda eski qolsa ham doim eng ustda
      const r = b.getBoundingClientRect();
      pop.style.top = (r.bottom + 8) + 'px';
      pop.innerHTML = metersHTML() + '<button type="button" class="ss-set-btn" id="ssQuotaBuy" style="margin-top:10px;width:100%">' + buyLabel() + '</button>' +
        (window.ssTgLink && isLoggedIn() ? '<button type="button" class="ss-set-btn" id="ssQuotaTg" style="margin-top:8px;width:100%">✈️ Telegram botni ulash</button>' : '');
      document.body.appendChild(pop);
      // v45: oyna HECH QACHON ekrandan chiqmaydi (telefonda chap chetga ketib qolardi): chap/o'ng chegaraga qisiladi
      const pw = pop.offsetWidth || 280, vw = document.documentElement.clientWidth || window.innerWidth;
      pop.style.right = 'auto';
      pop.style.left = Math.max(8, Math.min(r.right - pw, vw - pw - 8)) + 'px';
      animateMeters(pop);
      pop.addEventListener('click', function (ev) { ev.stopPropagation(); });
      pop.querySelector('#ssQuotaBuy').onclick = function () { pop.remove(); startCheckout(); };
      const tgb = pop.querySelector('#ssQuotaTg');
      if (tgb) tgb.onclick = function () { pop.remove(); try { window.ssTgLink(); } catch (_) {} };
    });
    document.addEventListener('click', function () { const p = document.getElementById('ssQuotaPop'); if (p) p.remove(); });
    return b;
  }
  function buyLabel() {
    return 'Sotib olish ($' + PACK_PRICE.toFixed(2) + ' · ' + PACKTXT() + ')';
  }
  function PACKTXT() { return fmt(PACK_UNITS / MODES.fast.page_units) + ' Tez / ' + fmt(PACK_UNITS / MODES.deep.page_units) + ' Chuqur varaq'; }
  let _lastPillUnits = null;
  function renderPill() {
    const b = ensurePill(); if (!b) return;
    if (_state.unlimited) {
      b.querySelector('.q-n').textContent = '∞';
      b.querySelector('.q-bar u').style.width = '100%';
      b.classList.remove('low', 'empty'); b.classList.add('paid');
      return;
    }
    const paid = _state.paid_credits | 0, free = _state.free_credits | 0;
    const capU = Math.max(1, FREE_UNITS + (paid > 0 ? Math.max(PACK_UNITS, paid) : 0));
    const leftU = free + paid, m = curMode();
    b.querySelector('.q-n').textContent = fmt(toPages(leftU, m)) + '/' + fmt(toPages(capU, m));
    b.querySelector('.q-bar u').style.width = Math.min(100, Math.round(leftU / capU * 100)) + '%';
    b.classList.toggle('low', leftU > 0 && leftU / capU <= 0.2);
    b.classList.toggle('empty', leftU < MODES[m].chat_units);
    b.classList.toggle('paid', paid > 0);
    if (_lastPillUnits != null && leftU < _lastPillUnits) { b.classList.remove('ss-dec'); void b.offsetWidth; b.classList.add('ss-dec'); }   // kamayish effekti
    _lastPillUnits = leftU;
  }

  function renderUI() {
    ensureBar();
    const total = totalUnits(), m = curMode();
    const badge = document.getElementById('creditBadge');
    const tokens = document.getElementById('statTokens');
    const bar = document.getElementById('tokenStatusBar');
    if (bar) bar.style.display = isLoggedIn() ? 'flex' : 'none';
    if (badge) {
      badge.textContent = _state.plan === 'vip' ? 'VIP' : (_state.unlimited ? '∞' : 'FREE');
      badge.className = 'credit-badge free';
    }
    if (tokens && typeof _state.total_tokens === 'number') tokens.textContent = Number(_state.total_tokens).toLocaleString();
    if (bar) {
      bar.classList.toggle('credits-low', !_state.unlimited && total <= FREE_UNITS * 0.2);
      bar.classList.toggle('credits-empty', !_state.unlimited && total < MODES[m].chat_units);
    }
    try {
      const strip = document.getElementById('aiBalanceStrip');
      if (strip) { strip.style.display = isLoggedIn() ? 'flex' : 'none'; strip.classList.add('ss-has-meter'); strip.innerHTML = metersHTML(); animateMeters(strip); }
    } catch (_) {}
    const sc = document.getElementById('statCredits');
    if (sc) sc.textContent = fmt(toPages(total, m));
    const su = document.getElementById('statPagesUsed');
    if (su) su.textContent = fmt(toPages(_state.spent_units | 0, m));
    try { renderPill(); } catch (_) {}
    try { const h = document.querySelector('#ssQuotaPop'); if (h) { /* ochiq bo'lsa yangilanadi */ h.firstChild && (h.querySelector('.ss-meter-wrap').outerHTML = metersHTML()); animateMeters(h); } } catch (_) {}
  }

  function applyServerUsage(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof data.free_daily_units === 'number' && data.free_daily_units > 0) FREE_UNITS = data.free_daily_units;
    if (typeof data.pack_units === 'number' && data.pack_units > 0) PACK_UNITS = data.pack_units;
    if (typeof data.pack_price_usd === 'number' && data.pack_price_usd > 0) PACK_PRICE = data.pack_price_usd;
    if (data.modes && typeof data.modes === 'object') Object.keys(data.modes).forEach(function (k) { MODES[k] = Object.assign({}, MODES[k], data.modes[k]); });
    if (typeof data.free_credits === 'number') _state.free_credits = data.free_credits;
    if (typeof data.paid_credits === 'number') _state.paid_credits = data.paid_credits;
    if (typeof data.next_reset_in_seconds === 'number') _state.next_reset_in_seconds = data.next_reset_in_seconds;
    if (typeof data.window_started === 'boolean') _state.window_started = data.window_started;
    else _state.window_started = (_state.next_reset_in_seconds | 0) > 0;
    _state.is_pro = false;
    _state.plan = data.plan || 'free';
    _state.plan_until = data.plan_until || null;
    _state.unlimited = !!data.unlimited;
    _state.ad_free = typeof data.ad_free === 'boolean' ? data.ad_free : (_state.unlimited || _state.is_pro);
    try { document.dispatchEvent(new CustomEvent('ss:usage', { detail: getState() })); } catch (_) {}
    if (typeof data.total_tokens === 'number') _state.total_tokens = data.total_tokens;
    if (typeof data.user_total_tokens === 'number') _state.total_tokens = data.user_total_tokens;
    if (typeof data.spent_24h === 'number') _state.spent_units = data.spent_24h;
    if (typeof data.units_charged === 'number' && data.units_charged > 0) {
      if (typeof data.spent_24h !== 'number') _state.spent_units = (_state.spent_units | 0) + data.units_charged;
      try {
        const bm = data.billing_mode === 'deep' ? 'deep' : 'fast';
        showToast('−' + fmt(data.units_charged / pu(bm)) + ' varaq', 'info');
      } catch (_) {}
    }
    if (typeof userStats !== 'undefined') {
      userStats.slide_credits = totalCredits();
      userStats.total_tokens = _state.total_tokens;
    }
    renderUI();
  }

  // Rejim almashganda: balans darhol qayta ko'rsatiladi (server birliklari / yangi varaq birligi)
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'aiModelSelect') {
      renderUI();
      try { showToast('Balans: ' + fmt(toPages(totalUnits(), curMode())) + ' ' + (curMode() === 'deep' ? 'Chuqur' : 'Tez') + '-varaq', 'info'); } catch (_) {}
    }
  });
  document.addEventListener('DOMContentLoaded', function () { try { renderPill(); } catch (_) {} });
  setTimeout(function () { try { renderPill(); } catch (_) {} }, 0);

  function guardSend() {
    if (!isLoggedIn()) return true;
    if (_state.unlimited) return true;       // v47: VIP / admin / cheksiz — hech qachon to'silmaydi
    if (totalUnits() >= MODES[curMode()].chat_units) return true;
    if ((_state.next_reset_in_seconds | 0) <= 0) return true;
    showLimitModal();
    return false;
  }

  function showLimitModal() {
    if (document.getElementById('limitModalOpen')) return;
    try {
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          title: 'Limit tugadi',
          html:
            '24 soatlik bepul limit tugadi.<br>Keyingi reset: <b>' +
            formatReset(_state.next_reset_in_seconds) +
            '</b><br>yoki <b>$' +
            PACK_PRICE.toFixed(2) +
            '</b> ga ' + PACKTXT() + ' sotib oling.',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Sotib olish ($' + PACK_PRICE.toFixed(2) + ')',
          cancelButtonText: 'Yopish',
          didOpen: function () {
            var el = document.querySelector('.swal2-container');
            if (el) el.id = 'limitModalOpen';
          }
        }).then(function (r) {
          if (r.isConfirmed) startCheckout();
        });
      } else {
        if (confirm('Limit tugadi. Sotib olasizmi?')) startCheckout();
      }
    } catch (_) {}
  }

  let _checkoutBusy = false;
  function tgWebApp() { try { const w = window.Telegram && window.Telegram.WebApp; return w && w.initData ? w : null; } catch (_) { return null; } }
  async function startCheckout(product) {
    product = 'pack';
    if (_checkoutBusy) return;
    if (!isLoggedIn()) {
      try { showToast("To'lov uchun avval tizimga kiring.", 'error'); } catch (_) {}
      return;
    }
    _checkoutBusy = true;

    let win = null;
    const tgw = tgWebApp();
    if (!tgw) { try { win = window.open('about:blank', '_blank'); } catch (_) { win = null; } }   // Telegram ichida popup ochilmaydi — openLink ishlatiladi
    try {
      const email = typeof currentUserEmail !== 'undefined' ? currentUserEmail : '';
      try { showToast("To'lov oynasi ochilmoqda…"); } catch (_) {}
      const res = await fetch('/api/payment/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: supabaseToken, email: email, return_url: window.location.origin, product: product })
      });
      let data = {};
      try { data = await res.json(); } catch (_) { data = { error: 'Server javobi noto\'g\'ri (HTTP ' + res.status + ')' }; }
      if (data.checkout_url) {
        if (tgw && typeof tgw.openLink === 'function') tgw.openLink(data.checkout_url);
        else if (win && !win.closed) win.location.href = data.checkout_url;
        else window.location.href = data.checkout_url;
      } else {
        if (win && !win.closed) win.close();
        try { showToast(data.error || data.hint || 'Checkout xato (HTTP ' + res.status + ')', 'error'); } catch (_) {}
        console.warn('create-checkout:', res.status, data);
      }
    } catch (e) {
      if (win && !win.closed) win.close();
      try { showToast("To'lov serveriga ulanib bo'lmadi", 'error'); } catch (_) {}
    } finally {
      _checkoutBusy = false;
    }
  }

  async function handlePaymentReturn() {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch (_) { return; }
    if (params.get('payment') !== 'success') return;
    try {
      params.delete('payment');
      const q = params.toString();
      history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
    } catch (_) {}
    const before = _state.paid_credits | 0;
    try { showToast("To'lov qabul qilindi. Hisob yangilanmoqda…"); } catch (_) {}
    for (let i = 0; i < 10; i++) {
      await new Promise(function (r) { setTimeout(r, i === 0 ? 1500 : 3000); });
      try {
        if (typeof loadUserStats === 'function') await loadUserStats();
      } catch (_) {}
      if ((_state.paid_credits | 0) > before) {
        try { showToast('✅ +' + ((_state.paid_credits | 0) - before) + ' varaq qo\'shildi!'); } catch (_) {}
        return;
      }
    }
    try { showToast("Varaqlar hali ko'rinmadi. Sahifani yangilab ko'ring yoki biroz kuting.", 'error'); } catch (_) {}
  }

  function getState() {
    return Object.assign({}, _state, { total: totalCredits() });
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        ensureBar();
        renderUI();
      });
    } else {
      ensureBar();
      renderUI();
    }
  } catch (e) {}

  setInterval(function () {
    if (_state.next_reset_in_seconds > 0) {
      _state.next_reset_in_seconds = Math.max(0, (_state.next_reset_in_seconds | 0) - 60);
      renderUI();
    }
  }, 60000);

  window.Monitoring = {
    applyServerUsage: applyServerUsage,
    renderUI: renderUI,
    startCheckout: startCheckout,
    showLimitModal: showLimitModal,
    guardSend: guardSend,
    handlePaymentReturn: handlePaymentReturn,
    getState: getState,
    totalCredits: totalCredits,
    totalUnits: totalUnits,
    FREE_UNITS: FREE_UNITS,
    PACK_UNITS: PACK_UNITS,
    PACK_PRICE: PACK_PRICE
  };
  window.applyServerUsage = applyServerUsage;
  window.startCreditsCheckout = startCheckout;
  window.addEventListener('load', function () { setTimeout(handlePaymentReturn, 800); });
})();
