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

  // v81: imzo slayd JSON'ining TO'LIQ xeshi. Avval ~400 ta belgi tanlab olinardi — kichik o'zgarish (matn, joy)
  // ko'pincha sezilmay, namoyish ESKI holatni ko'rsatardi. Har slayd uchun natija eslab qolinadi (qayta hisob yo'q).
  var sigMemo = new WeakMap();
  function jsonHash(s) {
    var j = String(s.json || ''), m = sigMemo.get(s);
    if (m && m.j === j) return m.h;
    var h = 2166136261;
    for (var i = 0; i < j.length; i++) h = Math.imul(h ^ j.charCodeAt(i), 16777619);
    h = (h >>> 0).toString(36) + ':' + j.length;
    sigMemo.set(s, { j: j, h: h });
    return h;
  }
  function slideSig() {
    var parts = [String((window.slides || slides).length)];
    (window.slides || slides).forEach(function (s) {
      parts.push(jsonHash(s) + ':' + (s.transition || '') + ':' + (s.transDur || 0) + ':' + (s.transAuto || 0));
    });
    return parts.join('|');
  }

  // v81: GIF / rasm / video namoyishda QAYTA YUKLANMAYDI. Muharrirning MediaRAM xotirasida bor media — tayyor blob
  // nusxasi bilan beriladi (iframe internetga bormaydi); yo'qlari fonda xotiraga olinadi — keyingi safar darhol.
  // Avval har tahrirdan keyin namoyish butunlay qayta qurilib, barcha GIF'lar qaytadan yuklanardi (telefonda uzoq).
  function mediaFromRam(list) {
    var R = window.MediaRAM, urls = [], all = [];
    if (!R || typeof R.peek !== 'function') return { all: all, missing: urls };
    (function walk(n, depth) {
      if (!n || typeof n !== 'object' || depth > 8) return;
      Object.keys(n).forEach(function (k) {
        var v = n[k];
        if (k === 'text') return;
        if (typeof v === 'string') {
          if (!/^(https?:|\/api\/proxy-image)/i.test(v)) return;
          var hit = null; try { hit = R.peek(v); } catch (e) {}
          all.push(v);
          if (hit && hit.objectUrl) n[k] = hit.objectUrl;
          else urls.push(v);
        } else if (v && typeof v === 'object') walk(v, depth + 1);
      });
    })(list, 0);
    return { all: all, missing: urls };
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
    try {
      var med = mediaFromRam(parsed);                        // nusxa (parsed) o'zgaradi, slaydlarning o'zi emas
      if (med.all.length && window.MediaRAM) {
        try { MediaRAM.setPinned(med.all); } catch (e) {}    // namoyish media'si xotiradan chiqarib yuborilmasin
        if (med.missing.length) { try { MediaRAM.warm(med.missing); } catch (e) {} }
      }
    } catch (e) {  }
    var sprites = {};
    try { if (window.ssBuildSprites) sprites = await window.ssBuildSprites(parsed); } catch (e) {  }
    window.__ssPresData = {
      project: { title: (typeof projectTitle === 'string' ? projectTitle : ''), slides: list.map(function (s) { return { json: s.json, transition: s.transition || '', transDur: s.transDur || 0, transAuto: s.transAuto || 0 }; }) },
      slides: parsed, sprites: sprites
    };
    var anim = ''; try { var ae = $('ssAnimStyle'); if (ae) anim = (ae.textContent || '').replace(/<\/style/gi, ''); } catch (e) {  }
    var html = '<!DOCTYPE html><html lang="uz" translate="no" class="notranslate"><head><meta charset="UTF-8"><meta name="google" content="notranslate"><base href="' + location.href.split('#')[0].replace(/"/g, '') + '">' +
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
  // DRAFT (auto-save): the deck survives a reload, a phone browser restart and the trip to the payment page.
  // One draft PER ACCOUNT (key = Supabase user id, or 'guest'), so another person on this browser never gets it.
  // It is deleted only when the user confirms «Akkauntdan chiqish» (handleLogout -> ssClearSavedProject).
  // IndexedDB (not localStorage): slides with images are far bigger than localStorage's ~5 MB, and the storage
  // lock in index.html keeps localStorage for the login token only.
  var DB_NAME = 'slide-studio-v40', STORE = 'project';
  function draftKey(uid) {
    var u = (uid != null) ? uid : (window._ssAuthUid || '');
    return 'draft:' + (u ? String(u) : 'guest');
  }
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
  function idbGet(key) { return openDb().then(function (db) { return new Promise(function (res, rej) { var r = db.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { rej(r.error); }; }); }); }
  function idbPut(key, v) { return openDb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, key); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); }); }
  function idbDel(key) { return openDb().then(function (db) { return new Promise(function (res) { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key); tx.oncomplete = res; tx.onerror = res; }); }); }

  // blob: URL -> data: URL cache. Before, entries were never removed: every converted video/image stayed in RAM
  // as a base64 string for the whole session (also after the media was deleted from the slides).
  // Now only the URLs still used by the deck are kept (pruned after every save), and very big files are
  // not converted at all (they are session-only anyway, see fileToVideoUrl in 15_video_anim_btn.js).
  var MAX_PERSIST_BLOB = 60 * 1024 * 1024;
  var blobMap = new Map(), blobSeen = null;
  async function blobToData(u) {
    if (blobSeen) blobSeen.add(u);
    if (blobMap.has(u)) return blobMap.get(u);
    var p = fetch(u).then(function (r) { return r.blob(); }).then(function (b) {
      if (!b || b.size > MAX_PERSIST_BLOB) return null;
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); });
    }).catch(function () { return null; });
    blobMap.set(u, p); return p;
  }
  function pruneBlobMap() {
    if (!blobSeen) return;
    blobMap.forEach(function (_v, k) { if (!blobSeen.has(k)) blobMap.delete(k); });
    blobSeen = null;
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
  // A slide whose JSON has no blob: URL is saved as the same string: no JSON.parse + JSON.stringify of
  // every slide on every save (with inline images/videos that was tens of MB of work every 3.5 s).
  async function slideJsonForSave(j) {
    j = String(j || '{}');
    if (j.indexOf('blob:') < 0) return j;
    var p = {}; try { p = JSON.parse(j); } catch (e) { return j; }
    await detachBlobs(p, 0);
    return JSON.stringify(p);
  }

  /** v72: muharrir hali boshlang'ich holatda — bitta slayd, faqat «Sarlavha kiriting» kabi namuna matn, oq fon.
   *  Bunday holat saqlanmaydi (chiqishdan keyin yoki yangi akkauntda «bo'sh slayd» qoralama bo'lib qolmasin). */
  function isPristineDeck() {
    try {
      if (!Array.isArray(slides) || slides.length !== 1) return false;
      var ph = function (s) { s = String(s == null ? '' : s).trim(); return !s || !!(window.SSI18n && SSI18n.isPlaceholder && SSI18n.isPlaceholder(s)); };
      if (typeof projectTitle === 'string' && !ph(projectTitle)) return false;
      if (slides[0].transition) return false;
      var p = JSON.parse(slides[0].json || '{}');
      if (p.backgroundImage || p.backgroundGif || p.backgroundVideo) return false;
      var bg = String(p.background || '#ffffff').replace(/\s+/g, '').toLowerCase();
      if (['#ffffff', '#fff', 'white', 'rgb(255,255,255)', ''].indexOf(bg) < 0) return false;
      return (p.objects || []).every(function (o) {
        return !o || ((o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') && ph(o.text));
      });
    } catch (e) { return false; }
  }
  window.ssIsPristineDeck = isPristineDeck;
  var savedKeys = {};                 // shu sessiyada haqiqatan saqlangan qoralamalar (faqat shularni o'chirish mumkin)

  var lastSavedSig = '', saving = false;
  // v79: 2 AKKAUNT XAVFSIZLIGI. Ekrandagi slaydlar qaysi akkauntga tegishli — shu yerda eslanadi. Boshqa akkauntga
  // o'tilganda (sahifa qayta yuklanguncha bo'lgan 80 ms ichida «pagehide» avto-saqlashni chaqirardi) A akkauntning
  // slaydlari B akkaunt qoralamasiga yozilib qolardi. Endi: egasi boshqa bo'lsa — HECH NARSA yozilmaydi.
  // Istisno: mehmon -> akkaunt (mehmon slaydlari kirgandan keyin akkauntga o'tadi — 45_v63_guest_carry.js).
  var ownerKey = '';
  function aiBusy() { return !!(window.isAiApplyingCommands || window.isAiStreaming || safe(function () { return isAiApplyingCommands || isAiStreaming; }, false)); }
  function canvasBusy() { return safe(function () { return !!(canvas && (canvas._currentTransform || (canvas.getActiveObject && canvas.getActiveObject() && canvas.getActiveObject().isEditing))); }, false) || safe(function () { return !!_switchBusy; }, false); }
  setTimeout(function () { window.__ssRestoreChecked = true; }, 12000);
  var armedAt = Date.now() + 8000;   // ishga tushgandan keyin 8 soniya saqlanmaydi (tiklash tugashi uchun)
  async function persistNow(force) {
    if (saving || typeof indexedDB === 'undefined') return;
    if (window.__ssUserLogout || window.__ssAcctSwitch) return; // logging out / switching account: nothing is written
    if (!window.__ssRestoreChecked || (!force && Date.now() < armedAt)) return;
    if (!slides || !slides.length) return;
    if (safe(function () { return Date.now() < _canvasLoadingUntil; }, false)) return;   // half-loaded canvas: never save it
    if (!force && (aiBusy() || canvasBusy())) return;
    saving = true;
    try {
      if (!canvasBusy()) safe(function () { saveCurrentSlideState(); });
      var key = draftKey();
      if (ownerKey && ownerKey !== key && ownerKey !== draftKey('')) return;   // v79: begona akkauntga yozilmaydi
      ownerKey = key;
      var list = slides, sig = key + '|' + slideSig() + '|' + (typeof projectTitle === 'string' ? projectTitle : '') + '|' + activeIndex;
      if (sig === lastSavedSig) return;
      if (isPristineDeck()) {
        // foydalanuvchi o'zi hammasini tozalagan bo'lsa — eski qoralama ham qolmasin; boshqa holatda hech narsa yozilmaydi
        if (savedKeys[key]) { await idbDel(key); delete savedKeys[key]; }
        lastSavedSig = sig;
        return;
      }
      var out = [];
      blobSeen = new Set();
      for (var i = 0; i < list.length; i++) {
        out.push({ json: await slideJsonForSave(list[i].json), thumb: list[i].thumb || '', imageNumbers: list[i].imageNumbers || [], transition: list[i].transition || '',
                   transDur: list[i].transDur || 0, transAuto: list[i].transAuto || 0, bgType: list[i].bgType, bgVal: list[i].bgVal });
      }
      if (window.__ssUserLogout) return;
      pruneBlobMap();
      await idbPut(key, { v: 2, owner: key, title: projectTitle, activeIndex: activeIndex, slides: out, savedAt: Date.now() });
      savedKeys[key] = true;
      lastSavedSig = sig;
    } catch (e) { console.warn('[v40] saqlash:', e); }
    finally { saving = false; blobSeen = null; }
  }
  setInterval(function () { if (document.visibilityState === 'visible') persistNow(false); }, 3500);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') persistNow(true); });
  window.addEventListener('pagehide', function () { persistNow(true); });
  window.ssPersistNow = function () { return persistNow(true); };
  /** v82.3: true = there are edits the auto-saved draft does not have yet («Saytdan chiqasizmi?» only then) */
  window.ssDraftDirty = function () {
    try {
      if (!canvasBusy()) safe(function () { saveCurrentSlideState(); });
      var key = draftKey();
      if (ownerKey && ownerKey !== key && ownerKey !== draftKey('')) return false;     // not this account's draft
      if (isPristineDeck()) return false;
      var sig = key + '|' + slideSig() + '|' + (typeof projectTitle === 'string' ? projectTitle : '') + '|' + activeIndex;
      if (sig === lastSavedSig) return false;
      persistNow(true);                         // try to save now (the user may press «Cancel» and stay)
      return true;
    } catch (e) { return true; }
  };
  /** v79: shu akkauntning qoralamasi qachon saqlangan (ms, yo'q bo'lsa 0) — 36_v45_tgdeck.js «eng oxirgisi» uchun */
  window.ssDraftSavedAt = async function () {
    try { var rec = await pTimeoutP(idbGet(draftKey()), 3000); return (rec && rec.owner === draftKey() && +rec.savedAt) || 0; }
    catch (e) { return 0; }
  };
  /** Logout (confirmed): this account's draft + the guest draft are deleted. The old single 'current' key too. */
  window.ssClearSavedProject = function (uid) {
    lastSavedSig = '';
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    return Promise.all([idbDel(draftKey(uid)), idbDel(draftKey('')), idbDel('current')]).catch(function () {});
  };

  /** 03_auth_project.js: initProjectFromUrl() calls this AFTER the account is known (appInit awaits the auth). */
  window.ssLoadSavedProject = async function () {
    window.__ssRestoreChecked = true;
    armedAt = Date.now() + 4000;
    if (typeof indexedDB === 'undefined') return null;
    // a fresh guest deck carried through the Google login wins (45_v63_guest_carry.js restores it)
    try { if (window.__ssAuthStorage && window.__ssAuthStorage.getItem('ss-auth-v39-guest')) return null; } catch (e) {}
    try {
      ownerKey = draftKey();
      var rec = await pTimeoutP(idbGet(draftKey()), 3000);
      if (!rec || rec.owner !== draftKey() || !Array.isArray(rec.slides) || !rec.slides.length) return null;
      lastSavedSig = '';
      window.__ssDraftSavedAt = +rec.savedAt || 0;               // v79: Mini App — botdagi taqdimot yangiroqmi?
      return rec;
    } catch (e) { return null; }
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
