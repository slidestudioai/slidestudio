/* =====================================================================
 * 39_v47_pro_ads_admin.js  (v47)
 *
 *  1) SOZLAMALAR: tepada doim ko'rinadigan ⚙️ tugma + ishonchli oyna (bottom-sheet).
 *     Telegram Mini App'da sidebar yopiq paytda ham ishlaydi; ikki marta ochilib qolmaydi.
 *  2) REKLAMA: chap panelda, slaydlar tagida (rasm/video + matn + havola). Server hal qiladi:
 *     Pro / VIP / admin / cheksiz akkauntlarga HECH QACHON ko'rsatilmaydi.
 *  3) Sozlamalar oynasi: balans, varaq sotib olish (Telegram ichida tashqi brauzerda ochiladi). Pro rejasi olib tashlangan.
 *  4) ADMIN: admin akkaunt (Google + ulangan Telegram) bo'lsa — sozlamalarda yashirin tugma.
 *     Boshqalarga hech narsa ko'rinmaydi (server 404 qaytaradi).
 *  5) E'lon: admin paneldan yozilgan e'lon (yopiladigan).
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssV47) return;
  window.__ssV47 = true;

  var tgw = null;
  try { tgw = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null; } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function token() { try { return (typeof supabaseToken !== 'undefined') ? supabaseToken : ''; } catch (e) { return ''; } }
  function logged() { var t = token(); return !!t && t !== 'dev-token'; }
  function email() { try { return (typeof currentUserEmail !== 'undefined') ? currentUserEmail : ''; } catch (e) { return ''; } }
  function mon() { return window.Monitoring || null; }
  function st() { try { return mon() && mon().getState ? mon().getState() : {}; } catch (e) { return {}; } }
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'info'); } catch (e) {} }
  function openExternal(url) {
    var abs = /^https?:/i.test(url) ? url : location.origin + url;
    try { if (tgw && typeof tgw.openLink === 'function') { tgw.openLink(abs); return; } } catch (e) {}
    var w = null; try { w = window.open(abs, '_blank', 'noopener'); } catch (e) {}
    if (!w) location.href = abs;
  }

  /* ------------------------------------------------------------------ CSS */
  var css = document.createElement('style');
  css.textContent = [
    '#ssTopSet{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:0;border-radius:50%;background:transparent;color:#444746;cursor:pointer;flex:none}',
    '#ssTopSet:hover{background:#e8eaed}#ssTopSet .material-symbols-outlined{font-size:22px}',
    '.ssset-ov{position:fixed;inset:0;z-index:2147483200;background:rgba(15,23,42,.5);display:flex;align-items:flex-end;justify-content:center;animation:ssFade .15s ease}',
    '.ssset{background:#fff;color:#1f2937;width:100%;max-width:460px;max-height:92vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 18px calc(22px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 40px rgba(0,0,0,.25);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;animation:ssUp .2s ease}',
    '@media(min-width:560px){.ssset-ov{align-items:center}.ssset{border-radius:20px}}',
    '@keyframes ssUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}@keyframes ssFade{from{opacity:0}to{opacity:1}}',
    '.ssset-x{float:right;background:#f1f3f4;border:0;border-radius:50%;width:32px;height:32px;font-size:20px;line-height:1;color:#5f6368;cursor:pointer}',
    '.ssset-head{display:flex;gap:12px;align-items:center;margin-bottom:14px}',
    '.ssset-av{width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#4f8cff,#7c5cff);color:#fff;display:grid;place-items:center;font-weight:700;font-size:19px;flex:none}',
    '.ssset-head b{display:block;word-break:break-all}',
    '.ssset-plan{display:inline-block;margin-top:3px;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;background:#eef0f3;color:#5f6368}',
    '.ssset-plan.pro{background:#e3edff;color:#1a56db}.ssset-plan.vip{background:#fdf3d0;color:#8a6a00}',
    '.ssset-card{border:1px solid #e5e7eb;border-radius:14px;padding:12px;margin:10px 0}',
    '.ssset-pro{background:linear-gradient(135deg,#f4f7ff,#f7f2ff);border-color:#d9e2ff}',
    '.ssset-pro h4{margin:0 0 6px;font-size:15px}.ssset-pro ul{margin:6px 0 10px;padding-left:18px;color:#4b5563}',
    '.ssset-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border:0;border-radius:12px;padding:12px;font:inherit;font-weight:600;cursor:pointer;background:#f1f3f4;color:#1f2937;margin-top:8px}',
    '.ssset-btn.pri{background:#1a73e8;color:#fff}.ssset-btn.gold{background:#f5b301;color:#2b2100}.ssset-btn.adm{background:#111827;color:#fff}',
    '.ssset-btn:disabled{opacity:.6}.ssset small{color:#6b7280}',
    '#ssAdSlot{flex:none;display:flex;align-items:center;gap:6px;padding:4px;margin-top:2px;border-top:1px dashed #dadce0;font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    '#ssAdSlot .ad-num{width:14px;flex:none;text-align:right;font-size:11px;color:#9aa0a6}',
    '#ssAdSlot .ad-card{position:relative;flex:1;min-width:0;height:95px;border:2px solid #f2c94c;border-radius:6px;overflow:hidden;background:linear-gradient(135deg,#1a73e8,#7c3aed);color:#fff;display:block;text-decoration:none;cursor:default}',
    '#ssAdSlot a.ad-card{cursor:pointer}',
    '#ssAdSlot .ad-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
    '#ssAdSlot .ad-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 25%,rgba(0,0,0,.72))}',
    '#ssAdSlot .ad-tag{position:absolute;top:4px;left:4px;z-index:2;background:rgba(0,0,0,.6);color:#fff;border-radius:5px;padding:0 5px;font-size:9px;letter-spacing:.03em}',
    '#ssAdSlot .ad-body{position:absolute;left:0;right:0;bottom:0;padding:6px 8px;z-index:2}',
    '#ssAdSlot .ad-body b{display:block;font-size:12px;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#ssAdSlot .ad-body p{margin:1px 0 0;font-size:10px;line-height:1.25;opacity:.92;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '#ssAdSlot .ad-go{position:absolute;top:4px;right:4px;z-index:2;background:#fff;color:#1a56db;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:700;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#ssAnn{position:fixed;top:64px;right:12px;z-index:2147482000;max-width:min(360px,calc(100vw - 24px));background:#111827;color:#fff;border-radius:12px;padding:10px 34px 10px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3)}',
    '#ssAnn button{position:absolute;top:4px;right:6px;background:none;border:0;color:#9ca3af;font-size:18px;cursor:pointer}'
  ].join('\n');
  document.head.appendChild(css);

  /* ------------------------------------------------------------------ Sozlamalar oynasi */
  var pubCfg = null, adminUrl = null, adminTok = null;
  var oldOpen = (typeof window.openSettingsPanel === 'function') ? window.openSettingsPanel : null;

  fetch('/api/config/public').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
    pubCfg = c || {};
    if (pubCfg.announcement) showAnnouncement(pubCfg.announcement);
  }).catch(function () {});

  function showAnnouncement(text) {
    try {
      var key = 'ssAnn:' + text;
      if (sessionStorage.getItem(key) || $('ssAnn')) return;
      var d = document.createElement('div'); d.id = 'ssAnn';
      d.innerHTML = '<span>📢 ' + esc(text) + '</span><button type="button" aria-label="Yopish">×</button>';
      d.querySelector('button').onclick = function () { try { sessionStorage.setItem(key, '1'); } catch (e) {} d.remove(); };
      document.body.appendChild(d);
    } catch (e) {}
  }

  function planLabel(s) {
    if (s.plan === 'vip') return ['VIP · cheksiz', 'vip'];
    if (s.unlimited) return ['Cheksiz', 'vip'];
    return ['Bepul', ''];
  }

  function closeSettings() { var o = $('ssSet'); if (o) o.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') closeSettings(); }

  function openSettingsV47() {
    if ($('ssSet')) return;                       // ikki marta bosilsa (touch + click) — bitta oyna
    var s = st(), li = logged();
    var pl = planLabel(s);
    var ov = document.createElement('div'); ov.id = 'ssSet'; ov.className = 'ssset-ov';
    var cfg = pubCfg || {};
    var packTxt = cfg.pack_pages && cfg.pack_price_usd ? ' — ' + cfg.pack_pages + ' varaq · $' + Number(cfg.pack_price_usd).toFixed(2) : '';
    var html = '<div class="ssset" role="dialog" aria-label="Sozlamalar"><button type="button" class="ssset-x" aria-label="Yopish">×</button>';
    if (li) {
      var em = email() || 'Akkaunt';
      html += '<div class="ssset-head"><div class="ssset-av">' + esc((em[0] || 'S').toUpperCase()) + '</div><div><b>' + esc(em) + '</b><span class="ssset-plan ' + pl[1] + '">' + esc(pl[0]) + '</span></div></div>';
      html += '<div class="ssset-card" id="ssSetMeters">' + (window.ssMetersHTML ? window.ssMetersHTML() : '') + '</div>';
      if (!s.unlimited) html += '<button type="button" class="ssset-btn pri" id="ssBuyPack">➕ Varaq sotib olish' + packTxt + '</button>';
      if (window.ssTgLink && !tgw) html += '<button type="button" class="ssset-btn" id="ssTg" data-tg-link>✈️ Telegram botni ulash</button>';
      if (tgw && window.ssGoogleLink) html += '<button type="button" class="ssset-btn" id="ssGg" data-google-link>🔗 Google akkauntni ulash</button>';   // v61: Mini App
      html += '<button type="button" class="ssset-btn" id="ssTools">🛠 Asboblar va tozalash</button>';
      html += '<button type="button" class="ssset-btn adm" id="ssAdmin" style="display:none">🛡 Admin panel</button>';
      if (!tgw) html += '<button type="button" class="ssset-btn" id="ssOut">Chiqish</button>';
    } else {
      html += '<div class="ssset-head"><div class="ssset-av">S</div><div><b>Mehmon</b><span class="ssset-plan">Kirmagansiz</span></div></div>' +
        '<small>Kirsangiz AI, balans va loyihalarni saqlash ishlaydi.</small>' +
        (tgw ? '' : '<button type="button" class="ssset-btn pri" id="ssIn">Google bilan kirish</button>') +
        '<button type="button" class="ssset-btn" id="ssTools">🛠 Asboblar</button>';
    }
    html += '</div>';
    ov.innerHTML = html;
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSettings(); });
    function on(id, fn) { var b = ov.querySelector('#' + id); if (b) b.onclick = function (e) { e.preventDefault(); fn(b); }; }
    ov.querySelector('.ssset-x').onclick = closeSettings;
    on('ssBuyPack', function () { closeSettings(); if (mon()) mon().startCheckout('pack'); });
    on('ssTg', function () { closeSettings(); try { window.ssTgLink(); } catch (e) {} });
    on('ssGg', function () { closeSettings(); try { window.ssGoogleLink(); } catch (e) {} });
    try { if (window.ssTgDecorate) window.ssTgDecorate(ov); } catch (e) {}
    try { if (window.ssGoogleDecorate) window.ssGoogleDecorate(ov); } catch (e) {}
    on('ssIn', function () { closeSettings(); try { handleGoogleLogin(); } catch (e) {} });
    on('ssOut', function () { closeSettings(); try { handleLogout(); } catch (e) {} });
    on('ssTools', function () {
      closeSettings();
      try { if (typeof toggleSidebarMenu === 'function' && window.innerWidth <= 900) { var sb = $('sidebar'); if (sb && !sb.classList.contains('open')) toggleSidebarMenu(); } } catch (e) {}
      try { if (oldOpen) oldOpen(); } catch (e) { toast('Asboblar oynasini ochib bo\u2018lmadi', 'error'); console.warn('[v47] oldOpen', e); }
    });
    on('ssAdmin', function () { closeSettings(); if (adminUrl) openExternal(adminUrl); });
    try { if (window.ssAnimateMeters) window.ssAnimateMeters(ov); } catch (e) {}
    if (li) checkAdmin(ov);
  }

  /* admin tugmasi: server tasdiqlasagina (Google admin + ulangan Telegram admin) ko'rinadi; aks holda 404 — hech narsa sezilmaydi */
  async function checkAdmin(ov) {
    try {
      var t = token();
      if (adminTok !== t) {
        adminTok = t; adminUrl = null;
        var r = await fetch('/api/me/admin-entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
        if (r.ok) { var j = await r.json(); adminUrl = j && j.url ? j.url : null; }
      }
      var b = ov.querySelector('#ssAdmin');
      if (b && adminUrl) b.style.display = 'flex';
    } catch (e) {}
  }

  window.openSettingsPanel = openSettingsV47;
  window.openSettingsV47 = openSettingsV47;

  /* yuqori ⚙️ tugma (hamma ekranda, sidebar yopiq bo'lsa ham) */
  function ensureTopButton() {
    var old = $('ssTopSet'); if (old) { old.remove(); }
    return;                                   // v49: yuqori o'ng burchakdagi qo'shimcha «Sozlamalar» tugmasi olib tashlandi
    if ($('ssTopSet')) return;
    var host = document.querySelector('.header-actions');
    if (!host) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'ssTopSet'; b.title = 'Sozlamalar'; b.setAttribute('aria-label', 'Sozlamalar');
    b.innerHTML = '<span class="material-symbols-outlined">settings</span>';
    host.appendChild(b);
  }

  /* hamma "sozlamalar" tugmalari bitta ishonchli ishlovchi orqali (sidebar qayta chizilsa ham ishlaydi) */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('#ssTopSet,.btn-settings,#sidebarSettingsBtn,[data-ss-open="settings"]') : null;
    if (!t) return;
    e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    openSettingsV47();
  }, true);


  /* ------------------------------------------------------------------ Tugmalar ishonchliligi */
  // (a) Fayl tanlash (fon rasmi, rasm, video...): DOM'ga ulanmagan <input type=file> Telegram/iOS WebView'da
  //     tanlangan faylni bildirmaydi ("tugma bosiladi, hech narsa bo'lmaydi"). Vaqtincha DOM'ga ulaymiz.
  try {
    var _origInputClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      var el = this;
      try {
        if (el.type === 'file' && !el.isConnected && document.body) {
          el.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
          document.body.appendChild(el);
          var done = function () { setTimeout(function () { try { if (el.parentNode) el.remove(); } catch (e) {} }, 1500); };
          el.addEventListener('change', done, { once: true });
          el.addEventListener('cancel', done, { once: true });
          setTimeout(function () { try { if (el.parentNode) el.remove(); } catch (e) {} }, 180000);
        }
      } catch (e) {}
      return _origInputClick.apply(el, arguments);
    };
  } catch (e) {}

  // (b) Allaqachon tanlangan slaydga qayta bosish: qayta chizish/miltillash bo'lmasin
  try {
    var _origSwitch = window.switchSlide;
    if (typeof _origSwitch === 'function' && !_origSwitch.__v47) {
      var wrapped = function (index) {
        try { if (typeof activeIndex !== 'undefined' && Number(index) === activeIndex) return; } catch (e) {}
        return _origSwitch.apply(this, arguments);
      };
      wrapped.__v47 = true;
      window.switchSlide = wrapped;
    }
  } catch (e) {}

  /* ------------------------------------------------------------------ Reklama (chap panel) */
  var curAd = null, lastKey = null, lastFree = null, closedAd = null;

  function renderAdInto(el, ad) {
    var media = '';
    if (ad.media_url && ad.media_type === 'image') media = '<img class="ad-media" src="' + esc(ad.media_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    else if (ad.media_url && ad.media_type === 'video') media = '<video class="ad-media" src="' + esc(ad.media_url) + '" autoplay muted loop playsinline preload="metadata"></video>';
    var inner = media + (media ? '<div class="ad-shade"></div>' : '') + '<span class="ad-tag">Reklama</span>' +
      (ad.has_link ? '<span class="ad-go">' + esc(ad.button_text || 'Batafsil') + ' ›</span>' : '') +
      '<div class="ad-body">' + (ad.title ? '<b>' + esc(ad.title) + '</b>' : '') + (ad.body ? '<p>' + esc(ad.body) + '</p>' : '') + '</div>';
    el.dataset.ad = ad.id;
    // butun karta bitta slayd kabi; havola bo'lsa rasm (karta) o'zi bosiladi
    el.innerHTML = '<span class="ad-num">📢</span>' + (ad.has_link
      ? '<a class="ad-card" target="_blank" rel="noopener sponsored" href="' + esc(ad.click_url) + '">' + inner + '</a>'
      : '<div class="ad-card">' + inner + '</div>');
    // v49.5: yopish (×) — shu reklama keyingi yangilanishgacha yashiriladi
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'ad-close'; x.setAttribute('aria-label', 'Yopish'); x.textContent = '×';
    x.style.cssText = 'position:absolute;top:6px;right:6px;z-index:5;width:22px;height:22px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:15px;line-height:20px;cursor:pointer;padding:0';
    x.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closedAd = ad.id; curAd = null; ensureSlot(); });
    var cardEl = el.querySelector('.ad-card'); if (cardEl) { if (getComputedStyle(cardEl).position === 'static') cardEl.style.position = 'relative'; cardEl.appendChild(x); }
    var a = el.querySelector('a.ad-card');
    if (a && tgw) a.addEventListener('click', function (e) { e.preventDefault(); openExternal(ad.click_url); });
  }

  var slotEl = null;
  function ensureSlot() {
    var sb = $('sidebar'); if (!sb) return;
    var scroll = sb.querySelector('.sidebar-slides-scroll');
    if (!curAd) { if (slotEl && slotEl.parentNode) slotEl.remove(); return; }
    if (!scroll) {                       // v51: sahifa yangilanganda panel kechroq paydo bo'ladi — reklama yo'qolib qolmasin, qayta urinamiz
      if (!ensureSlot._t && (ensureSlot._n = (ensureSlot._n || 0) + 1) <= 30) {
        ensureSlot._t = setTimeout(function () { ensureSlot._t = null; ensureSlot(); }, 500);
      }
      return;
    }
    ensureSlot._n = 0;
    if (!slotEl) { slotEl = document.createElement('div'); slotEl.id = 'ssAdSlot'; }
    if (slotEl.dataset.ad !== String(curAd.id)) renderAdInto(slotEl, curAd);
    var addBtn = scroll.querySelector('.btn-add-slide-bottom');
    var ok = slotEl.parentNode === scroll && (addBtn ? slotEl.nextElementSibling === addBtn : scroll.lastElementChild === slotEl);
    if (!ok) { if (addBtn) scroll.insertBefore(slotEl, addBtn); else scroll.appendChild(slotEl); }
  }

  async function fetchAd() {
    var s = st();
    if (logged() && s.ad_free) { curAd = null; ensureSlot(); return; }
    try {
      var h = {}; if (logged()) h.Authorization = 'Bearer ' + token();
      var r = await fetch('/api/ads/next?surface=site' + (curAd ? '&exclude=' + curAd.id : ''), { headers: h, cache: 'no-store' });
      var j = r.ok ? await r.json() : { ad: null };
      curAd = j && j.ad ? j.ad : null;
      if (curAd && closedAd === curAd.id) curAd = null;     // yopilgan reklama qayta chiqmaydi
    } catch (e) { return; }
    ensureSlot();
  }

  var rafPending = false;
  function watchSidebar() {
    var sb = $('sidebar');
    if (!sb || sb.__ssAdObs) return;
    sb.__ssAdObs = true;
    new MutationObserver(function () {
      if (rafPending) return; rafPending = true;
      requestAnimationFrame(function () { rafPending = false; ensureSlot(); });
    }).observe(sb, { childList: true, subtree: true });     // v51: varaqlar ro'yxati qayta chizilganda reklama kartasi o'chib ketmasin
  }

  document.addEventListener('ss:usage', function (e) {
    var free = !!(e.detail && e.detail.ad_free);
    if (lastFree === null || free !== lastFree) { lastFree = free; fetchAd(); }
  });

  function boot() {
    ensureTopButton(); watchSidebar();
    setTimeout(fetchAd, 1500);
    var prev = logged() ? token() : '';
    setInterval(function () {                                    // kirish/chiqish o'zgarsa — reklama va holat yangilanadi
      ensureTopButton(); watchSidebar();
      var now = logged() ? token() : '';
      if (now !== prev) {
        var wasLogged = !!prev; prev = now;
        if (wasLogged && !now) { try { if (mon()) mon().applyServerUsage({ plan: 'free', is_pro: false, unlimited: false, ad_free: false }); } catch (e) {} }
        adminTok = null; adminUrl = null;
        fetchAd();
      }
    }, 2500);
    setInterval(fetchAd, 60 * 1000);   // v49.5: o'chirilgan/yangi reklama 1 daqiqada yangilanadi
    window.addEventListener('focus', function () { fetchAd(); });                         // 8 daqiqada bir yangi reklama
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
