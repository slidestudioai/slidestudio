/* =====================================================================
 * 27_v38_app.js — v38 ilova qatlami (eng oxirgi yuklanadi)
 *   1) Sahifadan chiqishda ogohlantirish (slaydlar bulutda saqlanmaydi — faqat RAM)
 *   2) (olib tashlandi: loyiha tarixi yo'q)
 *   3) Yangi Sozlamalar paneli (RAM media, limit hisoblagichi, bir bosishda tozalash/tanlash)
 *   4) Taqdimotdan oldin barcha rasm/GIF/video ni RAM ga yuklash ("tayyorlanmoqda" oynasi)
 *   5) Matn doim eng tepada; to'liq-ekran shakl/fon hech qachon matn ustiga chiqmaydi
 * Hech narsa localStorage / sessionStorage / IndexedDB ga yozilmaydi — faqat RAM.
 * ===================================================================== */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  function safe(fn, d) { try { return fn(); } catch (e) { console.warn('[v38]', e); return d; } }
  function loggedIn() { return safe(function () { return !!supabaseToken && supabaseToken !== 'dev-token'; }, false); }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ------------------------------------------------------------------ 1) SAHIFADAN CHIQISHDA OGOHLANTIRISH
   * v38: slaydlar bulutda saqlanmaydi (faqat akkaunt va balans) — hammasi shu oynaning RAM'ida. */
  function deckHasContent() {
    return safe(function () {
      if (!slides) return false;
      if (slides.length > 1) return true;
      const p = JSON.parse((slides[0] && slides[0].json) || '{}');
      return (p.objects && p.objects.length > 0) || (p.gifs && p.gifs.length > 0) || !!p.backgroundGif || !!p.backgroundVideo;
    }, false);
  }
  window.addEventListener('beforeunload', function (e) {
    if (deckHasContent() && safe(function () { return hasUnsavedChanges; }, true)) { e.preventDefault(); e.returnValue = ''; return ''; }
  });
  // sozlamalarda ko'rsatish uchun
  function loggedInNow() { return loggedIn(); }
  void loggedInNow;

  /* ------------------------------------------------------------------ 3) SOZLAMALAR PANELI */
  function wipeJson(json, keepBg) {
    let p = {}; try { p = JSON.parse(json || '{}'); } catch (e) {}
    p.objects = []; p.gifs = [];
    delete p.backgroundGif; delete p.backgroundVideo; delete p.backgroundImage; delete p.overlays;
    return JSON.stringify(p);
  }
  async function reloadCurrent() {
    try { await loadSlideCanvasAsync(activeIndex); } catch (e) { safe(function () { loadSlideCanvas(activeIndex); }); }
    if (!document.querySelector('.settings-panel-inner')) safe(function () { renderSidebar(); });   // v42: Sozlamalar ochiq bo'lsa yopilib ketmasin
    safe(function () { slides.forEach(function (_, i) { refreshSlideThumb(i); }); });
    hasUnsavedChanges = true;
  }
  function ask(title, text) {
    if (!window.Swal) return Promise.resolve(window.confirm(title + '\n' + text));
    return Swal.fire({ title: title, text: text, icon: 'warning', showCancelButton: true, confirmButtonText: 'Ha', cancelButtonText: 'Bekor', heightAuto: false }).then(function (r) { return r.isConfirmed; });
  }
  const actions = {
    async clearSlide() {
      if (!(await ask('Joriy slaydni tozalash', 'Slayddagi barcha element, GIF va fon video o‘chiriladi.'))) return;
      safe(function () { saveCurrentSlideState(); });
      const s = slides[activeIndex]; s.json = wipeJson(s.json); s.imageNumbers = []; s.thumb = '';
      await reloadCurrent(); showToast('Slayd tozalandi');
    },
    async clearDeck() {
      if (!(await ask('Barcha slaydlarni tozalash', 'Hamma slaydlardagi elementlar o‘chiriladi (slaydlar soni o‘zgarmaydi).'))) return;
      safe(function () { saveCurrentSlideState(); });
      slides.forEach(function (s) { s.json = wipeJson(s.json); s.imageNumbers = []; s.thumb = ''; });
      await reloadCurrent(); showToast('Hamma slaydlar tozalandi');
    },
    async bgToAll() {
      safe(function () { saveCurrentSlideState(); });
      let cur = {}; try { cur = JSON.parse(slides[activeIndex].json || '{}'); } catch (e) {}
      const bg = cur.background || cur.backgroundColor || '#ffffff';
      const src = slides[activeIndex];
      slides.forEach(function (s) {
        let p = {}; try { p = JSON.parse(s.json || '{}'); } catch (e) {}
        p.background = bg; p.backgroundColor = bg;
        if (cur.backgroundGif) p.backgroundGif = cur.backgroundGif; else delete p.backgroundGif;
        if (cur.backgroundVideo) p.backgroundVideo = cur.backgroundVideo; else delete p.backgroundVideo;
        if (cur.backgroundImage) p.backgroundImage = cur.backgroundImage; else delete p.backgroundImage;
        s.json = JSON.stringify(p);
        // v42: fon turi ham ko'chiriladi — aks holda keyingi saqlashda ("color") GIF/video/rasm o'chib ketardi
        if (s !== src) {
          s.bgType = src.bgType; s.bgVal = src.bgVal; s.thumb = '';
          if (src.bgType === undefined) delete s.bgType;
        }
      });
      await reloadCurrent(); showToast('Joriy fon hamma slaydga qo‘llandi');
    },
    selectAll() {
      safe(function () {
        canvas.discardActiveObject();
        const objs = canvas.getObjects().filter(function (o) { return o.selectable !== false && o.visible !== false; });
        if (objs.length) canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas: canvas }));
        canvas.requestRenderAll();
      });
      const n = safe(function () { const a = canvas.getActiveObject(); return a ? (a.type === 'activeSelection' ? a.getObjects().length : 1) : 0; }, 0);
      showToast(n ? n + ' ta element tanlandi' : 'Tanlash uchun element yo‘q');
      if (!document.querySelector('.settings-panel-inner')) safe(function () { renderSidebar(); });
    },
    clearChat() { safe(function () { window.resetChatOnLoad(); }); showToast('Chat tozalandi'); },
    clearRam() { safe(function () { MediaRAM.clear(); }); showToast('Media xotirasi tozalandi'); }
  };
  let _fxOff = false;

  function openSettings() {
    const sidebar = $('sidebar'); if (!sidebar) return;
    const dd = $('settingsDropdown'); if (dd) dd.classList.remove('open');
    const li = loggedIn();
    const email = safe(function () { return currentUserEmail; }, '') || 'Mehmon';
    sidebar.innerHTML = '';
    const panel = document.createElement('div'); panel.className = 'settings-panel-inner';
    const st = safe(function () { return MediaRAM.stats(); }, { count: 0, bytes: 0, videos: 0 });
    const mb = (st.bytes / 1048576).toFixed(1);
    panel.innerHTML =
      '<div class="settings-panel-header"><button type="button" class="settings-back-btn" data-a="back" title="Orqaga"><span class="material-symbols-outlined">arrow_back</span></button><span class="settings-panel-title">Sozlamalar</span></div>' +
      '<div class="settings-panel-body">' +
      '<div class="settings-user-card"><span class="settings-avatar" style="background:' + (li ? '#0b57d0' : '#9ca3af') + ';">' + esc((email[0] || 'U').toUpperCase()) + '</span>' +
      '<div class="settings-user-info"><div class="settings-user-email">' + (li ? esc(email) : 'Tizimga kirmagan') + '</div><div class="settings-user-status">' + (li ? 'Tizimda' : 'Mehmon · slaydlar faqat shu oynada (RAM)') + '</div></div></div>' +
      (li ? '<div class="ss-set-sec">AI varaqlar</div><div class="ss-set-card ss-bal-card">' + safe(function () { return window.ssMetersHTML ? window.ssMetersHTML() : ''; }, '') +
        '<div class="ss-set-row"><span>Qo‘shimcha varaq kerakmi?</span><button type="button" class="ss-set-btn" data-a="buy">Sotib olish</button></div></div>' : '') +
      (li && window.ssTgLink ? '<div class="ss-set-sec">Telegram bot</div><div class="ss-set-card"><div class="ss-set-row"><span>Botni ulash<small>Telegram va sayt balansi bir xil bo‘ladi</small></span><button type="button" class="ss-set-btn" data-a="tglink">Ulash</button></div></div>' : '') +
      '<div class="ss-set-sec">Bir bosishda</div><div class="ss-set-card">' +
      '<div class="ss-set-row"><span>Hamma elementni tanlash</span><button type="button" class="ss-set-btn" data-a="selectAll">Tanlash</button></div>' +
      '<div class="ss-set-row"><span>Joriy fonni hamma slaydga<small>Rang / GIF / video</small></span><button type="button" class="ss-set-btn" data-a="bgToAll">Qo‘llash</button></div>' +
      '<div class="ss-set-row"><span>Joriy slaydni tozalash</span><button type="button" class="ss-set-btn danger" data-a="clearSlide">O‘chirish</button></div>' +
      '<div class="ss-set-row"><span>Hamma slaydlarni tozalash</span><button type="button" class="ss-set-btn danger" data-a="clearDeck">O‘chirish</button></div>' +
      '<div class="ss-set-row"><span>AI chat tarixi</span><button type="button" class="ss-set-btn" data-a="clearChat">Tozalash</button></div></div>' +
      '<div class="ss-set-sec">Qurilma xotirasi (RAM)</div><div class="ss-set-card">' +
      '<div class="ss-set-row"><span>Yuklangan media<small>' + st.count + ' ta fayl (' + st.videos + ' video) · ' + mb + ' MB · diskka yozilmaydi</small></span><button type="button" class="ss-set-btn" data-a="clearRam">Tozalash</button></div>' +
      '<div class="ss-set-row"><span>Yengil rejim<small>Yuklanish animatsiyalarini o‘chiradi</small></span><label class="ss-switch"><input type="checkbox" data-a="fx"' + (_fxOff ? ' checked' : '') + '><span></span></label></div></div>' +
      '<div class="settings-menu" style="margin-top:12px">' +
      (li ? '<button type="button" class="settings-menu-item" data-a="logout"><span class="material-symbols-outlined" style="color:#ef4444;">logout</span><span>Chiqish</span></button>'
          : '<button type="button" class="settings-menu-item" data-a="login"><span class="material-symbols-outlined" style="color:#0b57d0;">login</span><span>Google bilan kirish</span></button>') +
      '<button type="button" class="settings-menu-item" data-a="legal"><span class="material-symbols-outlined" style="color:#5f6368;">gavel</span><span>Huquqiy (Terms / Privacy / Refund)</span></button></div></div>';
    sidebar.appendChild(panel);
    safe(function () { if (window.ssAnimateMeters) window.ssAnimateMeters(panel); });
    panel.addEventListener('click', function (e) {
      const t = e.target.closest('[data-a]'); if (!t) return;
      const a = t.getAttribute('data-a');
      if (a === 'back') { safe(function () { renderSidebar(); }); }
      else if (a === 'login') safe(function () { handleGoogleLogin(); });
      else if (a === 'logout') { safe(function () { handleLogout(); }); safe(function () { renderSidebar(); }); }
      else if (a === 'buy') safe(function () { window.startCreditsCheckout(); });
      else if (a === 'tglink') safe(function () { window.ssTgLink(); });
      else if (a === 'legal') {
        if (window.Swal) Swal.fire({ title: 'Huquqiy hujjatlar', html: '<div style="display:flex;flex-direction:column;gap:10px;text-align:left;">' +
          '<a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a><a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a><a href="/refund.html" target="_blank" rel="noopener">Refund Policy</a></div>', confirmButtonText: 'Yopish', heightAuto: false });
        else window.open('/terms.html', '_blank');
      }
      else if (a === 'fx') { /* change hodisasi */ }
      else if (actions[a]) { actions[a](); if (a === 'clearRam') openSettings(); }
    });
    const fx = panel.querySelector('input[data-a="fx"]');
    if (fx) fx.addEventListener('change', function () { _fxOff = fx.checked; document.body.classList.toggle('ss-no-fx', _fxOff); });
  }
  window.openSettingsPanel = openSettings;

  /* ------------------------------------------------------------------ 4) TAQDIMOT OLDIDAN RAM GA YUKLASH */
  const SKIP_HOST = /youtube\.com|youtu\.be|vimeo\.com|\/embed\//i;
  const VID_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
  function collectMedia() {
    const imgs = new Set(), vids = new Set();
    const re = /"(?:src|url|backgroundGif|gifUrl)"\s*:\s*"((?:https?:\/\/|\/api\/proxy-image)[^"]+)"/g;
    (slides || []).forEach(function (s) {
      const j = (s && s.json) || ''; let m; re.lastIndex = 0;
      while ((m = re.exec(j))) {
        const u = m[1].replace(/\\u0026/g, '&');
        if (SKIP_HOST.test(u)) continue;
        (VID_EXT.test(u) ? vids : imgs).add(u);
      }
    });
    return { imgs: Array.from(imgs), vids: Array.from(vids) };
  }
  // memoizatsiya: taqdimotda bir xil kadr qayta chizilmasin
  const _memo = new Map();
  if (typeof window.renderSlideToOptimizedDataURL === 'function' && !window.renderSlideToOptimizedDataURL.__ssMemo) {
    const orig = window.renderSlideToOptimizedDataURL;
    window.renderSlideToOptimizedDataURL = function (json, opts) {
      if (!opts || !opts.skipElementGifs) return orig.apply(this, arguments);
      const key = (opts.segment == null ? '' : opts.segment) + '|' + json;
      if (_memo.has(key)) { const v = _memo.get(key); _memo.delete(key); _memo.set(key, v); return Promise.resolve(v); }
      return orig.apply(this, arguments).then(function (url) {
        if (typeof url === 'string' && url) { _memo.set(key, url); if (_memo.size > 80) _memo.delete(_memo.keys().next().value); }
        return url;
      });
    };
    window.renderSlideToOptimizedDataURL.__ssMemo = true;
  }

  function prepOverlay() {
    let o = $('ssPrepOverlay');
    if (!o) {
      o = document.createElement('div'); o.id = 'ssPrepOverlay';
      o.innerHTML = '<div class="ss-prep-card"><div class="ss-prep-title">Taqdimot tayyorlanmoqda…</div><div class="ss-prep-sub">Rasm, GIF va videolar xotiraga yuklanmoqda — namoyish to‘xtamasdan ishlaydi</div>' +
        '<div class="ss-prep-track"><div class="ss-prep-fill"></div></div><div class="ss-prep-num">0%</div><button type="button" class="ss-prep-skip">Kutmasdan boshlash</button></div>';
      document.body.appendChild(o);
    }
    return o;
  }
  let _prepBusy = false;
  async function prepareAndStart(orig, ctx, args) {
    if (_prepBusy) return;
    _prepBusy = true;
    try {
      safe(function () { saveCurrentSlideState(); });
      const m = collectMedia();
      const all = m.imgs.concat(m.vids);
      safe(function () { MediaRAM.setPinned(all); });
      const needMedia = all.filter(function (u) { return !safe(function () { return MediaRAM.peek(u); }); });
      const total = needMedia.length + slides.length;
      let skipped = false, done = 0;
      const ov = prepOverlay(), fill = ov.querySelector('.ss-prep-fill'), num = ov.querySelector('.ss-prep-num');
      ov.querySelector('.ss-prep-skip').onclick = function () { skipped = true; };
      const upd = function () { const p = total ? Math.round(done / total * 100) : 100; fill.style.width = p + '%'; num.textContent = p + '%  (' + done + '/' + total + ')'; };
      const needWork = total > 0 && (needMedia.length > 0 || slides.some(function (s) { return !_memo.has('0|' + s.json); }));
      if (needWork && !window.__ssNoPrep) {
        ov.classList.add('show'); upd();
        const t0 = Date.now();
        const mediaP = Promise.all(needMedia.map(function (u) {
          return safe(function () { return MediaRAM.load(u, { kind: VID_EXT.test(u) ? 'video' : 'image', priority: 'high' }); }, Promise.resolve())
            .then(function () {}, function () {}).then(function () { done++; upd(); });
        }));
        // 25 soniyadan keyin yoki "Kutmasdan boshlash" bosilsa — davom etamiz (yuklash fonda tugaydi)
        await Promise.race([mediaP, new Promise(function (res) { const iv = setInterval(function () { if (skipped || Date.now() - t0 > 25000) { clearInterval(iv); res(); } }, 150); mediaP.then(function () { clearInterval(iv); }); })]);
        for (let i = 0; i < slides.length && !skipped; i++) {
          const s = slides[i];
          try {
            await renderSlideToOptimizedDataURL(s.json, { skipElementGifs: true, segment: 0 });
            if (typeof window.presRenderSegments === 'function') await window.presRenderSegments(s);
          } catch (e) {}
          done++; upd();
          await new Promise(function (r) { setTimeout(r, 0); });
        }
        ov.classList.remove('show');
      }
    } finally { _prepBusy = false; }
    return orig.apply(ctx, args);
  }
  if (typeof window.startPresentation === 'function' && !window.startPresentation.__ssPrep) {
    const origStart = window.startPresentation;
    window.startPresentation = function () { return prepareAndStart(origStart, this, arguments); };
    window.startPresentation.__ssPrep = true;
  }

  /* ------------------------------------------------------------------ 5) MATN DOIM TEPADA */
  const TEXT_T = /^(i-?text|text|textbox)$/i;
  function enforceLayers(c) {
    try {
      if (!c || !c.getObjects) return;
      const W = c.getWidth ? c.getWidth() : 960, H = c.getHeight ? c.getHeight() : 540;
      const objs = c.getObjects().slice();
      const big = objs.filter(function (o) {
        return (o.type === 'rect' || o.type === 'image' || o.type === 'path') && !o.isGif &&
          o.getScaledWidth() >= W * 0.95 && o.getScaledHeight() >= H * 0.95;
      });
      for (let i = big.length - 1; i >= 0; i--) c.sendToBack(big[i]);        // to'liq-ekran fon pastga (tartib saqlanadi)
      objs.filter(function (o) { return TEXT_T.test(o.type || ''); }).forEach(function (t) { c.bringToFront(t); });   // matn eng tepada
      c.requestRenderAll && c.requestRenderAll();
    } catch (e) { console.warn('[v38] layers', e); }
  }
  window.ssEnforceLayers = enforceLayers;
  if (typeof window.createFabricCanvasFromElements === 'function' && !window.createFabricCanvasFromElements.__ssLayer) {
    const o = window.createFabricCanvasFromElements;
    window.createFabricCanvasFromElements = async function () { const c = await o.apply(this, arguments); enforceLayers(c); return c; };
    window.createFabricCanvasFromElements.__ssLayer = true;
  }
  if (typeof window.executeAiCommands === 'function' && !window.executeAiCommands.__ssLayer) {
    const o = window.executeAiCommands;
    window.executeAiCommands = async function () {
      const r = await o.apply(this, arguments);
      safe(function () { if (canvas) { enforceLayers(canvas); } });
      return r;
    };
    window.executeAiCommands.__ssLayer = true;
  }
})();
