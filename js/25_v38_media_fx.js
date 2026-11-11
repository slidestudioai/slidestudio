/* =====================================================================
 * 25_v38_media_fx.js (v38)
 *  1) Yuklanish skeleti FOIZ bilan — media qo'yiladigan ANIQ joyda (AI ham, qo'lda ham)
 *  2) Taqdimot media'sini RAM ga oldindan yuklash va "pin" qilish
 *  3) Slayd almashganda miltillamaslik (freeze-frame)
 *  4) Chap panel (sidebar) — qayta chizilmaydi, faqat o'zgargan joyi yangilanadi
 *  5) Miniatyura yangilash — navbat va birlashtirish (qotib qolmaslik)
 * Eski funksiyalar global bo'lgani uchun shu yerda qayta aniqlanadi (fayl oxirgi yuklanadi).
 * ===================================================================== */
(function () {
  'use strict';
  const RAM = window.MediaRAM;
  const $ = function (id) { return document.getElementById(id); };
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  // ------------------------------------------------------------------ 1) skelet + foiz
  function buildSkel(kind) {
    const d = document.createElement('div');
    d.className = 'media-skeleton shimmer ' + (kind === 'image' ? 'image-loading' : 'gif-loading');
    d.dataset.kind = kind || 'gif';
    d.innerHTML = '<div class="skeleton-spinner"></div><span class="skeleton-tag">' +
      (kind === 'image' ? 'RASM' : kind === 'video' ? 'VIDEO' : kind === 'bg' ? 'FON' : 'GIF') +
      '</span><span class="ss-skel-pct">0%</span><div class="ss-skel-track"><div class="ss-skel-fill"></div></div>';
    return d;
  }

  /** Skelet elementini MediaRAM progress hodisalariga bog'laydi */
  function bindProgress(el, url) {
    const key = RAM && RAM.unwrap(url);
    if (!key) return function () {};
    const pct = el.querySelector('.ss-skel-pct');
    const fill = el.querySelector('.ss-skel-fill');
    const off = RAM.on(function (ev) {
      if (ev.url !== key) return;
      if (ev.type === 'progress' && ev.total > 0) {
        const p = Math.min(99, Math.round(ev.loaded / ev.total * 100));
        el.classList.add('ss-known');
        if (fill) fill.style.width = p + '%';
        if (pct) pct.textContent = p + '%';
      } else if (ev.type === 'ready') {
        el.classList.add('ss-known');
        if (fill) fill.style.width = '100%';
        if (pct) pct.textContent = '100%';
        off();
      } else if (ev.type === 'error') off();
    });
    return off;
  }

  function showSkeleton(o) {
    o = o || {};
    const lyr = $('gifOverlay');
    if (!lyr) return null;
    const kind = o.kind === 'image' ? 'image' : (o.kind === 'bg' ? 'bg' : (o.kind === 'video' ? 'video' : 'gif'));
    const d = buildSkel(kind === 'bg' ? 'gif' : kind);
    if (kind === 'bg') {
      d.classList.add('bg-live');
      d.querySelector('.skeleton-tag').textContent = 'FON';
    } else {
      const w = Math.max(60, Number(o.width) || 320);
      const h = Math.max(60, Number(o.height) || 220);
      d.style.left = (Number.isFinite(Number(o.left)) ? Number(o.left) : 60) + 'px';
      d.style.top = (Number.isFinite(Number(o.top)) ? Number(o.top) : 60) + 'px';
      d.style.width = w + 'px';
      d.style.height = h + 'px';
    }
    lyr.appendChild(d);
    const off = o.url ? bindProgress(d, o.url) : function () {};
    let gone = false;
    const remove = function () {
      if (gone) return; gone = true; off();
      d.classList.add('done');
      setTimeout(function () { try { d.remove(); } catch (e) {} }, 250);
    };
    setTimeout(remove, 30000);
    return { remove: remove, el: d };
  }
  if (window.MediaSkeleton) window.MediaSkeleton.show = showSkeleton;
  window.ssShowSkeleton = showSkeleton;

  /** AI buyrug'i bajarilishidan OLDIN: joyida skelet + media fonda RAM ga yuklana boshlaydi */
  window.beginMediaPlaceholder = function (cmd) {
    try {
      const a = cmd.action;
      const dest = (cmd.target_slide || cmd.slide || 1) - 1;
      if (dest !== activeIndex) return null;
      const url = String(cmd.url || cmd.src || '');
      const http = /^https?:\/\//i.test(url);
      if (http && RAM) RAM.load(url, { priority: 'high' }).catch(function () {});
      if (a === 'add_gif') return showSkeleton({ kind: 'gif', left: cmd.left, top: cmd.top, width: cmd.width, height: cmd.height, url: url });
      if ((a === 'add_image' || a === 'place_image_url') && url && !/^(data|blob):/i.test(url)) {
        const isGifUrl = cmd.isGif === true || cmd.is_gif === true || /\.gif(\?|#|$)/i.test(url) || /media\.tenor\.com|c\.tenor\.com|giphy\.com/i.test(url);
        return showSkeleton({ kind: isGifUrl ? 'gif' : 'image', left: cmd.left, top: cmd.top, width: cmd.width, height: cmd.height, url: url });
      }
      if ((a === 'set_background_url' || a === 'set_background') && http) return showSkeleton({ kind: 'bg', url: url });
    } catch (e) {}
    return null;
  };

  /** Media brauzeridan qo'lda qo'yish: kutish paytida rasm tushadigan joyda foizli skelet */
  const _origMediaPlaceUrl = window.mediaPlaceUrl;
  if (typeof _origMediaPlaceUrl === 'function') {
    window.mediaPlaceUrl = async function (url, forceGif) {
      let sk = null;
      try {
        const http = /^https?:\/\//i.test(url || '');
        const isVideo = (typeof VideoKit !== 'undefined' && VideoKit.isVideoUrl(url) && !/\.gif(\?|#|$)/i.test(url));
        if (http && !isVideo) {
          const gif = !!forceGif || /\.gif(\?|#|$)/i.test(url);
          const num = (typeof globalImageCounter === 'number' ? globalImageCounter : 0) + 1;
          const left = gif ? 100 + (num % 5) * 20 : 60 + (num % 5) * 30;
          const top = gif ? 100 + (num % 3) * 20 : 60 + (num % 3) * 30;
          sk = showSkeleton({ kind: gif ? 'gif' : 'image', left: left, top: top, width: 400, height: 280, url: url });
          if (RAM) await RAM.load(url, { priority: 'high' }).catch(function () {});
        }
      } catch (e) {}
      try { return await _origMediaPlaceUrl.apply(this, arguments); }
      finally { if (sk) sk.remove(); }
    };
  }

  // ------------------------------------------------------------------ 2) taqdimot media'sini RAM ga olish
  const URL_RE = /"(?:src|gifUrl|_gifUrl|url|videoUrl|poster|thumb)"\s*:\s*"(https?:\/\/[^"]+)"/g;
  const _urlCache = new WeakMap();
  function slideMedia(slide) {
    if (!slide || typeof slide.json !== 'string') return [];
    const c = _urlCache.get(slide);
    if (c && c.j === slide.json) return c.u;
    const out = new Set();
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(slide.json))) {
      const u = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (RAM.unwrap(u)) out.add(u);
    }
    const u = Array.from(out);
    _urlCache.set(slide, { j: slide.json, u: u });
    return u;
  }
  function isVideoUrl(u) { return /\.(mp4|webm|ogv|m4v)(\?|#|$)/i.test(u); }
  function deckMedia() { const s = new Set(); (window.slides || slides || []).forEach(function (sl) { slideMedia(sl).forEach(function (u) { s.add(u); }); }); return Array.from(s); }
  window.ssDeckMedia = deckMedia;
  window.ssSlideMedia = slideMedia;

  let _lastSig = '';
  function syncDeckMedia() {
    if (!RAM || document.hidden) return;
    try {
      const all = deckMedia();
      const sig = all.join('|');
      if (sig === _lastSig) return;
      _lastSig = sig;
      RAM.setPinned(all);
      // joriy slayd ustuvor, qolganlari fonda (past ustuvorlik)
      const cur = slideMedia(slides[activeIndex]);
      cur.forEach(function (u) { RAM.load(u, { priority: 'high', kind: isVideoUrl(u) ? 'video' : 'image' }).catch(function () {}); });
      all.forEach(function (u) { if (cur.indexOf(u) < 0 && !isVideoUrl(u)) RAM.warm([u]); });
    } catch (e) {}
  }
  setInterval(syncDeckMedia, 1500);

  // ------------------------------------------------------------------ 3) freeze-frame
  const _origLoadSlide = window.loadSlideCanvas;
  if (typeof _origLoadSlide === 'function') {
    window.loadSlideCanvas = function (index, callback) {
      let fz = null;
      try {
        const card = $('canvasCard');
        const src = canvas && canvas.lowerCanvasEl;
        if (card && src && src.width > 0 && !document.body.classList.contains('ss-no-fx')) {
          fz = document.createElement('canvas');
          fz.className = 'ss-freeze';
          fz.width = src.width; fz.height = src.height;
          fz.getContext('2d').drawImage(src, 0, 0);
          card.appendChild(fz);
        }
      } catch (e) { fz = null; }
      let released = false;
      const release = function () {
        if (released) return; released = true;
        if (!fz) return;
        requestAnimationFrame(function () {
          fz.classList.add('ss-freeze-out');
          setTimeout(function () { try { fz.remove(); } catch (e) {} }, 180);
        });
      };
      const guard = setTimeout(release, 4000);
      return _origLoadSlide.call(this, index, function () {
        clearTimeout(guard);
        try { if (typeof callback === 'function') callback.apply(this, arguments); } finally { release(); }
      });
    };
  }

  // ------------------------------------------------------------------ 4) sidebar: qayta chizmasdan yangilash
  const itemCache = new WeakMap();      // slide obyekti -> { el, thumb, sig }
  function gifSig(slide) {
    try {
      const p = JSON.parse(slide.json || '{}');
      const bg = p.backgroundGif ? (p.backgroundGif.src || p.backgroundGif.url || '') : '';
      const bv = p.backgroundVideo ? (p.backgroundVideo.url || '') : '';
      const g = (p.objects || []).filter(function (o) { return o && (o.isGif || o.type === 'gifImage'); })
        .map(function (o) { return [o.gifUrl || o.src, o.left, o.top, o.scaleX, o.scaleY, o.angle].join(','); }).join(';');
      return bg + '|' + bv + '|' + g;
    } catch (e) { return ''; }
  }
  function slideItemHtml(slide, idx) {
    const imgNums = slide.imageNumbers && slide.imageNumbers.length > 0 ? '<div class="img-nums">#' + slide.imageNumbers.join(',#') + '</div>' : '';
    return '<div class="slide-num">' + (idx + 1) + '</div><div class="slide-thumb"><img alt="Slayd ' + (idx + 1) + '">' + imgNums +
      '<div class="slide-more-btn"><span class="material-symbols-outlined">more_vert</span></div></div>';
  }
  function createItem(slide) {
    const item = document.createElement('div');
    item.draggable = true;
    item.innerHTML = slideItemHtml(slide, 0);
    item.addEventListener('click', function (e) { e.stopPropagation(); switchSlide(Number(item.dataset.idx)); });
    const more = item.querySelector('.slide-more-btn');
    more.addEventListener('click', function (e) { e.stopPropagation(); showSlideContextMenu(e, Number(item.dataset.idx)); });
    item.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', item.dataset.idx);
      e.dataTransfer.setData('application/x-ss-internal', '1');       // tashqi tashlashdan ajratish uchun
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', function () { item.classList.remove('dragging'); });
    item.addEventListener('dragover', function (e) {
      if (!Array.from(e.dataTransfer.types || []).includes('application/x-ss-internal')) return;
      e.preventDefault(); item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', function () { item.classList.remove('drag-over'); });
    item.addEventListener('drop', function (e) {
      if (!Array.from(e.dataTransfer.types || []).includes('application/x-ss-internal')) return;
      e.preventDefault(); e.stopPropagation();
      item.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const toIdx = Number(item.dataset.idx);
      if (isNaN(fromIdx) || fromIdx === toIdx) return;
      if (!slides[fromIdx] || !slides[toIdx]) return;
      saveCurrentSlideState();
      const activeSlideObj = slides[activeIndex];
      const moved = slides.splice(fromIdx, 1)[0];
      slides.splice(toIdx, 0, moved);
      // v49.2: faol varaq obyekti bo'yicha indeks — kanvas qayta yuklanmaydi (bo'sh qolish xavfi yo'q)
      const ni = slides.indexOf(activeSlideObj);
      if (ni >= 0) activeIndex = ni;
      renderSidebar();
      try { updateSlideCounterUI(); } catch (e) {}
      recordGlobalState();
    });
    item.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      window._rightClickedSlideIndex = Number(item.dataset.idx);
      const menu = $('slideContextMenu');
      menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px'; menu.style.display = 'block';
    });
    let pressTimer;
    item.addEventListener('touchstart', function (e) {
      pressTimer = setTimeout(function () {
        window._rightClickedSlideIndex = Number(item.dataset.idx);
        const menu = $('slideContextMenu');
        menu.style.left = e.touches[0].clientX + 'px'; menu.style.top = e.touches[0].clientY + 'px'; menu.style.display = 'block';
      }, 600);
    }, { passive: true });
    item.addEventListener('touchend', function () { clearTimeout(pressTimer); });
    item.addEventListener('touchmove', function () { clearTimeout(pressTimer); }, { passive: true });
    return item;
  }

  window.renderSidebar = function renderSidebar() {
    const sidebar = $('sidebar');
    if (!sidebar) return;
    let scroll = sidebar.querySelector(':scope > .sidebar-slides-scroll');
    let addBtn = scroll && scroll.querySelector(':scope > .btn-add-slide-bottom');
    if (!scroll || !addBtn) {                       // birinchi marta yoki sozlamalar paneli almashtirgan bo'lsa — qayta quramiz
      sidebar.innerHTML = '';
      scroll = document.createElement('div');
      scroll.className = 'sidebar-slides-scroll';
      addBtn = document.createElement('div');
      addBtn.className = 'btn-add-slide-bottom';
      addBtn.onclick = function (e) { e.stopPropagation(); addSlide('title_body'); };
      addBtn.innerHTML = '<span class="material-symbols-outlined">add</span> Slayd Qo\'shish';
      scroll.appendChild(addBtn);
      sidebar.appendChild(scroll);
    }
    // v49: eng pastda «Hamma varaqni tozalash» (bitta bosish — hammasi 0 dan, ogohlantirish bilan)
    let clrBtn = scroll.querySelector(':scope > .btn-reset-canvas');
    if (!clrBtn) {
      clrBtn = document.createElement('div');
      clrBtn.className = 'btn-reset-canvas';
      clrBtn.onclick = function (e) { e.stopPropagation(); if (window.ssResetCanvas) window.ssResetCanvas(); };
      clrBtn.innerHTML = '<span class="material-symbols-outlined">delete_sweep</span> Hamma varaqni tozalash';
    }
    const activeScrollTop = scroll.scrollTop;
    window._liveThumbGifCount = scroll.querySelectorAll('.thumb-gif-item, .slide-thumb-bg-gif').length;

    const want = [];
    slides.forEach(function (slide, idx) {
      let rec = itemCache.get(slide);
      if (!rec) { rec = { el: createItem(slide), thumb: null, sig: null, nums: null }; itemCache.set(slide, rec); }
      const el = rec.el;
      el.dataset.idx = idx;
      const isNew = window._newlyCreatedSlideIds && slide._uid && window._newlyCreatedSlideIds.has(slide._uid);
      el.className = 'slide-item' + (idx === activeIndex ? ' active' : '') + (isNew ? ' just-created' : '');
      if (isNew && !slide._ssFxTimer) {   // v58: yangi slayd effekti 2 soniya turadi, keyin o'chadi (har renderda qayta boshlanmaydi)
        slide._ssFxTimer = setTimeout(function () {
          el.classList.remove('just-created');
          window._newlyCreatedSlideIds && window._newlyCreatedSlideIds.delete(slide._uid);
        }, 2000);
      }
      const numEl = el.querySelector('.slide-num');
      if (numEl.textContent !== String(idx + 1)) numEl.textContent = idx + 1;
      const nums = (slide.imageNumbers || []).join(',');
      if (rec.nums !== nums) {
        rec.nums = nums;
        const old = el.querySelector('.img-nums'); if (old) old.remove();
        if (nums) { const d = document.createElement('div'); d.className = 'img-nums'; d.textContent = '#' + (slide.imageNumbers || []).join(',#'); el.querySelector('.slide-thumb').insertBefore(d, el.querySelector('.slide-more-btn')); }
      }
      const img = el.querySelector('.slide-thumb > img');
      if (rec.thumb !== slide.thumb) { rec.thumb = slide.thumb; if (slide.thumb) img.src = slide.thumb; else img.removeAttribute('src'); }
      const sig = gifSig(slide);
      if (rec.sig !== sig) {
        rec.sig = sig;
        const thumbEl = el.querySelector('.slide-thumb');
        thumbEl.querySelectorAll('.slide-thumb-gifs, .slide-thumb-bg-gif').forEach(function (n) { n.remove(); });
        safe(function () { renderThumbGifOverlay(thumbEl, slide); });
      }
      want.push(el);
    });
    let ref = scroll.firstChild;
    want.forEach(function (el) {
      if (el === ref) ref = ref.nextSibling;
      else scroll.insertBefore(el, ref);
    });
    Array.from(scroll.children).forEach(function (n) { if (n !== addBtn && n !== clrBtn && want.indexOf(n) < 0 && n.id !== 'ssAdSlot') n.remove(); });
    if (addBtn.nextSibling !== clrBtn || scroll.lastChild !== clrBtn) { scroll.appendChild(addBtn); scroll.appendChild(clrBtn); }

    if (!sidebar.querySelector(':scope > .sidebar-user-section')) safe(function () { renderSidebarUserProfile(sidebar); });
    if (activeScrollTop > 0) scroll.scrollTop = activeScrollTop;
    else if (activeIndex > 2) { const a = scroll.querySelector('.slide-item.active'); if (a) { const t0 = a.offsetTop, b0 = t0 + a.offsetHeight; if (t0 < scroll.scrollTop) scroll.scrollTop = t0 - 8; else if (b0 > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = b0 - scroll.clientHeight + 8; } }
  };

  // ------------------------------------------------------------------ 5) miniatyura: navbat + birlashtirish
  const _origRefresh = window.refreshSlideThumb;
  if (typeof _origRefresh === 'function') {
    const running = new Map();     // slideObj -> { again, promise }
    let busy = 0;
    const waiters = [];
    function acquire() { if (busy < 2) { busy++; return Promise.resolve(); } return new Promise(function (r) { waiters.push(r); }); }
    function release() { busy--; const n = waiters.shift(); if (n) { busy++; n(); } }
    window.refreshSlideThumb = function (idx) {
      idx = Number(idx);
      const slide = slides[idx];
      if (!slide) return Promise.resolve();
      const cur = running.get(slide);
      if (cur) { cur.again = true; return cur.promise; }
      const rec = { again: false };
      rec.promise = (async function () {
        try {
          do {
            rec.again = false;
            await acquire();
            try { await _origRefresh(slides.indexOf(slide)); } catch (e) {} finally { release(); }
          } while (rec.again && slides.indexOf(slide) >= 0);
        } finally { running.delete(slide); }
      })();
      running.set(slide, rec);
      return rec.promise;
    };
  }
})();
