/* =====================================================================
 * 26_v38_input.js (v38) — nusxalash / joylashtirish / tashlash (drag & drop) — yagona mantiq
 *
 * Qoida: slaydga HAR DOIM ENG SO'NGGI nusxalangan narsa tushadi.
 *   • Sayt ichida nusxalanganda tizim clipboard'iga maxsus belgi (MIME) yoziladi.
 *   • Joylashtirishda clipboard'da shu belgi bor bo'lsa — ichki obyekt; yo'q bo'lsa (Telegram, brauzer, papka...) — tashqi
 *     (fayl / rasm / GIF / video / HTML ichidagi rasm / havola / matn).
 *   • Ctrl+C / Ctrl+V endi bekor qilinmaydi — brauzerning haqiqiy copy/paste hodisalari ishlatiladi.
 * ===================================================================== */
(function () {
  'use strict';
  const MARK = 'application/x-slide-studio-obj';
  let copySeq = 0;
  let inCopy = false;

  function toast(m, k) { try { showToast(m, k); } catch (e) {} }
  function isTextTarget(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }
  function modalOpen() {
    return !!document.querySelector('.swal2-container, .modal-overlay[style*="flex"], .media-browser-overlay.show, #mediaBrowserModal[style*="flex"], #colorModal[style*="flex"]');
  }
  function activeText() {
    const o = canvas.getActiveObject();
    return o && /text/i.test(o.type || '') ? (o.text || '') : '';
  }
  function editingText() { const o = canvas.getActiveObject(); return !!(o && o.isEditing); }

  // ---------------------------------------------------------------- COPY / CUT
  function doInternalCopy() {
    const o = canvas.getActiveObject();
    if (!o) return false;
    if (typeof copyObject === 'function') copyObject();
    copySeq++;
    window.__ssCopyId = copySeq;
    return true;
  }
  function writeMarker(e) {
    e.clipboardData.setData(MARK, String(window.__ssCopyId));
    const t = activeText();
    if (t) e.clipboardData.setData('text/plain', t);
    e.preventDefault();
  }
  document.addEventListener('copy', function (e) {
    if (inCopy || isTextTarget(e.target) || editingText() || modalOpen()) return;
    if (!doInternalCopy()) return;
    writeMarker(e);
  }, true);
  document.addEventListener('cut', function (e) {
    if (isTextTarget(e.target) || editingText() || modalOpen()) return;
    if (!doInternalCopy()) return;
    writeMarker(e);
    setTimeout(function () { try { deleteSelected(); } catch (x) {} }, 30);
  }, true);

  // v63: telefon / planshet / Telegram Mini App — sensorli ekran
  function isTouchUi() {
    try {
      return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || window.innerWidth <= 900 ||
        !!(window.Telegram && Telegram.WebApp && Telegram.WebApp.initData);
    } catch (e) { return false; }
  }
  window.ssIsTouchUi = isTouchUi;

  /** Menyu/tugmadan "Nusxalash": eski funksiya + haqiqiy tizim clipboard'iga belgi yozish */
  const _origCopy = window.copyObject;
  window.copyObject = function () {
    if (typeof _origCopy === 'function') _origCopy.apply(this, arguments);
    if (inCopy) return;
    // v63: telefonda tizim clipboard'iga majburan yozish (execCommand) katta rasm/GIF bilan ilovani qotirardi va xato berardi
    if (isTouchUi()) { copySeq++; window.__ssCopyId = copySeq; return; }
    copySeq++; window.__ssCopyId = copySeq;
    inCopy = true;
    const once = function (e) {
      document.removeEventListener('copy', once, true);
      try { writeMarker(e); } catch (x) {}
    };
    document.addEventListener('copy', once, true);
    try { document.execCommand('copy'); } catch (x) {}
    document.removeEventListener('copy', once, true);
    inCopy = false;
  };

  /** v63: menyudagi «Nusxalash». Telefonda FAQAT matn nusxalanadi (rasm/GIF/video nusxasi telefonda qiyin va xato berardi). */
  window.ssMenuCopy = function () {
    let o = null;
    try { o = canvas.getActiveObject(); } catch (e) {}
    if (!isTouchUi()) { window.copyObject(); return; }
    const t = o && /text/i.test(o.type || '') ? String(o.text || '') : '';
    if (!t) {
      toast(o ? 'Telefonda faqat matnni nusxalash mumkin. Rasm yoki shaklni takrorlash uchun uni tanlab media panelidagi «⧉ Nusxa» tugmasidan foydalaning.'
              : 'Avval nusxalanadigan matnni tanlang.', 'error');
      return;
    }
    try { if (typeof _origCopy === 'function') _origCopy(); } catch (e) {}
    copySeq++; window.__ssCopyId = copySeq;
    let done = false;
    const ok = function () { if (!done) { done = true; toast('Matn nusxalandi'); } };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, ok);
      else ok();
    } catch (e) { ok(); }
    try { document.querySelectorAll('.context-menu, .dropdown-menu').forEach(function (m) { m.style.display = 'none'; }); } catch (e) {}
  };

  // ---------------------------------------------------------------- tashqi mazmunni slaydga qo'yish
  function fileToDataUrl(file) {
    return new Promise(function (res, rej) { const r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(file); });
  }
  const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)(\?|#|$)/i;
  const VID_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)(\?|#|$)/i;
  function isMediaFile(f) { return /^(image|video)\//.test(f.type || '') || /\.(gif|png|jpe?g|webp|bmp|avif|mp4|webm|ogg|ogv|mov|m4v)$/i.test(f.name || ''); }
  function isImportFile(f) { return /\.(pptx|pdf|html?)$/i.test(f.name || ''); }
  function isUrl(s) { return /^https?:\/\/\S+$/i.test((s || '').trim()); }
  function nextNum() { return typeof assignNextImageNumber === 'function' ? assignNextImageNumber() : (++globalImageCounter); }
  function nextOid() { return typeof nextObjectId === 'function' ? nextObjectId() : Date.now(); }

  async function placeFile(file, pos) {
    const isVideo = /^video\//.test(file.type || '') || /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(file.name || '');
    const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name || '');
    const sk = window.ssShowSkeleton ? window.ssShowSkeleton({ kind: isVideo ? 'video' : (isGif ? 'gif' : 'image'), left: pos.left, top: pos.top, width: 360, height: 240 }) : null;
    try {
      if (isVideo) {
        const vu = await fileToVideoUrlPublic(file);
        if (vu) await VideoKit.addToActive({ url: vu, left: pos.left, top: pos.top });
        return;
      }
      const data = await fileToDataUrl(file);
      if (isGif && typeof placeGifImmediate === 'function') {
        const num = nextNum();
        placeGifImmediate(activeIndex, { left: pos.left, top: pos.top, width: 360, height: 240 }, data, num, nextOid());
        toast('#' + num + '-GIF joylashtirildi');
      } else {
        await placeImageDirectlyOnSlide(data, { left: pos.left, top: pos.top });
      }
    } catch (err) {
      toast('Fayl joylashtirilmadi: ' + ((err && err.message) || 'xatolik'), 'error');
    } finally { if (sk) sk.remove(); }
  }

  window.ssPlaceFile = placeFile;   // v46: botdan kelgan rasm/video shu orqali slaydga qo'yiladi

  async function placeUrl(url, pos) {
    url = url.trim();
    if (typeof VideoKit !== 'undefined' && VideoKit.isVideoUrl(url) && !/\.gif(\?|#|$)/i.test(url)) {
      return VideoKit.addToActive({ url: url, left: pos.left, top: pos.top });
    }
    const gif = /\.gif(\?|#|$)/i.test(url) || /(^|\.)(tenor|giphy)\.com\//i.test(url);
    const sk = window.ssShowSkeleton ? window.ssShowSkeleton({ kind: gif ? 'gif' : 'image', left: pos.left, top: pos.top, width: 360, height: 240, url: url }) : null;
    try {
      if (gif && typeof placeGifImmediate === 'function') {
        placeGifImmediate(activeIndex, { left: pos.left, top: pos.top, width: 360, height: 240 }, url, nextNum(), nextOid());
      } else {
        let data = url;
        try { data = await resolveRemoteToDataUrl(url); } catch (e) { data = url; }
        await placeImageDirectlyOnSlide(data, { left: pos.left, top: pos.top });
      }
    } finally { if (sk) sk.remove(); }
  }

  function placeText(text, pos) {
    const tb = new fabric.Textbox(text.trim().slice(0, 4000), { left: pos.left, top: pos.top, width: 700, fontSize: 22, fill: '#1f1f1f', fontFamily: 'Roboto' });
    configureTextbox(tb);
    ensureObjectId(tb);
    canvas.add(tb); canvas.setActiveObject(tb); canvas.requestRenderAll();
    saveCurrentSlideState(); recordGlobalState();
    toast('Matn joylashtirildi');
  }

  /** data = { files:[], html:'', uri:'', text:'' } — hodisa ichida SINXRON o'qib olingan */
  async function placeExternal(data, pos) {
    let step = 0;
    const at = function () { const p = { left: Math.min(760, pos.left + step * 30), top: Math.min(440, pos.top + step * 30) }; step++; return p; };
    const files = data.files || [];
    let did = false;
    for (const f of files) {
      if (isMediaFile(f)) { await placeFile(f, at()); did = true; }
      else if (isImportFile(f) && typeof processImportFile === 'function') { await processImportFile(f); did = true; }
    }
    if (did) return true;
    // brauzerdan nusxalangan rasm: HTML ichida <img src> / <video src>
    if (data.html) {
      try {
        const doc = new DOMParser().parseFromString(data.html, 'text/html');
        const el = doc.querySelector('img[src], video[src], video source[src]');
        const src = el && el.getAttribute('src');
        if (src && /^(https?:|data:image\/)/i.test(src)) {
          if (/^data:image\//i.test(src)) {
            if (/^data:image\/gif/i.test(src) && typeof placeGifImmediate === 'function') placeGifImmediate(activeIndex, { left: at().left, top: at().top, width: 360, height: 240 }, src, nextNum(), nextOid());
            else await placeImageDirectlyOnSlide(src, at());
          } else await placeUrl(src, at());
          return true;
        }
      } catch (e) {}
    }
    const uri = (data.uri || '').split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s && s[0] !== '#'; })[0];
    const txt = (data.text || '').trim();
    const candidate = uri || (isUrl(txt) ? txt : '');
    if (candidate && /^https?:\/\//i.test(candidate)) {
      const mediaLike = IMG_EXT.test(candidate) || VID_EXT.test(candidate) || /youtube\.com|youtu\.be|vimeo\.com|tenor\.com|giphy\.com/i.test(candidate);
      if (mediaLike) { await placeUrl(candidate, at()); return true; }
    }
    if (txt) { placeText(txt, at()); return true; }
    return false;
  }

  function readTransfer(dt) {
    const types = Array.from(dt.types || []);
    return {
      types: types,
      files: dt.files ? Array.from(dt.files) : [],
      html: types.indexOf('text/html') >= 0 ? dt.getData('text/html') : '',
      uri: types.indexOf('text/uri-list') >= 0 ? dt.getData('text/uri-list') : '',
      text: types.indexOf('text/plain') >= 0 ? dt.getData('text/plain') : '',
    };
  }

  // ---------------------------------------------------------------- PASTE
  window.addEventListener('paste', async function (e) {
    if (isTextTarget(e.target) || editingText() || modalOpen()) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const data = readTransfer(cd);
    const mark = cd.getData(MARK);
    const hasExternal = data.files.length || data.html || data.uri || data.text;
    // 1) clipboard'da bizning belgi bor va u eng so'nggi nusxa — ichki obyekt
    if (mark && String(mark) === String(window.__ssCopyId) && typeof _clipboardStack !== 'undefined' && _clipboardStack) {
      e.preventDefault(); pasteObject(); return;
    }
    // 2) tashqaridan nusxalangan
    if (hasExternal) {
      e.preventDefault();
      const ok = await placeExternal(data, { left: 120, top: 100 });
      if (!ok) toast('Bu turdagi ma\'lumotni joylashtirib bo\'lmadi', 'error');
      return;
    }
    // 3) hech narsa o'qib bo'lmadi (ba'zi brauzerlar) — ichki nusxa bo'lsa shuni
    if (typeof _clipboardStack !== 'undefined' && _clipboardStack) { e.preventDefault(); pasteObject(); }
  }, true);

  /** Menyu / tugmadan "Joylashtirish": tizim clipboard'ini o'qib ko'radi (ruxsat so'raladi); bo'sh/ruxsatsiz bo'lsa ichki nusxa */
  window.ssPasteLatest = async function () {
    try { closeContextMenus(); } catch (e) {}
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        const files = [];
        for (const it of items) {
          for (const t of it.types) {
            if (/^(image|video)\//.test(t)) { const b = await it.getType(t); files.push(new File([b], 'clipboard.' + (t.split('/')[1] || 'png'), { type: t })); break; }
          }
        }
        let text = '';
        for (const it of items) { if (it.types.indexOf('text/plain') >= 0) { text = await (await it.getType('text/plain')).text(); break; } }
        if (files.length || text) {
          // ichki nusxa matni bo'lsa (biz yozgan) — ichki obyektni qo'yamiz
          if (!files.length && text === activeTextCache && _clipboardStack) { pasteObject(); return; }
          if (await placeExternal({ files: files, text: text, html: '', uri: '' }, { left: 120, top: 100 })) return;
        }
      }
    } catch (e) { /* ruxsat berilmadi — ichki nusxaga tushamiz */ }
    if (typeof _clipboardStack !== 'undefined' && _clipboardStack) pasteObject();
    else toast('Clipboard bo\'sh yoki ruxsat berilmadi. Ctrl+V ishlating.', 'error');
  };
  let activeTextCache = '';
  document.addEventListener('copy', function () { activeTextCache = activeText(); }, true);

  // ---------------------------------------------------------------- DRAG & DROP
  let bound = false;
  window.SSInput = {
    bindDragDrop: function () {
      if (bound) return; bound = true;
      let overlay = $o('globalDropOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'globalDropOverlay';
        overlay.className = 'drop-overlay';
        document.body.appendChild(overlay);
      }
      overlay.innerHTML = '<div class="drop-overlay-card">📁 Rasm, GIF, video yoki matnni shu yerga tashlang<span class="ss-drop-sub">Telegram, brauzer yoki kompyuterdan</span></div>';
      let depth = 0;
      const isInternal = function (dt) { return dt && Array.from(dt.types || []).indexOf('application/x-ss-internal') >= 0; };
      const isExternal = function (dt) {
        if (!dt || isInternal(dt)) return false;
        const t = Array.from(dt.types || []);
        return t.indexOf('Files') >= 0 || t.indexOf('text/uri-list') >= 0 || t.indexOf('text/html') >= 0 || t.indexOf('text/plain') >= 0 || t.indexOf('application/x-moz-file') >= 0;
      };
      const show = function () { overlay.classList.add('active'); };
      const hide = function () { overlay.classList.remove('active'); depth = 0; };
      window.addEventListener('dragenter', function (e) {
        if (isTextTarget(e.target) || !isExternal(e.dataTransfer)) return;
        e.preventDefault(); depth++; show();
      });
      window.addEventListener('dragleave', function (e) {
        if (!isExternal(e.dataTransfer) && depth === 0) return;
        depth = Math.max(0, depth - 1); if (depth === 0) hide();
      });
      window.addEventListener('dragover', function (e) {
        if (isTextTarget(e.target) || !isExternal(e.dataTransfer)) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      });
      window.addEventListener('drop', async function (e) {
        hide();
        const dt = e.dataTransfer;
        if (!dt || isInternal(dt)) return;
        // ichki "kutilayotgan rasm" (AI paneldan sudralgan) — eski mantiq
        const pendingId = dt.getData('application/x-slide-studio-pending');
        if (isTextTarget(e.target) && !pendingId) return;
        let pos = { left: 120, top: 100 };
        try {
          const card = $o('canvasCard') || $o('canvasWrapper');
          const rect = card.getBoundingClientRect();
          const sx = (canvas.width || 960) / Math.max(1, rect.width), sy = (canvas.height || 540) / Math.max(1, rect.height);
          const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
          if (inside) pos = { left: Math.max(20, Math.min(700, (e.clientX - rect.left) * sx)), top: Math.max(20, Math.min(400, (e.clientY - rect.top) * sy)) };
        } catch (x) {}
        const data = readTransfer(dt);
        if (pendingId && !data.files.length) {
          e.preventDefault();
          const p = (typeof pendingImagesStore !== 'undefined' ? pendingImagesStore : []).find(function (i) { return i.id === pendingId; });
          if (p && p.base64) {
            if (/^data:image\/gif/i.test(p.base64) && typeof placeGifImmediate === 'function') {
              const num = p.globalNum || nextNum();
              placeGifImmediate(activeIndex, { left: pos.left, top: pos.top, width: 360, height: 240 }, p.base64, num, nextOid());
              if (typeof consumePendingImageByNumber === 'function') consumePendingImageByNumber(num);
            } else {
              await placeImageDirectlyOnSlide(p.base64, pos);
              if (typeof consumePendingImageByNumber === 'function') consumePendingImageByNumber(p.globalNum);
            }
          }
          return;
        }
        // chap paneldagi miniatyuraga tashlangan bo'lsa — o'sha slaydga
        const thumb = e.target && e.target.closest ? e.target.closest('.slide-item') : null;
        if (thumb) {
          const idx = Number(thumb.dataset.idx);
          if (!isNaN(idx) && idx !== activeIndex) { try { await switchSlide(idx); } catch (x) {} }
        }
        if (!(data.files.length || data.html || data.uri || data.text)) return;
        e.preventDefault();
        const ok = await placeExternal(data, pos);
        if (!ok) toast('Bu turdagi ma\'lumotni joylashtirib bo\'lmadi', 'error');
      });
    }
  };
  function $o(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------- "Rasm yuklash" tugmasi: rasm + GIF + VIDEO, ko'p fayl
  window.triggerDirectImageUpload = function () {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*,video/*,.gif,.mp4,.webm,.mov';
    inp.multiple = true;
    inp.onchange = async function (e) {
      const files = Array.from(e.target.files || []);
      let i = 0;
      for (const f of files) { await placeFile(f, { left: 60 + (i % 5) * 30, top: 60 + (i % 3) * 30 }); i++; }
    };
    inp.click();
  };
  try { window.triggerDirectImageUpload.toString(); } catch (e) {}

  // ---------------------------------------------------------------- dastlabki sozlash
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[onclick="pasteObject()"]').forEach(function (n) { n.setAttribute('onclick', 'ssPasteLatest()'); });
  });
  document.querySelectorAll('[onclick="pasteObject()"]').forEach(function (n) { n.setAttribute('onclick', 'ssPasteLatest()'); });
})();
