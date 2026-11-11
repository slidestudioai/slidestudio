/* v31 — muharrir, kartochka va media tuzatishlari
 *  1. Matn tahrirlash: 1 marta bosish = faqat tanlash; 2 marta bosish = matn tahrirlash rejimi.
 *     Matn tanlangan holda Ctrl/Cmd+A = shu matn ichidagi HAMMA matn belgilanadi (qayta-qayta sakramaydi).
 *     Matn tahrirlanmayotgan bo'lsa Ctrl+A = slayddagi barcha elementlar.
 *  2. CardFit: AI yaratgan slaydda kartochka (rect) to'rt tomondan teng chetda turadi,
 *     ichidagi matn 24-28px padding bilan sig'adi va kartochkadan chiqib ketmaydi.
 */
(function () {
  'use strict';

  var SW = 960, SH = 540;

  function isText(o) { return !!o && (o.type === 'textbox' || o.type === 'i-text') && !o.isButton && !o.isEmbed; }

  // ------------------------------------------------------------------
  // 1. Matn tahrirlash
  // ------------------------------------------------------------------
  try {
    // Fabric: tanlangan matnga yana bir marta bosish tahrirlashni boshlaydi — buni o'chiramiz (editable=false),
    // tahrirlash faqat ikki marta bosilganda (yoki Ctrl+A / Enter) yoqiladi.
    fabric.Textbox.prototype.editable = false;
    fabric.IText.prototype.editable = false;
  } catch (e) {}

  // v34: Fabric matn tahrirlash rejimiga o'tganda hasControls=false qilib tutqichlarni yashiradi — shu sabab 1 bosishda
  // tutqichlar 1 soniya chiqib yo'qolardi. Endi tahrirlash paytida ham tutqichlar (o'lchash) ko'rinadi.
  try {
    var IP = fabric.IText && fabric.IText.prototype;
    if (IP && typeof IP._setEditingProps === 'function' && !IP.__ssKeepCtl) {
      IP.__ssKeepCtl = true;
      var _sep = IP._setEditingProps;
      IP._setEditingProps = function () {
        _sep.apply(this, arguments);
        this.hasControls = true; this.hasBorders = true; this.selectable = true;
        this.borderColor = '#2563eb';
      };
    }
  } catch (e) {}

  function startEditing(t, selectAll, ev) {
    if (!isText(t)) return false;
    try {
      t.editable = true;
      if (canvas.getActiveObject() !== t) canvas.setActiveObject(t);
      if (!t.isEditing) t.enterEditing(ev);
      if (selectAll) t.selectAll();
      if (t.hiddenTextarea) { try { t.hiddenTextarea.focus({ preventScroll: true }); } catch (e) { t.hiddenTextarea.focus(); } }
      canvas.requestRenderAll();
      return true;
    } catch (e) { console.warn('startEditing:', e); return false; }
  }
  window.startTextEditing = startEditing;

  function init() {
    // v34: matnga BITTA bosish = darhol tahrirlash (surish/o'lchash emas, oddiy bosish bo'lsa).
    // Animatsiyali matnda ham: ko'rib chiqish bosish zahoti to'xtaydi (15_video_anim_btn.js), matn tanlanadi va tahrirlanadi.
    canvas.on('mouse:up', function (opt) {
      try {
        // v49: bitta bosish = faqat tanlash. Tahrirlash — ikki marta bosish yoki Enter (o'z-o'zidan ochilib ketmasin)
        if (!window.ssSingleClickEdit) return;
        var t = opt && opt.target, ev = opt && opt.e;
        if (!isText(t) || t.isEditing || !opt.isClick) return;
        if (ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || ev.button === 2)) return;
        var ao = canvas.getActiveObject();
        if (ao && ao.type === 'activeSelection') return;
        // v36: animatsiyali matnning BIRINCHI bosilishi = faqat tanlash (4 burchak chiqadi) + animatsiya 1 marta.
        // Shu matnga IKKINCHI bosish = tahrirlash (animatsiya qayta o'ynamaydi). Boshqa joyni bosib qaytsangiz — yana animatsiya.
        if (t.animName && canvas.__ssPrevActive !== t) return;
        startEditing(t, false, ev);
        try { if (t.setCursorByClick && ev) t.setCursorByClick(ev); } catch (er) {}
      } catch (e) { console.warn('click-edit', e); }
    });
    canvas.on('mouse:down:before', function () { try { canvas.__ssPrevActive = canvas.getActiveObject(); } catch (e) { canvas.__ssPrevActive = null; } });
    canvas.on('mouse:dblclick', function (opt) {
      var t = opt && opt.target;
      if (!isText(t) || t.isEditing) return;
      startEditing(t, false, opt.e);
    });
    canvas.on('text:editing:exited', function (e) {
      try { if (e && e.target) e.target.editable = false; } catch (er) {}
    });
    // Tanlangan matnda Enter = tahrirlash
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      var ao = canvas.getActiveObject();
      if (isText(ao) && !ao.isEditing && !document.querySelector('.swal2-container')) {
        e.preventDefault(); e.stopImmediatePropagation();
        startEditing(ao, false);
      }
    }, true);
    // Ctrl/Cmd + A
    window.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if ((e.key || '').toLowerCase() !== 'a' && e.code !== 'KeyA') return;
      var pres = document.getElementById('presentationOverlay');
      if (pres && pres.style.display === 'flex') return;
      var ao = canvas.getActiveObject();
      var t = e.target;
      var inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (inField) {
        // fabric yashirin textarea (matn tahrirlanayotganda): shu matnning hammasini belgilaymiz
        if (ao && ao.isEditing && t === ao.hiddenTextarea) {
          e.preventDefault(); e.stopPropagation();
          try { ao.selectAll(); ao.hiddenTextarea.setSelectionRange(0, ao.hiddenTextarea.value.length); canvas.requestRenderAll(); } catch (er) {}
        }
        return;
      }
      if (document.querySelector('.swal2-container, .modal-overlay[style*="flex"]')) return;
      if (isText(ao)) {
        e.preventDefault(); e.stopImmediatePropagation();
        startEditing(ao, true);
        return;
      }
      // boshqa holatda — mavjud "hamma elementlarni belgilash" ishlaydi
    }, true);
  }

  // ------------------------------------------------------------------
  // 2. CardFit — kartochka chetlari va ichki padding
  // ------------------------------------------------------------------
  var OUTER = 40, PAD = 24, MIN_FONT = 12;

  function isCard(o) {
    return !!o && o.type === 'rect' && !o.isButton && !o.isEmbed && !o.angle && o.visible !== false &&
      (o.width * (o.scaleX || 1)) >= 140 && (o.height * (o.scaleY || 1)) >= 70;
  }
  function bbox(o) {
    var w = o.width * (o.scaleX || 1), h = o.height * (o.scaleY || 1);
    return { l: o.left, t: o.top, w: w, h: h, r: o.left + w, b: o.top + h };
  }
  function kidsOf(objs, idx, card) {
    var cb = bbox(card), res = [];
    for (var i = idx + 1; i < objs.length; i++) {
      var o = objs[i];
      if (!isText(o) || o.angle || o.visible === false) continue;
      var b = o.getBoundingRect(true, true);
      var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      var inCenter = cx >= cb.l && cx <= cb.r && cy >= cb.t && cy <= cb.b;
      // v33: matn chetga chiqib ketgan bo'lsa ham (markazi tashqarida), boshlanish nuqtasi kartochka ichida bo'lsa — kartochka bolasi
      var inStart = b.left >= cb.l - 2 && b.left < cb.r && b.top >= cb.t - 2 && b.top < cb.b;
      if (inCenter || inStart) res.push(o);
    }
    return res;
  }

  /** Slaydni deyarli to'ldiradigan, lekin notekis chetli katta kartochkani simmetrik qiladi */
  function balanceBigCard(cv, objs, idx, card) {
    var b = bbox(card);
    if (b.w < SW * 0.78 || b.h < SH * 0.7) return;
    var ml = b.l, mr = SW - b.r, mt = b.t, mb = SH - b.b;
    var minM = Math.min(ml, mr, mt, mb), maxM = Math.max(ml, mr, mt, mb);
    if (maxM <= 3) return;                                   // butun slayd foni — tegmaymiz
    if (minM >= 16 && (maxM - minM) <= 10) return;           // allaqachon teng
    var m = Math.min(OUTER, Math.max(24, Math.round((ml + mr + mt + mb) / 4)));
    if (ml < 0 || mr < 0 || mt < 0 || mb < 0 || (maxM - minM) > 10 || minM < 16) m = OUTER;
    var nb = { l: m, t: m, w: SW - 2 * m, h: SH - 2 * m };
    var kx = nb.w / b.w, ky = nb.h / b.h;
    var kids = kidsOf(objs, idx, card);
    // Kartochka yangi joyda boshqa elementni (masalan, tashqaridagi sarlavhani) yopib qo'ysa — tegmaymiz
    for (var q = 0; q < objs.length; q++) {
      var ob = objs[q];
      if (ob === card || kids.indexOf(ob) >= 0 || ob.visible === false) continue;
      var r = ob.getBoundingRect(true, true);
      var inNew = r.left < nb.l + nb.w && r.left + r.width > nb.l && r.top < nb.t + nb.h && r.top + r.height > nb.t;
      var inOld = r.left >= b.l - 1 && r.left + r.width <= b.r + 1 && r.top >= b.t - 1 && r.top + r.height <= b.b + 1;
      if (inNew && !inOld) return;
    }
    card.set({ left: nb.l, top: nb.t, width: nb.w / (card.scaleX || 1), height: nb.h / (card.scaleY || 1) });
    card.setCoords();
    kids.forEach(function (o) {
      var p = o.getPointByOrigin('left', 'top');
      var nx = nb.l + (p.x - b.l) * kx, ny = nb.t + (p.y - b.t) * ky;
      o.set({ width: Math.max(24, o.width * kx) });
      o.initDimensions();
      o.setPositionByOrigin(new fabric.Point(nx, ny), 'left', 'top');
      o.setCoords();
    });
  }

  /** Kartochka ichidagi matnlarni padding bilan sig'diradi */
  function fitKids(cv, objs, idx, card) {
    var cb = bbox(card);
    var pad = Math.min(PAD, Math.max(12, Math.min(cb.w, cb.h) * 0.12));
    var wideMin = (cb.w - pad * 2) * 0.8;
    var kids = kidsOf(objs, idx, card);
    if (!kids.length) return;
    var innerW = cb.w - pad * 2;
    var maxBottom = cb.b - pad;
    var needGrow = 0;
    kids.forEach(function (o) {
      var p = o.getPointByOrigin('left', 'top');
      var left = p.x, top = p.y;
      if (o.width > innerW || o.width >= wideMin) { o.set({ width: innerW }); left = cb.l + pad; }
      if (left < cb.l + pad) left = cb.l + pad;
      if (left + o.width > cb.r - pad) left = Math.max(cb.l + pad, cb.r - pad - o.width);
      if (top < cb.t + pad) top = cb.t + pad;
      o.initDimensions();
      o.setPositionByOrigin(new fabric.Point(left, top), 'left', 'top');
      var guard = 60;
      while (guard-- > 0 && top + o.height > maxBottom && o.fontSize > MIN_FONT) {
        o.set({ fontSize: o.fontSize - 1 });
        o.initDimensions();
      }
      if (top + o.height > maxBottom) {
        // shrift yetmadi — yuqoriga suramiz, so'ng kartochkani cho'zamiz
        var nt = Math.max(cb.t + pad, maxBottom - o.height);
        top = nt;
        o.setPositionByOrigin(new fabric.Point(left, top), 'left', 'top');
        if (top + o.height > maxBottom) needGrow = Math.max(needGrow, top + o.height + pad - cb.b);
      } else {
        o.setPositionByOrigin(new fabric.Point(left, top), 'left', 'top');
      }
      o.setCoords();
    });
    if (needGrow > 0) {
      var room = (SH - 24) - cb.b;
      var g = Math.min(needGrow, Math.max(0, room));
      if (g > 0) { card.set({ height: (cb.h + g) / (card.scaleY || 1) }); card.setCoords(); }
    }
  }

  /** v32: bir-birining ustiga chiqqan bloklarni (matn/rasm/GIF/video/tugma) pastga surib ajratadi */
  function isLeaf(o) {
    if (!o || o.visible === false || o.angle) return false;
    if (o.isBackground || o._isBackground) return false;
    return isText(o) || o.type === 'image' || o.isGif || o.type === 'gifImage' || o.type === 'embedVideo' || o.isEmbed || o.isButton || o.type === 'slideButton';
  }
  function leafBox(o) { var b = o.getBoundingRect(true, true); return { l: b.left, t: b.top, r: b.left + b.width, b: b.top + b.height, w: b.width, h: b.height }; }
  function containerBottom(objs, o, b) {
    // o ning markazi turgan kartochkaning pastki chegarasi (padding bilan), aks holda xavfsiz maydon
    var cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2, best = 510;
    for (var i = 0; i < objs.length; i++) {
      var c = objs[i];
      if (!isCard(c) || c === o) continue;
      var cb = bbox(c);
      if (cb.w >= SW * 0.95 && cb.h >= SH * 0.95) continue;
      if (cx >= cb.l && cx <= cb.r && cy >= cb.t && cy <= cb.b) best = Math.min(best === 510 ? 1e9 : best, cb.b - PAD);
    }
    return best === 1e9 ? 510 : best;
  }
  function resolveOverlaps(cv, objs) {
    var GAP = 18, leaves = objs.filter(isLeaf);
    if (leaves.length < 2) return;
    for (var pass = 0; pass < 4; pass++) {
      var moved = false;
      leaves.sort(function (a, b) { return leafBox(a).t - leafBox(b).t || leafBox(a).l - leafBox(b).l; });
      for (var i = 1; i < leaves.length; i++) {
        var a = leaves[i], A = leafBox(a);
        for (var j = 0; j < i; j++) {
          var B = leafBox(leaves[j]);
          var ox = Math.min(A.r, B.r) - Math.max(A.l, B.l), oy = Math.min(A.b, B.b) - Math.max(A.t, B.t);
          if (ox <= 2 || oy <= 2) continue;            // ustma-ust tushmaydi (yoki faqat chegarada)
          var newTop = B.b + GAP, lim = containerBottom(objs, a, A);
          if (newTop + A.h <= lim + 0.5) {
            var p = a.getPointByOrigin('left', 'top');
            a.setPositionByOrigin(new fabric.Point(p.x, p.y + (newTop - A.t)), 'left', 'top');
            a.setCoords(); moved = true; A = leafBox(a);
          } else if (isText(a) && a.fontSize > MIN_FONT + 2) {
            // joy yetmasa — shriftni biroz kichraytiramiz
            a.set({ fontSize: Math.max(MIN_FONT, a.fontSize - 2) }); a.initDimensions(); a.setCoords(); moved = true; A = leafBox(a);
          }
        }
      }
      if (!moved) break;
    }
  }

  /** v34: ro'yxat belgilari (✓, doira, chevron, kichik ikonka) matnning birinchi harflari ustiga tushmasin:
   *  belgi matn boshiga tegib/kesib tursa — matn belgidan 12px o'ngga suriladi va shuncha torayadi. */
  function isMarker(o) {
    if (!o || o.isButton || o.isEmbed || o.angle || o.visible === false || isText(o)) return false;
    var t = o.type;
    if (!(t === 'path' || t === 'circle' || t === 'ellipse' || t === 'triangle' || t === 'polygon' || t === 'rect' || t === 'image')) return false;
    var b = o.getBoundingRect(true, true);
    return b.width >= 6 && b.height >= 6 && b.width <= 72 && b.height <= 72;
  }
  function shiftForMarkers(objs) {
    var texts = objs.filter(isText), marks = objs.filter(isMarker);
    if (!texts.length || !marks.length) return;
    texts.forEach(function (T) {
      marks.forEach(function (M) {
        var tb = T.getBoundingRect(true, true), mb = M.getBoundingRect(true, true);
        if (tb.width < 80 || tb.width <= mb.width + 30) return;          // kichik yozuv (masalan raqamli doira ichidagi) — tegmaymiz
        var ox = Math.min(tb.left + tb.width, mb.left + mb.width) - Math.max(tb.left, mb.left);
        var oy = Math.min(tb.top + tb.height, mb.top + mb.height) - Math.max(tb.top, mb.top);
        if (ox <= 1 || oy <= 1) return;
        if (mb.left + mb.width / 2 > tb.left + Math.min(80, tb.width * 0.35)) return;   // belgi matn boshida emas
        var nl = mb.left + mb.width + 12, delta = nl - tb.left;
        if (delta <= 0) return;
        var p = T.getPointByOrigin('left', 'top');
        T.set({ width: Math.max(24, T.width - delta / (T.scaleX || 1)) });
        T.initDimensions();
        T.setPositionByOrigin(new fabric.Point(nl, p.y), 'left', 'top');
        T.setCoords();
      });
    });
  }

  function fit(cv) {
    if (!cv || typeof cv.getObjects !== 'function') return;
    var objs = cv.getObjects();
    try { resolveOverlaps(cv, objs); } catch (e) { console.warn('CardFit.overlap', e); }
    for (var i = 0; i < objs.length; i++) {
      if (isCard(objs[i])) { try { balanceBigCard(cv, objs, i, objs[i]); } catch (e) { console.warn('CardFit.balance', e); } }
    }
    for (var j = 0; j < objs.length; j++) {
      if (isCard(objs[j])) { try { fitKids(cv, objs, j, objs[j]); } catch (e) { console.warn('CardFit.fitKids', e); } }
    }
    try { shiftForMarkers(objs); } catch (e) { console.warn('CardFit.markers', e); }
    try { resolveOverlaps(cv, objs); } catch (e) { console.warn('CardFit.overlap2', e); }   // matn torayib balandlashgan bo'lishi mumkin
  }
  window.CardFit = { fit: fit };

  // ishga tushirish
  var tries = 0;
  var t = setInterval(function () {
    tries++;
    var ok = false;
    try { ok = typeof canvas !== 'undefined' && canvas && typeof canvas.on === 'function' && typeof fabric !== 'undefined'; } catch (e) {}
    if (ok) { clearInterval(t); try { init(); } catch (e) { console.warn('v31 init:', e); } }
    else if (tries > 100) clearInterval(t);
  }, 100);
})();

/* v31 — video plakati (miniatyura/eksport uchun): havoladan rasm manzilini qaytaradi */
(function () {
  'use strict';
  var cache = {};
  window.ssVideoPoster = function (url) {
    return new Promise(function (resolve) {
      try {
        if (!url) return resolve(null);
        if (cache[url] !== undefined) return resolve(cache[url]);
        var p = window.parseVideoUrl ? window.parseVideoUrl(url) : null;
        var out = null;
        if (p && p.kind === 'youtube' && p.id) out = 'https://i.ytimg.com/vi/' + p.id + '/hqdefault.jpg';
        else if (p && p.kind === 'vimeo' && p.id) out = 'https://vumbnail.com/' + p.id + '.jpg';
        else if (p && p.kind === 'dailymotion' && p.id) out = 'https://www.dailymotion.com/thumbnail/video/' + p.id;
        if (out || (p && p.kind !== 'file')) { cache[url] = out; return resolve(out); }
        // MP4 / WebM: birinchi kadrni olamiz (CORS ruxsat bergan yoki o'z-origin bo'lsa)
        var v = document.createElement('video');
        var done = false;
        var fin = function (r) { if (done) return; done = true; cache[url] = r; try { v.removeAttribute('src'); v.load(); } catch (e) {} resolve(r); };
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
        v.addEventListener('loadeddata', function () { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch (e) { fin(null); } }, { once: true });
        v.addEventListener('seeked', function () {
          try {
            var c = document.createElement('canvas'); c.width = 480; c.height = 270;
            c.getContext('2d').drawImage(v, 0, 0, 480, 270);
            fin(c.toDataURL('image/jpeg', 0.7));
          } catch (e) { fin(null); }
        }, { once: true });
        v.addEventListener('error', function () { fin(null); }, { once: true });
        setTimeout(function () { fin(null); }, 4000);
        v.src = url;
      } catch (e) { resolve(null); }
    });
  };
})();

/* v31 — PDF: rasm ustida ko'rinmas, belgilanadigan matn qatlami */
(function () {
  'use strict';
  function clean(str) {
    return String(str || '')
      .replace(/[ʻʼ‘’`´]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/ /g, ' ')
      .replace(/[^\x20-\x7E\xA1-\xFF\n]/g, '');
  }
  window.ssPdfTextLayer = async function (pdfDoc, page, json, pw, ph) {
    var PL = window.PDFLib;
    if (!PL || !PL.StandardFonts) return;
    var parsed = {};
    try { parsed = JSON.parse(json || '{}'); } catch (e) { return; }
    var objs = (parsed.objects || []).filter(function (o) {
      return o && o.visible !== false && (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') && String(o.text || '').trim();
    });
    if (!objs.length) return;
    if (!pdfDoc.__ssFont) pdfDoc.__ssFont = await pdfDoc.embedFont(PL.StandardFonts.Helvetica);
    var font = pdfDoc.__ssFont, k = pw / 960;
    objs.forEach(function (o) {
      try {
        var size = Math.max(4, (o.fontSize || 24) * k * (o.scaleY || 1));
        var w = (o.width || 200) * (o.scaleX || 1) * k;
        var lh = (o.lineHeight || 1.16) * size;
        var left = (o.left || 0) * k, top = (o.top || 0) * k;
        if (o.originX === 'center') left -= w / 2; else if (o.originX === 'right') left -= w;
        var lines = [];
        clean(o.text).split('\n').forEach(function (para) {
          var words = para.split(/\s+/).filter(Boolean), cur = '';
          words.forEach(function (wd) {
            var t = cur ? cur + ' ' + wd : wd;
            if (cur && font.widthOfTextAtSize(t, size) > w) { lines.push(cur); cur = wd; } else cur = t;
          });
          lines.push(cur);
        });
        lines.forEach(function (ln, i) {
          if (!ln) return;
          var lw = font.widthOfTextAtSize(ln, size), x = left;
          if (o.textAlign === 'center') x = left + (w - lw) / 2; else if (o.textAlign === 'right') x = left + (w - lw);
          page.drawText(ln, { x: x, y: ph - (top + i * lh) - size * 0.85, size: size, font: font, color: PL.rgb(0, 0, 0), opacity: 0 });
        });
      } catch (e) { /* bitta matn xatosi hammasini to'xtatmasin */ }
    });
  };
})();

/* v32 — rasm burchagi (standart 90°), qatlam tez tugmalari, PPTX importni uslubga moslash */
(function () {
  'use strict';

  // 1) Yumaloqlash faqat foydalanuvchi aniq so'rasa
  var lastPrompt = '';
  var RX = /(yumshat|yumshoq|yumaloq|dumaloq|doira|oval|burchag|circle|round|rounded|corner)/i;
  window.ssRoundingAllowed = function () { return RX.test(lastPrompt); };
  function hookGuard() {
    if (!window.SlideGuard || window.SlideGuard.__v32) return !!(window.SlideGuard && window.SlideGuard.__v32);
    var o = window.SlideGuard.beforeSend;
    window.SlideGuard.beforeSend = function (prompt, isCont) {
      if (!isCont && typeof prompt === 'string') lastPrompt = prompt;
      return o.apply(this, arguments);
    };
    window.SlideGuard.__v32 = true;
    return true;
  }
  var tg = setInterval(function () { if (hookGuard()) clearInterval(tg); }, 200);
  setTimeout(function () { clearInterval(tg); }, 20000);

  // 2) Qatlamlar: Ctrl+Shift+] / [  (eng oldinga / eng orqaga),  Ctrl+] / [  (bir qadam)
  window.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = e.code;
    if (k !== 'BracketRight' && k !== 'BracketLeft') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var ao = canvas.getActiveObject();
    if (!ao || ao.isEditing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    try {
      if (k === 'BracketRight') window.bringToFront(); else window.sendToBack();   // v36: bir marta bosish = eng tepaga / eng pastga
    } catch (er) { console.warn('layer key:', er); }
  }, true);

  // 3) Import qilingan PPTX: rasm = 90°, uzun matn bloklari kartochka ichida
  function lum(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  function shade(hex, amt) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
    var n = parseInt(m[1], 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v = amt > 0 ? v + (255 - v) * amt : v * (1 + amt); return Math.max(0, Math.min(255, Math.round(v)));
    });
    return '#' + c.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function box(o) {
    var w = (o.width || 0) * (o.scaleX != null ? o.scaleX : 1), h = (o.height || 0) * (o.scaleY != null ? o.scaleY : 1);
    var l = o.left || 0, t = o.top || 0;
    if (o.originX === 'center') l -= w / 2; else if (o.originX === 'right') l -= w;
    if (o.originY === 'center') t -= h / 2; else if (o.originY === 'bottom') t -= h;
    return { l: l, t: t, w: w, h: h };
  }
  window.ssAdaptImported = function (jsonStr) {
    var p;
    try { p = JSON.parse(jsonStr || '{}'); } catch (e) { return jsonStr; }
    var objs = p.objects || [];
    // rasm/GIF/video: 90° burchak
    objs.forEach(function (o) {
      if (!o) return;
      if (o.type === 'image' || o.isGif || o.type === 'gifImage' || o.type === 'embedVideo' || o.isEmbed) {
        o.mRadius = 0; if (o.clipPath) o.clipPath = null; if (o.rx) { o.rx = 0; o.ry = 0; }
      }
    });
    return JSON.stringify(p);   // v49.2: import aslicha — qo'shimcha karta (rect) QO'SHILMAYDI
    var bg = typeof p.background === 'string' ? p.background : '#ffffff';
    if (p.backgroundImage || p.backgroundGif || p.backgroundVideo) return JSON.stringify(p);
    var dark = lum(bg) < 0.5;
    var cardFill = dark ? shade(bg, 0.12) : shade(bg, -0.05);
    var PADC = 24, out = [], changed = false;
    // mavjud konteynerlar (rect/rasm) — ularning ichidagi matnga tegmaymiz
    var holders = objs.filter(function (o) { return o && (o.type === 'rect' || o.type === 'image' || o.type === 'circle' || o.type === 'ellipse') && box(o).w > 60 && box(o).h > 40; }).map(box);
    objs.forEach(function (o) {
      if (o && (o.type === 'textbox' || o.type === 'i-text') && !o.angle && String(o.text || '').trim().length >= 25 && (o.width || 0) >= 140) {
        var b = box(o), cx = b.l + b.w / 2, cy = b.t + b.h / 2;
        var inside = holders.some(function (h) { return cx >= h.l && cx <= h.l + h.w && cy >= h.t && cy <= h.t + h.h; });
        if (!inside) {
          var L = b.l - PADC, T = b.t - PADC, W = b.w + PADC * 2, H = b.h + PADC * 2;
          var dx = 0, dy = 0;
          if (L < 16) dx = 16 - L; if (T < 16) dy = 16 - T;
          if (L + dx + W > 944) { W = 944 - (L + dx); }
          if (T + dy + H > 524) { H = 524 - (T + dy); }
          if (W > b.w + 8 && H > b.h + 8) {
            out.push({ type: 'rect', left: L + dx, top: T + dy, width: W, height: H, fill: cardFill, rx: 16, ry: 16, stroke: null, strokeWidth: 0 });
            if (dx || dy) { o.left = (o.left || 0) + dx; o.top = (o.top || 0) + dy; }
            changed = true;
          }
        }
      }
      out.push(o);
    });
    if (changed) p.objects = out;
    return JSON.stringify(p);
  };
})();

/* v34 — eksportdan oldin: shu formatda nima saqlanmasligi aniq aytiladi (ovozli video, animatsiya, havola, tugma) */
(function () {
  'use strict';
  function scan() {
    var r = { video: 0, bgVideo: 0, anim: 0, buttons: 0, links: 0, gifs: 0 };
    try {
      if (typeof saveCurrentSlideState === 'function') saveCurrentSlideState();
      (slides || []).forEach(function (s) {
        var p; try { p = JSON.parse(s.json || '{}'); } catch (e) { return; }
        if (p.backgroundVideo && p.backgroundVideo.url) r.bgVideo++;
        if (p.backgroundGif) r.gifs++;
        (p.objects || []).forEach(function (o) {
          if (!o) return;
          if (o.type === 'embedVideo' || o.isEmbed) r.video++;
          if (o.animName) r.anim++;
          if (o.type === 'slideButton' || o.isButton) r.buttons++;
          if (o.linkUrl) r.links++;
          if (o.isGif || o.type === 'gifImage') r.gifs++;
        });
      });
    } catch (e) {}
    return r;
  }
  function lines(fmt, r) {
    var L = [];
    if (fmt === 'PDF') {
      if (r.video + r.bgVideo) L.push('🎬 <b>' + (r.video + r.bgVideo) + ' ta video</b> — PDF\'da o\'ynamaydi, faqat rasm (plakat) bo\'lib qoladi');
      if (r.gifs) L.push('🖼 <b>' + r.gifs + ' ta GIF</b> — harakatsiz (1-kadr) bo\'ladi');
      if (r.anim) L.push('✨ <b>' + r.anim + ' ta animatsiya</b> — saqlanmaydi');
      if (r.buttons + r.links) L.push('🔗 <b>' + (r.buttons + r.links) + ' ta havola/tugma</b> — PDF\'da bosilmaydi');
    } else if (fmt === 'PPTX') {
      if (r.video + r.bgVideo) L.push('🎬 <b>' + (r.video + r.bgVideo) + ' ta video</b> — YouTube/Vimeo PowerPoint\'da onlayn video bo\'ladi, boshqa havolalar matn-havola bo\'ladi');
      if (r.anim) L.push('✨ <b>' + r.anim + ' ta animatsiya</b> — PowerPoint animatsiyasiga aylanmaydi');
      if (r.buttons) L.push('🔘 <b>' + r.buttons + ' ta tugma</b> — oddiy shakl bo\'lib qoladi');
      if (r.gifs) L.push('🖼 <b>' + r.gifs + ' ta GIF</b> — PowerPoint versiyasiga qarab harakatsiz bo\'lishi mumkin');
    }
    return L;
  }
  window.ssExportNotice = async function (fmt) {
    if (fmt !== 'PDF' || typeof Swal === 'undefined') return true;
    var r = scan();
    if (!(r.video + r.bgVideo + r.anim + r.buttons + r.links + r.gifs)) return true;
    var res = await Swal.fire({
      icon: 'info', title: 'PDF haqida eslatma',
      html: '<div style="text-align:left;line-height:1.7">Slaydda animatsiya, video yoki tugma/link bo\'lsa, PDF formatida ular ishlamay qolishi mumkin.<br><br>Hammasi ishlashi uchun <b>HTML</b> formatidan foydalaning.</div>',
      showCancelButton: true, confirmButtonText: 'PDF ni saqlash', cancelButtonText: 'Bekor qilish', heightAuto: false
    });
    return !!res.isConfirmed;
  };
  ['exportPDF'].forEach(function (name) {   // v36: PPTX da ogohlantirish oynasi chiqmaydi
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__ssWrapped) return;
    var w = async function () {
      if (!(await window.ssExportNotice(name === 'exportPDF' ? 'PDF' : 'PPTX'))) return;
      return orig.apply(this, arguments);
    };
    w.__ssWrapped = true;
    window[name] = w;
  });
})();
