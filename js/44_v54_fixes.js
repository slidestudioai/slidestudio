/* v54 — editor tuzatishlari
 *  1. Fon rangi / rasm / element o'zgarganda kanvas DARHOL yangilanmasdi (boshqa elementni bosgandagina ko'rinardi).
 *     Sabab: Fabric 5 da toDataURL() → toCanvasElement() → renderCanvas() kutilayotgan requestRenderAll() ni
 *     cancelRequestedRender() bilan BEKOR qiladi va faqat eksport kanvasiga chizadi. Biz o'zgarishdan keyin darhol
 *     thumbnail (toDataURL) olamiz — shuning uchun ekrandagi kanvas eski holatda qolardi.
 *     Endi eksportdan keyin kutilgan render qayta so'raladi.
 *  2. Chap panel kengligi o'zgarsa (Sozlamalar ochilganda 225 → 320px) yoki AI panel ochilsa/yopilsa
 *     slayd o'z joyiga qayta sig'diriladi (avval o'ng panel ostiga kirib, kesilib qolardi).
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ 1. Bekor qilingan renderni qaytarish
  try {
    var P = fabric.StaticCanvas.prototype;
    if (!P.toCanvasElement.__ssV54) {
      var origTCE = P.toCanvasElement;
      P.toCanvasElement = function () {
        var pending = !!this.isRendering;
        var out = origTCE.apply(this, arguments);
        if (pending && this.lowerCanvasEl && this.contextContainer) {
          try { this.requestRenderAll(); } catch (e) {}
        }
        return out;
      };
      P.toCanvasElement.__ssV54 = true;
    }
  } catch (e) { console.warn('[v54] render fix:', e); }

  // ------------------------------------------------------------------ 2. Joy o'zgarsa slaydni qayta sig'dirish
  function refit() {
    try {
      if (typeof window.scheduleFitCanvas === 'function') window.scheduleFitCanvas();
    } catch (e) {}
  }
  function watch() {
    var w = document.getElementById('canvasWrapper');
    if (!w) return false;
    if (window.ResizeObserver) {
      var last = '';
      var ro = new ResizeObserver(function (entries) {
        var r = entries[0] && entries[0].contentRect;
        if (!r) return;
        var key = Math.round(r.width) + 'x' + Math.round(r.height);
        if (key === last) return;
        last = key;
        refit();
      });
      ro.observe(w);
    }
    // panel CSS transition (0.3s) tugaganda ham bir marta
    ['sidebar', 'aiSidebar'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('transitionend', function (e) { if (e.target === el) refit(); });
    });
    return true;
  }
  if (!watch()) document.addEventListener('DOMContentLoaded', watch, { once: true });
})();

/* v54 — Telegram Mini App
 *  1. To'liq ekran rejimida (Telegram 8+) yuqori tugmalar telefon «chelka»si / Telegram tugmalari ostida qolardi:
 *     safeAreaInset + contentSafeAreaInset CSS o'zgaruvchilariga yoziladi va sahifa yuqorisiga qo'shiladi.
 *  2. Telegram «Orqaga» tugmasi: ochiq panel (AI, sozlamalar, chap menyu) bo'lsa — uni yopadi.
 */
(function () {
  'use strict';
  var tg = window.Telegram && window.Telegram.WebApp;
  if (!tg || !tg.initData) return;

  function applyInsets() {
    try {
      var a = tg.safeAreaInset || {}, c = tg.contentSafeAreaInset || {};
      var top = (Number(a.top) || 0) + (Number(c.top) || 0);
      var bottom = (Number(a.bottom) || 0) + (Number(c.bottom) || 0);
      var root = document.documentElement.style;
      root.setProperty('--tg-inset-top', top + 'px');
      root.setProperty('--tg-inset-bottom', bottom + 'px');
      document.body.classList.toggle('tg-inset', top > 0 || bottom > 0);
    } catch (e) {}
    try { if (typeof window.scheduleFitCanvas === 'function') window.scheduleFitCanvas(); } catch (e) {}
  }
  try {
    if (tg.onEvent) {
      tg.onEvent('safeAreaChanged', applyInsets);
      tg.onEvent('contentSafeAreaChanged', applyInsets);
      tg.onEvent('fullscreenChanged', applyInsets);
    }
  } catch (e) {}
  if (document.body) applyInsets(); else document.addEventListener('DOMContentLoaded', applyInsets, { once: true });

  // ---- Orqaga tugmasi
  function openPanel() {
    var ai = document.getElementById('aiSidebar');
    if (document.getElementById('ssSet')) return 'settings';
    if (ai && ai.classList.contains('open')) return 'ai';
    var sb = document.getElementById('sidebar');
    if (sb && sb.classList.contains('open')) return 'sidebar';
    return null;
  }
  function closePanel() {
    var p = openPanel();
    try {
      if (p === 'settings') { var o = document.getElementById('ssSet'); if (o) o.remove(); }
      else if (p === 'ai' && typeof window.toggleAISidebar === 'function') window.toggleAISidebar(false);
      else if (p === 'sidebar' && typeof toggleSidebarMenu === 'function') toggleSidebarMenu();
    } catch (e) {}
    setTimeout(syncBack, 50);
  }
  function syncBack() {
    try {
      if (!tg.BackButton) return;
      if (openPanel()) tg.BackButton.show(); else tg.BackButton.hide();
    } catch (e) {}
  }
  try { if (tg.BackButton && tg.BackButton.onClick) tg.BackButton.onClick(closePanel); } catch (e) {}
  // panel ochilishi/yopilishi DOM o'zgarishi orqali kuzatiladi (har bir ochish funksiyasini o'rash shart emas)
  try {
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(syncBack, 60); })
      .observe(document.body || document.documentElement, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] });
    ['aiSidebar', 'sidebar'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) new MutationObserver(function () { clearTimeout(t); t = setTimeout(syncBack, 60); }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  } catch (e) {}
})();

/* v54.1 — Yuqori panel: akkaunt holatiga qarab
 *  - kirmagan: balans (#ssQuota) YASHIRIN, «Kirish» tugmasi ko'rinadi;
 *  - kirgan:   balans ko'rinadi, «Kirish» tugmasi YASHIRIN (akkaunt chap paneldagi profil kartasida).
 *  Holat bir nechta joyda (auth, monitoring, sidebar) inline style bilan o'zgartirilardi va bir-biriga zid edi —
 *  endi yagona body klassi (ss-auth-in / ss-auth-out) va v54.css dagi !important qoidasi hal qiladi.
 */
(function () {
  'use strict';
  function loggedIn() {
    try { return typeof supabaseToken !== 'undefined' && !!supabaseToken && supabaseToken !== 'dev-token' && !!currentUserEmail; }
    catch (e) { return false; }
  }
  var last = null;
  function sync() {
    if (!document.body) return;
    var li = loggedIn();
    if (li === last) return;
    last = li;
    document.body.classList.toggle('ss-auth-in', li);
    document.body.classList.toggle('ss-auth-out', !li);
    try { if (typeof window.scheduleFitCanvas === 'function') window.scheduleFitCanvas(); } catch (e) {}
  }
  window.ssSyncAuthHeader = sync;
  sync();
  document.addEventListener('DOMContentLoaded', sync);
  setInterval(sync, 800);           // kirish/chiqish ko'p joydan bo'ladi — arzon tekshiruv (faqat o'zgarganda DOM'ga tegadi)
})();

/* v55 — E'lon (reklamasiz) popup.
 * Admin «📣 E'lon» joylasa — saytda chiroyli popup bo'lib chiqadi («Reklama» yozuvisiz, VIP'ga ham).
 * Har bir e'lon bir marta ko'rsatiladi (brauzer eslab qoladi); yangisi bo'lsa keyingi tekshiruvda chiqadi.
 */
(function () {
  'use strict';
  // Sayt maxfiylik uchun oddiy localStorage'ni o'chirgan (index.html) — faqat «ss-auth-v39» prefiksli kalitlar saqlanadi.
  // Ko'rilgan e'lonlar ro'yxati (faqat raqamlar) shu ruxsat etilgan omborda; bo'lmasa — RAM'da (sahifa yopilguncha).
  var KEY = 'ss-auth-v39-notice-seen', mem = [];
  var store = window.__ssAuthStorage || null;
  function seen() {
    try { var v = store && store.getItem(KEY); if (v) return (JSON.parse(v) || []).filter(function (x) { return typeof x === 'number'; }).slice(-50); } catch (e) {}
    return mem.slice(-50);
  }
  function markSeen(id) {
    var a = seen(); if (a.indexOf(id) < 0) a.push(id);
    mem = a.slice(-50);
    try { if (store) store.setItem(KEY, JSON.stringify(mem)); } catch (e) {}
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var open = false;

  function show(n) {
    if (open || !n || document.getElementById('ssNotice')) return;
    open = true;
    var media = '';
    if (n.media_url && n.media_type === 'image') media = '<img class="ssn-media" src="' + esc(n.media_url) + '" alt="" referrerpolicy="no-referrer">';
    else if (n.media_url && n.media_type === 'video') media = '<video class="ssn-media" src="' + esc(n.media_url) + '" autoplay muted loop playsinline></video>';
    var ov = document.createElement('div');
    ov.id = 'ssNotice'; ov.className = 'ssn-ov';
    ov.innerHTML = '<div class="ssn" role="dialog" aria-modal="true" aria-label="' + esc(n.title || "E'lon") + '">' +
      '<button type="button" class="ssn-x" aria-label="Yopish">×</button>' + media +
      '<div class="ssn-body">' + (n.title ? '<h3>' + esc(n.title) + '</h3>' : '') + (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
      (n.has_link ? '<a class="ssn-go" target="_blank" rel="noopener" href="' + esc(n.click_url) + '">' + esc(n.button_text || 'Batafsil') + '</a>' : '') +
      '</div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('on'); });
    function close() {
      markSeen(n.id);
      ov.classList.remove('on');
      setTimeout(function () { try { ov.remove(); } catch (e) {} open = false; }, 220);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.ssn-x').onclick = close;
    var go = ov.querySelector('.ssn-go');
    if (go) go.addEventListener('click', function (e) {
      var tgw = window.Telegram && window.Telegram.WebApp;
      if (tgw && tgw.initData && tgw.openLink) { e.preventDefault(); try { tgw.openLink(location.origin + n.click_url); } catch (er) {} }
      setTimeout(close, 50);
    });
  }

  async function check() {
    if (open || document.hidden) return;
    try {
      var r = await fetch('/api/notice/next?exclude=' + encodeURIComponent(seen().join(',')), { cache: 'no-store' });
      if (!r.ok) return;
      var j = await r.json();
      if (j && j.notice && seen().indexOf(j.notice.id) < 0) show(j.notice);
    } catch (e) {}
  }
  window.ssCheckNotice = check;
  setTimeout(check, 2500);                 // sahifa ochilib, slayd chizilgandan keyin
  setInterval(check, 10 * 60 * 1000);
})();
