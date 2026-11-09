(function () {
  'use strict';

  var SX = 10 / 960;
  var SY = 5.625 / 540;
  var PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  function pTimeout(p, ms, fb) {
    return Promise.race([p, new Promise(function (res) { setTimeout(function () { res(fb); }, ms); })]);
  }
  function toast(msg, kind) { try { showToast(msg, kind); } catch (e) {  } }

  function makeSafeFileName(title, ext) {
    var n = String(title == null ? '' : title);
    try { n = n.normalize('NFC'); } catch (e) {  }
    n = n.replace(/[\u0000-\u001f\u007f<>:"\/\\|?*\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, ' ');
    n = n.replace(/\s+/g, ' ').trim();
    n = n.replace(/^[.\s]+|[.\s]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n)) n = '_' + n;
    if (n.length > 120) n = n.slice(0, 120).replace(/[.\s]+$/g, '');
    if (!n) n = 'Taqdimot';
    return ext ? n + '.' + String(ext).replace(/^\./, '') : n;
  }
  window.makeSafeFileName = makeSafeFileName;

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { a.remove(); } catch (e) {  }
      try { URL.revokeObjectURL(url); } catch (e) {  }
    }, 60000);
  }
  window.downloadBlob = downloadBlob;

  var NAMED = {
    black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
    yellow: 'FFFF00', orange: 'FFA500', purple: '800080', gray: '808080', grey: '808080',
    pink: 'FFC0CB', brown: 'A52A2A', cyan: '00FFFF', magenta: 'FF00FF'
  };
  function h2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16).toUpperCase(); }

  function parseColor(c) {
    if (c == null) return null;
    if (typeof c === 'object') {
      if (Array.isArray(c.colorStops) && c.colorStops.length) return parseColor(c.colorStops[0].color);
      return null;
    }
    c = String(c).trim().toLowerCase();
    if (!c || c === 'transparent' || c === 'none') return null;
    var m;
    if ((m = /^#([0-9a-f]{3})$/.exec(c))) return { hex: m[1].split('').map(function (x) { return x + x; }).join('').toUpperCase(), alpha: 1 };
    if ((m = /^#([0-9a-f]{6})$/.exec(c))) return { hex: m[1].toUpperCase(), alpha: 1 };
    if ((m = /^#([0-9a-f]{8})$/.exec(c))) return { hex: m[1].slice(0, 6).toUpperCase(), alpha: parseInt(m[1].slice(6), 16) / 255 };
    if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+)(%?))?\s*\)$/.exec(c))) {
      var a = m[4] == null ? 1 : (m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { hex: h2(+m[1]) + h2(+m[2]) + h2(+m[3]), alpha: Math.max(0, Math.min(1, isFinite(a) ? a : 1)) };
    }
    if (NAMED[c]) return { hex: NAMED[c], alpha: 1 };
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillStyle = c;
      var v = ctx.fillStyle;
      if (v && v !== c) return parseColor(v);
      if (/^#/.test(v)) return parseColor(v);
    } catch (e) {  }
    return null;
  }

  function cleanFont(f) {
    var first = String(f || 'Arial').split(',')[0].replace(/["']/g, '').trim();
    if (!first) first = 'Arial';
    var g = { 'sans-serif': 'Arial', 'serif': 'Times New Roman', 'monospace': 'Courier New', 'system-ui': 'Arial', 'cursive': 'Comic Sans MS', 'fantasy': 'Impact' };
    return g[first.toLowerCase()] || first;
  }

  function placeBox(el, w, h) {
    var left = num(el.left, 0), top = num(el.top, 0);
    var angDeg = num(el.angle, 0), ang = angDeg * Math.PI / 180;
    var ox = el.originX || 'left', oy = el.originY || 'top';
    var dx = ox === 'center' ? 0 : (ox === 'right' ? -w / 2 : w / 2);
    var dy = oy === 'center' ? 0 : (oy === 'bottom' ? -h / 2 : h / 2);
    var cx = left + dx * Math.cos(ang) - dy * Math.sin(ang);
    var cy = top + dx * Math.sin(ang) + dy * Math.cos(ang);
    var rot = Math.round((((angDeg % 360) + 360) % 360) * 10) / 10;
    return { x: r4((cx - w / 2) * SX), y: r4((cy - h / 2) * SY), w: r4(Math.max(w, 1) * SX), h: r4(Math.max(h, 1) * SY), rotate: rot };
  }

  function transparencyOf(colorObj, opacity) {
    var a = (colorObj ? colorObj.alpha : 1) * (opacity == null ? 1 : num(opacity, 1));
    return Math.max(0, Math.min(100, Math.round((1 - a) * 100)));
  }

  function blobToDataUrl(b) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error || new Error('FileReader')); };
      fr.readAsDataURL(b);
    });
  }
  function fetchAsDataUrl(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(blobToDataUrl);
  }

  async function getImageData(src, preferRaw) {
    try { if (typeof sanitizeImageUrl === 'function') src = sanitizeImageUrl(src); } catch (e) {  }
    if (!src || typeof src !== 'string') return null;
    if (/^data:/i.test(src)) return src;
    var abs = /^https?:/i.test(src);
    if (abs && preferRaw) {
      try { return await fetchAsDataUrl('/api/proxy-image?raw=1&url=' + encodeURIComponent(src)); } catch (e) {  }
    }
    if (abs && typeof resolveRemoteToDataUrl === 'function') {
      try {
        var d = await resolveRemoteToDataUrl(src);
        if (d && /^data:/i.test(d)) return d;
      } catch (e) {  }
    }
    try { return await fetchAsDataUrl(src); } catch (e) {  }
    return null;
  }

  function loadImg(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }

  async function normalizeImageData(dataUrl) {
    var m = /^data:([^;,]+)(;base64)?,/i.exec(dataUrl || '');
    if (!m) return null;
    var mime = m[1].toLowerCase();

    if (mime !== 'image/gif' && typeof window.ssSlimDataUrl === 'function' && dataUrl.length > 150000 && /^image\/(png|jpe?g|webp|bmp)$/.test(mime)) {
      try { var sl = await window.ssSlimDataUrl(dataUrl, 1920); if (sl && /^data:image\/(png|jpeg);base64,/i.test(sl)) return sl; } catch (e) {}
    }
    if (m[2] && (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/gif')) return dataUrl;
    var im = await pTimeout(loadImg(dataUrl), 15000, null);
    if (!im) return null;
    var w = im.naturalWidth || 1024, h = im.naturalHeight || 768;
    var k = Math.min(1, 2400 / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    var ctx = c.getContext('2d');

    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  async function prepareImage(src, isGif) {
    var d = await pTimeout(getImageData(src, !!isGif), 25000, null);
    if (!d) return null;
    return normalizeImageData(d);
  }

  function renderObjectPng(el) {
    return new Promise(function (resolve) {
      try {
        fabric.util.enlivenObjects([el], function (objs) {
          try {
            var o = objs && objs[0];
            if (!o) { resolve(null); return; }
            var origLeft = o.left || 0, origTop = o.top || 0;
            var origOX = o.originX || 'left', origOY = o.originY || 'top';

            o.set({ left: 0, top: 0, originX: 'left', originY: 'top' });
            if (o.setCoords) o.setCoords();
            var url = null;
            try {
              url = o.toDataURL({
                format: 'png',
                multiplier: 2,
                enableRetinaScaling: false,
                withoutTransform: false
              });
            } catch (e1) {

              try {
                var br = o.getBoundingRect(true, true);
                var w = Math.max(1, Math.ceil(br.width || 1));
                var h = Math.max(1, Math.ceil(br.height || 1));
                var c = document.createElement('canvas');
                c.width = w; c.height = h;
                var tc = new fabric.Canvas(c, { backgroundColor: null, enableRetinaScaling: false });
                tc.add(o);
                if (o.setCoords) o.setCoords();
                tc.renderAll();
                url = tc.toDataURL({ format: 'png', multiplier: 2 });
                tc.dispose();
              } catch (e2) { url = null; }
            }

            try { o.set({ left: origLeft, top: origTop, originX: origOX, originY: origOY }); } catch (_) {}
            if (!url) { resolve(null); return; }

            var r = null;
            try {
              o.set({ left: origLeft, top: origTop, originX: origOX, originY: origOY });
              if (o.setCoords) o.setCoords();
              r = o.getBoundingRect(true, true);
            } catch (_) {}
            var left = r ? Math.max(0, Math.floor(r.left)) : Math.max(0, Math.floor(origLeft));
            var top = r ? Math.max(0, Math.floor(r.top)) : Math.max(0, Math.floor(origTop));
            var width = r ? Math.max(1, Math.ceil(r.width)) : Math.max(1, Math.ceil((el.width || 100) * (el.scaleX || 1)));
            var height = r ? Math.max(1, Math.ceil(r.height)) : Math.max(1, Math.ceil((el.height || 100) * (el.scaleY || 1)));
            resolve({ data: url, left: left, top: top, width: width, height: height });
          } catch (e) { resolve(null); }
        }, '');
      } catch (e) { resolve(null); }
    });
  }

  function bgSrc0(p) { return !!((p.backgroundGif && (p.backgroundGif.src || p.backgroundGif.url)) || (p.backgroundImage && p.backgroundImage.src)); }
  function slideBgHex(parsed) {
    if (typeof extractSlideBackgroundHex === 'function') {
      try { return extractSlideBackgroundHex(parsed); } catch (e) {  }
    }
    var c = parseColor(parsed && (parsed.background || parsed.backgroundColor));
    return c ? c.hex : 'FFFFFF';
  }

  function addTextEl(slide, el) {
    var text = String(el.text == null ? '' : el.text).replace(/\r\n?/g, '\n').replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
    var bg = parseColor(el.backgroundColor);
    if (!text.trim() && !bg) return true;
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var w = Math.max(10, num(el.width, 400) * sx);
    var h = Math.max(10, num(el.height, 60) * sy);
    var b = placeBox(el, w, h);

    var pad = Math.min(0.15, Math.max(0.04, b.w * 0.025));

    var scaleAvg = (Math.abs(sx) + Math.abs(sy)) / 2 || 1;
    var fsPx = num(el.fontSize, 24) * scaleAvg;

    var pt = Math.max(1, Math.round(fsPx * 0.75 * 2) / 2);
    var col = parseColor(el.fill) || { hex: '1F1F1F', alpha: 1 };
    var weight = el.fontWeight;
    var bold = weight === 'bold' || weight === 'bolder' || num(weight, 400) >= 600;
    var italic = el.fontStyle === 'italic' || el.fontStyle === 'oblique';
    var align = ({ left: 'left', center: 'center', right: 'right', justify: 'justify' })[el.textAlign] || 'left';

    var lh = Math.max(0.8, Math.min(3, num(el.lineHeight, 1.16)));

    var hBoost = Math.max(b.h, r4((pt / 72) * lh * (text.split('\n').length || 1) * 1.15));
    var opts = {
      x: r4(b.x - pad / 2), y: b.y, w: r4(b.w + pad), h: r4(Math.max(b.h, hBoost)),
      fontSize: pt, fontFace: cleanFont(el.fontFamily), color: col.hex,
      bold: bold, italic: italic, align: align, valign: 'top',
      margin: 0, wrap: true, fit: 'none', lineSpacingMultiple: Math.round(lh * 100) / 100
    };
    if (el.underline) opts.underline = true;
    if (el.linkUrl && /^(https?:|mailto:)/i.test(el.linkUrl)) opts.hyperlink = { url: el.linkUrl };
    if (el.linethrough) opts.strike = 'sngStrike';
    if (b.rotate) opts.rotate = b.rotate;
    var cs = num(el.charSpacing, 0);
    if (cs) opts.charSpacing = Math.round(cs / 1000 * pt * 2) / 2;
    var tr = transparencyOf(col, el.opacity);
    if (tr > 0) opts.transparency = tr;
    if (bg) opts.fill = { color: bg.hex, transparency: transparencyOf(bg, el.opacity) };
    slide.addText(text, opts);
    return true;
  }

  // ====================================================================
  // v40: havolalar, tugmalar, MP4 va YouTube — PowerPoint / Google Slides / WPS uchun
  // ====================================================================
  var ANIM_KEYS = ['animName', 'animDur', 'animDelay', 'animLoop', 'animTrigger', 'animOrder', 'animIn', 'animOut'];

  /** PPTX/PDF: brauzer animatsiyalari tashlab yuboriladi (obyektning boshqa xossalari o'zgarmaydi) */
  function stripAnim(el) {
    var c = {};
    for (var k in el) { if (Object.prototype.hasOwnProperty.call(el, k) && ANIM_KEYS.indexOf(k) < 0) c[k] = el[k]; }
    return c;
  }
  window.ssStripAnimations = stripAnim;

  function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    return /^(https?:\/\/|mailto:)/i.test(u) ? u : '';
  }
  /** Element havolasi: { url } yoki { slide } — PowerPoint tushunadigan hyperlink obyekti */
  function elementLink(el) {
    var u = safeUrl(el && el.linkUrl);
    return u ? { url: u, tooltip: u.slice(0, 120) } : null;
  }
  function buttonLink(el, ctx) {
    var a = el.btnAction || 'next', t = el.btnTarget, n = null;
    if (a === 'url') { var u = safeUrl(t); return u ? { url: u, tooltip: String(el.btnLabel || u).slice(0, 120) } : null; }
    if (a === 'next') n = ctx.idx + 2;
    else if (a === 'prev') n = ctx.idx;
    else if (a === 'first') n = 1;
    else if (a === 'last') n = ctx.total;
    else if (a === 'goto') n = parseInt(t, 10);
    if (n && n >= 1 && n <= ctx.total && n !== ctx.idx + 1) return { slide: n, tooltip: String(el.btnLabel || '').slice(0, 120) };
    return null;
  }

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
    return c;
  }
  function cvsUrl(c, type, q) { try { return c.toDataURL(type || 'image/jpeg', q || 0.86); } catch (e) { return null; } }
  var TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  /** Rasm ustiga Play (▶) belgisini chizadi. kind: 'youtube' — qizil "YouTube" tugmasi, boshqasi — oq doira */
  function drawPlay(ctx, W, H, kind) {
    var cx = W / 2, cy = H / 2, s = Math.min(W, H);
    if (kind === 'youtube') {
      var bw = s * 0.34, bh = bw * 0.7;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = s * 0.04; ctx.shadowOffsetY = s * 0.012;
      roundRectPath(ctx, cx - bw / 2, cy - bh / 2, bw, bh, bh * 0.28);
      ctx.fillStyle = '#FF0000'; ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.moveTo(cx - bh * 0.16, cy - bh * 0.27); ctx.lineTo(cx + bh * 0.3, cy); ctx.lineTo(cx - bh * 0.16, cy + bh * 0.27); ctx.closePath();
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
    } else {
      var r = s * 0.15;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = s * 0.04; ctx.shadowOffsetY = s * 0.012;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.moveTo(cx - r * 0.28, cy - r * 0.45); ctx.lineTo(cx + r * 0.5, cy); ctx.lineTo(cx - r * 0.28, cy + r * 0.45); ctx.closePath();
      ctx.fillStyle = '#111827'; ctx.fill();
    }
  }
  /** Muqova: (ixtiyoriy) rasm + qorong'ulashtirish + Play. Rasm bo'lmasa — gradient. Hech qachon xato bermaydi. */
  async function composeCover(imgDataUrl, wPx, hPx, kind, crop169) {
    try {
      var W = 960, H = Math.max(2, Math.round(960 * (hPx / Math.max(1, wPx))));
      if (H > 1400) { W = Math.round(W * 1400 / H); H = 1400; }
      var c = newCanvas(W, H), ctx = c.getContext('2d');
      if (!ctx) return TINY_PNG;
      var g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0F172A'); g.addColorStop(1, '#334155');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var im = imgDataUrl ? await pTimeout(loadImg(imgDataUrl), 8000, null) : null;
      if (im && im.naturalWidth > 8) {
        var sw = im.naturalWidth, sh = im.naturalHeight, sx = 0, sy = 0;
        if (crop169 && sw / sh < 1.5) { var nh = sw * 9 / 16; sy = (sh - nh) / 2; sh = nh; }
        var k = Math.max(W / sw, H / sh), dw = sw * k, dh = sh * k;
        ctx.drawImage(im, sx, sy, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
        ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, 0, W, H);
      }
      drawPlay(ctx, W, H, kind);
      return cvsUrl(c, 'image/jpeg', 0.86) || TINY_PNG;
    } catch (e) { return TINY_PNG; }
  }

  function parseOnline(el) {
    var kind = el.embedKind || '', id = el.embedId || '', url = el.embedUrl || el.videoUrl || el.src || '';
    if ((!kind || !id) && window.parseVideoUrl && url) {
      try { var pv = window.parseVideoUrl(url); if (pv) { kind = kind || pv.kind; id = id || pv.id; } } catch (e) {  }
    }
    var watch = url;
    if (kind === 'youtube' && id) watch = 'https://www.youtube.com/watch?v=' + id;
    else if (kind === 'vimeo' && id) watch = 'https://vimeo.com/' + id;
    else if (kind === 'dailymotion' && id) watch = 'https://www.dailymotion.com/video/' + id;
    return { kind: kind, id: id, url: url, watch: safeUrl(watch) };
  }
  async function onlineThumb(info) {
    if (info.kind === 'youtube' && info.id) {
      var list = [
        { u: 'https://i.ytimg.com/vi/' + info.id + '/maxresdefault.jpg', crop: false },
        { u: 'https://i.ytimg.com/vi/' + info.id + '/mqdefault.jpg', crop: false },
        { u: 'https://i.ytimg.com/vi/' + info.id + '/hqdefault.jpg', crop: true }
      ];
      for (var i = 0; i < list.length; i++) {
        var d = await pTimeout(getImageData(list[i].u, true), 8000, null);
        if (d && /^data:image\//i.test(d)) {
          var im = await pTimeout(loadImg(d), 6000, null);
          if (im && im.naturalWidth > 200) return { data: d, crop: list[i].crop };
        }
      }
    }
    try {
      if (window.ssVideoPoster && info.url) {
        var pu = await pTimeout(window.ssVideoPoster(info.url), 6000, null);
        if (pu) { var pd = await pTimeout(getImageData(pu, true), 8000, null); if (pd) return { data: pd, crop: false }; }
      }
    } catch (e) {  }
    return null;
  }

  /** Lokal videodan birinchi kadrni (muqova) oladi */
  function localVideoPoster(src, wPx, hPx) {
    return new Promise(function (resolve) {
      var done = false, objUrl = null, v = null;
      function fin(r) {
        if (done) return; done = true;
        try { if (v) { v.removeAttribute('src'); v.load(); } } catch (e) {  }
        try { if (objUrl) URL.revokeObjectURL(objUrl); } catch (e) {  }
        resolve(r);
      }
      setTimeout(function () { fin(null); }, 12000);
      (async function () {
        try {
          var u = src;
          if (/^data:/i.test(src)) { var b = await (await fetch(src)).blob(); objUrl = URL.createObjectURL(b); u = objUrl; }
          v = document.createElement('video');
          v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
          v.onerror = function () { fin(null); };
          v.onloadeddata = function () {
            var t = 0.1;
            try { if (isFinite(v.duration) && v.duration > 0.4) t = Math.min(0.5, v.duration / 4); } catch (e) {  }
            v.onseeked = function () {
              try {
                var vw = v.videoWidth || 640, vh = v.videoHeight || 360;
                var W = Math.min(960, vw), H = Math.round(W * vh / vw);
                var c = newCanvas(W, H); c.getContext('2d').drawImage(v, 0, 0, W, H);
                fin(cvsUrl(c, 'image/jpeg', 0.85));
              } catch (e) { fin(null); }
            };
            try { v.currentTime = t; } catch (e) { fin(null); }
          };
          v.src = u;
        } catch (e) { fin(null); }
      })();
    });
  }


  // ---- v40: galereya videosi va GIF — PPTX ichida haqiqiy video fayl sifatida ----
  var MAX_VIDEO_BYTES = 90 * 1024 * 1024;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /** Onlayn video faylni (mp4) yuklab, data: URL qiladi — PPTX ichiga joylash uchun */
  async function remoteVideoToData(url) {
    var tries = [url, '/api/proxy-video?url=' + encodeURIComponent(url)];
    for (var i = 0; i < tries.length; i++) {
      try {
        var r = await pTimeout(fetch(tries[i]), 60000, null);
        if (!r || !r.ok) continue;
        var b = await r.blob();
        if (!b.size || b.size > MAX_VIDEO_BYTES) continue;
        var ty = (b.type || '').toLowerCase();
        if (!/^video\//.test(ty)) { if (/\.(mp4|m4v|mov)(\?|#|$)/i.test(url) || ty === 'application/octet-stream') ty = 'video/mp4'; else continue; }
        if (/webm|ogg/.test(ty)) return null;                    // PowerPoint bu formatni o'ynamaydi
        var d = await blobToDataUrl(new Blob([b], { type: ty === 'video/quicktime' ? 'video/quicktime' : 'video/mp4' }));
        if (/^data:video\//i.test(d)) return d;
      } catch (e) {  }
    }
    return null;
  }
  /** v42: blob: / https: video manbasini MP4 data: URL ga aylantiradi (galereya videosi — GIF kabi faylga joylanadi). */
  async function videoSrcToData(u) {
    if (!u) return '';
    if (/^data:video\//i.test(u)) return u;
    if (/^https?:/i.test(u)) return (await remoteVideoToData(u)) || '';
    if (/^blob:/i.test(u)) {
      try {
        var b = await (await fetch(u)).blob();
        if (!b.size || b.size > MAX_VIDEO_BYTES) return '';
        var ty = (b.type || '').toLowerCase();
        if (/webm|ogg/.test(ty)) return '';
        if (!/^video\//.test(ty)) {
          var head = new Uint8Array(await b.slice(0, 12).arrayBuffer());
          var isMp4 = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;   // 'ftyp'
          if (!isMp4) return '';
          ty = 'video/mp4';
        }
        var d = await blobToDataUrl(new Blob([b], { type: ty === 'video/quicktime' ? 'video/quicktime' : 'video/mp4' }));
        return /^data:video\//i.test(d) ? d : '';
      } catch (e) { return ''; }
    }
    return '';
  }
  function mp4Mime() {
    try {
      if (!window.MediaRecorder) return '';
      var c = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
      for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported(c[i])) return c[i];
    } catch (e) {  }
    return '';
  }
  /** GIF -> MP4 (brauzerda yozib olinadi). Qo'llab-quvvatlanmasa null — GIF rasm sifatida qoladi. */
  async function gifToMp4(gifData) {
    var mime = mp4Mime();
    if (!mime || !window.GifDecoder) return null;
    try {
      var buf = new Uint8Array(await (await fetch(gifData)).arrayBuffer());
      var g = window.GifDecoder.decode(buf);
      if (!g || !g.frames || !g.frames.length) return null;
      var W = Math.max(2, Math.min(640, g.width)), H = Math.max(2, Math.round(W * g.height / g.width));
      W -= W % 2; H -= H % 2;
      var out = newCanvas(W, H), octx = out.getContext('2d'), tmp = newCanvas(g.width, g.height), tctx = tmp.getContext('2d');
      if (!octx || !tctx || !out.captureStream) return null;
      var total = 0; g.frames.forEach(function (f) { total += Math.max(20, f.delay || 100); });
      var loops = Math.max(1, Math.min(40, Math.ceil(8000 / Math.max(total, 100))));
      var chunks = [], rec = new MediaRecorder(out.captureStream(30), { mimeType: mime, videoBitsPerSecond: 2500000 });
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var stopped = new Promise(function (res) { rec.onstop = res; });
      var first = true;
      rec.start(250);
      for (var l = 0; l < loops; l++) {
        for (var i = 0; i < g.frames.length; i++) {
          var f = g.frames[i];
          tctx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), g.width, g.height), 0, 0);
          octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, W, H); octx.drawImage(tmp, 0, 0, W, H);
          if (first) { first = false; }
          await sleep(Math.max(20, f.delay || 100));
        }
      }
      var poster = out.toDataURL('image/jpeg', 0.85);
      rec.stop(); await stopped;
      var blob = new Blob(chunks, { type: 'video/mp4' });
      if (!blob.size) return null;
      return { data: await blobToDataUrl(blob), poster: poster };
    } catch (e) { console.warn('GIF->MP4:', e); return null; }
  }
  async function addGifAsVideoEl(slide, el, stats) {
    var src = el.gifUrl || el.src;
    if (!src || !mp4Mime()) return false;
    var raw = await pTimeout(getImageData(src, true), 25000, null);
    if (!raw) return false;
    var v = await gifToMp4(raw);
    if (!v) return false;
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var w = Math.max(2, num(el.width, 200) * sx), h = Math.max(2, num(el.height, 150) * sy);
    var b = placeBox(el, w, h);
    slide.addMedia({ type: 'video', data: v.data, cover: v.poster, extn: 'mp4', x: b.x, y: b.y, w: b.w, h: b.h });
    stats.gifVideo = (stats.gifVideo || 0) + 1;
    return true;
  }

  /** v42: YouTube/Vimeo/Dailymotion uchun PowerPoint "Onlayn video" manzili */
  function onlineEmbedUrl(info) {
    if (!info || !info.id) return '';
    if (info.kind === 'youtube') return 'https://www.youtube.com/embed/' + info.id + '?feature=oembed';
    if (info.kind === 'vimeo') return 'https://player.vimeo.com/video/' + info.id;
    if (info.kind === 'dailymotion') return 'https://www.dailymotion.com/embed/video/' + info.id;
    return '';
  }
  async function coverToPng(dataUrl) {
    try {
      if (/^data:image\/png/i.test(dataUrl)) return dataUrl;
      var im = await pTimeout(loadImg(dataUrl), 10000, null);
      if (!im) return dataUrl;
      var c = newCanvas(im.naturalWidth || 960, im.naturalHeight || 540);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL('image/png') || dataUrl;
    } catch (e) { return dataUrl; }
  }
  /** PowerPoint ichida HAQIQIY onlayn video (internet bo'lsa slaydning o'zida ijro bo'ladi, avtomatik boshlanadi). */
  async function addOnlineVideo(slide, info, box, coverJpg, autoplay) {
    var emb = onlineEmbedUrl(info);
    if (!emb) return false;
    try {
      var cp = await coverToPng(coverJpg);
      slide.addMedia({ type: 'online', link: emb, cover: cp, x: box.x, y: box.y, w: box.w, h: box.h, objectName: autoplay === false ? 'SS_VideoNoAuto' : 'SS_Video' });
      return true;
    } catch (e) { console.warn('PPTX onlayn video:', e); return false; }
  }
 /** Onlayn video ustida kichik bosiladigan havola (PowerPoint'ning o'z pleyeri ishlamasa/WPS/Google Slides'da ham YouTube ochiladi) */
  function addVideoLinkPill(slide, box, watch, small) {
    if (!watch) return;
    try {
      slide.addText('\u25B6 YouTube\u2019da ochish', { x: box.x + 0.08, y: box.y + 0.08, w: Math.min(small ? 1.7 : 2.0, Math.max(0.8, box.w - 0.16)), h: 0.3,
        fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0, fill: { color: '000000', transparency: small ? 55 : 35 },
        hyperlink: { url: watch, tooltip: 'Videoni brauzerda ochish' }, objectName: 'SS_VideoLink' });
    } catch (e) {  }
  }
  /** v42: slaydga "Avtomatik boshlash" (media ijro) animatsiyasini qo'shadi */
  function injectVideoAutoplay(xml) {
    if (xml.indexOf('<p:timing') >= 0 || xml.indexOf('<a:videoFile') < 0) return xml;
    var ids = [], re = /<p:pic>[\s\S]*?<\/p:pic>/g, m;
    while ((m = re.exec(xml))) {
      var blk = m[0];
      if (blk.indexOf('<a:videoFile') < 0 || blk.indexOf('SS_VideoNoAuto') >= 0) continue;
      var idm = /<p:cNvPr[^>]*\sid="(\d+)"/.exec(blk);
      if (idm) ids.push(idm[1]);
    }
    if (!ids.length) return xml;
    var n = 5;
    var eff = ids.map(function (id, i) {
      var a = n++, b = n++;
      return '<p:par><p:cTn id="' + a + '" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="' + (i ? 'withEffect' : 'afterEffect') + '">' +
        '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="' + b + '" dur="1" fill="hold"/>' +
        '<p:tgtEl><p:spTgt spid="' + id + '"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par>';
    }).join('');
    var timing = '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
      '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>' +
      '<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>' +
      '<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' + eff + '</p:childTnLst></p:cTn></p:par>' +
      '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>' +
      '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
      '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>' +
      '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
    if (xml.indexOf('</p:clrMapOvr>') >= 0) return xml.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + timing);
    return xml.replace('</p:sld>', timing + '</p:sld>');
  }
  window.__ssInjectVideoAutoplay = injectVideoAutoplay;

  function videoNote(slide, b, text) {
    slide.addText(text, { x: b.x, y: b.y + b.h - 0.34, w: b.w, h: 0.34, align: 'center', valign: 'middle', fontSize: 10, color: 'FFFFFF',
      fill: { color: '000000', transparency: 45 }, margin: 0 });
  }

  /** YouTube / Vimeo / Dailymotion / onlayn havola: muqova + Play (▶) rasmi, ustiga to'g'ridan-to'g'ri havola.
   *  Internet bo'lsa bosilganda brauzer ochiladi, bo'lmasa PowerPoint hech qanday xato bermaydi. */
  async function addVideoLinkEl(slide, el, stats) {
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var w = Math.max(10, num(el.width, 480) * sx), h = Math.max(10, num(el.height, 270) * sy);
    var b = placeBox(el, w, h);
    var info = parseOnline(el);
    if (info.kind === 'file' || /^(blob|data):/i.test(info.url || '') || (!info.kind && /\.(mp4|m4v|mov)(\?|#|$)/i.test(info.url))) {
      var fu = await videoSrcToData(info.url);
      if (fu) return addLocalVideoEl(slide, Object.assign({}, el, { videoUrl: fu, isVideo: true }), stats);
    }
    var th = await onlineThumb(info);
    var cover = await composeCover(th && th.data, w, h, info.kind === 'youtube' ? 'youtube' : 'generic', th && th.crop);
    if (await addOnlineVideo(slide, info, b, cover, el.embedAutoplay)) { addVideoLinkPill(slide, b, info.watch, false); stats.onlineVideo = (stats.onlineVideo || 0) + 1; if (!th && stats) stats.noThumb = (stats.noThumb || 0) + 1; return true; }
    var o = { data: cover, x: b.x, y: b.y, w: b.w, h: b.h };
    if (b.rotate) o.rotate = b.rotate;
    if (info.watch) o.hyperlink = { url: info.watch, tooltip: 'Videoni ochish' };
    slide.addImage(o);
    if (!th && stats) stats.noThumb = (stats.noThumb || 0) + 1;
    return true;
  }

  async function addButtonEl(slide, el, ctx) {
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var w = Math.max(10, num(el.width, 200) * sx), h = Math.max(10, num(el.height, 56) * sy);
    var b = placeBox(el, w, h);
    var fill = parseColor(el.fill) || { hex: '4F46E5', alpha: 1 };
    var tcol = parseColor(el.btnTextColor) || { hex: 'FFFFFF', alpha: 1 };
    var scaleAvg = (Math.abs(sx) + Math.abs(sy)) / 2 || 1;
    var pt = Math.max(6, Math.round(num(el.btnFontSize, 22) * scaleAvg * 0.75 * 2) / 2);
    var rIn = Math.min(Math.max(0, num(el.rx, 0)) * Math.abs(sx) * SX, Math.min(b.w, b.h) / 2);
    var opts = {
      x: b.x, y: b.y, w: b.w, h: b.h, align: 'center', valign: 'middle', margin: 0, wrap: true, fit: 'none',
      color: tcol.hex, fontSize: pt, fontFace: cleanFont(el.btnFontFamily || 'Montserrat'), bold: el.btnBold !== false,
      fill: { color: fill.hex, transparency: transparencyOf(fill, el.opacity) },
      line: { color: fill.hex, transparency: 100 },
      shape: rIn > 0.005 ? 'roundRect' : 'rect',
      objectName: 'SS_Button'
    };
    if (rIn > 0.005) opts.rectRadius = r4(rIn);
    if (b.rotate) opts.rotate = b.rotate;
    var lk = buttonLink(el, ctx);
    if (lk) opts.hyperlink = lk;
    slide.addText(String(el.btnLabel == null ? '' : el.btnLabel), opts);
    return true;
  }

  /** Lokal MP4: PowerPoint ichiga HAQIQIY video fayl sifatida joylanadi (oflayn ishlaydi). */
  async function addLocalVideoEl(slide, el, stats) {
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var w = Math.max(10, num(el.width, 480) * sx), h = Math.max(10, num(el.height, 270) * sy);
    var b = placeBox(el, w, h);
    var u = el.videoUrl || el.src || '';
    if (!/^data:video\//i.test(u)) { var rv = await videoSrcToData(u); if (rv) u = rv; }
    var m = /^data:(video\/[a-z0-9.+-]+)[;,]/i.exec(u);
    var mime = m ? m[1].toLowerCase() : '';
    var extn = (mime === 'video/mp4' || mime === 'video/x-m4v') ? 'mp4' : (mime === 'video/quicktime' ? 'mov' : '');
    var poster = await pTimeout(localVideoPoster(u, w, h), 13000, null);
    if (extn && /;base64,/i.test(u)) {
      var cover = poster || await composeCover(null, w, h, 'generic');
      var mo = { type: 'video', data: u, cover: cover, extn: extn, x: b.x, y: b.y, w: b.w, h: b.h };
      if (el.embedAutoplay === false || el.videoAutoplay === false) mo.objectName = 'SS_VideoNoAuto';
      try { slide.addMedia(mo); return true; } catch (e) { console.warn('PPTX addMedia:', e); }
    }
    // PowerPoint ijro eta olmaydigan format (WebM/OGG), blob: yoki onlayn fayl
    var cov2 = await composeCover(poster, w, h, 'generic');
    var io = { data: cov2, x: b.x, y: b.y, w: b.w, h: b.h };
    if (b.rotate) io.rotate = b.rotate;
    if (safeUrl(u)) io.hyperlink = { url: safeUrl(u), tooltip: 'Videoni ochish' };
    slide.addImage(io);
    if (!safeUrl(u)) { videoNote(slide, b, 'Video: faqat MP4 formati PowerPoint\u2019da ijro etiladi'); if (stats) stats.badVideo = (stats.badVideo || 0) + 1; }
    return true;
  }

  async function addImageEl(slide, el, stats) {
    var isGif = !!(el.isGif || el.type === 'gifImage');
    var src = isGif ? (el.gifUrl || el.src) : el.src;
    if (!src) return false;
    var data = await prepareImage(src, isGif);
    if (!data) { if (isGif) stats.gifFail++; return false; }
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var w = Math.max(1, num(el.width, 200) * sx), h = Math.max(1, num(el.height, 150) * sy);
    var cropped = num(el.cropX, 0) > 0 || num(el.cropY, 0) > 0 || !!el.clipPath;
    var lk = elementLink(el);
    if (cropped) {
      var pngc = await renderObjectPng(el);
      if (pngc) {
        var co = { data: pngc.data, x: r4(pngc.left * SX), y: r4(pngc.top * SY), w: r4(pngc.width * SX), h: r4(pngc.height * SY) };
        if (lk) co.hyperlink = lk;
        slide.addImage(co);
        return true;
      }
    }
    var b = placeBox(el, w, h);
    var o = { data: data, x: b.x, y: b.y, w: b.w, h: b.h };
    if (b.rotate) o.rotate = b.rotate;
    if (el.flipX) o.flipH = true;
    if (el.flipY) o.flipV = true;
    var op = num(el.opacity, 1);
    if (op < 1) o.transparency = Math.round((1 - op) * 100);
    if (lk) o.hyperlink = lk;
    slide.addImage(o);
    return true;
  }

  function shapeStyle(el) {
    var f = parseColor(el.fill), s = parseColor(el.stroke);
    var o = {
      fill: f ? { color: f.hex, transparency: transparencyOf(f, el.opacity) } : { color: 'FFFFFF', transparency: 100 },
      line: s && num(el.strokeWidth, 0) > 0
        ? { color: s.hex, width: Math.max(0.25, Math.round(num(el.strokeWidth, 1) * 0.75 * 4) / 4), transparency: transparencyOf(s, el.opacity) }
        : { color: 'FFFFFF', transparency: 100 }
    };
    return o;
  }

  async function addShapeEl(pptx, slide, el) {
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var t = el.type, w, h, shape = null, extra = {};
    if (t === 'rect') {
      w = num(el.width, 100) * sx; h = num(el.height, 100) * sy;

      var rxPx = Math.max(num(el.rx, 0) * sx, num(el.ry, 0) * sy);
      var maxR = Math.min(w, h) / 2;
      if (rxPx > 0.5 && maxR > 0) {

        shape = pptx.ShapeType.roundRect;
        extra.rectRadius = r4(Math.min(rxPx, maxR) * SX);   // pptxgenjs: dyuymda
      } else {
        shape = pptx.ShapeType.rect;
      }
    } else if (t === 'circle') {
      var r = num(el.radius, num(el.width, 100) / 2);
      w = r * 2 * sx; h = r * 2 * sy; shape = pptx.ShapeType.ellipse;
    } else if (t === 'ellipse') {
      w = num(el.rx, 50) * 2 * sx; h = num(el.ry, 50) * 2 * sy; shape = pptx.ShapeType.ellipse;
    } else if (t === 'triangle') {
      w = num(el.width, 100) * sx; h = num(el.height, 100) * sy; shape = pptx.ShapeType.triangle;
    } else {
      return false;
    }
    var b = placeBox(el, w, h);
    var o = Object.assign({ x: b.x, y: b.y, w: b.w, h: b.h }, shapeStyle(el), extra);
    if (b.rotate) o.rotate = b.rotate;
    if (el.flipX) o.flipH = true;
    if (el.flipY) o.flipV = true;
    var slk = elementLink(el);
    if (slk) o.hyperlink = slk;
    slide.addShape(shape, o);
    return true;
  }

  async function addFallbackEl(slide, el) {
    var p = await renderObjectPng(el);
    if (!p) return false;
    slide.addImage({ data: p.data, x: r4(p.left * SX), y: r4(p.top * SY), w: r4(p.width * SX), h: r4(p.height * SY) });
    return true;
  }

  /* ---- v48: jadval / grafik — PowerPoint'ning o'z (tahrirlanadigan) jadval va diagrammasi ---- */
  function hex6(c, dflt) { var p = parseColor(c); return p ? p.hex : dflt; }
  function addTableEl(slide, el) {
    var sp = el.ssSpec, rows = sp && sp.rows;
    if (!rows || !rows.length) return false;
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var w = Math.max(40, num(el.width, 400) * sx), h = Math.max(20, num(el.height, 100) * sy);
    var b = placeBox(el, w, h);
    var cols = rows[0].length, avg = (Math.abs(sx) + Math.abs(sy)) / 2 || 1;
    var fsPt = Math.max(6, Math.round((sp.fs || 16) * avg * 0.75 * 2) / 2);
    var hFill = hex6(sp.headerFill, '1A73E8'), hCol = hex6(sp.headerColor, 'FFFFFF');
    var border = { type: 'solid', pt: 0.75, color: 'DBE1EA' };
    var data = rows.map(function (r, ri) {
      var isH = sp.header !== false && ri === 0;
      return r.map(function (c, ci) {
        return { text: String(c), options: {
          bold: isH, color: isH ? hCol : '1F2937', fontFace: 'Arial', fontSize: fsPt,
          align: (ci === 0 && !isH) ? 'left' : 'center', valign: 'middle',
          fill: { color: isH ? hFill : (sp.stripe !== false && ri % 2 === 0 ? 'F1F5F9' : 'FFFFFF') },
          border: [border, border, border, border], margin: [0.03, 0.08, 0.03, 0.08]
        } };
      });
    });
    var cw = []; for (var i = 0; i < cols; i++) cw.push(r4(b.w / cols));
    var rh = []; for (var j = 0; j < rows.length; j++) rh.push(r4(b.h / rows.length));
    slide.addTable(data, { x: b.x, y: b.y, w: b.w, colW: cw, rowH: rh });
    return true;
  }
  function addChartEl(pptx, slide, el) {
    var sp = el.ssSpec;
    if (!sp || !sp.labels || !sp.series || !sp.series.length) return false;
    var sx = num(el.scaleX, 1) || 1, sy = num(el.scaleY, 1) || 1;
    var w = Math.max(80, num(el.width, 500) * sx), h = Math.max(60, num(el.height, 300) * sy);
    var b = placeBox(el, w, h);
    var kind = sp.chart === 'donut' ? 'doughnut' : sp.chart;
    var CT = pptx.charts || (pptx.ChartType || {});
    var type = ({ bar: CT.BAR, line: CT.LINE, pie: CT.PIE, doughnut: CT.DOUGHNUT })[kind] || CT.BAR;
    var data = sp.series.map(function (s, i) { return { name: s.name || ('Qator ' + (i + 1)), labels: sp.labels, values: s.values }; });
    var pal = (sp.colors && sp.colors.length ? sp.colors : ['#1a73e8', '#34a853', '#fbbc04', '#ea4335']).map(function (c) { return hex6(c, '1A73E8'); });
    var pie = kind === 'pie' || kind === 'doughnut';
    var colors = [], need = pie || data.length === 1 ? sp.labels.length : data.length;
    for (var i = 0; i < need; i++) colors.push(pal[i % pal.length]);
    var ink = hex6(sp.textColor, '374151');
    var o = { x: b.x, y: b.y, w: b.w, h: b.h, chartColors: colors, showValue: !pie, dataLabelColor: ink, dataLabelFontSize: 12, dataLabelFontBold: true,
      showLegend: pie || data.length > 1, legendPos: pie ? 'r' : 't', legendFontSize: 12, legendColor: ink,
      catAxisLabelColor: ink, catAxisLabelFontSize: 12, valAxisLabelColor: '6B7280', valAxisLabelFontSize: 11,
      valGridLine: { color: 'E5E7EB', size: 0.75 }, catAxisLabelPos: 'low' };
    if (pie) { o.showPercent = true; o.showValue = false; o.dataLabelFormatCode = '0%'; o.dataLabelColor = kind === 'pie' ? 'FFFFFF' : ink; if (kind === 'doughnut') o.holeSize = 55; }
    else if (kind === 'bar') { o.barDir = 'col'; o.barGapWidthPct = 60; if (data.length === 1) o.valAxisHidden = false; }
    else { o.lineSize = 3; o.lineDataSymbolSize = 8; }
    if (sp.title) { o.showTitle = true; o.title = String(sp.title); o.titleFontSize = 16; o.titleColor = '111827'; o.titleFontFace = 'Arial'; }
    slide.addChart(type, data, o);
    return true;
  }
  var TR_XML = { fade: '<p:fade/>', zoom: '<p:zoom dir="in"/>', flip: '<p:cover dir="r"/>', up: '<p:push dir="u"/>', blur: '<p:dissolve/>' };
  function injectTransition(xml, name) {
    var key = name == null || name === '' ? 'fade' : String(name);
    var inner = TR_XML[key];
    if (!inner || xml.indexOf('<p:transition') >= 0) return xml;
    var tag = '<p:transition spd="med">' + inner + '</p:transition>';
    if (/<\/p:clrMapOvr>/.test(xml)) return xml.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + tag);
    if (/<p:timing[\s>]/.test(xml)) return xml.replace(/<p:timing[\s>]/, function (m) { return tag + m; });
    return xml.replace('</p:sld>', tag + '</p:sld>');
  }
  window.__ssInjectTransition = injectTransition;

  var _pptxBusy = false;

  async function exportPPTX() {
    if (_pptxBusy) { toast('PPTX tayyorlanmoqda, biroz kuting…'); return; }
    if (window.isAiApplyingCommands || window.isAiStreaming ||
        (typeof isAiApplyingCommands !== 'undefined' && isAiApplyingCommands) ||
        (typeof isAiStreaming !== 'undefined' && isAiStreaming)) {
      toast("AI slayd yaratmoqda — tugagach qayta urinib ko'ring", 'error');
      return;
    }
    if (typeof PptxGenJS === 'undefined') {
      try { Swal.fire('Xato', "PowerPoint kutubxonasi (PptxGenJS) yuklanmadi. Internetni tekshirib sahifani yangilang.", 'error'); } catch (e) {  }
      return;
    }
    _pptxBusy = true;
    try {
      saveCurrentSlideState();
      toast('PPTX tayyorlanmoqda…');
      var title = (typeof projectTitle === 'string' && projectTitle.trim()) ? projectTitle.trim() : 'Taqdimot';
      var pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_16x9';
      pptx.title = title;
      pptx.author = 'Slide Studio';
      pptx.company = 'Slide Studio';
      pptx.subject = title;

      var stats = { gifFail: 0, imgFail: 0, skipped: 0, errors: 0 };

      for (var i = 0; i < slides.length; i++) {
        if (slides.length > 3) toast('PPTX tayyorlanmoqda… ' + (i + 1) + ' / ' + slides.length);
        var slide = pptx.addSlide();
        var parsed = {};
        try { parsed = JSON.parse(slides[i].json || '{}'); } catch (e) { parsed = {}; }
        try { slide.background = { color: slideBgHex(parsed) }; } catch (e) {  }

        try {
          var bgSrc = null, bgGif = false;
          if (parsed.backgroundGif && (parsed.backgroundGif.src || parsed.backgroundGif.url)) {
            bgSrc = parsed.backgroundGif.src || parsed.backgroundGif.url; bgGif = true;
          } else if (parsed.backgroundImage && parsed.backgroundImage.src) {
            bgSrc = parsed.backgroundImage.src;
          }
          if (bgSrc) {
            var bgData = await prepareImage(bgSrc, bgGif);
            if (bgData) {
              if (bgGif) slide.addImage({ data: bgData, x: 0, y: 0, w: 10, h: 5.625 });
              else slide.background = { data: bgData };
            } else if (bgGif) stats.gifFail++; else stats.imgFail++;
          }
        } catch (e) { stats.errors++; console.warn('PPTX fon:', e); }

        try {
          var bv = parsed.backgroundVideo, continue_bg = false;
          if (bv && bv.url && !bgSrc0(parsed)) {
            var bvu = String(bv.url);
            if (/^data:video\/(mp4|x-m4v)[;,]/i.test(bvu) && /;base64,/i.test(bvu)) {
              var bpost = await pTimeout(localVideoPoster(bvu, 960, 540), 13000, null);
              if (bpost) slide.background = { data: bpost };
              slide.addMedia({ type: 'video', data: bvu, cover: bpost || await composeCover(null, 960, 540, 'generic'), extn: 'mp4', x: 0, y: 0, w: 10, h: 5.625 });
            } else if (/\.(mp4|m4v|mov)(\?|#|$)/i.test(bvu) && /^https?:/i.test(bvu) && (bvu = (await remoteVideoToData(bvu)) || bvu) && /^data:video/i.test(bvu)) {
              var bpost2 = await pTimeout(localVideoPoster(bvu, 960, 540), 13000, null);
              if (bpost2) slide.background = { data: bpost2 };
              slide.addMedia({ type: 'video', data: bvu, cover: bpost2 || await composeCover(null, 960, 540, 'generic'), extn: 'mp4', x: 0, y: 0, w: 10, h: 5.625 });
            } else {
              var binfo = parseOnline({ embedUrl: bvu });
              var bth = await onlineThumb(binfo);
              var bcover = await composeCover(bth && bth.data, 960, 540, binfo.kind === 'youtube' ? 'youtube' : 'generic', bth && bth.crop);
              if (await addOnlineVideo(slide, binfo, { x: 0, y: 0, w: 10, h: 5.625 }, bcover, true)) { addVideoLinkPill(slide, { x: 0, y: 0, w: 10, h: 5.625 }, binfo.watch, true); stats.onlineVideo = (stats.onlineVideo || 0) + 1; continue_bg = true; }
              var bo = { data: bcover, x: 0, y: 0, w: 10, h: 5.625 };
              if (binfo.watch) bo.hyperlink = { url: binfo.watch, tooltip: 'Fon videosini ochish' };
              if (!continue_bg) slide.addImage(bo);
            }
          }
        } catch (e) { stats.errors++; console.warn('PPTX fon video:', e); }

        var objs = parsed.objects || [];
        var ctx = { idx: i, total: slides.length };
        for (var k = 0; k < objs.length; k++) {
          var el = objs[k];
          if (!el || el.visible === false) continue;
          if (el.animName) stats.anim = (stats.anim || 0) + 1;
          el = stripAnim(el);                 // veb-animatsiyalar PPTX ga o'tmaydi
          try {
            var ok = false, t = el.type;
            if (t === 'textbox' || t === 'i-text' || t === 'text') ok = addTextEl(slide, el);
            else if (t === 'slideButton' || el.isButton) ok = await addButtonEl(slide, el, ctx);
            else if (t === 'embedVideo' || el.isEmbed) ok = await addVideoLinkEl(slide, el, stats);
            else if (el.isVideo || t === 'videoImage') ok = await addLocalVideoEl(slide, el, stats);
            else if (el.isGif || t === 'gifImage') {
              if (stats.gifVideoOk !== false && mp4Mime()) { toast('GIF videoga aylantirilmoqda…'); ok = await addGifAsVideoEl(slide, el, stats); if (!ok) stats.gifVideoOk = false; }
              if (!ok) ok = await addImageEl(slide, el, stats);
            }
            else if (t === 'image') ok = await addImageEl(slide, el, stats);
            else if (el.ssKind === 'table' && el.ssSpec) ok = addTableEl(slide, el);
            else if (el.ssKind === 'chart' && el.ssSpec) ok = addChartEl(pptx, slide, el);
            else if (t === 'rect' || t === 'circle' || t === 'ellipse' || t === 'triangle') ok = await addShapeEl(pptx, slide, el);
            else ok = await addFallbackEl(slide, el);
            if (!ok) {
              if (t === 'image' || el.isGif || t === 'gifImage') {
                var okF = await addFallbackEl(slide, el);
                if (!okF) stats.imgFail++;
              } else stats.skipped++;
            }
          } catch (e) {
            stats.errors++;
            console.warn('PPTX element xato:', el && el.type, e);
          }
        }
      }

      var buf = await pptx.write({ outputType: 'arraybuffer' });
      var outBlob = new Blob([buf], { type: PPTX_MIME });

      if (window.JSZip) {
        try {
          var zip = await JSZip.loadAsync(buf);
          var ct = await zip.file('[Content_Types].xml').async('string');
          if (!/Extension="json"/i.test(ct)) {
            ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="json" ContentType="application/json"/>');
            zip.file('[Content_Types].xml', ct);
          }
          // tugma: havola faqat shakl darajasida qoladi (matn tagiga chizilmaydi, rangi o'zgarmaydi)
          var slideNames = Object.keys(zip.files).filter(function (nm) { return /^ppt\/slides\/slide\d+\.xml$/.test(nm); });
          // v42: videolar slayd ochilishi bilan avtomatik ijro boshlansin
          for (var an = 0; an < slideNames.length; an++) {
            try {
              var axml = await zip.file(slideNames[an]).async('string');
              var bxml = injectVideoAutoplay(axml);
              if (bxml !== axml) zip.file(slideNames[an], bxml);
            } catch (e) { console.warn('PPTX avto-ijro:', e); }
          }
          // v48: slayd o'tishi — PowerPoint'ning o'z <p:transition> elementi
          for (var tn = 0; tn < slideNames.length; tn++) {
            try {
              var tix = parseInt(slideNames[tn].match(/slide(\d+)\.xml$/)[1], 10) - 1;
              var txml = await zip.file(slideNames[tn]).async('string');
              var uxml = injectTransition(txml, slides[tix] && slides[tix].transition);
              if (uxml !== txml) zip.file(slideNames[tn], uxml);
            } catch (e) { console.warn('PPTX o\'tish:', e); }
          }
          for (var sn = 0; sn < slideNames.length; sn++) {
            var sxml = await zip.file(slideNames[sn]).async('string');
            if (sxml.indexOf('SS_Button') < 0) continue;
            sxml = sxml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, function (blk) { return blk.indexOf('name="SS_Button"') < 0 ? blk : blk.replace(/ u="sng"/g, '').replace(/<a:rPr[^>]*>[\s\S]*?<\/a:rPr>/g, function (rp) { return rp.replace(/<a:hlinkClick[^>]*?(?:\/>|>[\s\S]*?<\/a:hlinkClick>)/g, ''); }); });
            zip.file(slideNames[sn], sxml);
          }
          ['mp4:video/mp4', 'mov:video/quicktime'].forEach(function (pair) {
            var ex = pair.split(':')[0], ctp = pair.split(':')[1];
            if (!new RegExp('Extension="' + ex + '"', 'i').test(ct)) ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="' + ex + '" ContentType="' + ctp + '"/>');
          });
          zip.file('[Content_Types].xml', ct);
          var rels = await zip.file('_rels/.rels').async('string');
          if (rels.indexOf('slide-studio/project.json') < 0) {
            rels = rels.replace('</Relationships>',
              '<Relationship Id="rIdSlideStudio1" Type="https://slidestudio.app/relationships/project" Target="slide-studio/project.json"/></Relationships>');
            zip.file('_rels/.rels', rels);
          }
          var payload = {
            version: 2, format: 'slide-studio', title: title,
            slides: slides.map(function (s) { return { json: s.json, imageNumbers: s.imageNumbers || [], transition: s.transition || '' }; }),
            exportedAt: new Date().toISOString()
          };
          zip.file('slide-studio/project.json', JSON.stringify(payload), { compression: 'DEFLATE' });

          var clean = new JSZip();
          var names = Object.keys(zip.files).filter(function (nm) { return !zip.files[nm].dir; });
          names.sort(function (a, b) { return (a === '[Content_Types].xml' ? -1 : 0) - (b === '[Content_Types].xml' ? -1 : 0); });
          for (var ni = 0; ni < names.length; ni++) {
            clean.file(names[ni], await zip.file(names[ni]).async('uint8array'), { createFolders: false });
          }
          var embedded = await clean.generateAsync({ type: 'blob', mimeType: PPTX_MIME, compression: 'DEFLATE', compressionOptions: { level: 6 } });

          var chk = await JSZip.loadAsync(embedded);
          var n = Object.keys(chk.files).filter(function (p) { return /^ppt\/slides\/slide\d+\.xml$/.test(p); }).length;
          if (n === slides.length && chk.file('ppt/presentation.xml') && chk.file('slide-studio/project.json')) outBlob = embedded;
          else console.warn('PPTX tekshiruvi mos kelmadi, oddiy PPTX yuklanadi');
        } catch (e) { console.warn('PPTX loyiha joylash:', e); }
      }

      downloadBlob(outBlob, makeSafeFileName(title, 'pptx'));

      var warn = [];
      if (stats.gifFail) warn.push(stats.gifFail + ' ta GIF');
      if (stats.imgFail) warn.push(stats.imgFail + ' ta rasm');
      if (stats.skipped) warn.push(stats.skipped + ' ta element');
      if (stats.badVideo) warn.push(stats.badVideo + ' ta video (faqat MP4 PowerPoint\u2019da ishlaydi)');
      if (stats.errors) warn.push(stats.errors + ' ta xatolik');
      if (warn.length) toast('PPTX yuklandi, lekin qo\'shilmadi: ' + warn.join(', ') + ((stats.gifFail || stats.imgFail) ? ' (internet/CORS)' : ''), 'error');
      else toast(stats.anim ? 'PPTX yuklandi. Eslatma: PowerPoint\'da animatsiyalar ishlamasligi yoki cheklanishi mumkin' : 'PPTX yuklandi — PowerPoint da ochib, qayta tahrirlash mumkin');
    } catch (e) {
      console.error('PPTX saqlash xatosi:', e);
      toast('PPTX saqlashda xatolik: ' + String((e && e.message) || e), 'error');
    } finally {
      _pptxBusy = false;
    }
  }
  window.exportPPTX = exportPPTX;

  var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var FAB_VER = '5.3.1';

  function parseXml(str) {
    var d = new DOMParser().parseFromString(str, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('XML o\'qilmadi');
    return d;
  }
  function kid(el, ns, name) {
    for (var c = el && el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === name && (!ns || c.namespaceURI === ns)) return c;
    }
    return null;
  }
  function kids(el, ns, name) {
    var out = [];
    for (var c = el && el.firstElementChild; c; c = c.nextElementSibling) {
      if ((!name || c.localName === name) && (!ns || c.namespaceURI === ns)) out.push(c);
    }
    return out;
  }
  function resolvePath(dir, t) {
    if (t.charAt(0) === '/') return t.slice(1);
    var parts = (dir + t).split('/'), out = [];
    parts.forEach(function (p) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }
  async function readRels(zip, part) {
    var dir = part.replace(/[^/]+$/, ''), base = part.split('/').pop();
    var f = zip.file(dir + '_rels/' + base + '.rels');
    var map = {};
    if (!f) return map;
    var d = parseXml(await f.async('string'));
    Array.prototype.forEach.call(d.getElementsByTagName('Relationship'), function (r) {
      var t = r.getAttribute('Target') || '';
      map[r.getAttribute('Id')] = {
        type: r.getAttribute('Type') || '',
        target: r.getAttribute('TargetMode') === 'External' ? t : resolvePath(dir, t)
      };
    });
    return map;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    function f(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    if (s === 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }

  function makeThemeCtx(themeDoc) {
    var colors = {}, fonts = { major: 'Arial', minor: 'Arial' };
    if (themeDoc) {
      var cs = themeDoc.getElementsByTagNameNS(NS_A, 'clrScheme')[0];
      if (cs) kids(cs, NS_A).forEach(function (n) {
        var c = n.firstElementChild;
        if (!c) return;
        var v = c.getAttribute('val') || c.getAttribute('lastClr');
        if (v && /^[0-9a-f]{6}$/i.test(v)) colors[n.localName] = v.toUpperCase();
      });
      var fs = themeDoc.getElementsByTagNameNS(NS_A, 'fontScheme')[0];
      if (fs) {
        var mj = kid(fs, NS_A, 'majorFont'), mn = kid(fs, NS_A, 'minorFont');
        var lj = mj && kid(mj, NS_A, 'latin'), ln = mn && kid(mn, NS_A, 'latin');
        if (lj && lj.getAttribute('typeface')) fonts.major = lj.getAttribute('typeface');
        if (ln && ln.getAttribute('typeface')) fonts.minor = ln.getAttribute('typeface');
      }
    }
    var alias = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
    return {
      fonts: fonts,
      scheme: function (name) { return colors[alias[name] || name] || null; }
    };
  }

  function readColorNode(node, theme) {
    if (!node) return null;
    var c = node.localName === 'solidFill' ? node.firstElementChild : node;
    if (!c) return null;
    var hex = null;
    if (c.localName === 'srgbClr') hex = (c.getAttribute('val') || '').toUpperCase();
    else if (c.localName === 'sysClr') hex = (c.getAttribute('lastClr') || '000000').toUpperCase();
    else if (c.localName === 'schemeClr') hex = theme.scheme(c.getAttribute('val'));
    else if (c.localName === 'prstClr') hex = ({ black: '000000', white: 'FFFFFF' })[c.getAttribute('val')] || '000000';
    if (!hex || !/^[0-9A-F]{6}$/.test(hex)) return null;
    var alpha = 1;
    var lumMod = null, lumOff = null;
    kids(c, NS_A).forEach(function (m) {
      var v = parseFloat(m.getAttribute('val')) / 100000;
      if (!isFinite(v)) return;
      if (m.localName === 'alpha') alpha = v;
      else if (m.localName === 'lumMod') lumMod = v;
      else if (m.localName === 'lumOff') lumOff = v;
    });
    if (lumMod != null || lumOff != null) {
      var hsl = rgbToHsl(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
      var l = hsl[2] * (lumMod == null ? 1 : lumMod) + (lumOff == null ? 0 : lumOff);
      var rgb = hslToRgb(hsl[0], hsl[1], Math.max(0, Math.min(1, l)));
      hex = h2(rgb[0]) + h2(rgb[1]) + h2(rgb[2]);
    }
    return { hex: '#' + hex.toLowerCase(), alpha: alpha };
  }
  function fillOf(spPr, theme) {
    if (!spPr) return null;
    if (kid(spPr, NS_A, 'noFill')) return { none: true };
    var sf = kid(spPr, NS_A, 'solidFill');
    return sf ? readColorNode(sf, theme) : null;
  }
  function isDark(hex) {
    var v = parseInt(hex.replace('#', ''), 16);
    var r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
  }

  function readXfrm(spPr) {
    var x = spPr && kid(spPr, NS_A, 'xfrm');
    if (!x) return null;
    var off = kid(x, NS_A, 'off'), ext = kid(x, NS_A, 'ext');
    if (!off || !ext) return null;
    var fl = function (a) { var v = x.getAttribute(a); return v === '1' || v === 'true'; };
    return {
      x: num(off.getAttribute('x'), 0), y: num(off.getAttribute('y'), 0),
      cx: num(ext.getAttribute('cx'), 0), cy: num(ext.getAttribute('cy'), 0),
      rot: num(x.getAttribute('rot'), 0) / 60000, flipH: fl('flipH'), flipV: fl('flipV')
    };
  }

  function applyGroups(r, groups) {
    var out = { x: r.x, y: r.y, cx: r.cx, cy: r.cy, rot: r.rot, flipH: r.flipH, flipV: r.flipV };
    for (var i = groups.length - 1; i >= 0; i--) {
      var g = groups[i];
      var kx = g.chExtX ? g.extX / g.chExtX : 1, ky = g.chExtY ? g.extY / g.chExtY : 1;
      out.x = g.offX + (out.x - g.chOffX) * kx;
      out.y = g.offY + (out.y - g.chOffY) * ky;
      out.cx *= kx; out.cy *= ky;
    }
    return out;
  }

  function fabricPos(cx, cy, w, h, angDeg) {
    var a = angDeg * Math.PI / 180;
    return {
      left: cx - (w / 2 * Math.cos(a) - h / 2 * Math.sin(a)),
      top: cy - (w / 2 * Math.sin(a) + h / 2 * Math.cos(a))
    };
  }

  function findPlaceholderXfrm(docs, ph) {
    if (!ph) return null;
    var type = ph.getAttribute('type'), idx = ph.getAttribute('idx');
    for (var i = 0; i < docs.length; i++) {
      var tree = docs[i] && docs[i].getElementsByTagNameNS(NS_P, 'spTree')[0];
      if (!tree) continue;
      var sps = kids(tree, NS_P, 'sp');
      for (var j = 0; j < sps.length; j++) {
        var nv = kid(sps[j], NS_P, 'nvSpPr'), nvPr = nv && kid(nv, NS_P, 'nvPr'), p2 = nvPr && kid(nvPr, NS_P, 'ph');
        if (!p2) continue;
        var sameIdx = idx != null && p2.getAttribute('idx') === idx;
        var sameType = type != null && p2.getAttribute('type') === type;
        if (sameIdx || (idx == null && sameType) || (type === 'ctrTitle' && p2.getAttribute('type') === 'title')) {
          var xf = readXfrm(kid(sps[j], NS_P, 'spPr'));
          if (xf) return xf;
        }
      }
    }
    return null;
  }

  function readTextBody(txBody, theme, defaultPt, phType) {
    var paras = kids(txBody, NS_A, 'p');
    var lines = [], best = null, align = null;
    paras.forEach(function (p) {
      var pPr = kid(p, NS_A, 'pPr');
      if (pPr && pPr.getAttribute('algn') && !align) align = pPr.getAttribute('algn');
      var line = '';
      var bu = pPr && kid(pPr, NS_A, 'buChar');
      if (bu) line += (bu.getAttribute('char') || '•') + ' ';
      kids(p, NS_A).forEach(function (n) {
        if (n.localName === 'br') { line += '\n'; return; }
        if (n.localName !== 'r' && n.localName !== 'fld') return;
        var tEl = kid(n, NS_A, 't');
        var t = tEl ? tEl.textContent : '';
        line += t;
        var rPr = kid(n, NS_A, 'rPr');
        var rec = { len: t.length, sz: null, b: false, i: false, u: false, color: null, font: null };
        if (rPr) {
          if (rPr.getAttribute('sz')) rec.sz = num(rPr.getAttribute('sz'), 0) / 100;
          rec.b = rPr.getAttribute('b') === '1' || rPr.getAttribute('b') === 'true';
          rec.i = rPr.getAttribute('i') === '1' || rPr.getAttribute('i') === 'true';
          var u = rPr.getAttribute('u'); rec.u = !!u && u !== 'none';
          rec.color = readColorNode(kid(rPr, NS_A, 'solidFill'), theme);
          var lat = kid(rPr, NS_A, 'latin');
          if (lat && lat.getAttribute('typeface')) {
            var tf = lat.getAttribute('typeface');
            rec.font = tf === '+mj-lt' ? theme.fonts.major : (tf === '+mn-lt' ? theme.fonts.minor : tf);
          }
        }
        if (!best || rec.len > best.len) best = rec;
      });
      lines.push(line);
    });
    var text = lines.join('\n').replace(/\s+$/, '');
    if (!text.trim()) return null;
    best = best || {};
    return {
      text: text,
      pt: best.sz || defaultPt,
      bold: !!best.b || phType === 'title' || phType === 'ctrTitle',
      italic: !!best.i, underline: !!best.u,
      color: best.color, font: best.font || (/title/i.test(phType || '') ? theme.fonts.major : theme.fonts.minor),
      align: ({ l: 'left', ctr: 'center', r: 'right', just: 'justify' })[align] || 'left',
      paraCount: lines.length
    };
  }

  async function importNativePptx(zip, file) {
    var presF = zip.file('ppt/presentation.xml');
    if (!presF) throw new Error('Bu to\'g\'ri PPTX fayl emas (ppt/presentation.xml topilmadi)');
    var pres = parseXml(await presF.async('string'));
    var sz = pres.getElementsByTagNameNS(NS_P, 'sldSz')[0];
    var slideCx = sz ? num(sz.getAttribute('cx'), 9144000) : 9144000;
    var slideCy = sz ? num(sz.getAttribute('cy'), 5143500) : 5143500;
    var scale = Math.min(960 / slideCx, 540 / slideCy);
    var offX = (960 - slideCx * scale) / 2, offY = (540 - slideCy * scale) / 2;

    var presRels = await readRels(zip, 'ppt/presentation.xml');
    var slidePaths = [];
    var idLst = pres.getElementsByTagNameNS(NS_P, 'sldIdLst')[0];
    if (idLst) kids(idLst, NS_P, 'sldId').forEach(function (s) {
      var rid = s.getAttributeNS(NS_R, 'id');
      if (rid && presRels[rid]) slidePaths.push(presRels[rid].target);
    });
    if (!slidePaths.length) {
      Object.keys(zip.files).filter(function (p) { return /^ppt\/slides\/slide\d+\.xml$/.test(p); })
        .sort(function (a, b) { return parseInt(a.match(/(\d+)\.xml$/)[1], 10) - parseInt(b.match(/(\d+)\.xml$/)[1], 10); })
        .forEach(function (p) { slidePaths.push(p); });
    }
    if (!slidePaths.length) throw new Error('PPTX ichida slayd topilmadi');

    var themeFile = zip.file('ppt/theme/theme1.xml');
    var theme = makeThemeCtx(themeFile ? parseXml(await themeFile.async('string')) : null);

    var title = '';
    try {
      var core = zip.file('docProps/core.xml');
      if (core) {
        var cd = parseXml(await core.async('string'));
        var tt = cd.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0];
        if (tt) title = (tt.textContent || '').trim();
      }
    } catch (e) {  }
    if (!title && file && file.name) title = file.name.replace(/\.pptx$/i, '');

    var skipped = { table: 0, chart: 0, other: 0, media: 0 };
    var mediaCache = {};
    async function mediaData(path) {
      if (mediaCache[path] !== undefined) return mediaCache[path];
      var f = zip.file(path);
      if (!f) { mediaCache[path] = null; return null; }
      var ext = (path.split('.').pop() || '').toLowerCase();
      var mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' })[ext];
      if (!mime) { mediaCache[path] = null; skipped.media++; return null; }
      var b64 = await f.async('base64');
      var url = 'data:' + mime + ';base64,' + b64;
      var norm = await normalizeImageData(url);
      var im = norm ? await loadImg(norm) : null;
      var res = norm && im ? { src: norm, w: im.naturalWidth || 1, h: im.naturalHeight || 1, gif: mime === 'image/gif' } : null;
      mediaCache[path] = res;
      return res;
    }

    var result = [];
    for (var si = 0; si < slidePaths.length; si++) {
      var sp = slidePaths[si];
      var sf = zip.file(sp);
      if (!sf) continue;
      var sdoc = parseXml(await sf.async('string'));
      var srels = await readRels(zip, sp);
      var layoutDoc = null, masterDoc = null;
      try {
        var lrel = Object.keys(srels).map(function (k) { return srels[k]; }).filter(function (r) { return /slideLayout$/.test(r.type); })[0];
        if (lrel && zip.file(lrel.target)) {
          layoutDoc = parseXml(await zip.file(lrel.target).async('string'));
          var lrels = await readRels(zip, lrel.target);
          var mrel = Object.keys(lrels).map(function (k) { return lrels[k]; }).filter(function (r) { return /slideMaster$/.test(r.type); })[0];
          if (mrel && zip.file(mrel.target)) masterDoc = parseXml(await zip.file(mrel.target).async('string'));
        }
      } catch (e) {  }

      var out = { version: FAB_VER, objects: [], background: '#ffffff' };

      var bgDone = false;
      var bgDocs = [[sdoc, srels], [layoutDoc, null], [masterDoc, null]];
      for (var bi = 0; bi < bgDocs.length && !bgDone; bi++) {
        var bd = bgDocs[bi][0];
        if (!bd) continue;
        var bg = bd.getElementsByTagNameNS(NS_P, 'bg')[0];
        var bgPr = bg && kid(bg, NS_P, 'bgPr');
        if (!bgPr) continue;
        var bgc = kid(bgPr, NS_A, 'solidFill') ? readColorNode(kid(bgPr, NS_A, 'solidFill'), theme) : null;
        if (bgc) { out.background = bgc.hex; bgDone = true; break; }
        var blip = kid(bgPr, NS_A, 'blipFill');
        var blipEl = blip && kid(blip, NS_A, 'blip');
        var rid2 = blipEl && blipEl.getAttributeNS(NS_R, 'embed');
        if (rid2 && bgDocs[bi][1] && bgDocs[bi][1][rid2]) {
          var md = await mediaData(bgDocs[bi][1][rid2].target);
          if (md) {
            out.backgroundImage = { type: 'image', version: FAB_VER, src: md.src, left: 0, top: 0, scaleX: 960 / md.w, scaleY: 540 / md.h, originX: 'left', originY: 'top' };
            bgDone = true;
          }
        }
      }

      var tree = sdoc.getElementsByTagNameNS(NS_P, 'spTree')[0];
      var phDocs = [layoutDoc, masterDoc];

      /* v49: PPTX ichidagi HAQIQIY jadval va diagrammalar — tahrirlanadigan jadval/grafik obyektlari sifatida */
      var importGraphicFrame = async function (frame, gdata, uri, groups, srels2) {
        if (!window.ssSpecToJSON || !gdata) return null;
        var fx = kid(frame, NS_P, 'xfrm');
        var off = fx && kid(fx, NS_A, 'off'), ext = fx && kid(fx, NS_A, 'ext');
        if (!off || !ext) return null;
        var r0 = applyGroups({ x: num(off.getAttribute('x'), 0), y: num(off.getAttribute('y'), 0), cx: num(ext.getAttribute('cx'), 0), cy: num(ext.getAttribute('cy'), 0), rot: 0, flipH: false, flipV: false }, groups);
        var L = offX + r0.x * scale, T = offY + r0.y * scale, W2 = Math.max(40, r0.cx * scale), H2 = Math.max(30, r0.cy * scale);
        if (/table/i.test(uri)) {
          var tbl = gdata.getElementsByTagNameNS(NS_A, 'tbl')[0];
          if (!tbl) return null;
          var rows = [], hFill = null, hCol = null, fsPx = 0, rowHs = [];
          kids(tbl, NS_A, 'tr').forEach(function (tr, ri) {
            var cells = [];
            rowHs.push(num(tr.getAttribute('h'), 0));
            kids(tr, NS_A, 'tc').forEach(function (tc, ci) {
              if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') { cells.push(''); return; }
              var tb = kid(tc, NS_A, 'txBody'), parts = [];
              if (tb) kids(tb, NS_A, 'p').forEach(function (p) {
                var s = ''; kids(p, NS_A).forEach(function (rn) { if (rn.localName === 'r' || rn.localName === 'fld') { var te = kid(rn, NS_A, 't'); s += te ? te.textContent : ''; } else if (rn.localName === 'br') s += ' '; });
                if (s.trim()) parts.push(s.trim());
              });
              cells.push(parts.join(' '));
              if (ri === 0 && ci === 0) {
                var pr = kid(tc, NS_A, 'tcPr'), cf = pr && fillOf(pr, theme);
                if (cf && !cf.none) hFill = cf.hex;
                var rp = tb && tb.getElementsByTagNameNS(NS_A, 'rPr')[0];
                if (rp) { var cc = readColorNode(kid(rp, NS_A, 'solidFill'), theme); if (cc) hCol = cc.hex; }
              }
              if (!fsPx) { var rp2 = tb && tb.getElementsByTagNameNS(NS_A, 'rPr')[0]; if (rp2 && rp2.getAttribute('sz')) fsPx = num(rp2.getAttribute('sz'), 0) / 100 * 12700 * scale; }
            });
            if (cells.length) rows.push(cells);
          });
          if (!rows.length) return null;
          var spec = { rows: rows, left: L, top: T, width: W2, height: H2, header: true };
          if (hFill) spec.headerFill = hFill; if (hCol) spec.headerColor = hCol; if (fsPx) spec.fontSize = Math.round(fsPx);
          return window.ssSpecToJSON('table', spec);
        }
        if (/chart/i.test(uri)) {
          var ce = gdata.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart')[0];
          var rid3 = ce && ce.getAttributeNS(NS_R, 'id');
          if (!rid3 || !srels2[rid3] || !zip.file(srels2[rid3].target)) return null;
          var cdoc = parseXml(await zip.file(srels2[rid3].target).async('string'));
          var NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
          var plotArea = cdoc.getElementsByTagNameNS(NS_C, 'plotArea')[0];
          if (!plotArea) return null;
          var kindMap = { barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'doughnut', areaChart: 'line' };
          var chartEl = kids(plotArea, NS_C).filter(function (e) { return kindMap[e.localName]; })[0];
          if (!chartEl) return null;
          var vals = function (node) { return node ? Array.prototype.map.call(node.getElementsByTagNameNS(NS_C, 'v'), function (v) { return v.textContent; }) : []; };
          var labels = [], series = [], colors = [];
          kids(chartEl, NS_C, 'ser').forEach(function (ser, si) {
            if (!labels.length) labels = vals(kid(ser, NS_C, 'cat')).map(String);
            var nm = vals(kid(ser, NS_C, 'tx'))[0] || '';
            series.push({ name: nm, values: vals(kid(ser, NS_C, 'val')).map(function (v) { return parseFloat(v) || 0; }) });
            var sp2 = kid(ser, NS_C, 'spPr'), cl = sp2 && (fillOf(sp2, theme) || (kid(sp2, NS_A, 'ln') && readColorNode(kid(kid(sp2, NS_A, 'ln'), NS_A, 'solidFill'), theme)));
            if (cl && !cl.none && (kindMap[chartEl.localName] !== 'pie' && kindMap[chartEl.localName] !== 'doughnut')) colors[si] = cl.hex;
            if (kindMap[chartEl.localName] === 'pie' || kindMap[chartEl.localName] === 'doughnut') {
              kids(ser, NS_C, 'dPt').forEach(function (dp) {
                var ix = num((kid(dp, NS_C, 'idx') || { getAttribute: function () { return 0; } }).getAttribute('val'), 0);
                var dsp = kid(dp, NS_C, 'spPr'), dc = dsp && fillOf(dsp, theme);
                if (dc && !dc.none) colors[ix] = dc.hex;
              });
            }
          });
          if (!series.length) return null;
          var titleEl = cdoc.getElementsByTagNameNS(NS_C, 'title')[0], ttl = '';
          if (titleEl) ttl = Array.prototype.map.call(titleEl.getElementsByTagNameNS(NS_A, 't'), function (t) { return t.textContent; }).join('');
          var spec2 = { chart: kindMap[chartEl.localName], labels: labels, series: series, left: L, top: T, width: W2, height: H2, title: ttl };
          var cc2 = colors.filter(Boolean); if (cc2.length) spec2.colors = colors.map(function (c, i) { return c || cc2[i % cc2.length]; });
          return window.ssSpecToJSON('chart', spec2);
        }
        return null;
      };

      var walk = async function (container, groups) {
        var nodes = kids(container);
        for (var ni = 0; ni < nodes.length; ni++) {
          var n = nodes[ni];
          try {
            if (n.namespaceURI !== NS_P) continue;
            var ln = n.localName;
            if (ln === 'grpSp') {
              var gp = kid(n, NS_P, 'grpSpPr'), gx = gp && kid(gp, NS_A, 'xfrm');
              if (gx) {
                var o1 = kid(gx, NS_A, 'off'), e1 = kid(gx, NS_A, 'ext'), co = kid(gx, NS_A, 'chOff'), ce = kid(gx, NS_A, 'chExt');
                if (o1 && e1 && co && ce) {
                  await walk(n, groups.concat([{
                    offX: num(o1.getAttribute('x'), 0), offY: num(o1.getAttribute('y'), 0),
                    extX: num(e1.getAttribute('cx'), 1), extY: num(e1.getAttribute('cy'), 1),
                    chOffX: num(co.getAttribute('x'), 0), chOffY: num(co.getAttribute('y'), 0),
                    chExtX: num(ce.getAttribute('cx'), 1), chExtY: num(ce.getAttribute('cy'), 1)
                  }]));
                  continue;
                }
              }
              await walk(n, groups);
              continue;
            }
            if (ln === 'graphicFrame') {
              var gd = n.getElementsByTagNameNS(NS_A, 'graphicData')[0];
              var uri = gd ? (gd.getAttribute('uri') || '') : '';
              var okObj = null;
              try { okObj = await importGraphicFrame(n, gd, uri, groups, srels); } catch (e) { console.warn('PPTX jadval/diagramma:', e); }
              if (okObj) { out.objects.push(okObj); continue; }
              if (/table/i.test(uri)) skipped.table++; else if (/chart/i.test(uri)) skipped.chart++; else skipped.other++;
              continue;
            }
            if (ln !== 'sp' && ln !== 'pic' && ln !== 'cxnSp') continue;

            var spPr = kid(n, NS_P, 'spPr');
            var nv = kid(n, NS_P, ln === 'sp' ? 'nvSpPr' : (ln === 'pic' ? 'nvPicPr' : 'nvCxnSpPr'));
            var nvPr = nv && kid(nv, NS_P, 'nvPr');
            var ph = nvPr && kid(nvPr, NS_P, 'ph');
            var xf = readXfrm(spPr) || findPlaceholderXfrm(phDocs, ph);
            if (!xf) continue;
            xf = applyGroups(xf, groups);
            var W = xf.cx * scale, H = xf.cy * scale;
            var CX = offX + (xf.x + xf.cx / 2) * scale, CY = offY + (xf.y + xf.cy / 2) * scale;
            var pos = fabricPos(CX, CY, W, H, xf.rot);

            if (ln === 'pic') {
              var blipF = kid(n, NS_P, 'blipFill'), blipN = blipF && kid(blipF, NS_A, 'blip');
              var rid = blipN && blipN.getAttributeNS(NS_R, 'embed');
              if (!rid || !srels[rid]) continue;
              var md2 = await mediaData(srels[rid].target);
              if (!md2) continue;
              var src = blipF && kid(blipF, NS_A, 'srcRect');
              var l = src ? num(src.getAttribute('l'), 0) / 100000 : 0, t = src ? num(src.getAttribute('t'), 0) / 100000 : 0;
              var r = src ? num(src.getAttribute('r'), 0) / 100000 : 0, b = src ? num(src.getAttribute('b'), 0) / 100000 : 0;
              var cw = Math.max(1, md2.w * (1 - l - r)), ch = Math.max(1, md2.h * (1 - t - b));
              out.objects.push({
                type: 'image', version: FAB_VER, originX: 'left', originY: 'top',
                left: pos.left, top: pos.top, width: cw, height: ch,
                scaleX: W / cw, scaleY: H / ch,
                flipX: !!xf.flipH, flipY: !!xf.flipV, angle: xf.rot,
                cropX: md2.w * l, cropY: md2.h * t, src: md2.src, crossOrigin: null, filters: []
              });
              continue;
            }

            if (ln === 'cxnSp') {
              var lnN = spPr && kid(spPr, NS_A, 'ln');
              var lc = lnN && readColorNode(kid(lnN, NS_A, 'solidFill'), theme);
              var lw = lnN ? num(lnN.getAttribute('w'), 12700) : 12700;
              var x1 = xf.flipH ? CX + W / 2 : CX - W / 2, x2 = xf.flipH ? CX - W / 2 : CX + W / 2;
              var y1 = xf.flipV ? CY + H / 2 : CY - H / 2, y2 = xf.flipV ? CY - H / 2 : CY + H / 2;
              out.objects.push({
                type: 'line', version: FAB_VER, originX: 'left', originY: 'top',
                left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
                x1: x1 - Math.min(x1, x2) - Math.abs(x2 - x1) / 2, y1: y1 - Math.min(y1, y2) - Math.abs(y2 - y1) / 2,
                x2: x2 - Math.min(x1, x2) - Math.abs(x2 - x1) / 2, y2: y2 - Math.min(y1, y2) - Math.abs(y2 - y1) / 2,
                stroke: lc ? lc.hex : '#333333', strokeWidth: Math.max(1, lw * scale), fill: null
              });
              continue;
            }

            var geom = spPr && kid(spPr, NS_A, 'prstGeom');
            var prst = geom ? geom.getAttribute('prst') : 'rect';
            var fill = fillOf(spPr, theme);
            var lnS = spPr && kid(spPr, NS_A, 'ln');
            var stroke = lnS && !kid(lnS, NS_A, 'noFill') ? readColorNode(kid(lnS, NS_A, 'solidFill'), theme) : null;
            var strokeW = stroke ? Math.max(0.5, num(lnS.getAttribute('w'), 12700) * scale) : 0;
            var txBody = kid(n, NS_P, 'txBody');
            var isPlaceholder = !!ph;
            var hasVisual = (fill && !fill.none) || stroke;
            if (hasVisual && !isPlaceholder || (hasVisual && isPlaceholder)) {
              var base = {
                version: FAB_VER, originX: 'left', originY: 'top', left: pos.left, top: pos.top,
                angle: xf.rot, scaleX: 1, scaleY: 1,
                fill: fill && !fill.none ? fill.hex : 'rgba(0,0,0,0)',
                opacity: fill && !fill.none ? fill.alpha : 1,
                stroke: stroke ? stroke.hex : null, strokeWidth: strokeW
              };
              if (prst === 'ellipse') {
                out.objects.push(Object.assign({ type: 'ellipse', width: W, height: H, rx: W / 2, ry: H / 2 }, base));
              } else if (prst === 'triangle') {
                out.objects.push(Object.assign({ type: 'triangle', width: W, height: H }, base));
              } else {
                var rr = 0;
                if (prst === 'roundRect') {
                  var gd2 = geom && geom.getElementsByTagNameNS(NS_A, 'gd')[0];
                  var adj = gd2 ? num((gd2.getAttribute('fmla') || '').replace(/[^\d.-]/g, ''), 16667) : 16667;
                  rr = Math.min(W, H) * adj / 100000;
                }
                out.objects.push(Object.assign({ type: 'rect', width: W, height: H, rx: rr, ry: rr }, base));
              }
            }

            if (txBody) {
              var phType = ph ? (ph.getAttribute('type') || 'body') : '';
              var defPt = /title/i.test(phType) ? 40 : (phType === 'subTitle' ? 24 : 18);
              var tb = readTextBody(txBody, theme, defPt, phType);
              if (tb) {
                var bp = kid(txBody, NS_A, 'bodyPr');
                var lIns = bp && bp.getAttribute('lIns') != null ? num(bp.getAttribute('lIns'), 91440) : 91440;
                var rIns = bp && bp.getAttribute('rIns') != null ? num(bp.getAttribute('rIns'), 91440) : 91440;
                var tIns = bp && bp.getAttribute('tIns') != null ? num(bp.getAttribute('tIns'), 45720) : 45720;
                var bIns = bp && bp.getAttribute('bIns') != null ? num(bp.getAttribute('bIns'), 45720) : 45720;
                var anchor = bp ? bp.getAttribute('anchor') : null;
                var fontPx = tb.pt * 12700 * scale;
                var tw = Math.max(10, W - (lIns + rIns) * scale);
                var th = Math.max(10, H - (tIns + bIns) * scale);
                var est = tb.paraCount * fontPx * 1.3;
                var dy = 0;
                if (anchor === 'ctr') dy = Math.max(0, (th - est) / 2);
                else if (anchor === 'b') dy = Math.max(0, th - est);
                var tpos = fabricPos(CX, CY, W, H, xf.rot);
                var ang = xf.rot * Math.PI / 180;
                var lx = lIns * scale, ly = tIns * scale + dy;
                var tcol = tb.color ? tb.color.hex : ((fill && !fill.none && isDark(fill.hex)) ? '#ffffff' : '#1f1f1f');
                out.objects.push({
                  type: 'textbox', version: FAB_VER, originX: 'left', originY: 'top',
                  left: tpos.left + lx * Math.cos(ang) - ly * Math.sin(ang),
                  top: tpos.top + lx * Math.sin(ang) + ly * Math.cos(ang),
                  width: tw, height: th, angle: xf.rot, scaleX: 1, scaleY: 1,
                  text: tb.text, fontSize: Math.max(4, Math.round(fontPx * 10) / 10),
                  fontFamily: tb.font || 'Arial', fill: tcol,
                  fontWeight: tb.bold ? 'bold' : 'normal', fontStyle: tb.italic ? 'italic' : 'normal',
                  underline: !!tb.underline, textAlign: tb.align, lineHeight: 1.16, splitByGrapheme: true
                });
              }
            }
          } catch (e) {
            skipped.other++;
            console.warn('PPTX import element:', e);
          }
        }
      };
      if (tree) await walk(tree, []);
      result.push({ json: JSON.stringify(out), thumb: '', imageNumbers: [] });
    }
    return { slides: result, title: title, skipped: skipped };
  }

  async function applyImportedSlides(list, title) {
    saveCurrentSlideState();
    if (title) {
      projectTitle = title;
      var titleEl = document.getElementById('presentationTitle');
      if (titleEl) titleEl.innerText = projectTitle;
    }
    slides = list.map(function (s) {
      return { json: s.json || '{}', thumb: s.thumb || '', imageNumbers: s.imageNumbers || [], transition: s.transition || '' };
    });
    activeIndex = 0;
    try { reindexAllSlideImages(); } catch (e) {  }
    try { bumpObjectIdCounterFromSlides(); } catch (e) {  }
    renderSidebar();
    await loadSlideCanvasAsync(0);
    try { GifBackground.applyFromSlide(slides[0].json); } catch (e) {  }
    updateSlideCounterUI();
    try { updateAllImageBadges(); } catch (e) {  }
    try { await Promise.all(slides.map(function (_, i) { return refreshSlideThumb(i); })); } catch (e) {  }
    recordGlobalState();
  }

  async function importPptxClient(file) {
    Swal.fire({ title: 'PPTX ochilmoqda…', allowOutsideClick: false, didOpen: function () { Swal.showLoading(); } });
    try {
      if (!window.JSZip) { Swal.fire('Xato', 'JSZip yuklanmadi. Internetni tekshiring.', 'error'); return; }
      var zip = await JSZip.loadAsync(await file.arrayBuffer());

      var projFile = zip.file('slide-studio/project.json');
      if (projFile) {
        try {
          var data = JSON.parse(await projFile.async('string'));
          var list = data.slides || [];
          if (list.length) {
            await applyImportedSlides(list, data.title);
            Swal.fire({ icon: 'success', title: 'PPTX ochildi', text: list.length + " ta slayd (to'liq tahrirlash mumkin).", timer: 2200, showConfirmButton: false });
            return;
          }
        } catch (e) { console.warn('Ichki loyiha o\'qilmadi, oddiy PPTX sifatida o\'qiladi:', e); }
      }

      var res = await importNativePptx(zip, file);
      if (!res.slides.length) throw new Error('PPTX ichida slayd topilmadi');
      try { if (window.ssAdaptImported) res.slides = res.slides.map(function (s) { return Object.assign({}, s, { json: window.ssAdaptImported(s.json) }); }); } catch (e) { console.warn('adapt:', e); }
      await applyImportedSlides(res.slides, res.title);
      var sk = res.skipped, notes = [];
      if (sk.table) notes.push(sk.table + ' ta jadval');
      if (sk.chart) notes.push(sk.chart + ' ta diagramma');
      if (sk.media) notes.push(sk.media + ' ta qo\'llab-quvvatlanmaydigan rasm (EMF/WMF)');
      if (sk.other) notes.push(sk.other + ' ta boshqa element');
      Swal.fire({
        icon: notes.length ? 'info' : 'success', title: 'PPTX ochildi',
        html: res.slides.length + ' ta slayd o\'qildi (matn, rasm, shakl, fon tahrirlanadi).' +
          (notes.length ? '<br><small>O\'tkazib yuborildi: ' + notes.join(', ') + '</small>' : ''),
        timer: notes.length ? undefined : 2400, showConfirmButton: notes.length > 0
      });
    } catch (e) {
      console.error(e);
      Swal.fire('PPTX xato', (e && e.message) || String(e), 'error');
    }
  }
  window.importPptxClient = importPptxClient;
  window.ssApplyImportedSlides = applyImportedSlides;
})();
