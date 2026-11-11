/* =====================================================================
 * 28_v39_fixes.js — v39 tuzatishlar qatlami (eng oxirgi yuklanadi)
 *
 *  1) SESSIYA: akkaunt sahifa yangilanganda / uzoq turib qolganda chiqib ketmaydi
 *       (token yangilash qo'riqchisi, tasodifiy SIGNED_OUT ni tiklash)
 *  2) MEDIA → HAQIQIY FAYL: .pptx / .html / .pdf / .json eksportdan oldin barcha rasm, GIF va lokal video
 *       (blob:, /api/proxy-image, http rasm) base64 (data:) ko'rinishida slayd ichiga joylanadi.
 *       Onlayn video (YouTube / Vimeo / http .mp4 havola) — havola bo'lib qoladi.
 *  3) MEDIA OYNASI: slaydda 2 marta bosish / "/fon", "/rasm", "/gif", "/video" buyruqlari bilan ochiladi;
 *       tashqariga bosganda yopilmaydi (faqat ✕ yoki Esc); yuklanish spinneri; rasm miltillamasdan paydo bo'ladi.
 *  4) AI YOZAYOTGANDA: GIF dekoder keshi "pin" qilinadi (chiqarib yuborilmaydi), xato GIF'lar qayta uriniladi,
 *       kanvas muntazam qayta chiziladi — GIF/rasm yo'qolib qolmaydi.
 * Hech qanday slayd/media ma'lumoti localStorage'ga yozilmaydi (v38 qoidasi saqlanadi) — faqat login tokeni.
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssV39) return;
  window.__ssV39 = true;

  const $ = function (id) { return document.getElementById(id); };
  function safe(fn, d) { try { return fn(); } catch (e) { console.warn('[v39]', e); return d; } }
  function toast(m, k) { safe(function () { showToast(m, k); }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isTyping(t) {
    if (!t || !t.tagName) return false;
    const g = t.tagName;
    return g === 'INPUT' || g === 'TEXTAREA' || g === 'SELECT' || !!t.isContentEditable;
  }

  /* =================================================================
   * 1) SESSIYA QO'RIQCHISI
   * ================================================================= */
  const AUTH_KEY = 'ss-auth-v39';
  const BACKUP_KEY = 'ss-auth-v39-backup';
  const store = function () { return window.__ssAuthStorage || null; };
  function sbClient() { try { return (typeof supabaseClient !== 'undefined') ? supabaseClient : null; } catch (e) { return null; } }

  function backupSession(session) {
    try {
      const st = store();
      if (!st || !session || !session.refresh_token) return;
      st.setItem(BACKUP_KEY, JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token, t: Date.now() }));
    } catch (e) {}
  }

  /** Sessiyani tekshiradi; muddati yaqin bo'lsa yangilaydi. Brauzer fon tabda taymerni to'xtatib qo'yganida ham ishlaydi. */
  async function ensureFresh() {
    const c = sbClient();
    if (!c || window.__ssUserLogout) return;
    try {
      const r = await c.auth.getSession();                       // muddati o'tgan bo'lsa o'zi yangilaydi
      const s = r && r.data && r.data.session;
      if (!s) { await recover(); return; }
      backupSession(s);
      const left = (s.expires_at ? s.expires_at * 1000 : 0) - Date.now();
      if (left < 5 * 60 * 1000) {
        const rr = await c.auth.refreshSession();
        if (rr && rr.data && rr.data.session) backupSession(rr.data.session);
      }
    } catch (e) { /* tarmoq xatosi — keyingi urinishda */ }
  }

  let _recovering = false;
  async function recover() {
    if (_recovering || window.__ssUserLogout) return false;
    const c = sbClient(); const st = store();
    if (!c || !st) return false;
    _recovering = true;
    try {
      const raw = st.getItem(BACKUP_KEY);
      if (!raw) return false;
      const b = JSON.parse(raw);
      if (!b || !b.refresh_token) return false;
      const r = await c.auth.setSession({ access_token: b.access_token, refresh_token: b.refresh_token });
      if (r && r.data && r.data.session) {
        backupSession(r.data.session);
        safe(function () { supabaseToken = r.data.session.access_token; currentUserEmail = (r.data.session.user && r.data.session.user.email) || currentUserEmail; });
        safe(function () { if (typeof updateAuthUI === 'function') updateAuthUI(); });
        return true;
      }
    } catch (e) { console.warn('[v39] sessiya tiklanmadi', e); }
    finally { _recovering = false; }
    return false;
  }
  // v63: Telegram'dan / havola orqali ochilganda yangi sessiya bir-ikki soniyada keladi (Telegram avto-kirish, magic link).
  // Shu payt eski sessiya «tugadi» deb qizil ogohlantirish chiqardi, keyin esa hammasi ishlardi. Endi biroz kutib qayta tekshiramiz.
  function lateSession() {
    return new Promise(function (res) {
      var tries = 0;
      (function tick() {
        tries++;
        var c = null; try { c = window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null); } catch (e) {}
        if (!c) { if (tries < 8) return setTimeout(tick, 600); return res(null); }
        c.auth.getSession().then(function (r) {
          var s = r && r.data ? r.data.session : null;
          if (s || tries >= 8) return res(s || null);
          setTimeout(tick, 600);
        }, function () { if (tries >= 8) res(null); else setTimeout(tick, 600); });
      })();
    });
  }
  window.ssLateSession = lateSession;
  window.ssRecoverSession = function () {
    return recover().then(async function (ok) {
      if (!ok) {
        var s = await lateSession();
        if (s) {
          safe(function () { supabaseToken = s.access_token; currentUserEmail = (s.user && s.user.email) || currentUserEmail; window._ssAuthUid = s.user ? String(s.user.id) : ''; });
          safe(function () { if (typeof updateAuthUI === 'function') updateAuthUI(); });
          return true;
        }
        // haqiqatan tugagan (masalan refresh token bekor qilingan) — endi UI'ni chiqish holatiga o'tkazamiz
        safe(function () { supabaseToken = 'dev-token'; currentUserEmail = ''; window._ssAuthUid = ''; });
        safe(function () { if (typeof updateAuthUI === 'function') updateAuthUI(); });
        toast('Sessiya tugadi. Iltimos, qaytadan kiring.', 'error');
      }
      return ok;
    });
  };

  // sessiyani yangilash qo'riqchilari
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ensureFresh(); });
  window.addEventListener('focus', ensureFresh);
  window.addEventListener('online', ensureFresh);
  window.addEventListener('pageshow', ensureFresh);
  setInterval(ensureFresh, 4 * 60 * 1000);
  // klient yaratilgach birinchi tekshiruv va hodisalarga ulanish
  (function waitClient(n) {
    const c = sbClient();
    if (!c) { if (n < 80) setTimeout(function () { waitClient(n + 1); }, 250); return; }
    try {
      c.auth.onAuthStateChange(function (ev, s) {
        if (s && (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED' || ev === 'INITIAL_SESSION' || ev === 'USER_UPDATED')) { window.__ssUserLogout = false; backupSession(s); }
      });
    } catch (e) {}
    ensureFresh();
  })(0);

  /* =================================================================
   * 2) MEDIA → HAQIQIY FAYL (base64) — eksportdan oldin
   * ================================================================= */
  const MAX_EMBED_BYTES = 90 * 1024 * 1024;
  const ONLINE_VIDEO_RE = /(youtu\.be|youtube(?:-nocookie)?\.com|vimeo\.com|dailymotion\.com|dai\.ly)/i;
  const VIDEO_FILE_RE = /\.(mp4|webm|ogv|ogg|mov|m4v)(\?|#|$)/i;
  const IMG_KEYS = { src: 1, gifUrl: 1, _gifUrl: 1, thumb: 0 };
  const _cache = new Map();

  function blobToDataUrl(b) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('FileReader')); };
      r.readAsDataURL(b);
    });
  }
  async function urlToDataUrl(url) {
    if (_cache.has(url)) return _cache.get(url);
    const p = (async function () {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const b = await res.blob();
      if (b.size > MAX_EMBED_BYTES) throw new Error('too-big');
      let d = await blobToDataUrl(b);
      // ba'zan MIME bo'sh keladi (application/octet-stream) — baytlardan aniqlaymiz
      if (/^data:(application\/octet-stream|;base64)?/i.test(d) && !/^data:(image|video)\//i.test(d)) {
        const head = new Uint8Array(await b.slice(0, 12).arrayBuffer());
        let mime = '';
        if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) mime = 'image/gif';
        else if (head[0] === 0x89 && head[1] === 0x50) mime = 'image/png';
        else if (head[0] === 0xff && head[1] === 0xd8) mime = 'image/jpeg';
        else if (head[0] === 0x52 && head[1] === 0x49) mime = 'image/webp';
        else if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) mime = 'video/mp4';
        else if (head[0] === 0x1a && head[1] === 0x45) mime = 'video/webm';
        if (mime) d = 'data:' + mime + ';base64,' + d.split(',')[1];
      }
      return d;
    })();
    _cache.set(url, p);
    try { return await p; } catch (e) { _cache.delete(url); throw e; }
  }
  async function remoteImageToDataUrl(url) {
    // 1) mavjud proksi yordamchisi  2) to'g'ridan-to'g'ri  3) raw proksi
    try { if (typeof resolveRemoteToDataUrl === 'function') { const d = await resolveRemoteToDataUrl(url); if (d && /^data:/i.test(d)) return d; } } catch (e) {}
    try { return await urlToDataUrl(url); } catch (e) {}
    try { return await urlToDataUrl('/api/proxy-image?raw=1&url=' + encodeURIComponent(url)); } catch (e) {}
    return null;
  }

  async function convertString(v, key, parentKey, parent, st) {
    if (!v || typeof v !== 'string') return v;
    if (/^data:/i.test(v)) return v;
    // blob: har qanday kalitda — sessiyadan tashqarida ishlamaydi, albatta data: ga o'tkaziladi
    if (/^blob:/i.test(v)) {
      try { const d = await urlToDataUrl(v); st.embedded++; return d; }
      catch (e) { st.failed++; st.notes.push(e && e.message === 'too-big' ? 'katta video' : 'blob'); return v; }
    }
    const isEmbedObj = parent && (parent.isEmbed || parent.type === 'embedVideo');
    if (isEmbedObj) return v;                                    // onlayn video — havola
    const remote = /^https?:\/\//i.test(v) || /^\/api\/proxy-image/i.test(v);
    if (!remote) return v;
    if (ONLINE_VIDEO_RE.test(v) || VIDEO_FILE_RE.test(v)) return v;   // onlayn video — havola sifatida qoladi
    const isMediaKey = IMG_KEYS[key] === 1 ||
      ((key === 'url' || key === 'src') && (parentKey === 'backgroundGif' || parentKey === 'backgroundImage'));
    if (!isMediaKey) return v;
    const d = await remoteImageToDataUrl(v);
    if (d) { st.embedded++; return d; }
    st.failed++; st.notes.push('rasm');
    return v;
  }
  async function walk(node, parentKey, st) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = await walkVal(node[i], parentKey, parentKey, null, st);
    } else if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        if (k === 'thumb' || k === 'text' || k === 'fontFamily') continue;
        node[k] = await walkVal(node[k], k, parentKey, node, st);
      }
    }
  }
  async function walkVal(v, key, parentKey, parent, st) {
    if (typeof v === 'string') return convertString(v, key, parentKey, parent, st);
    if (v && typeof v === 'object') { await walk(v, key, st); return v; }
    return v;
  }

  let _embedBusy = null;
  /** Barcha slaydlardagi media'ni slayd JSON ichiga to'liq joylaydi. Qayta chaqirilsa kutadi. */
  async function embedAll(opts) {
    if (_embedBusy) return _embedBusy;
    _embedBusy = (async function () {
      const st = { embedded: 0, failed: 0, notes: [] };
      safe(function () { saveCurrentSlideState(); });
      let activeChanged = false;
      const list = safe(function () { return slides; }, []);
      for (let i = 0; i < list.length; i++) {
        if (list.length > 2) toast('Media fayl ichiga joylanmoqda… ' + (i + 1) + ' / ' + list.length);
        let p = null;
        try { p = JSON.parse(list[i].json || '{}'); } catch (e) { continue; }
        const before = st.embedded;
        await walk(p, '', st);
        let slimmed = 0;
        try { if (typeof window.ssSlimSlideJson === 'function') slimmed = await window.ssSlimSlideJson(p, st); } catch (e) { console.warn('[v43] slim', e); }
        if (st.embedded !== before || slimmed) {
          list[i].json = JSON.stringify(p);
          if (i === safe(function () { return activeIndex; }, -1)) activeChanged = true;
        }
      }
      // faol slayd kanvasdagi obyektlari ham yangi (data:) manbalarga o'tsin — aks holda keyingi saveCurrentSlideState() eski blob: ni qaytaradi
      if (activeChanged) {
        try { await loadSlideCanvasAsync(activeIndex); } catch (e) { safe(function () { loadSlideCanvas(activeIndex); }); }
        safe(function () { renderSidebar(); });
      }
      return st;
    })();
    try { return await _embedBusy; } finally { _embedBusy = null; }
  }
  window.ssEmbedAllMedia = embedAll;

  function wrapExport(name, label) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__v39) return;
    const w = async function () {
      const ctx = this, args = arguments;
      let st = null;
      try { st = await embedAll(); } catch (e) { console.warn('[v39] embed', e); }
      if (st && st.failed) {
        toast(st.failed + ' ta media faylga joylanmadi (' + Array.from(new Set(st.notes)).join(', ') + '). Qolganlari to\'liq saqlandi.', 'error');
      }
      return orig.apply(ctx, args);
    };
    w.__v39 = true;
    window[name] = w;
  }
  ['exportHTML', 'exportPDF', 'exportPPTX', 'exportProjectJSON'].forEach(function (n) { wrapExport(n); });
  // eksport funksiyalari keyin qayta e'lon qilinsa (boshqa modul) — bir marta qayta o'raymiz
  setTimeout(function () { ['exportHTML', 'exportPDF', 'exportPPTX', 'exportProjectJSON'].forEach(function (n) { wrapExport(n); }); }, 1500);

  /* Lokal video: har doim data: (60MB gacha); undan kattasi — blob (sessiya) + ogohlantirish. 15_video_anim_btn.js ham shuni qiladi. */
  const prevVid = window.fileToVideoUrlPublic;
  if (typeof prevVid === 'function' && !prevVid.__v39) {
    const nv = async function (file) {
      const r = await prevVid(file);
      if (r && /^blob:/i.test(r) && file && file.size <= MAX_EMBED_BYTES) {
        try { return await blobToDataUrl(file); } catch (e) {}
      }
      return r;
    };
    nv.__v39 = true;
    window.fileToVideoUrlPublic = nv;
  }

  /* =================================================================
   * 3) MEDIA OYNASI — barqaror, spinnerli
   * ================================================================= */
  let _busy = 0;
  let _busyKind = 'soft';           // soft: tepada yupqa chiziq; hard: butun karta ustida spinner
  function modal() { return $('mediaBrowserModal'); }
  function card() { const m = modal(); return m && m.querySelector('.media-browser-card'); }
  function ensureBusyEl() {
    const c = card();
    if (!c) return null;
    let el = c.querySelector('.ss39-busy');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ss39-busy';
      el.innerHTML = '<div class="ss39-bar"></div><div class="ss39-block"><div class="ss39-ring"></div><div class="ss39-label">Yuklanmoqda…</div></div>';
      c.appendChild(el);
    }
    return el;
  }
  function busyStart(label, hard) {
    _busy++;
    if (hard) _busyKind = 'hard';
    const el = ensureBusyEl();
    if (!el) return;
    el.classList.add('on');
    el.classList.toggle('hard', _busyKind === 'hard');
    const l = el.querySelector('.ss39-label'); if (l && label) l.textContent = label;
  }
  function busyEnd() {
    _busy = Math.max(0, _busy - 1);
    if (_busy > 0) return;
    _busyKind = 'soft';
    const el = card() && card().querySelector('.ss39-busy');
    if (el) { el.classList.remove('on'); el.classList.remove('hard'); }
  }
  function wrapBusy(name, label, hard) {
    const f = window[name];
    if (typeof f !== 'function' || f.__v39busy) return;
    const w = function () {
      busyStart(label, hard);
      let r;
      try { r = f.apply(this, arguments); } catch (e) { busyEnd(); throw e; }
      if (r && typeof r.then === 'function') return r.then(function (v) { busyEnd(); return v; }, function (e) { busyEnd(); throw e; });
      busyEnd();
      return r;
    };
    w.__v39busy = true;
    window[name] = w;
  }
  ['mediaFetchResults', 'mediaSearchOnline', 'mediaRefresh'].forEach(function (n) { wrapBusy(n, 'Qidirilmoqda…', false); });
  ['mediaPlaceUrl', 'mediaPlaceSelected', 'mediaSetAsBackground', 'mediaAddFromUrl', 'mediaHandleFiles', 'placeGifOnSlide']
    .forEach(function (n) { wrapBusy(n, 'Slaydga joylanmoqda…', true); });

  // yopish: faqat ✕ tugmasi va Esc. Tashqariga bosish yopmaydi (inline onmousedown olib tashlangan; zaxira sifatida ham to'sib qo'yamiz).
  const _origClose = window.closeMediaBrowser;
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const m = modal();
    if (m && m.style.display !== 'none' && m.style.display !== '') {
      e.preventDefault(); e.stopPropagation();
      if (typeof window.closeMediaBrowser === 'function') window.closeMediaBrowser();
    }
  }, true);
  document.addEventListener('mousedown', function (e) {
    const m = modal();
    if (m && e.target === m) { e.stopPropagation(); e.preventDefault(); }   // backdrop bosilishi hech narsa qilmaydi
  }, true);
  document.addEventListener('touchstart', function (e) {
    const m = modal();
    if (m && e.target === m) e.stopPropagation();
  }, true);
  void _origClose;

  function openMedia(tab) {
    if (typeof window.openMediaBrowser === 'function') window.openMediaBrowser(tab);
  }
  window.ssOpenMedia = openMedia;

  // --- slaydda 2 marta bosish (sichqoncha) / 2 marta tegish (telefon) → media oynasi
  function mediaOpenAllowed() {
    if (document.querySelector('.swal2-container')) return false;
    const m = modal(); if (m && m.style.display === 'flex') return false;
    const pres = $('presentationOverlay'); if (pres && pres.style.display === 'flex') return false;
    const ao = safe(function () { return canvas.getActiveObject(); }, null);
    if (ao && ao.isEditing) return false;
    return true;
  }
  function isBackdropObj(t) {
    if (!t) return true;
    if (/text/i.test(t.type || '')) return false;
    if (t.isButton || t.isEmbed || t.isGif || t.isVideo || t.type === 'gifImage' || t.type === 'videoImage' || t.type === 'embedVideo' || t.type === 'image') return false;
    const w = (t.width || 0) * (t.scaleX || 1), h = (t.height || 0) * (t.scaleY || 1);
    return w >= 960 * 0.9 && h >= 540 * 0.9;          // butun slaydni qoplagan shakl = fon
  }
  safe(function () {
    canvas.on('mouse:dblclick', function (opt) {
      const t = opt && opt.target;
      if (t && !isBackdropObj(t)) return;
      if (!mediaOpenAllowed()) return;
      openMedia();
    });
    // telefon: ikki marta tez tegish
    let lastTap = 0, lastX = 0, lastY = 0;
    const up = canvas.upperCanvasEl;
    if (up) {
      up.addEventListener('touchend', function (e) {
        if (e.touches && e.touches.length) return;
        const ch = e.changedTouches && e.changedTouches[0]; if (!ch) return;
        const now = Date.now();
        const near = Math.abs(ch.clientX - lastX) < 26 && Math.abs(ch.clientY - lastY) < 26;
        if (now - lastTap < 320 && near) {
          lastTap = 0;
          const tgt = safe(function () { return canvas.findTarget(e, false); }, null);
          if ((!tgt || isBackdropObj(tgt)) && mediaOpenAllowed()) openMedia();
        } else { lastTap = now; lastX = ch.clientX; lastY = ch.clientY; }
      }, { passive: true });
    }
  });

  // --- "/fon", "/rasm", "/gif", "/video", "/media" buyruqlari (AI maydonida) + "/" bosilganda menyu
  const COMMANDS = [
    { cmd: '/fon', tab: 'images', label: 'Fon — rasm / GIF / video qo\'yish', icon: 'wallpaper' },
    { cmd: '/rasm', tab: 'images', label: 'Onlayn rasm qo\'shish', icon: 'image' },
    { cmd: '/gif', tab: 'gifs', label: 'GIF qo\'shish', icon: 'gif_box' },
    { cmd: '/video', tab: 'videos', label: 'Video qo\'shish', icon: 'movie' },
    { cmd: '/media', tab: 'images', label: 'Rasm / GIF / video oynasi', icon: 'travel_explore' }
  ];
  function matchCommand(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t || t.charAt(0) !== '/') return null;
    return COMMANDS.find(function (c) { return t === c.cmd; }) || null;
  }
  function runCommand(c, input) {
    if (input) { input.value = ''; safe(function () { autoGrowSidebarInput(input); }); }
    hideSlashMenu();
    // mobil: AI paneli yopilsin, oyna ustida qolsin
    openMedia(c.tab);
  }
  let _menu = null;
  function hideSlashMenu() { if (_menu) _menu.classList.remove('on'); }
  function showSlashMenu(input) {
    const v = (input.value || '').trim().toLowerCase();
    if (!v || v.charAt(0) !== '/' || v.indexOf(' ') >= 0) { hideSlashMenu(); return; }
    const list = COMMANDS.filter(function (c) { return c.cmd.indexOf(v) === 0; });
    if (!list.length) { hideSlashMenu(); return; }
    if (!_menu) {
      _menu = document.createElement('div');
      _menu.className = 'ss39-slash';
      document.body.appendChild(_menu);
    }
    _menu.innerHTML = '';
    list.forEach(function (c) {
      const it = document.createElement('button');
      it.type = 'button'; it.className = 'ss39-slash-item';
      it.innerHTML = '<span class="material-symbols-outlined">' + c.icon + '</span><b>' + c.cmd + '</b><i>' + c.label + '</i>';
      it.addEventListener('mousedown', function (e) { e.preventDefault(); });
      it.addEventListener('click', function () { runCommand(c, input); });
      _menu.appendChild(it);
    });
    const r = input.getBoundingClientRect();
    _menu.style.left = Math.max(8, r.left) + 'px';
    _menu.style.width = Math.min(Math.max(240, r.width), window.innerWidth - 16) + 'px';
    _menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    _menu.classList.add('on');
  }
  function bindCommandInput() {
    const input = $('aiSidebarInput');
    if (!input || input.__v39) return !!input;
    input.__v39 = true;
    input.addEventListener('input', function () { showSlashMenu(input); });
    input.addEventListener('blur', function () { setTimeout(hideSlashMenu, 150); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        const c = matchCommand(input.value);
        if (c) { e.preventDefault(); e.stopImmediatePropagation(); runCommand(c, input); }
      } else if (e.key === 'Escape') hideSlashMenu();
    }, true);
    const btn = $('btnSidebarAi');
    if (btn) btn.addEventListener('click', function (e) {
      const c = matchCommand(input.value);
      if (c) { e.preventDefault(); e.stopImmediatePropagation(); runCommand(c, input); }
    }, true);
    return true;
  }
  (function tryBind(n) { if (!bindCommandInput() && n < 40) setTimeout(function () { tryBind(n + 1); }, 250); })(0);
  // pastki AI oynasi (mobil) uchun ham
  document.addEventListener('keydown', function (e) {
    const t = e.target;
    if (!t || t.tagName !== 'TEXTAREA' || t.id === 'aiSidebarInput') return;
    if (e.key === 'Enter' && !e.shiftKey) {
      const c = matchCommand(t.value);
      if (c && /ai|bottom/i.test(t.id || '')) { e.preventDefault(); e.stopImmediatePropagation(); runCommand(c, t); }
    }
  }, true);

  /* --- yangi qo'yilgan rasm/GIF/video miltillamasdan, yumshoq paydo bo'lsin --- */
  let _fadeUntil = 0;
  function armFade() { _fadeUntil = Date.now() + 5000; }
  ['mediaPlaceUrl', 'mediaPlaceSelected', 'placeGifOnSlide', 'placeImageDirectlyOnSlide', 'placeGifImmediate', 'mediaHandleFiles', 'mediaAddFromUrl']
    .forEach(function (n) {
      const f = window[n];
      if (typeof f !== 'function' || f.__v39fade) return;
      const w = function () { armFade(); return f.apply(this, arguments); };
      w.__v39fade = true; w.__v39busy = f.__v39busy;
      window[n] = w;
    });
  safe(function () {
    canvas.on('object:added', function (e) {
      const o = e && e.target;
      if (!o || Date.now() > _fadeUntil) return;
      const media = o.type === 'image' || o.type === 'gifImage' || o.type === 'videoImage' || o.type === 'embedVideo' || o.isGif || o.isVideo || o.isEmbed;
      if (!media || o.__v39faded) return;
      o.__v39faded = true;
      const target = (o.opacity == null ? 1 : o.opacity);
      if (target <= 0) return;
      o.set('opacity', 0);
      try {
        fabric.util.animate({
          startValue: 0, endValue: target, duration: 260,
          easing: fabric.util.ease.easeOutCubic,
          onChange: function (v) { o.set('opacity', v); canvas.requestRenderAll(); },
          onComplete: function () { o.set('opacity', target); canvas.requestRenderAll(); }
        });
      } catch (er) { o.set('opacity', target); canvas.requestRenderAll(); }
    });
  });

  /* =================================================================
   * 4) AI YOZAYOTGANDA GIF / RASM QO'RIQCHISI
   * ================================================================= */
  function gifUrlsOfDeck() {
    const out = new Set();
    safe(function () {
      (slides || []).forEach(function (s) {
        let p = null; try { p = JSON.parse(s.json || '{}'); } catch (e) { return; }
        (p.objects || []).forEach(function (o) {
          if (o && (o.isGif || o.type === 'gifImage')) { const u = o.gifUrl || o.src; if (u) out.add(u); }
        });
        if (p.backgroundGif && (p.backgroundGif.src || p.backgroundGif.url)) out.add(p.backgroundGif.src || p.backgroundGif.url);
      });
    });
    return out;
  }
  function aiBusy() {
    return !!safe(function () { return isAiStreaming || isAiApplyingCommands; }, false) || !!window.isAiStreaming || !!window.isAiApplyingCommands;
  }
  function guardTick() {
    if (document.hidden) return;
    const GP = window.GifPlayer;
    // (a) dekoder keshi: joriy taqdimotdagi GIF'lar "eng yangi ishlatilgan" bo'lib turadi → LRU ularni chiqarib yubormaydi
    if (GP && typeof GP.entryFor === 'function') {
      gifUrlsOfDeck().forEach(function (u) { safe(function () { GP.entryFor(u); }); });   // xato bo'lganlar o'zi qayta uriniladi
    }
    // (b) faol kanvasdagi GIF/rasm obyektlari
    let any = false;
    safe(function () {
      canvas.getObjects().forEach(function (o) {
        if (!o) return;
        const gif = o.isGif || o.type === 'gifImage';
        const img = o.type === 'image';
        if (!gif && !img) return;
        any = true;
        // kutilmagan "ko'rinmas" holat: visible=false / opacity=0 faqat fade animatsiyasidan tashqarida tuzatiladi
        if (gif) {
          const el = o._gifElement || o._element;
          if (el && el.tagName === 'IMG' && el.complete && el.naturalWidth === 0 && !el.__v39retry) {
            el.__v39retry = 1;                         // bir marta manbani qayta o'rnatamiz
            const u = o.gifUrl || o._gifUrl || o.src;
            if (u) { try { el.removeAttribute('crossorigin'); el.src = /^(data:|blob:|\/)/i.test(u) ? u : ('/api/proxy-image?raw=1&url=' + encodeURIComponent(u)); } catch (e) {} }
          }
          o.dirty = true;
        }
      });
    });
    // (c) AI ishlayotganda kanvas muntazam qayta chiziladi (GIF kadrlari to'xtab qolmasin)
    if (any && aiBusy()) safe(function () { canvas.requestRenderAll(); });
  }
  setInterval(guardTick, 700);
  // AI tugagach — bir marta qo'shimcha qayta chizish va kutilayotgan GIF dekodlarini kutish
  let _wasBusy = false;
  setInterval(function () {
    const b = aiBusy();
    if (_wasBusy && !b) {
      [0, 250, 900, 2200].forEach(function (d) { setTimeout(function () { safe(function () { canvas.requestRenderAll(); }); guardTick(); }, d); });
    }
    _wasBusy = b;
  }, 300);

  /* AI matni yozilayotganda sahifa qayta hisoblanishini kamaytirish: sidebarni alohida qatlamga ajratish (CSS: v39.css) */
  document.documentElement.classList.add('ss39-ready');

})();
