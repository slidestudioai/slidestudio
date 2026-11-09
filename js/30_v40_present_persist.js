/* Slide Studio v40 — (1) Namoyish: jonli GIF/video/animatsiya, oldindan yuklash, keshda saqlash
 *                    (2) Brauzerni yopib ochganda loyiha tiklanadi (IndexedDB)
 *                    (3) Chap panel miniatyuralari harakatsiz
 *                    (4) Eksport ogohlantirishlari
 * Namoyish eksport qilinadigan HTML bilan BIR XIL ko'rsatgich (29_v40_html_export.js) yordamida ishlaydi.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function toast(m, k) { try { showToast(m, k); } catch (e) {  } }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  // =====================================================================
  // 1) NAMOYISH
  // =====================================================================
  var cache = { frame: null, sig: '', ready: false, booting: null };
  var presOpen = false, skipRequested = false;

  function slideSig() {
    var parts = [String((window.slides || slides).length)];
    (window.slides || slides).forEach(function (s) {
      var j = String(s.json || ''), n = j.length, h = n;
      var step = Math.max(1, Math.floor(n / 400));
      for (var i = 0; i < n; i += step) h = ((h * 31) + j.charCodeAt(i)) | 0;
      parts.push(n + ':' + h);
    });
    return parts.join('|');
  }

  function collectHeadAssets() {
    var out = '';
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      if (/fonts\.googleapis\.com/.test(l.href || '')) out += '<link rel="stylesheet" href="' + l.href + '">';
    });
    document.querySelectorAll('style').forEach(function (st) {
      var t = st.textContent || '';
      if (/@font-face/.test(t) && t.length < 3e6) out += '<style>' + t.replace(/<\/style/gi, '') + '</style>';
    });
    return out;
  }

  function prepOverlay() {
    var o = $('ssPrepOverlay');
    if (!o) {
      o = document.createElement('div'); o.id = 'ssPrepOverlay';
      o.innerHTML = '<div class="ss-prep-card"><div class="ss-prep-title">Taqdimot tayyorlanmoqda…</div>' +
        '<div class="ss-prep-sub">Rasm, GIF, video va YouTube oldindan yuklanmoqda — namoyish qotmasdan ishlaydi</div>' +
        '<div class="ss-prep-track"><div class="ss-prep-fill"></div></div><div class="ss-prep-num">0%</div>' +
        '<button type="button" class="ss-prep-skip">Kutmasdan boshlash</button></div>';
      document.body.appendChild(o);
    }
    return o;
  }
  function setProgress(done, total) {
    var o = prepOverlay(), p = total ? Math.min(100, Math.round(done / total * 100)) : 100;
    var f = o.querySelector('.ss-prep-fill'), n = o.querySelector('.ss-prep-num');
    if (f) f.style.width = p + '%'; if (n) n.textContent = p + '%  (' + done + '/' + total + ')';
  }

  function destroyFrame() {
    if (cache.frame && cache.frame.parentNode) cache.frame.parentNode.removeChild(cache.frame);
    cache = { frame: null, sig: '', ready: false, booting: null };
  }

  async function buildFrame() {
    try { saveCurrentSlideState(); } catch (e) {  }
    var list = (window.slides || slides);
    var parsed = list.map(function (s) { try { return JSON.parse(s.json || '{}'); } catch (e) { return {}; } });
    var sprites = {};
    try { if (window.ssBuildSprites) sprites = await window.ssBuildSprites(parsed); } catch (e) {  }
    window.__ssPresData = {
      project: { title: (typeof projectTitle === 'string' ? projectTitle : ''), slides: list.map(function (s) { return { json: s.json, transition: s.transition || '' }; }) },
      slides: parsed, sprites: sprites
    };
    var anim = ''; try { var ae = $('ssAnimStyle'); if (ae) anim = (ae.textContent || '').replace(/<\/style/gi, ''); } catch (e) {  }
    var html = '<!DOCTYPE html><html lang="uz"><head><meta charset="UTF-8"><base href="' + location.href.split('#')[0].replace(/"/g, '') + '">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' + collectHeadAssets() +
      '<style>' + anim + '\n' + (window.ssViewerCss || '') + '\nhtml,body{background:#000}#app{background:#0f0f12}</style></head><body>' +
      window.ssViewerShellHtml(parsed.length, true, false) +
      '<script>window.__SS_EMBED=true;<\/script><script>' + window.ssViewerRuntimeSource().replace(/<\/script/gi, '<\\/script') + '<\/script></body></html>';
    var fr = document.createElement('iframe');
    fr.id = 'presViewerFrame';
    fr.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    fr.setAttribute('allowfullscreen', '');
    fr.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;visibility:hidden;z-index:5';
    fr.srcdoc = html;
    return fr;
  }

  function api() { return cache.frame && cache.frame.contentWindow && cache.frame.contentWindow.__ssPres; }

  function whenFrameLoaded(fr) {
    return new Promise(function (res) {
      if (fr.contentWindow && fr.contentWindow.__ssPres) return res();
      fr.addEventListener('load', function () { res(); }, { once: true });
    });
  }

  /** Viewerni tayyorlaydi (iframe + oldindan yuklash). Allaqachon tayyor bo'lsa — darhol. */
  async function ensureReady(visibleProgress) {
    var sig = slideSig();
    if (cache.frame && cache.sig === sig) {
      if (cache.ready) return true;
      if (cache.booting) { await cache.booting; return true; }
    } else if (cache.frame) {
      destroyFrame();
    }
    var ov = $('presentationOverlay');
    var fr = await buildFrame();
    cache.frame = fr; cache.sig = sig; cache.ready = false;
    ov.appendChild(fr);
    cache.booting = (async function () {
      await whenFrameLoaded(fr);
      var a = fr.contentWindow.__ssPres;
      await new Promise(function (res) {
        var h = function (ev) { if (ev.source === fr.contentWindow && ev.data && ev.data.ss === 'ready') { window.removeEventListener('message', h); res(); } };
        window.addEventListener('message', h);
        a.boot(0);
        if (skipRequested) a.skip();
      });
      cache.ready = true;
      try { a.pause(); } catch (e) {  }
    })();
    await cache.booting;
    return true;
  }

  async function startPresentationV40() {
    if (presOpen) return;
    var ov = $('presentationOverlay'); if (!ov) return;
    presOpen = true; skipRequested = false;
    try { saveCurrentSlideState(); } catch (e) {  }
    var needBuild = !(cache.frame && cache.ready && cache.sig === slideSig());
    var po = null;
    if (needBuild) {
      po = prepOverlay(); setProgress(0, 1); po.classList.add('show');
      po.querySelector('.ss-prep-skip').onclick = function () { skipRequested = true; var a = api(); if (a) a.skip(); };
    }
    ov.classList.add('pres-v40');
    // v42: muharrirning eski tugmalari (o'tkazish/X) HECH QACHON ko'rinmasin — faqat ko'rsatgichning o'z tugmalari qoladi
    try { Array.prototype.forEach.call(ov.querySelectorAll('.pres-controls,.close-pres-btn'), function (n) { n.style.setProperty('display', 'none', 'important'); }); } catch (e) {  }
    ov.style.display = 'flex'; ov.style.background = '#000';
    if (needBuild) { ov.style.visibility = 'hidden'; }   // tayyor bo'lguncha qora oyna ko'rinmasin
    try {
      var progress = function (ev) { if (cache.frame && ev.source === cache.frame.contentWindow && ev.data && ev.data.ss === 'progress') setProgress(ev.data.done, ev.data.total); };
      window.addEventListener('message', progress);
      await ensureReady(true);
      window.removeEventListener('message', progress);
    } catch (e) { console.warn('[v40] namoyish tayyorlash:', e); }
    if (po) po.classList.remove('show');
    ov.style.visibility = '';
    if (!presOpen) return;
    cache.frame.style.visibility = 'visible';
    var a = api(); if (a) { a.restart(0); try { cache.frame.contentWindow.focus(); } catch (e) {  } }
  }

  function closePresentationV40() {
    var ov = $('presentationOverlay');
    presOpen = false;
    var po = $('ssPrepOverlay'); if (po) po.classList.remove('show');
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {  }
    try { var a = api(); if (a) a.pause(); } catch (e) {  }
    if (ov) { ov.style.display = 'none'; ov.style.visibility = ''; }
    try { if (cache.frame) cache.frame.style.visibility = 'hidden'; } catch (e) {  }
  }
  function nextV40() { var a = api(); if (a && presOpen) a.next(); }
  function prevV40() { var a = api(); if (a && presOpen) a.prev(); }

  window.startPresentation = startPresentationV40;
  window.closePresentation = closePresentationV40;
  window.nextPresentationSlide = nextV40;
  window.prevPresentationSlide = prevV40;
  window.ssPrewarmPresentation = function () { if (!presOpen && (!cache.ready || cache.sig !== slideSig())) { ensureReady(false).catch(function () {}); } };

  window.addEventListener('message', function (ev) {
    if (cache.frame && ev.source === cache.frame.contentWindow && ev.data && ev.data.ss === 'close') closePresentationV40();
  });
  // Namoyish tugmasi ustiga kelganda — fonda oldindan tayyorlab qo'yamiz (bosilganda darhol ochiladi)
  document.addEventListener('pointerover', function (e) {
    var t = e.target && e.target.closest && e.target.closest('.btn-slideshow'); if (t && !t.__ssw) { t.__ssw = true; setTimeout(function () { t.__ssw = false; }, 4000); window.ssPrewarmPresentation(); }
  }, { passive: true });

  // =====================================================================
  // 2) DOIMIY SAQLASH (IndexedDB) — brauzer yopilib ochilganda ham tayyor turadi
  // =====================================================================
  var DB_NAME = 'slide-studio-v40', STORE = 'project', KEY = 'current';
  var dbp = null;
  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      try {
        var rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  function idbGet() { return openDb().then(function (db) { return new Promise(function (res, rej) { var r = db.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { rej(r.error); }; }); }); }
  function idbPut(v) { return openDb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, KEY); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); }); }
  function idbDel() { return openDb().then(function (db) { return new Promise(function (res) { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(KEY); tx.oncomplete = res; tx.onerror = res; }); }); }

  var blobMap = new Map();
  async function blobToData(u) {
    if (blobMap.has(u)) return blobMap.get(u);
    var p = fetch(u).then(function (r) { return r.blob(); }).then(function (b) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); }); }).catch(function () { return null; });
    blobMap.set(u, p); return p;
  }
  async function detachBlobs(node, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return;
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = node[k];
      if (typeof v === 'string') { if (/^blob:/i.test(v)) { var d = await blobToData(v); if (d) node[k] = d; } }
      else if (v && typeof v === 'object') await detachBlobs(v, depth + 1);
    }
  }

  var lastSavedSig = '', saving = false;
  function aiBusy() { return !!(window.isAiApplyingCommands || window.isAiStreaming || safe(function () { return isAiApplyingCommands || isAiStreaming; }, false)); }
  function canvasBusy() { return safe(function () { return !!(canvas && (canvas._currentTransform || (canvas.getActiveObject && canvas.getActiveObject() && canvas.getActiveObject().isEditing))); }, false) || safe(function () { return !!_switchBusy; }, false); }
  setTimeout(function () { window.__ssRestoreChecked = true; }, 12000);
  var armedAt = Date.now() + 8000;   // ishga tushgandan keyin 8 soniya saqlanmaydi (tiklash tugashi uchun)
  async function persistNow(force) {
    // v48: faqat OXIRGI loyiha saqlanadi (bitta kalit 'current'); «Rasmni tozalash» bosilganda yangisi eskisini almashtiradi
    return;                                   // v49: sayt hech narsani saqlamaydi — har safar 0 dan
    if (saving || typeof indexedDB === 'undefined') return;
    if (!window.__ssRestoreChecked || Date.now() < armedAt) return;
    if (!slides || !slides.length) return;
    if (!force && (aiBusy() || canvasBusy())) return;
    saving = true;
    try {
      if (!canvasBusy()) safe(function () { saveCurrentSlideState(); });
      var list = slides, sig = slideSig() + '|' + (typeof projectTitle === 'string' ? projectTitle : '') + '|' + activeIndex;
      if (sig === lastSavedSig) return;
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var p = {}; try { p = JSON.parse(list[i].json || '{}'); } catch (e) { p = {}; }
        await detachBlobs(p, 0);
        out.push({ json: JSON.stringify(p), thumb: list[i].thumb || '', imageNumbers: list[i].imageNumbers || [], transition: list[i].transition || '' });
      }
      await idbPut({ v: 1, title: projectTitle, activeIndex: activeIndex, slides: out, savedAt: Date.now() });
      lastSavedSig = sig;
    } catch (e) { console.warn('[v40] saqlash:', e); }
    finally { saving = false; }
  }
  setInterval(function () { if (document.visibilityState === 'visible') persistNow(false); }, 3500);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') persistNow(true); });
  window.addEventListener('pagehide', function () { persistNow(true); });
  window.ssPersistNow = function () { return persistNow(true); };
  window.ssClearSavedProject = function () { return idbDel(); };

  /** 03_auth_project.js: initProjectFromUrl() ishga tushishida chaqiriladi */
  window.ssLoadSavedProject = async function () {
    // v48: oxirgi saqlangan loyiha tiklanadi (faqat bitta). Xato bo'lsa — toza yangi loyiha.
    window.__ssRestoreChecked = true;
    try { if (typeof indexedDB !== 'undefined') await pTimeoutP(idbDel(), 3000); } catch (e) {}   // v49: eski saqlanganini ham o'chiramiz
    return null;
  };
  function pTimeoutP(p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]); }

  // =====================================================================
  // 3) CHAP PANEL: miniatyuralar harakatsiz (GIF birinchi kadr), sakrash yo'q
  // =====================================================================
  function freezeImg(img) {
    if (!img || img.__ssFrozen) return;
    img.__ssFrozen = true;
    var run = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) return;
        var k = Math.min(1, 480 / Math.max(w, h)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        img.src = c.toDataURL('image/png');
      } catch (e) {  }
    };
    if (img.complete && img.naturalWidth) run(); else img.addEventListener('load', run, { once: true });
  }
  function freezeAllThumbs(root) {
    (root || document).querySelectorAll('#sidebar .slide-thumb-bg-gif img, #sidebar .thumb-gif-item img').forEach(freezeImg);
  }
  function startThumbFreezer() {
    var sb = $('sidebar'); if (!sb) return setTimeout(startThumbFreezer, 500);
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { freezeAllThumbs(sb); }, 60); }).observe(sb, { childList: true, subtree: true });
    freezeAllThumbs(sb);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startThumbFreezer); else startThumbFreezer();

})();
