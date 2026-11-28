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
    var low = first.toLowerCase();
    var g = {
      'sans-serif': 'Arial', 'serif': 'Times New Roman', 'monospace': 'Courier New',
      'system-ui': 'Arial', 'cursive': 'Comic Sans MS', 'fantasy': 'Impact',
      'montserrat': 'Arial', 'roboto': 'Arial', 'inter': 'Arial', 'poppins': 'Arial',
      'opensans': 'Arial', 'open sans': 'Arial', 'nunito': 'Arial', 'lato': 'Arial',
      'source sans pro': 'Arial', 'helvetica': 'Arial', 'helvetica neue': 'Arial',
      // v67: tor (condensed) shriftlar Arial'da kengayib, qator ko'payib ketmasin
      'oswald': 'Arial Narrow', 'bebas neue': 'Arial Narrow', 'anton': 'Arial Narrow'
    };
    // Maxsus shriftlar ko'p kompyuterda yo'q — Arial/Calibri ishlatiladi (oʻ gʻ harflari yaxshi chiqadi)
    if (g[low]) return g[low];
    // Faqat Windows/macOS standartlari qolsin
    var safe = /^(arial|arial black|arial narrow|calibri|cambria|georgia|times new roman|courier new|verdana|tahoma|trebuchet ms|comic sans ms|impact|segoe ui|consolas)$/i;
    return safe.test(first) ? first : 'Arial';
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

  /* ==================================================================
   * v67: 1:1 GEOMETRIYA STANDARTI (Fabric.js ⇄ PptxGenJS)
   *  - 1 px = 1/96 dyuym = 0.75 pt = 9525 EMU (960×540 px slayd = 10×5.625 dyuym, 16:9).
   *  - Fabric obyektning tashqi qutisi chegarani (stroke) ham o'z ichiga oladi:
   *      strokeUniform=false: (width + sw) × scale,   strokeUniform=true: width × scale + sw
   *    PowerPoint'da chiziq shakl geometriyasi chetida (markazda) chiziladi — shuning uchun
   *    markaz tashqi qutidan olinadi, quti esa sof geometriya (width × scale) bo'ladi.
   *    Natijada qalin chegarali kartochka PowerPoint'da ham aynan shu joyda turadi.
   * ================================================================== */
  function r6(v) { return Math.round(v * 1e6) / 1e6; }   // dyuym, ~1 EMU aniqlik
  function absScale(el) { return { sx: Math.abs(num(el.scaleX, 1)) || 1, sy: Math.abs(num(el.scaleY, 1)) || 1 }; }
  function fullDims(el, w0, h0) {
    var s = absScale(el), sw = Math.max(0, num(el.strokeWidth, 0));
    if (el.strokeUniform) return { w: w0 * s.sx + sw, h: h0 * s.sy + sw };
    return { w: (w0 + sw) * s.sx, h: (h0 + sw) * s.sy };
  }
  function centerOf(el, fw, fh) {
    var left = num(el.left, 0), top = num(el.top, 0);
    var ang = num(el.angle, 0) * Math.PI / 180;
    var ox = el.originX || 'left', oy = el.originY || 'top';
    var dx = ox === 'center' ? 0 : (ox === 'right' ? -fw / 2 : fw / 2);
    var dy = oy === 'center' ? 0 : (oy === 'bottom' ? -fh / 2 : fh / 2);
    return { x: left + dx * Math.cos(ang) - dy * Math.sin(ang), y: top + dx * Math.sin(ang) + dy * Math.cos(ang) };
  }
  /** Shaklning sof geometriya qutisi (dyuymda). w0/h0 — Fabric'dagi (masshtabsiz) width/height. */
  function placeGeom(el, w0, h0, allowZero) {
    var s = absScale(el), fd = fullDims(el, w0, h0), c = centerOf(el, fd.w, fd.h);
    var gw = w0 * s.sx, gh = h0 * s.sy;
    if (!allowZero) { gw = Math.max(gw, 1); gh = Math.max(gh, 1); }
    var angDeg = num(el.angle, 0);
    var rot = Math.round((((angDeg % 360) + 360) % 360) * 100) / 100;
    return { x: r6((c.x - gw / 2) * SX), y: r6((c.y - gh / 2) * SY), w: r6(gw * SX), h: r6(gh * SY), rotate: rot, cx: c.x, cy: c.y, gw: gw, gh: gh };
  }
  function scaleAvgOf(el) { var s = absScale(el); return (s.sx + s.sy) / 2; }
  /** Chegara (stroke): rang, qalinlik (pt), uzuq chiziq */
  function lineOf(el) {
    var s = parseColor(el.stroke), sw = num(el.strokeWidth, 0);
    if (!s || !(sw > 0)) return null;
    var wpx = el.strokeUniform ? sw : sw * scaleAvgOf(el);
    var o = { color: s.hex, width: Math.max(0.1, Math.round(wpx * 0.75 * 100) / 100) };
    var tr = transparencyOf(s, el.opacity);
    if (tr > 0) o.transparency = tr;
    var da = el.strokeDashArray;
    if (Array.isArray(da) && da.length >= 2 && da[0] > 0) o.dashType = (da[0] <= sw * 1.5) ? 'sysDot' : (da[0] >= sw * 6 ? 'lgDash' : 'dash');
    return o;
  }
  function fillOptsOf(el) {
    var f = el.fill;
    if (f && typeof f === 'object' && !Array.isArray(f.colorStops)) return undefined;    // naqsh (pattern) — fallback
    var c = parseColor(f);
    return c ? { color: c.hex, transparency: transparencyOf(c, el.opacity) } : null;
  }
  /**
   * Fabric soyasi → PowerPoint <a:outerShdw>.
   *  Fabric: offsetX/offsetY px (obyekt masshtabi bilan, nonScaling bo'lmasa), blur px; soya obyekt bilan aylanmaydi.
   *  PPTX : dist (pt) = √(ox²+oy²)·0.75, dir = atan2(oy, ox) (soat yo'nalishida), blurRad (pt), rotWithShape=0.
   *  PptxGenJS 3.12 xatolarini chetlab o'tamiz: blur 0 → 8pt, offset 0 → 4pt, angle 0 → 270° bo'lib qolardi.
   */
  function shadowOf(el) {
    var sh = el.shadow;
    if (!sh || typeof sh !== 'object') return null;
    var c = parseColor(sh.color) || { hex: '000000', alpha: 1 };
    var s = sh.nonScaling ? { sx: 1, sy: 1 } : absScale(el);
    var ox = num(sh.offsetX, 0) * s.sx, oy = num(sh.offsetY, 0) * s.sy;
    var blur = Math.max(0, num(sh.blur, 0)) * (s.sx + s.sy) / 2;
    var alpha = c.alpha * (el.opacity == null ? 1 : num(el.opacity, 1));
    var dist = Math.sqrt(ox * ox + oy * oy);
    if (alpha <= 0.004 || (dist < 0.05 && blur < 0.05)) return null;
    var ang = dist < 0.05 ? 90 : Math.round(((Math.atan2(oy, ox) * 180 / Math.PI) % 360 + 360) % 360);
    if (ang === 0 || ang === 360) ang = 359;      // 0 qiymati kutubxonada 270° ga aylanadi (≈0.02·dist px farq)
    return {
      type: 'outer', color: c.hex,
      blur: blur < 0.05 ? 0.00001 : Math.round(blur * 0.75 * 100) / 100,      // → blurRad="0" (qattiq soya)
      offset: dist < 0.05 ? 0.00001 : Math.round(dist * 0.75 * 1000) / 1000,
      angle: ang,
      opacity: Math.round(Math.min(1, alpha) * 1000) / 1000
    };
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

  var FABRIC_FS_MULT = 1.13;          // fabric.Text.prototype._fontSizeMult — qator balandligi = fontSize × lineHeight × 1.13
  var FABRIC_FS_FRACTION = 0.222;     // fabric.Text.prototype._fontSizeFraction — tayanch chiziq (baseline) siljishi
  // Shriftning pastki qismi (descent / em) — PowerPoint aniq qator oralig'ida birinchi qatorni L − descent ga qo'yadi
  var FONT_DESCENT = { 'arial': 0.212, 'arial black': 0.21, 'arial narrow': 0.212, 'calibri': 0.25, 'cambria': 0.222, 'georgia': 0.219,
    'times new roman': 0.216, 'courier new': 0.3, 'verdana': 0.21, 'tahoma': 0.207, 'trebuchet ms': 0.222, 'comic sans ms': 0.29,
    'impact': 0.21, 'segoe ui': 0.25, 'consolas': 0.26 };
  /** Fabric'ning o'zi qanday qatorlarga bo'lsa — PowerPoint'ga ham aynan shu qatorlar (boshqa shriftda ham qator soni o'zgarmaydi) */
  function wrappedLines(el, text) {
    if (typeof fabric === 'undefined' || el.type !== 'textbox') return null;
    try {
      var tb = new fabric.Textbox(text, {
        width: num(el.width, 400), fontSize: num(el.fontSize, 24), fontFamily: el.fontFamily || 'Arial',
        fontWeight: el.fontWeight || 'normal', fontStyle: el.fontStyle || 'normal', charSpacing: num(el.charSpacing, 0),
        splitByGrapheme: !!el.splitByGrapheme, lineHeight: num(el.lineHeight, 1.16)
      });
      var ls = (tb._textLines || []).map(function (l) { return l.join('').replace(/\s+$/, ''); });
      return ls.length ? ls : null;
    } catch (e) { return null; }
  }

  /* v67: belgi darajasidagi uslublar (Fabric «styles»: o'lcham, qalin, kursiv, rang, shrift) — PowerPoint'da alohida bo'laklar (run).
     Har bir (Fabric bo'lgan) qator — alohida paragraf; qator qadami shu qatordagi ENG KATTA shriftdan. */
  function hasCharStyles(el) {
    var st = el.styles;
    if (!st || typeof st !== 'object') return false;
    if (Array.isArray(st)) return st.length > 0;
    return Object.keys(st).some(function (l) { return st[l] && Object.keys(st[l]).length; });
  }
  function richLines(el, text) {
    if (typeof fabric === 'undefined') return null;
    try {
      var tb = new fabric.Textbox(text, {
        width: num(el.width, 400), fontSize: num(el.fontSize, 24), fontFamily: el.fontFamily || 'Arial',
        fontWeight: el.fontWeight || 'normal', fontStyle: el.fontStyle || 'normal', charSpacing: num(el.charSpacing, 0),
        splitByGrapheme: !!el.splitByGrapheme, lineHeight: num(el.lineHeight, 1.16), styles: el.styles || {}
      });
      var out = [];
      for (var i = 0; i < tb._textLines.length; i++) {
        var map = tb._styleMap ? tb._styleMap[i] : { line: i, offset: 0 };
        var chars = tb._textLines[i], line = [], maxFs = 0;
        for (var j = 0; j < chars.length; j++) {
          var sd = (el.styles && el.styles[map.line] && el.styles[map.line][map.offset + j]) || {};
          var st = {
            fontSize: num(sd.fontSize, num(el.fontSize, 24)), fontWeight: sd.fontWeight || el.fontWeight || 'normal',
            fontStyle: sd.fontStyle || el.fontStyle || 'normal', fill: sd.fill || el.fill, fontFamily: sd.fontFamily || el.fontFamily,
            underline: sd.underline != null ? sd.underline : !!el.underline
          };
          maxFs = Math.max(maxFs, st.fontSize);
          line.push({ ch: chars[j], st: st });
        }
        while (line.length && /\s/.test(line[line.length - 1].ch)) line.pop();
        out.push({ chars: line, maxFs: maxFs || num(el.fontSize, 24) });
      }
      return out;
    } catch (e) { return null; }
  }

  function addTextEl(slide, el) {
    var text = String(el.text == null ? '' : el.text).replace(/\r\n?/g, '\n').replace(/[​-‍﻿­]/g, '');
    var bg = parseColor(el.backgroundColor);
    if (!text.trim() && !bg) return true;
    var w0 = Math.max(10, num(el.width, 400)), h0 = Math.max(10, num(el.height, 60));
    var b = placeGeom(el, w0, h0);
    var fsPx = num(el.fontSize, 24) * scaleAvgOf(el);
    var pt = Math.max(1, Math.round(fsPx * 0.75 * 100) / 100);
    var col = parseColor(el.fill) || { hex: '1F1F1F', alpha: 1 };
    var weight = el.fontWeight;
    var bold = weight === 'bold' || weight === 'bolder' || num(weight, 400) >= 600;
    var italic = el.fontStyle === 'italic' || el.fontStyle === 'oblique';
    var align = ({ left: 'left', center: 'center', right: 'right', justify: 'justify', 'justify-left': 'justify', 'justify-center': 'justify', 'justify-right': 'justify' })[el.textAlign] || 'left';
    var lh = Math.max(0.5, Math.min(3, num(el.lineHeight, 1.16)));
    // v67: qator qadami ANIQ (pt) — Fabric bilan bir xil: fontSize × lineHeight × 1.13
    var lineSp = Math.round(pt * lh * FABRIC_FS_MULT * 100) / 100;
    var lines = align !== 'justify' ? wrappedLines(el, text) : null;
    var outText = lines ? lines.join('\n') : text;
    var n = lines ? lines.length : (text.split('\n').length || 1);
    // shrift metrikasi biroz farq qilsa ham qator buzilmasin — kenglik zaxirasi faqat matn OQADIGAN tomonga
    var pad = Math.min(0.15, Math.max(0.04, b.w * 0.025));
    var x = b.x;
    if (align === 'center' || align === 'justify' || b.rotate) x = b.x - pad / 2;
    else if (align === 'right') x = b.x - pad;
    var hNeed = n * lineSp / 72;
    var h = b.rotate ? b.h : Math.max(b.h, hNeed);
    // Birinchi qator tayanch chizig'i: Fabric = fontSize·1.13·(1 − 0.222), PowerPoint = L − descent.
    // Farqicha qutini yuqoriga suramiz — matn saytdagi bilan bir xil balandlikda turadi.
    var face = cleanFont(el.fontFamily);
    var desc = FONT_DESCENT[face.toLowerCase()] || 0.212;
    var shiftPx = fsPx * (lh * FABRIC_FS_MULT - desc - FABRIC_FS_MULT * (1 - FABRIC_FS_FRACTION));
    var y = b.y;
    if (!b.rotate && isFinite(shiftPx)) { y = b.y - shiftPx * SY; h = h + Math.max(0, shiftPx) * SY; }
    var opts = {
      x: r4(x), y: r6(y), w: r4(b.w + pad), h: r4(h),
      fontSize: pt, fontFace: face, color: col.hex,
      bold: bold, italic: italic, align: align, valign: 'top',
      margin: 0, wrap: true, fit: 'none', lineSpacing: lineSp
    };
    if (el.underline) opts.underline = { style: 'sng' };
    if (el.linkUrl && /^(https?:|mailto:)/i.test(el.linkUrl)) opts.hyperlink = { url: el.linkUrl };
    if (el.linethrough) opts.strike = 'sngStrike';
    if (b.rotate) opts.rotate = b.rotate;
    if (el.flipX) opts.flipH = true;
    if (el.flipY) opts.flipV = true;
    var cs = num(el.charSpacing, 0);
    if (cs) opts.charSpacing = Math.round(cs / 1000 * pt * 100) / 100;
    var tr = transparencyOf(col, el.opacity);
    if (tr > 0) opts.transparency = tr;
    if (bg) opts.fill = { color: bg.hex, transparency: transparencyOf(bg, el.opacity) };
    var ts = parseColor(el.stroke);
    if (ts && num(el.strokeWidth, 0) > 0) opts.outline = { color: ts.hex, size: Math.max(0.1, Math.round(num(el.strokeWidth, 1) * scaleAvgOf(el) * 0.75 * 100) / 100) };
    var sh = shadowOf(el);
    if (sh && !bg) opts.shadow = sh;          // to'ldirilmagan matn qutisida soya harflarga tushadi (Fabric kabi)
    var rich = hasCharStyles(el) ? richLines(el, text) : null;
    if (rich && rich.length) {
      var sAvg = scaleAvgOf(el), runs = [], totalPt = 0;
      rich.forEach(function (ln, li) {
        var lnPt = Math.round(ln.maxFs * sAvg * 0.75 * lh * FABRIC_FS_MULT * 100) / 100;
        totalPt += lnPt;
        var cur = null;
        var flush = function () { if (cur) { runs.push(cur); cur = null; } };
        ln.chars.forEach(function (c) {
          var st = c.st, cc = parseColor(st.fill) || col;
          var ro = {
            fontSize: Math.max(1, Math.round(st.fontSize * sAvg * 0.75 * 100) / 100), fontFace: cleanFont(st.fontFamily),
            bold: st.fontWeight === 'bold' || st.fontWeight === 'bolder' || num(st.fontWeight, 400) >= 600,
            italic: st.fontStyle === 'italic' || st.fontStyle === 'oblique', color: cc.hex, lineSpacing: lnPt
          };
          if (st.underline) ro.underline = { style: 'sng' };
          var k = JSON.stringify(ro);
          if (cur && cur._k === k) cur.text += c.ch;
          else { flush(); cur = { text: c.ch, options: ro, _k: k }; }
        });
        if (!cur) cur = { text: '', options: { fontSize: Math.round(ln.maxFs * sAvg * 0.75 * 100) / 100, lineSpacing: lnPt }, _k: '' };
        if (li < rich.length - 1) cur.options = Object.assign({}, cur.options, { breakLine: true });
        flush();
      });
      runs.forEach(function (r) { delete r._k; });
      // birinchi qator tayanch chizig'i — shu qatordagi eng katta shrift bo'yicha
      if (!b.rotate) {
        var f0 = rich[0].maxFs * sAvg;
        var sh0 = f0 * (lh * FABRIC_FS_MULT - desc - FABRIC_FS_MULT * (1 - FABRIC_FS_FRACTION));
        opts.y = r6(b.y - sh0 * SY);
        opts.h = r4(Math.max(b.h, totalPt / 72) + Math.max(0, sh0) * SY);
      }
      delete opts.lineSpacing;
      slide.addText(runs, opts);
      return true;
    }
    slide.addText(outText, opts);
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
  /* ---- v50: element animatsiyalari -> PowerPoint <p:timing> (kirish / diqqat / chiqish effektlari) ---- */
  var PPT_FX = {
    fadeIn: ['entr', 10, 0, 'fade'], fadeInUp: ['entr', 2, 4, 'fly', 'b'], fadeInDown: ['entr', 2, 1, 'fly', 't'],
    fadeInLeft: ['entr', 2, 8, 'fly', 'l'], fadeInRight: ['entr', 2, 2, 'fly', 'r'], zoomIn: ['entr', 53, 16, 'zoom'],
    bounceIn: ['entr', 53, 16, 'zoom'], slideInUp: ['entr', 2, 4, 'fly', 'b'], slideInLeft: ['entr', 2, 8, 'fly', 'l'],
    slideInRight: ['entr', 2, 2, 'fly', 'r'], flipInX: ['entr', 22, 1, 'wipe', 'u'], rotateIn: ['entr', 31, 0, 'spin'],
    pulse: ['emph', 6, 0, 'grow', 108000], bounce: ['emph', 6, 0, 'grow', 112000], tada: ['emph', 6, 0, 'grow', 120000],
    heartBeat: ['emph', 6, 0, 'grow', 130000], rubberBand: ['emph', 6, 0, 'grow', 125000], jello: ['emph', 6, 0, 'grow', 108000],
    flash: ['emph', 6, 0, 'grow', 103000], shakeX: ['emph', 32, 0, 'teeter'], swing: ['emph', 32, 0, 'teeter'], wobble: ['emph', 32, 0, 'teeter'],
    fadeOut: ['exit', 10, 0, 'fade'], zoomOut: ['exit', 53, 16, 'zoom'], bounceOut: ['exit', 53, 16, 'zoom'], slideOutDown: ['exit', 2, 4, 'fly', 'b'],
    float: ['emph', 6, 0, 'grow', 104000], spin: ['emph', 8, 0, 'rot'], pulseLoop: ['emph', 6, 0, 'grow', 106000]
  };
  // v68: yagona jadval (js/00d_anim_fx.js) birinchi — uning qiymatlari ustun, tartibi importdagi «asosiy nom»ni belgilaydi
  if (window.SS_FX) (function () {
    var merged = {};
    Object.keys(SS_FX.ppt).forEach(function (k) { merged[k] = SS_FX.ppt[k]; });
    Object.keys(PPT_FX).forEach(function (k) { if (!merged[k]) merged[k] = PPT_FX[k]; });
    PPT_FX = merged;
  })();
  var PPT_LOOPS = { float: 1, spin: 1, pulseLoop: 1 };
  function buildAnimEffects(list, nextId) {
    // list: [{spid, name, dur, delay, loop}]  ->  { xml, n }
    var n = nextId, out = '', first = true;
    function id() { return n++; }
    function tgt(spid) { return '<p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl>'; }
    function setVis(spid, val, delayMs) {
      return '<p:set><p:cBhvr><p:cTn id="' + id() + '" dur="1" fill="hold"><p:stCondLst><p:cond delay="' + delayMs + '"/></p:stCondLst></p:cTn>' + tgt(spid) +
        '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="' + val + '"/></p:to></p:set>';
    }
    function anim(spid, attr, from, to, ms) {
      var v = function (x) { return typeof x === 'number' ? '<p:val><p:fltVal val="' + x + '"/></p:val>' : '<p:val><p:strVal val="' + x + '"/></p:val>'; };
      return '<p:anim calcmode="lin" valueType="num"><p:cBhvr' + (/ppt_[xy]/.test(attr) ? ' additive="base"' : '') + '><p:cTn id="' + id() + '" dur="' + ms + '" fill="hold"/>' + tgt(spid) +
        '<p:attrNameLst><p:attrName>' + attr + '</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0">' + v(from) + '</p:tav><p:tav tm="100000">' + v(to) + '</p:tav></p:tavLst></p:anim>';
    }
    function fade(spid, dir, ms) { return '<p:animEffect transition="' + dir + '" filter="fade"><p:cBhvr><p:cTn id="' + id() + '" dur="' + ms + '"/>' + tgt(spid) + '</p:cBhvr></p:animEffect>'; }
    list.forEach(function (it) {
      var fx = PPT_FX[it.name]; if (!fx) return;
      var cls = fx[0], pid = fx[1], sub = fx[2], kind = fx[3], arg = fx[4];
      var spid = it.spid, loop = it.loop || PPT_LOOPS[it.name];
      var ms = Math.max(100, Math.round((it.dur > 0 ? it.dur : (loop ? 2 : 0.8)) * 1000)), dl = Math.max(0, Math.round((it.delay || 0) * 1000));
      var body = '';
      var fx = function (dir, filter) { return '<p:animEffect transition="' + dir + '" filter="' + filter + '"><p:cBhvr><p:cTn id="' + id() + '" dur="' + ms + '"/>' + tgt(spid) + '</p:cBhvr></p:animEffect>'; };
      var FLY = { l: ['0-#ppt_w/2', '#ppt_y'], r: ['1+#ppt_w/2', '#ppt_y'], t: ['#ppt_x', '0-#ppt_h/2'], b: ['#ppt_x', '1+#ppt_h/2'] };
      var wh = function (wFrom, wTo, hFrom, hTo) { return anim(spid, 'ppt_w', wFrom, wTo, ms) + anim(spid, 'ppt_h', hFrom, hTo, ms); };
      if (cls === 'entr') {
        body += setVis(spid, 'visible', 0);
        if (kind === 'appear') { /* darhol */ }
        else if (kind === 'fade') body += fade(spid, 'in', ms);
        else if (kind === 'fly') { var f1 = FLY[arg] || FLY.b; body += anim(spid, 'ppt_x', f1[0], '#ppt_x', ms) + anim(spid, 'ppt_y', f1[1], '#ppt_y', ms); }
        else if (kind === 'float') body += fade(spid, 'in', ms) + anim(spid, 'ppt_y', arg === 'd' ? '#ppt_y-.1' : '#ppt_y+.1', '#ppt_y', ms);
        else if (kind === 'zoom') body += wh(0, '#ppt_w', 0, '#ppt_h') + fade(spid, 'in', ms);
        else if (kind === 'grow') body += wh(0, '#ppt_w', 0, '#ppt_h');
        else if (kind === 'expand') body += wh('#ppt_w*0.70', '#ppt_w', '#ppt_h*0.70', '#ppt_h') + fade(spid, 'in', ms);
        else if (kind === 'stretch') body += arg === 'x' ? anim(spid, 'ppt_w', 0, '#ppt_w', ms) : anim(spid, 'ppt_h', 0, '#ppt_h', ms);
        else if (kind === 'swivel') body += anim(spid, 'ppt_h', 0, '#ppt_h', ms) + fade(spid, 'in', ms);
        else if (kind === 'filter') body += fx('in', arg);
        else if (kind === 'wipe') body += fx('in', 'wipe(' + (arg === 'u' ? 'up' : arg === 'l' ? 'left' : arg === 'r' ? 'right' : 'down') + ')');
        else if (kind === 'spin') body += wh(0, '#ppt_w', 0, '#ppt_h') + anim(spid, 'style.rotation', 90, 0, ms) + fade(spid, 'in', ms);
      } else if (cls === 'exit') {
        if (kind === 'fade') body += fade(spid, 'out', ms);
        else if (kind === 'fly') { var f2 = FLY[arg] || FLY.b; body += anim(spid, 'ppt_x', '#ppt_x', f2[0], ms) + anim(spid, 'ppt_y', '#ppt_y', f2[1], ms); }
        else if (kind === 'float') body += fade(spid, 'out', ms) + anim(spid, 'ppt_y', '#ppt_y', arg === 'd' ? '#ppt_y+.1' : '#ppt_y-.1', ms);
        else if (kind === 'zoom') body += wh('#ppt_w', 0, '#ppt_h', 0) + fade(spid, 'out', ms);
        else if (kind === 'grow') body += wh('#ppt_w', 0, '#ppt_h', 0);
        else if (kind === 'expand') body += wh('#ppt_w', '#ppt_w*0.70', '#ppt_h', '#ppt_h*0.70') + fade(spid, 'out', ms);
        else if (kind === 'stretch') body += arg === 'x' ? anim(spid, 'ppt_w', '#ppt_w', 0, ms) : anim(spid, 'ppt_h', '#ppt_h', 0, ms);
        else if (kind === 'filter') body += fx('out', arg);
        else if (kind === 'spin') body += wh('#ppt_w', 0, '#ppt_h', 0) + anim(spid, 'style.rotation', 0, 90, ms) + fade(spid, 'out', ms);
        body += setVis(spid, 'hidden', kind === 'disappear' ? 0 : Math.max(0, ms - 1));
      } else if (cls === 'path') {
        // harakat yo'li: koordinatalar slayd ulushlarida (PowerPoint va LibreOffice bir xil o'qiydi)
        body += '<p:animMotion origin="layout" path="' + arg + '" pathEditMode="relative" ptsTypes=""><p:cBhvr><p:cTn id="' + id() + '" dur="' + ms + '" fill="hold"/>' + tgt(spid) +
          '<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>';
      } else {                                               // emph
        var rep = loop ? ' repeatCount="indefinite"' : '';
        if (kind === 'grow') {
          var by = arg || 110000;
          body += '<p:animScale><p:cBhvr><p:cTn id="' + id() + '" dur="' + Math.round(ms / 2) + '" autoRev="1" fill="hold"' + rep + '/>' + tgt(spid) + '</p:cBhvr><p:by x="' + by + '" y="' + by + '"/></p:animScale>';
        } else if (kind === 'growHold') {
          body += '<p:animScale><p:cBhvr><p:cTn id="' + id() + '" dur="' + ms + '" fill="hold"/>' + tgt(spid) + '</p:cBhvr><p:by x="' + (arg || 150000) + '" y="' + (arg || 150000) + '"/></p:animScale>';
        } else if (kind === 'opacity') {
          body += '<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="' + id() + '" dur="' + ms + '" fill="hold"/>' + tgt(spid) + '<p:attrNameLst><p:attrName>style.opacity</p:attrName></p:attrNameLst></p:cBhvr>' +
            '<p:tavLst><p:tav tm="0"><p:val><p:fltVal val="1"/></p:val></p:tav><p:tav tm="100000"><p:val><p:fltVal val="' + (arg || 0.5) + '"/></p:val></p:tav></p:tavLst></p:anim>';
        } else if (kind === 'rot') {
          body += '<p:animRot by="21600000"><p:cBhvr><p:cTn id="' + id() + '" dur="' + ms + '" fill="hold"' + rep + '/>' + tgt(spid) + '<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>';
        } else {
          body += '<p:animRot by="300000"><p:cBhvr><p:cTn id="' + id() + '" dur="' + Math.max(80, Math.round(ms / 8)) + '" autoRev="1" repeatCount="4000" fill="hold"/>' + tgt(spid) + '<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>';
        }
      }
      // ease-out (sayt bilan bir xil): kirish/chiqish/harakat yo'li sekinlashib tugaydi
      var ease = (cls === 'emph' || kind === 'appear' || kind === 'disappear') ? '' : ' decel="100000"';
      out += '<p:par><p:cTn id="' + id() + '" presetID="' + pid + '" presetClass="' + cls + '" presetSubtype="' + sub + '" fill="hold" grpId="0" nodeType="' + (first ? 'afterEffect' : 'withEffect') + '"' + ease + '>' +
        '<p:stCondLst><p:cond delay="' + dl + '"/></p:stCondLst><p:childTnLst>' + body + '</p:childTnLst></p:cTn></p:par>';
      first = false;
    });
    return { xml: out, n: n };
  }
  /** v42 + v50: video avto-ijro VA element animatsiyalari bitta <p:timing> ichida. anims: [{tag,name,dur,delay,loop}] */
  function injectVideoAutoplay(xml, anims) {
    anims = anims || [];
    var hasVid = xml.indexOf('<a:videoFile') >= 0;
    if (xml.indexOf('<p:timing') >= 0 || (!hasVid && !anims.length)) return xml;
    var ids = [], m;
    if (hasVid) {
      var re = /<p:pic>[\s\S]*?<\/p:pic>/g;
      while ((m = re.exec(xml))) {
        var blk = m[0];
        if (blk.indexOf('<a:videoFile') < 0 || blk.indexOf('SS_VideoNoAuto') >= 0) continue;
        var idm = /<p:cNvPr[^>]*\sid="(\d+)"/.exec(blk);
        if (idm) ids.push(idm[1]);
      }
    }
    // animatsiya tegi -> shakl id (+ matnli <p:sp> bo'lsa bldP)
    var fxList = [], bld = '';
    anims.forEach(function (a) {
      var r = new RegExp('<p:cNvPr id="(\\d+)" name="' + a.tag + '"').exec(xml);
      if (!r) return;
      fxList.push({ spid: r[1], name: a.name, dur: a.dur, delay: a.delay, loop: a.loop });
      var spBlk = new RegExp('<p:sp>(?:(?!<\\/p:sp>)[\\s\\S])*?<p:cNvPr id="' + r[1] + '" name="' + a.tag + '"').test(xml);
      if (spBlk) bld += '<p:bldP spid="' + r[1] + '" grpId="0" animBg="1"/>';
    });
    if (!ids.length && !fxList.length) return xml;
    var n = 5;
    var eff = ids.map(function (id, i) {
      var a = n++, b = n++;
      return '<p:par><p:cTn id="' + a + '" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="' + (i ? 'withEffect' : 'afterEffect') + '">' +
        '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="' + b + '" dur="1" fill="hold"/>' +
        '<p:tgtEl><p:spTgt spid="' + id + '"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par>';
    }).join('');
    var fx = buildAnimEffects(fxList, n);
    if (ids.length && fx.xml) fx.xml = fx.xml.replace(/nodeType="afterEffect"/, 'nodeType="withEffect"');   // media bilan birga boshlanadi
    var timing = '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
      '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>' +
      '<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>' +
      '<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' + eff + fx.xml + '</p:childTnLst></p:cTn></p:par>' +
      '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>' +
      '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
      '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>' +
      '</p:childTnLst></p:cTn></p:par></p:tnLst>' + (bld ? '<p:bldLst>' + bld + '</p:bldLst>' : '') + '</p:timing>';
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
    if (await addOnlineVideo(slide, info, b, cover, el.embedAutoplay)) {
      stats.onlineVideo = (stats.onlineVideo || 0) + 1;
      if (!th && stats) stats.noThumb = (stats.noThumb || 0) + 1;
      return true;
    }
    // Onlayn video ishlamasa: muqova + havola (WPS / eski PowerPoint uchun)
    var o = { data: cover, x: b.x, y: b.y, w: b.w, h: b.h };
    if (b.rotate) o.rotate = b.rotate;
    if (info.watch) o.hyperlink = { url: info.watch, tooltip: 'Videoni ochish' };
    slide.addImage(o);
    addVideoLinkPill(slide, b, info.watch, false);
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

  /* v67: Fabric gradienti → PowerPoint <a:gradFill> (PptxGenJS gradient bermaydi — XML keyin almashtiriladi).
     Rang to'xtash nuqtalari shakl qutisi bo'ylab qayta hisoblanadi — Fabric koordinatalari qutini to'liq qoplamasa ham aynan mos. */
  var gradByName = {}, avByName = {}, gradSeq = 1;
  function gradientXml(el, gw, gh) {
    var g = el.fill;
    if (!g || typeof g !== 'object' || !Array.isArray(g.colorStops) || g.colorStops.length < 2) return null;
    var c = g.coords || {}, op = el.opacity == null ? 1 : num(el.opacity, 1);
    var W0 = num(el.width, gw) || gw, H0 = num(el.height, gh) || gh;
    var px = function (v, full) { return g.gradientUnits === 'percentage' ? num(v, 0) * full : num(v, 0); };
    var stops = g.colorStops.slice().sort(function (a, b) { return num(a.offset, 0) - num(b.offset, 0); });
    var gs = function (pos, s0) {
      var pc = parseColor(s0.color) || { hex: '000000', alpha: 1 };
      var a = pc.alpha * (s0.opacity == null ? 1 : num(s0.opacity, 1)) * op;
      return '<a:gs pos="' + Math.round(Math.max(0, Math.min(1, pos)) * 100000) + '"><a:srgbClr val="' + pc.hex + '">' + (a < 0.999 ? '<a:alpha val="' + Math.round(a * 100000) + '"/>' : '') + '</a:srgbClr></a:gs>';
    };
    if (g.type === 'radial') {
      return '<a:gradFill rotWithShape="1"><a:gsLst>' + stops.map(function (s0) { return gs(num(s0.offset, 0), s0); }).join('') +
        '</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>';
    }
    var x1 = px(c.x1, W0), y1 = px(c.y1, H0), x2 = px(c.x2, W0), y2 = px(c.y2, H0);
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / len, uy = dy / len;
    // qutining burchaklari gradient yo'nalishiga proyeksiya: PowerPoint gradienti butun qutini qoplaydi
    var proj = [[0, 0], [W0, 0], [0, H0], [W0, H0]].map(function (p) { return (p[0] - x1) * ux + (p[1] - y1) * uy; });
    var tmin = Math.min.apply(null, proj), tmax = Math.max.apply(null, proj), span = (tmax - tmin) || 1;
    var ang = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) % 360 + 360) % 360 * 60000);
    return '<a:gradFill rotWithShape="1"><a:gsLst>' + stops.map(function (s0) { return gs((num(s0.offset, 0) * len - tmin) / span, s0); }).join('') +
      '</a:gsLst><a:lin ang="' + ang + '" scaled="0"/></a:gradFill>';
  }
  function shapeOpts(el, box) {
    var o = { x: box.x, y: box.y, w: box.w, h: box.h };
    var f = fillOptsOf(el);
    if (f) o.fill = f;                                    // yo'q bo'lsa — <a:noFill/> (soya faqat chegaradan tushadi, Fabric kabi)
    var gx = f && gradientXml(el, box.gw, box.gh);
    if (gx) { o.objectName = 'SS_G' + (gradSeq++); gradByName[o.objectName] = gx; }
    o.line = lineOf(el) || { color: 'FFFFFF', transparency: 100 };
    if (box.rotate) o.rotate = box.rotate;
    if (el.flipX) o.flipH = true;
    if (el.flipY) o.flipV = true;
    var sh = shadowOf(el);
    if (sh) o.shadow = sh;
    var slk = elementLink(el);
    if (slk) o.hyperlink = slk;
    return o;
  }

  /** rect / roundRect / ellipse / triangle — PowerPoint'ning o'z (preset) shakllari, geometriya 1:1 */
  async function addShapeEl(pptx, slide, el) {
    if (fillOptsOf(el) === undefined) return false;                  // naqshli to'ldirish — rasm sifatida
    var t = el.type, w0, h0, shape = null, extra = {};
    var s = absScale(el);
    if (t === 'rect') {
      w0 = num(el.width, 100); h0 = num(el.height, 100);
      var rxPx = Math.max(num(el.rx, 0) * s.sx, num(el.ry, 0) * s.sy);
      var maxR = Math.min(w0 * s.sx, h0 * s.sy) / 2;
      if (rxPx > 0.5 && maxR > 0) { shape = pptx.ShapeType.roundRect; extra.rectRadius = r6(Math.min(rxPx, maxR) * SX); }   // dyuymda (adj = r / min(w,h))
      else shape = pptx.ShapeType.rect;
    } else if (t === 'circle') {
      var sa = num(el.startAngle, 0), ea = num(el.endAngle, 360);
      if (Math.abs((ea - sa) % 360) > 0.01 && Math.abs(ea - sa) < 359.99) return false;   // yoy (arc) — rasm sifatida
      var r = num(el.radius, num(el.width, 100) / 2);
      w0 = r * 2; h0 = r * 2; shape = pptx.ShapeType.ellipse;
    } else if (t === 'ellipse') {
      w0 = num(el.rx, 50) * 2; h0 = num(el.ry, 50) * 2; shape = pptx.ShapeType.ellipse;
    } else if (t === 'triangle') {
      w0 = num(el.width, 100); h0 = num(el.height, 100); shape = pptx.ShapeType.triangle;   // cho'qqi tepada o'rtada — Fabric bilan bir xil
    } else {
      return false;
    }
    var b = placeGeom(el, w0, h0);
    slide.addShape(shape, Object.assign(shapeOpts(el, b), extra));
    return true;
  }

  /* path / polygon / polyline → PowerPoint «custGeom» (erkin shakl): nuqtalar AYNAN Fabric'dagidek,
     PowerPoint'da shakl sifatida tanlanadi, suriladi, rangi o'zgaradi, «Edit Points» bilan tahrirlanadi. */
  function pathGeometry(el) {
    if (typeof fabric === 'undefined') return null;
    var tmp;
    try {
      if (el.type === 'path') tmp = new fabric.Path(el.path, { strokeWidth: 0 });
      else tmp = new (el.type === 'polyline' ? fabric.Polyline : fabric.Polygon)(el.points || [], { strokeWidth: 0 });
    } catch (e) { return null; }
    var w0 = num(tmp.width, 0), h0 = num(tmp.height, 0);
    var po = tmp.pathOffset || { x: w0 / 2, y: h0 / 2 };
    return { w0: w0, h0: h0, minX: po.x - w0 / 2, minY: po.y - h0 / 2, path: tmp.path, points: tmp.points, closed: el.type === 'polygon' };
  }
  function geomPoints(g, kx, ky) {
    var pts = [], X = function (v) { return r6((v - g.minX) * kx); }, Y = function (v) { return r6((v - g.minY) * ky); };
    if (g.path) {
      var started = false;
      g.path.forEach(function (c) {
        switch (c[0]) {
          case 'M': pts.push({ x: X(c[1]), y: Y(c[2]), moveTo: true }); started = true; break;
          case 'L': pts.push({ x: X(c[1]), y: Y(c[2]) }); break;
          case 'C': pts.push({ x: X(c[5]), y: Y(c[6]), curve: { type: 'cubic', x1: X(c[1]), y1: Y(c[2]), x2: X(c[3]), y2: Y(c[4]) } }); break;
          case 'Q': pts.push({ x: X(c[3]), y: Y(c[4]), curve: { type: 'quadratic', x1: X(c[1]), y1: Y(c[2]) } }); break;
          case 'Z': case 'z': if (started) pts.push({ close: true }); break;
          default: break;
        }
      });
    } else if (g.points) {
      g.points.forEach(function (p, i) { var q = { x: X(p.x), y: Y(p.y) }; if (i === 0) q.moveTo = true; pts.push(q); });
      if (g.closed && pts.length) pts.push({ close: true });
    }
    // PptxGenJS: ≥100 qiymatni EMU deb oladi — dyuymdagi qiymatlar doim < 100 (slayd 10 dyuym)
    return pts;
  }
  async function addPathEl(pptx, slide, el) {
    if (fillOptsOf(el) === undefined) return false;
    var g = pathGeometry(el);
    if (!g || !(g.w0 > 0 || g.h0 > 0)) return false;
    var s = absScale(el);
    var b = placeGeom(el, g.w0, g.h0, true);
    // nol o'lchamli (to'g'ri chiziq ko'rinishidagi) yo'l: PowerPoint 0 kenglikdagi path'ni chizmaydi — 1px zaxira
    var gw = Math.max(b.gw, 1), gh = Math.max(b.gh, 1);
    b.x = r6((b.cx - gw / 2) * SX); b.y = r6((b.cy - gh / 2) * SY); b.w = r6(gw * SX); b.h = r6(gh * SY);
    var pts = geomPoints(g, s.sx * SX, s.sy * SY);
    if (pts.length < 2) return false;
    if (b.gw < 1) pts.forEach(function (p) { if (p.x != null) p.x = r6(p.x + (gw - b.gw) / 2 * SX); });
    if (b.gh < 1) pts.forEach(function (p) { if (p.y != null) p.y = r6(p.y + (gh - b.gh) / 2 * SY); });
    var o = shapeOpts(el, b);                           // ochiq yo'l (zigzag, galochka chizig'i) — to'ldirishsiz
    o.points = pts;
    slide.addShape(pptx.ShapeType.custGeom || 'custGeom', o);
    return true;
  }

  /** fabric.Line → PowerPoint chizig'i (prst="line"), yo'nalishi flipV/flipH bilan */
  async function addLineEl(pptx, slide, el) {
    var ln = lineOf(el);
    if (!ln) return true;
    var x1 = num(el.x1, 0), y1 = num(el.y1, 0), x2 = num(el.x2, 0), y2 = num(el.y2, 0);
    var w0 = Math.abs(x2 - x1) || num(el.width, 0), h0 = Math.abs(y2 - y1) || num(el.height, 0);
    var b = placeGeom(el, w0, h0, true);
    var o = { x: b.x, y: b.y, w: Math.max(b.w, 0), h: Math.max(b.h, 0), line: ln };
    var anti = (x2 - x1) * (y2 - y1) < 0;
    if (anti !== !!el.flipY) o.flipV = true;
    if (el.flipX) o.flipH = !o.flipH;
    if (b.rotate) o.rotate = b.rotate;
    var sh = shadowOf(el);
    if (sh) o.shadow = sh;
    slide.addShape(pptx.ShapeType.line, o);
    return true;
  }

  /* Guruh (group): ichidagi har bir shakl/matn ALOHIDA, tahrirlanadigan obyekt bo'lib chiqadi
     (oldin butun guruh bitta rasm bo'lardi). Joylashuv Fabric matritsalari bilan aniq hisoblanadi. */
  var FLAT_OK = /^(textbox|i-text|text|rect|circle|ellipse|triangle|path|polygon|polyline|line|group|prstShape)$/;
  function canFlatten(g, depth) {
    if (typeof fabric === 'undefined' || !fabric.util || !fabric.util.qrDecompose) return false;
    if (!g || g.type !== 'group' || g.ssKind || g.clipPath || depth > 4) return false;
    if (num(g.skewX, 0) || num(g.skewY, 0)) return false;
    var kids = g.objects || [];
    if (!kids.length) return false;
    return kids.every(function (k) {
      if (!k || !FLAT_OK.test(k.type || '') || k.clipPath || num(k.skewX, 0) || num(k.skewY, 0)) return false;
      if (k.type === 'group') return canFlatten(k, depth + 1);
      return true;
    });
  }
  function matrixOf(o) {
    var fd = fullDims(o, num(o.width, 0), num(o.height, 0)), c = centerOf(o, fd.w, fd.h);
    return fabric.util.composeMatrix({ translateX: c.x, translateY: c.y, angle: num(o.angle, 0), scaleX: num(o.scaleX, 1), scaleY: num(o.scaleY, 1), flipX: !!o.flipX, flipY: !!o.flipY });
  }
  function flattenGroup(g, parentM, parentOpacity, out) {
    var gm = fabric.util.multiplyTransformMatrices(parentM, matrixOf(g));
    var op = parentOpacity * (g.opacity == null ? 1 : num(g.opacity, 1));
    (g.objects || []).forEach(function (k) {
      if (!k || k.visible === false) return;
      if (k.type === 'group') { flattenGroup(k, gm, op, out); return; }
      var m = fabric.util.multiplyTransformMatrices(gm, matrixOf(k));
      var d = fabric.util.qrDecompose(m);
      var flip = d.scaleY < 0;
      var flat = Object.assign({}, k, {
        left: d.translateX, top: d.translateY, originX: 'center', originY: 'center',
        angle: d.angle, scaleX: Math.abs(d.scaleX), scaleY: Math.abs(d.scaleY), flipX: false, flipY: flip, skewX: 0, skewY: 0,
        opacity: op * (k.opacity == null ? 1 : num(k.opacity, 1))
      });
      if (!flat.shadow && g.shadow) flat.shadow = g.shadow;
      out.push(flat);
    });
    return out;
  }

  /** Vektor obyekt (shakl / yo'l / chiziq / matn) — PowerPoint'ning o'z obyekti; bo'lmasa false */
  async function addVectorEl(pptx, slide, el) {
    var t = el.type;
    if (t === 'textbox' || t === 'i-text' || t === 'text') return addTextEl(slide, el);
    if (t === 'rect' || t === 'circle' || t === 'ellipse' || t === 'triangle') return addShapeEl(pptx, slide, el);
    if (t === 'path' || t === 'polygon' || t === 'polyline') return addPathEl(pptx, slide, el);
    if (t === 'line') return addLineEl(pptx, slide, el);
    if (t === 'prstShape') return addPrstEl(pptx, slide, el);
    return false;
  }
  /** v68: PowerPoint'ning 187 ta tayyor shakli — o'sha nom bilan (prstGeom), sariq tutqich (adj) qiymatlari ham */
  async function addPrstEl(pptx, slide, el) {
    if (fillOptsOf(el) === undefined) return false;
    var name = String(el.prst || 'rect');
    if (!/^[A-Za-z0-9]+$/.test(name)) return false;
    var b = placeGeom(el, num(el.width, 100), num(el.height, 100));
    var o = shapeOpts(el, b);
    var adj = el.adj && typeof el.adj === 'object' ? el.adj : null;
    if (adj && Object.keys(adj).length) {
      var av = Object.keys(adj).filter(function (k) { return /^[A-Za-z0-9]+$/.test(k) && isFinite(+adj[k]); })
        .map(function (k) { return '<a:gd name="' + k + '" fmla="val ' + Math.round(+adj[k]) + '"/>'; }).join('');
      if (av) { if (!o.objectName) o.objectName = 'SS_G' + (gradSeq++); avByName[o.objectName] = av; }
    }
    slide.addShape(name, o);
    return true;
  }
  async function addFlatGroup(pptx, slide, el) {
    var flat = flattenGroup(el, [1, 0, 0, 1, 0, 0], 1, []);
    var lk = elementLink(el);
    for (var i = 0; i < flat.length; i++) {
      if (lk && !flat[i].linkUrl) flat[i].linkUrl = el.linkUrl;
      var ok = await addVectorEl(pptx, slide, flat[i]);
      if (!ok) ok = await addFallbackEl(slide, flat[i]);
    }
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
    var border = { type: 'solid', pt: 0.75, color: hex6(sp.borderColor, 'DBE1EA') };
    var bodyFillX = hex6(sp.bodyFill, 'FFFFFF'), stripeX = hex6(sp.stripeColor, 'F1F5F9'), bodyInk = hex6(sp.bodyColor, '1F2937'), cs = sp.cellStyles || {};
    // v49: canvas'dagi layout bilan BIR XIL — katak ichki bo'shlig'i, qator qadami (1.2 × shrift) va qator/ustun o'lchamlari
    var padX = (sp.padX != null ? sp.padX : 8) * Math.abs(sx) * SX, padY = (sp.padY != null ? sp.padY : 6) * Math.abs(sy) * SY;
    var lineSp = Math.round(fsPt * (sp.lh || 1.2) * 100) / 100;
    var data = rows.map(function (r, ri) {
      var isH = sp.header !== false && ri === 0;
      return r.map(function (c, ci) {
        var st = cs[ri + ',' + ci] || {};
        return { text: String(c), options: {
          bold: isH || !!st.bold, color: st.color ? hex6(st.color, '1F2937') : (isH ? hCol : bodyInk), fontFace: 'Arial', fontSize: fsPt, lineSpacing: lineSp,
          align: (ci === 0 && !isH) ? 'left' : 'center', valign: 'middle',
          fill: { color: st.fill ? hex6(st.fill, 'FFFFFF') : (isH ? hFill : (sp.stripe !== false && ri % 2 === 0 ? stripeX : bodyFillX)) },
          border: [border, border, border, border], margin: [r4(padY), r4(padX), r4(padY), r4(padX)]
        } };
      });
    });
    var cw = [], rh = [], i, j;
    if (Array.isArray(sp.colW) && sp.colW.length === cols) for (i = 0; i < cols; i++) cw.push(r4(sp.colW[i] * Math.abs(sx) * SX));
    else for (i = 0; i < cols; i++) cw.push(r4(b.w / cols));
    if (Array.isArray(sp.rowHs) && sp.rowHs.length === rows.length) for (j = 0; j < rows.length; j++) rh.push(r4(sp.rowHs[j] * Math.abs(sy) * SY));
    else for (j = 0; j < rows.length; j++) rh.push(r4(b.h / rows.length));
    slide.addTable(data, { x: b.x, y: b.y, w: r4(cw.reduce(function (a, v) { return a + v; }, 0)), colW: cw, rowH: rh });
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
    // v49: Y o'qi canvas bilan BIR XIL (min / max / qadam) — avto-o'q PowerPoint/WPS'da boshqa raqam va gridline berardi
    if (!pie && sp.yMax != null && sp.yStep) {
      o.valAxisMinVal = sp.yMin != null ? sp.yMin : 0; o.valAxisMaxVal = sp.yMax; o.valAxisMajorUnit = sp.yStep;
      o.valAxisLabelFormatCode = sp.yStep >= 1 ? '#,##0' : '0.0#'; o.dataLabelFormatCode = '#,##0.##';
    }
    if (pie) { o.showPercent = true; o.showValue = false; o.dataLabelFormatCode = '0%'; o.dataLabelColor = kind === 'pie' ? 'FFFFFF' : ink; if (kind === 'doughnut') o.holeSize = 55; }
    else if (kind === 'bar') { o.barDir = 'col'; o.barGapWidthPct = 60; if (data.length === 1) o.valAxisHidden = false; }
    else { o.lineSize = 3; o.lineDataSymbolSize = 8; }
    if (sp.title) { o.showTitle = true; o.title = String(sp.title); o.titleFontSize = 16; o.titleColor = '111827'; o.titleFontFace = 'Arial'; }
    slide.addChart(type, data, o);
    return true;
  }
  function injectTransition(xml, name, dur, auto) {
    if (xml.indexOf('<p:transition') >= 0 || xml.indexOf('<mc:AlternateContent') >= 0) return xml;
    var key = name == null || name === '' ? 'fade' : String(name);
    var tag = '';
    if (key === 'none') tag = auto > 0 ? '<p:transition advTm="' + Math.round(auto * 1000) + '"/>' : '';
    else if (window.SS_TR) tag = SS_TR.pptXml(key, (name == null || name === '') && !(dur > 0) ? 0.5 : dur, auto);
    if (!tag) return xml;
    if (/<\/p:clrMapOvr>/.test(xml)) return xml.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + tag);
    if (/<p:timing[\s>]/.test(xml)) return xml.replace(/<p:timing[\s>]/, function (m) { return tag + m; });
    return xml.replace('</p:sld>', tag + '</p:sld>');
  }
  window.__ssInjectTransition = injectTransition;

  var _pptxBusy = false;
  var animBySlide = {}, animSeq = 1;

  async function exportPPTX() {
    if (_pptxBusy) { toast('PPTX tayyorlanmoqda, biroz kuting…'); return; }
    animBySlide = {}; animSeq = 1; gradByName = {}; avByName = {}; gradSeq = 1;
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
      try { if (window.ssSyncPageNumbers) window.ssSyncPageNumbers(true); } catch (e) {}
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
              if (await addOnlineVideo(slide, binfo, { x: 0, y: 0, w: 10, h: 5.625 }, bcover, true)) {
                stats.onlineVideo = (stats.onlineVideo || 0) + 1;
                continue_bg = true;
              } else {
                var bo = { data: bcover, x: 0, y: 0, w: 10, h: 5.625 };
                if (binfo.watch) bo.hyperlink = { url: binfo.watch, tooltip: 'Fon videosini ochish' };
                slide.addImage(bo);
                addVideoLinkPill(slide, { x: 0, y: 0, w: 10, h: 5.625 }, binfo.watch, true);
              }
            }
          }
        } catch (e) { stats.errors++; console.warn('PPTX fon video:', e); }

        var objs = parsed.objects || [];
        var ctx = { idx: i, total: slides.length };
        animBySlide[i] = [];
        for (var k = 0; k < objs.length; k++) {
          var el = objs[k];
          if (!el || el.visible === false) continue;
          var animInfo = null, soBefore = (slide._slideObjects || []).length;
          if (el.animName) {
            stats.anim = (stats.anim || 0) + 1;
            if (PPT_FX[el.animName]) animInfo = { name: el.animName, dur: num(el.animDur, 0), delay: num(el.animDelay, 0), loop: el.animLoop === true || el.animLoop === 'true' };
          }
          el = stripAnim(el);                 // CSS animatsiya xossalari obyektdan olinadi; PowerPoint effekti <p:timing> orqali yoziladi
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
            else if (t === 'group' && canFlatten(el, 0)) ok = await addFlatGroup(pptx, slide, el);
            else ok = await addVectorEl(pptx, slide, el);
            if (!ok && !/^(image|gifImage)$/.test(t) && !el.isGif) ok = await addFallbackEl(slide, el);
            if (!ok) {
              if (t === 'image' || el.isGif || t === 'gifImage') {
                var okF = await addFallbackEl(slide, el);
                if (!okF) stats.imgFail++;
              } else stats.skipped++;
            }
            if (animInfo && ok) {                // birinchi hosil bo'lgan obyektni nomlab qo'yamiz — keyin XML'dan topiladi
              var soNow = slide._slideObjects || [];
              if (soNow.length > soBefore && soNow[soBefore] && soNow[soBefore].options) {
                var atag = 'SS_A' + (animSeq++);
                var oldNm = soNow[soBefore].options.objectName;
                if (oldNm && gradByName[oldNm]) gradByName[atag] = gradByName[oldNm];   // gradient nomi animatsiya nomiga o'tadi
                if (oldNm && avByName[oldNm]) avByName[atag] = avByName[oldNm];
                soNow[soBefore].options.objectName = atag;
                animInfo.tag = atag;
                animBySlide[i].push(animInfo);
              }
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
              var aix = parseInt(slideNames[an].match(/slide(\d+)\.xml$/)[1], 10) - 1;
              var bxml = injectVideoAutoplay(axml, animBySlide[aix] || []);
              if (bxml !== axml) zip.file(slideNames[an], bxml);
            } catch (e) { console.warn('PPTX avto-ijro:', e); }
          }
          // v48: slayd o'tishi — PowerPoint'ning o'z <p:transition> elementi
          for (var tn = 0; tn < slideNames.length; tn++) {
            try {
              var tix = parseInt(slideNames[tn].match(/slide(\d+)\.xml$/)[1], 10) - 1;
              var txml = await zip.file(slideNames[tn]).async('string');
              var uxml = injectTransition(txml, slides[tix] && slides[tix].transition, slides[tix] && slides[tix].transDur, slides[tix] && slides[tix].transAuto);
              if (uxml !== txml) zip.file(slideNames[tn], uxml);
            } catch (e) { console.warn('PPTX o\'tish:', e); }
          }
          // v67: gradientlar — PptxGenJS yozgan bir rangli to'ldirish haqiqiy <a:gradFill> ga almashtiriladi
          if (Object.keys(gradByName).length || Object.keys(avByName).length) for (var gn = 0; gn < slideNames.length; gn++) {
            var gxml = await zip.file(slideNames[gn]).async('string'), gxml2 = gxml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, function (blk) {
              var m = /<p:cNvPr id="\d+" name="([^"]+)"/.exec(blk);
              if (!m || !(gradByName[m[1]] || avByName[m[1]])) return blk;
              if (avByName[m[1]]) blk = blk.replace(/<a:avLst><\/a:avLst>/, '<a:avLst>' + avByName[m[1]] + '</a:avLst>');
              if (!gradByName[m[1]]) return blk;
              return blk.replace(/(<\/a:prstGeom>|<\/a:custGeom>)<a:solidFill>[\s\S]*?<\/a:solidFill>/, function (_, g1) { return g1 + gradByName[m[1]]; });
            });
            if (gxml2 !== gxml) zip.file(slideNames[gn], gxml2);
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
          var fps = [];
          try { fps = await slideFps(zip); } catch (e) { fps = []; }
          var payload = {
            version: 2, format: 'slide-studio', title: title, fp: fps.length === slides.length ? fps : undefined,
            slides: slides.map(function (s) { return { json: s.json, imageNumbers: s.imageNumbers || [], transition: s.transition || '', transDur: s.transDur || 0, transAuto: s.transAuto || 0 }; }),
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

      (window.downloadBlob || downloadBlob)(outBlob, makeSafeFileName(title, 'pptx'));   // v75: Telegram'da chatga yuboriladi

      var warn = [];
      if (stats.gifFail) warn.push(stats.gifFail + ' ta GIF');
      if (stats.imgFail) warn.push(stats.imgFail + ' ta rasm');
      if (stats.skipped) warn.push(stats.skipped + ' ta element');
      if (stats.badVideo) warn.push(stats.badVideo + ' ta video (faqat MP4 PowerPoint\u2019da ishlaydi)');
      if (stats.errors) warn.push(stats.errors + ' ta xatolik');
      // v62: animatsiya / slayd o'tishi bor bo'lsa — qaysi dasturda ishlashini aniq aytamiz (bir marta, sessiya davomida)
      try {
        var hasTr = slides.some(function (s) { return s && s.transition && s.transition !== 'none'; });
        if ((stats.anim || hasTr) && !window.__ssPptxFxNoted && window.Swal) {
          window.__ssPptxFxNoted = true;
          setTimeout(function () {
            Swal.fire({ icon: 'info', title: 'Animatsiya va o\u2018tish effektlari haqida', heightAuto: false, confirmButtonText: 'Tushunarli',
              html: '<div style="text-align:left;font-size:14px;line-height:1.5">' +
                'PPTX faylda animatsiyalar va slayd o\u2018tishlari <b>PowerPoint (2010 va yangi)</b> effektlariga o\u2018girildi — faylni ochib «Slide Show» ni bosing.<br><br>' +
                '⚠️ <b>Google Slides, WPS, Keynote</b> va telefon ilovalarida ba\u2019zi animatsiyalar yoki o\u2018tishlar <b>ishlamasligi</b> yoki boshqacharoq ko\u2018rinishi mumkin. ' +
                'Ba\u2019zi effektlar PowerPoint\u2019dagi eng yaqin analogi bilan almashtirildi.<br><br>' +
                '✅ Saytdagidek <b>100% bir xil</b> ko\u2018rinish uchun <b>HTML</b> formatda saqlang (istalgan brauzerda ochiladi).</div>' });
          }, 400);
        }
      } catch (e) {}
      if (warn.length) toast('PPTX yuklandi, lekin qo\'shilmadi: ' + warn.join(', ') + ((stats.gifFail || stats.imgFail) ? ' (internet/CORS)' : ''), 'error');
      else toast(stats.anim ? 'PPTX yuklandi — slayd o\'tishlari va animatsiyalar PowerPoint effektlariga o\'girildi (ba\'zi effektlar eng yaqin PowerPoint analogi bilan)' : 'PPTX yuklandi — PowerPoint da ochib, qayta tahrirlash mumkin');
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
        // v83: <a:sysClr val="window" lastClr="FFFFFF"/> — the colour is lastClr («window» is a name). Before, the
        // name won, failed the hex test, and every white/black theme colour (lt1/dk1, bg1/tx1) was lost.
        var v = c.localName === 'sysClr' ? (c.getAttribute('lastClr') || ({ window: 'FFFFFF', windowText: '000000' })[c.getAttribute('val')])
          : c.getAttribute('val');
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
    if (sf) return readColorNode(sf, theme);
    // v67: chiziqli gradient (a:gradFill) — Fabric gradientiga aylantiriladi; hex = birinchi rang (zaxira)
    var gf = kid(spPr, NS_A, 'gradFill'), gl = gf && kid(gf, NS_A, 'gsLst');
    if (!gl) return null;
    var stops = kids(gl, NS_A, 'gs').map(function (g) {
      var c = readColorNode(g.firstElementChild, theme);
      return c ? { offset: Math.max(0, Math.min(1, num(g.getAttribute('pos'), 0) / 100000)), color: c.hex, opacity: c.alpha == null ? 1 : c.alpha } : null;
    }).filter(Boolean).sort(function (a, b) { return a.offset - b.offset; });
    if (!stops.length) return null;
    var lin = kid(gf, NS_A, 'lin');
    return { hex: stops[0].color, alpha: 1, grad: { stops: stops, ang: lin ? num(lin.getAttribute('ang'), 0) / 60000 : 90, radial: !lin && !!kid(gf, NS_A, 'path') } };
  }
  /** Fabric gradient (obyekt chap-yuqori burchagiga nisbatan, px) */
  function fabricGradient(fill, W, H) {
    var g = fill.grad, a = g.ang * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    if (g.radial) return { type: 'radial', gradientUnits: 'pixels', coords: { x1: W / 2, y1: H / 2, r1: 0, x2: W / 2, y2: H / 2, r2: Math.max(W, H) / 2 }, colorStops: g.stops, offsetX: 0, offsetY: 0 };
    var L = (Math.abs(W * c) + Math.abs(H * sn)) / 2;
    return { type: 'linear', gradientUnits: 'pixels', coords: { x1: W / 2 - c * L, y1: H / 2 - sn * L, x2: W / 2 + c * L, y2: H / 2 + sn * L }, colorStops: g.stops, offsetX: 0, offsetY: 0 };
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
      // v67: guruhning o'z burilishi va akslantirishi bolalarga ham qo'llanadi (oldin tashlab ketilardi)
      if (g.rot || g.flipH || g.flipV) {
        var gcx = g.offX + g.extX / 2, gcy = g.offY + g.extY / 2;
        var ccx = out.x + out.cx / 2, ccy = out.y + out.cy / 2;
        if (g.flipH) { ccx = 2 * gcx - ccx; out.flipH = !out.flipH; out.rot = -out.rot; }
        if (g.flipV) { ccy = 2 * gcy - ccy; out.flipV = !out.flipV; out.rot = -out.rot; }
        if (g.rot) {
          var a = g.rot * Math.PI / 180, dx = ccx - gcx, dy = ccy - gcy;
          ccx = gcx + dx * Math.cos(a) - dy * Math.sin(a);
          ccy = gcy + dx * Math.sin(a) + dy * Math.cos(a);
          out.rot += g.rot;
        }
        out.rot = ((out.rot % 360) + 360) % 360;
        out.x = ccx - out.cx / 2; out.y = ccy - out.cy / 2;
      }
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

  /* v67: joy egallovchi (placeholder) matn uslubi merosi: master txStyles → master placeholder → layout placeholder.
     Har daraja (lvl1..9) uchun: o'lcham, qalinlik, tekislash, marker (•), qator oralig'i. */
  function readLvlStyles(lst, theme, into) {
    if (!lst) return into;
    for (var lv = 1; lv <= 9; lv++) {
      var pp = kid(lst, NS_A, 'lvl' + lv + 'pPr');
      if (!pp) continue;
      var o = into[lv] = Object.assign({}, into[lv] || {});
      if (pp.getAttribute('algn')) o.algn = pp.getAttribute('algn');
      if (kid(pp, NS_A, 'buNone')) o.bu = 'none';
      var bc = kid(pp, NS_A, 'buChar'); if (bc) o.bu = bc.getAttribute('char') || '\u2022';
      var ls = kid(pp, NS_A, 'lnSpc'), lp = ls && kid(ls, NS_A, 'spcPct'); if (lp) o.ln = num(lp.getAttribute('val'), 100000) / 100000;
      var dr = kid(pp, NS_A, 'defRPr');
      if (dr) {
        if (dr.getAttribute('sz')) o.sz = num(dr.getAttribute('sz'), 0) / 100;
        if (dr.getAttribute('b') != null) o.b = dr.getAttribute('b') === '1';
        if (dr.getAttribute('i') != null) o.i = dr.getAttribute('i') === '1';
        var c = readColorNode(kid(dr, NS_A, 'solidFill'), theme); if (c) o.color = c;
        var lat = kid(dr, NS_A, 'latin'); if (lat && lat.getAttribute('typeface')) { var tf = lat.getAttribute('typeface'); o.font = tf === '+mj-lt' ? theme.fonts.major : (tf === '+mn-lt' ? theme.fonts.minor : tf); }
      }
    }
    return into;
  }
  function findPhSp(doc, ph) {
    if (!doc || !ph) return null;
    var type = ph.getAttribute('type') || 'body', idx = ph.getAttribute('idx');
    var tree = doc.getElementsByTagNameNS(NS_P, 'spTree')[0];
    if (!tree) return null;
    var sps = kids(tree, NS_P, 'sp'), byType = null;
    for (var j = 0; j < sps.length; j++) {
      var nv = kid(sps[j], NS_P, 'nvSpPr'), nvPr = nv && kid(nv, NS_P, 'nvPr'), p2 = nvPr && kid(nvPr, NS_P, 'ph');
      if (!p2) continue;
      var t2 = p2.getAttribute('type') || 'body';
      if (idx != null && p2.getAttribute('idx') === idx) return sps[j];
      if (!byType && (t2 === type || (type === 'ctrTitle' && t2 === 'title') || (type === 'obj' && t2 === 'body'))) byType = sps[j];
    }
    return byType;
  }
  function phInherit(ph, phType, layoutDoc, masterDoc, theme) {
    if (!ph) return null;
    var inh = {};
    var isTitle = /title/i.test(phType || ''), isBody = !isTitle && !/^(dt|ftr|sldNum)$/.test(phType || '');
    var tx = masterDoc && masterDoc.getElementsByTagNameNS(NS_P, 'txStyles')[0];
    if (tx) readLvlStyles(kid(tx, NS_P, isTitle ? 'titleStyle' : (isBody ? 'bodyStyle' : 'otherStyle')), theme, inh);
    [masterDoc, layoutDoc].forEach(function (d) {
      var sp = findPhSp(d, ph), tb = sp && kid(sp, NS_P, 'txBody');
      if (tb) readLvlStyles(kid(tb, NS_A, 'lstStyle'), theme, inh);
    });
    return inh;
  }

  /* v67: matn bo'laklari (run) O'Z uslubi bilan o'qiladi — o'lcham, qalinlik, kursiv, rang, shrift har bo'lakda alohida
     (oldin butun quti eng uzun bo'lak uslubini olardi: sarlavha + oddiy matn bir xil katta va qalin bo'lib qolardi).
     Natija: Fabric Textbox «styles» (qator / belgi indeksi bo'yicha). PowerPoint'ning normAutofit fontScale ham qo'llanadi. */
  function readTextBody(txBody, theme, defaultPt, phType, inh) {
    inh = readLvlStyles(kid(txBody, NS_A, 'lstStyle'), theme, Object.assign({}, inh || {}));
    var bp = kid(txBody, NS_A, 'bodyPr');
    var af = bp && kid(bp, NS_A, 'normAutofit');
    var fontScale = af && af.getAttribute('fontScale') ? num(af.getAttribute('fontScale'), 100000) / 100000 : 1;
    var lnRed = af && af.getAttribute('lnSpcReduction') ? num(af.getAttribute('lnSpcReduction'), 0) / 100000 : 0;
    var isTitle = /title/i.test(phType || '');
    var inhAny = Object.keys(inh).length > 0;
    var paras = kids(txBody, NS_A, 'p');
    var lines = [''], runs = [], align = null, lnPct = null;
    function push(t, rec) {
      for (var k = 0; k < t.length; k++) {
        if (t[k] === '\n') { lines.push(''); continue; }
        if (rec) runs.push({ line: lines.length - 1, ch: lines[lines.length - 1].length, rec: rec });
        lines[lines.length - 1] += t[k];
      }
    }
    paras.forEach(function (p, pi) {
      if (pi > 0) lines.push('');
      var pPr = kid(p, NS_A, 'pPr');
      var lvS = inh[(pPr ? num(pPr.getAttribute('lvl'), 0) : 0) + 1] || {};
      var pAl = (pPr && pPr.getAttribute('algn')) || lvS.algn;
      if (pAl && !align) align = pAl;
      var ls = pPr && kid(pPr, NS_A, 'lnSpc'), lsp = ls && kid(ls, NS_A, 'spcPct');
      if (lnPct == null) lnPct = lsp ? num(lsp.getAttribute('val'), 100000) / 100000 : (lvS.ln != null ? lvS.ln : null);
      var endR = kid(p, NS_A, 'endParaRPr');
      var buEl = pPr && kid(pPr, NS_A, 'buChar');
      var buCh = buEl ? (buEl.getAttribute('char') || '\u2022') : ((pPr && kid(pPr, NS_A, 'buNone')) ? null : (lvS.bu && lvS.bu !== 'none' ? lvS.bu : null));
      var bu = buCh ? { getAttribute: function () { return buCh; } } : null;
      var hasText = kids(p, NS_A).some(function (n) { return (n.localName === 'r' || n.localName === 'fld') && kid(n, NS_A, 't') && kid(n, NS_A, 't').textContent; });
      kids(p, NS_A).forEach(function (n) {
        if (n.localName === 'br') { push('\n'); return; }
        if (n.localName !== 'r' && n.localName !== 'fld') return;
        var tEl = kid(n, NS_A, 't');
        var t = tEl ? tEl.textContent.replace(/\r?\n/g, ' ') : '';
        var rPr = kid(n, NS_A, 'rPr');
        var rec = { sz: lvS.sz || null, b: lvS.b != null ? lvS.b : null, i: !!lvS.i, u: false, color: lvS.color || null, font: lvS.font || null };
        if (rPr) {
          if (rPr.getAttribute('sz')) rec.sz = num(rPr.getAttribute('sz'), 0) / 100;
          if (rPr.getAttribute('b') != null) rec.b = rPr.getAttribute('b') === '1' || rPr.getAttribute('b') === 'true';
          if (rPr.getAttribute('i') != null) rec.i = rPr.getAttribute('i') === '1' || rPr.getAttribute('i') === 'true';
          var u = rPr.getAttribute('u'); rec.u = !!u && u !== 'none';
          rec.color = readColorNode(kid(rPr, NS_A, 'solidFill'), theme) || rec.color;
          var lat = kid(rPr, NS_A, 'latin');
          if (lat && lat.getAttribute('typeface')) {
            var tf = lat.getAttribute('typeface');
            rec.font = tf === '+mj-lt' ? theme.fonts.major : (tf === '+mn-lt' ? theme.fonts.minor : tf);
          }
        }
        if (bu && hasText && lines[lines.length - 1] === '') push((bu.getAttribute('char') || '•') + ' ', rec);
        push(t, rec);
      });
      if (!hasText && endR && endR.getAttribute('sz')) runs.push({ line: lines.length - 1, ch: -1, rec: { sz: num(endR.getAttribute('sz'), 0) / 100 } });
    });
    var text = lines.join('\n').replace(/\s+$/, '');
    if (!text.trim()) return null;
    // asosiy (eng ko'p belgiga ega) uslub — qutining o'zi; farq qiladiganlari «styles» ga
    var cnt = {}, best = null, bestN = -1;
    runs.forEach(function (r) { if (r.ch < 0) return; var k = JSON.stringify(r.rec); cnt[k] = (cnt[k] || 0) + 1; if (cnt[k] > bestN) { bestN = cnt[k]; best = r.rec; } });
    best = best || {};
    function eff(rec) {
      return {
        pt: (rec.sz || defaultPt) * fontScale,
        bold: rec.b == null ? (inhAny ? false : isTitle) : rec.b,
        italic: !!rec.i, underline: !!rec.u,
        color: rec.color, font: rec.font || (isTitle ? theme.fonts.major : theme.fonts.minor)
      };
    }
    var base = eff(best);
    var styled = runs.filter(function (r) { return r.ch >= 0; }).map(function (r) { return { line: r.line, ch: r.ch, e: eff(r.rec) }; });
    return {
      text: text, pt: base.pt, bold: base.bold, italic: base.italic, underline: base.underline, color: base.color, font: base.font,
      align: ({ l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' })[align] || 'left',
      paraCount: lines.length, runs: styled,
      lineScale: Math.max(0.6, (lnPct == null ? 1 : lnPct) * (1 - lnRed))
    };
  }

  /** v55: shakl/rasmdagi bosiladigan havola (a:hlinkClick) — http(s) bo'lsa URL, aks holda '' */
  function ssShapeLink(nv, srels) {
    try {
      var cNv = nv && nv.firstElementChild;
      var hl = cNv && cNv.getElementsByTagNameNS(NS_A, 'hlinkClick')[0];
      var rid = hl && hl.getAttributeNS(NS_R, 'id');
      var tg = rid && srels[rid] && srels[rid].target;
      return (tg && /^https?:\/\//i.test(tg)) ? String(tg).slice(0, 500) : '';
    } catch (e) { return ''; }
  }

  /* v67: PowerPoint erkin shakli (custGeom) → Fabric yo'li (path). Nuqtalar shakl qutisiga masshtablanadi,
     aylantirish va akslantirish (flipH/V) nuqtalarga qo'llanadi — yo'l slaydda aynan o'z joyida chiziladi. */
  function custGeomToPath(cg, xf, base, sc, X0, Y0) {
    var pl = kid(cg, NS_A, 'pathLst');
    if (!pl) return null;
    var W = xf.cx * sc, H = xf.cy * sc, L = X0 + xf.x * sc, T = Y0 + xf.y * sc, cx = L + W / 2, cy = T + H / 2;
    var ang = (xf.rot || 0) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    var flips = (xf.flipH ? 1 : 0) + (xf.flipV ? 1 : 0);
    var d = [], anyFill = false, anyStroke = false;
    function P(px, py, pw, ph) {
      var x = L + (pw ? px / pw : 0) * W, y = T + (ph ? py / ph : 0) * H;
      if (xf.flipH) x = 2 * cx - x;
      if (xf.flipV) y = 2 * cy - y;
      var dx = x - cx, dy = y - cy;
      return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
    }
    function f(v) { return Math.round(v * 100) / 100; }
    kids(pl, NS_A, 'path').forEach(function (path) {
      var pw = num(path.getAttribute('w'), xf.cx) || xf.cx, ph = num(path.getAttribute('h'), xf.cy) || xf.cy;
      if (path.getAttribute('fill') !== 'none') anyFill = true;
      if (path.getAttribute('stroke') !== '0' && path.getAttribute('stroke') !== 'false') anyStroke = true;
      var cur = [0, 0], start = [0, 0];
      kids(path, NS_A).forEach(function (c) {
        var pts = kids(c, NS_A, 'pt').map(function (p) { return [num(p.getAttribute('x'), 0), num(p.getAttribute('y'), 0)]; });
        var q;
        switch (c.localName) {
          case 'moveTo': if (pts[0]) { cur = pts[0]; start = cur; q = P(cur[0], cur[1], pw, ph); d.push('M', f(q[0]), f(q[1])); } break;
          case 'lnTo': if (pts[0]) { cur = pts[0]; q = P(cur[0], cur[1], pw, ph); d.push('L', f(q[0]), f(q[1])); } break;
          case 'cubicBezTo':
            if (pts.length === 3) { var a1 = P(pts[0][0], pts[0][1], pw, ph), a2 = P(pts[1][0], pts[1][1], pw, ph), a3 = P(pts[2][0], pts[2][1], pw, ph); d.push('C', f(a1[0]), f(a1[1]), f(a2[0]), f(a2[1]), f(a3[0]), f(a3[1])); cur = pts[2]; }
            break;
          case 'quadBezTo':
            if (pts.length === 2) { var b1 = P(pts[0][0], pts[0][1], pw, ph), b2 = P(pts[1][0], pts[1][1], pw, ph); d.push('Q', f(b1[0]), f(b1[1]), f(b2[0]), f(b2[1])); cur = pts[1]; }
            break;
          case 'arcTo': {
            var wR = num(c.getAttribute('wR'), 0), hR = num(c.getAttribute('hR'), 0);
            var st = num(c.getAttribute('stAng'), 0) / 60000 * Math.PI / 180, sw = num(c.getAttribute('swAng'), 0) / 60000 * Math.PI / 180;
            var ccx = cur[0] - wR * Math.cos(st), ccy = cur[1] - hR * Math.sin(st);
            var ex = ccx + wR * Math.cos(st + sw), ey = ccy + hR * Math.sin(st + sw);
            var e2 = P(ex, ey, pw, ph);
            var rx = Math.abs(wR / pw * W), ry = Math.abs(hR / ph * H);
            var sweep = sw > 0 ? 1 : 0; if (flips % 2) sweep = 1 - sweep;
            if (rx > 0 && ry > 0) d.push('A', f(rx), f(ry), f(xf.rot || 0), Math.abs(sw) > Math.PI ? 1 : 0, sweep, f(e2[0]), f(e2[1]));
            else d.push('L', f(e2[0]), f(e2[1]));
            cur = [ex, ey];
            break;
          }
          case 'close': d.push('Z'); cur = start; break;
          default: break;
        }
      });
    });
    if (d.length < 4) return null;
    var o = Object.assign({}, base, { type: 'path', path: d.join(' '), angle: 0, flipX: false, flipY: false, strokeLineJoin: 'round' });
    delete o.left; delete o.top; delete o.width; delete o.height;
    if (!anyFill) o.fill = '';
    if (!anyStroke) { o.stroke = null; o.strokeWidth = 0; }
    // joylashuvni HOZIROQ hisoblaymiz (Fabric bilan) — slayd ochilmasdan eksport qilinsa ham shakl o'z joyida bo'ladi
    try {
      if (typeof fabric !== 'undefined') {
        var tmp = new fabric.Path(o.path, { strokeWidth: o.strokeWidth || 0 });
        o.left = tmp.left; o.top = tmp.top; o.width = tmp.width; o.height = tmp.height;
        o.path = tmp.path;
      }
    } catch (e) {}
    return o;
  }

  /* ==================================================================
   * v67: PowerPoint → sayt: animatsiyalar (<p:timing>) va slayd o'tishi (<p:transition>)
   * Eksportdagi PPT_FX / SS_TR jadvallarining teskarisi — aylana (sayt → PPTX → sayt) yo'qotishsiz.
   * ================================================================== */
  var FX_BY_KEY = {}, FX_BY_ID = {};
  Object.keys(PPT_FX).forEach(function (name) {
    var f = PPT_FX[name], k1 = f[0] + '|' + f[1] + '|' + f[2], k2 = f[0] + '|' + f[1];
    if (!FX_BY_KEY[k1]) FX_BY_KEY[k1] = name;
    if (!FX_BY_ID[k2]) FX_BY_ID[k2] = name;
  });
  var FX_DEFAULT = { entr: 'fadeIn', emph: 'pulse', exit: 'fadeOut' };
  function pptFxName(cls, pid, sub) {
    var n = FX_BY_KEY[cls + '|' + pid + '|' + sub] || FX_BY_ID[cls + '|' + pid];
    if (n) return n;
    if (cls === 'entr') {                                     // keng tarqalgan PowerPoint effektlari → eng yaqin sayt effekti
      if (pid === 2 || pid === 47 || pid === 42) return ({ 1: 'fadeInDown', 2: 'fadeInRight', 8: 'fadeInLeft' })[sub] || 'fadeInUp';
      if (pid === 23 || pid === 53 || pid === 21) return 'zoomIn';
      if (pid === 26) return 'bounceIn';
      if (pid === 22 || pid === 12 || pid === 18) return 'flipInX';
      if (pid === 31 || pid === 45) return 'rotateIn';
    }
    if (cls === 'emph') { if (pid === 8) return 'spin'; if (pid === 32 || pid === 34) return 'swing'; if (pid === 35) return 'flash'; }
    if (cls === 'exit') { if (pid === 2 || pid === 47) return 'slideOutDown'; if (pid === 23 || pid === 53) return 'zoomOut'; }
    return FX_DEFAULT[cls] || null;
  }
  /** Harakat yo'li: aynan bizning yo'limiz bo'lsa — o'sha nom; aks holda yo'nalishi bo'yicha eng yaqini */
  function pathFxName(ectn) {
    var mo = ectn.getElementsByTagNameNS(NS_P, 'animMotion')[0], d = mo ? String(mo.getAttribute('path') || '') : '';
    var norm = function (x) { return x.replace(/\s+/g, ' ').trim(); };
    var hit = null;
    if (window.SS_FX) SS_FX.list.some(function (e) { if (e[1] === 'path' && norm(e[3][4]) === norm(d)) { hit = e[0]; return true; } return false; });
    if (hit) return hit;
    var nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    if (nums.length < 2) return 'moveRight';
    var ex = nums[nums.length - 2], ey = nums[nums.length - 1];
    if (/C/i.test(d)) return Math.abs(ex) < 0.01 && Math.abs(ey) < 0.01 ? 'loopCircle' : 'arcUp';
    var ang = Math.atan2(ey, ex) * 180 / Math.PI;
    if (ang > -22.5 && ang <= 22.5) return 'moveRight';
    if (ang > 22.5 && ang <= 67.5) return 'moveDiagDown';
    if (ang > 67.5 && ang <= 112.5) return 'moveDown';
    if (ang < -22.5 && ang >= -67.5) return 'moveDiagUp';
    if (ang < -67.5 && ang >= -112.5) return 'moveUp';
    return 'moveLeft';
  }
  function cTnDelay(ctn) {
    var st = kid(ctn, NS_P, 'stCondLst'), cond = st && kid(st, NS_P, 'cond');
    var d = cond ? cond.getAttribute('delay') : '0';
    return d === 'indefinite' ? 0 : Math.max(0, num(d, 0));
  }
  function maxBehaviorDur(ctn) {
    var m = 0;
    Array.prototype.forEach.call(ctn.getElementsByTagNameNS(NS_P, 'cTn'), function (c) {
      var d = c.getAttribute('dur'); if (!d || d === 'indefinite') return;
      var k = c.getAttribute('autoRev') === '1' ? 2 : 1;                 // oldinga + orqaga
      var rc = c.getAttribute('repeatCount'); if (rc && rc !== 'indefinite') k *= Math.max(1, num(rc, 1000) / 1000);
      m = Math.max(m, cTnDelay(c) + num(d, 0) * k);
    });
    return m;
  }
  function importTiming(sdoc, spidMap) {
    var timing = sdoc.getElementsByTagNameNS(NS_P, 'timing')[0];
    if (!timing) return;
    var seq = null;
    Array.prototype.some.call(timing.getElementsByTagNameNS(NS_P, 'cTn'), function (c) { if (c.getAttribute('nodeType') === 'mainSeq') { seq = c; return true; } return false; });
    var groups = seq ? kids(kid(seq, NS_P, 'childTnLst') || seq, NS_P, 'par') : [];
    var t = 0;                                                // sekin-ketin vaqt (ms): bosishlar ketma-ket ijro deb olinadi
    groups.forEach(function (gpar) {
      var gctn = kid(gpar, NS_P, 'cTn'); if (!gctn) return;
      var gEnd = t;
      kids(kid(gctn, NS_P, 'childTnLst') || gctn, NS_P, 'par').forEach(function (ipar) {
        var ictn = kid(ipar, NS_P, 'cTn'); if (!ictn) return;
        var iStart = t + cTnDelay(ictn);
        kids(kid(ictn, NS_P, 'childTnLst') || ictn, NS_P, 'par').forEach(function (epar) {
          var ectn = kid(epar, NS_P, 'cTn'); if (!ectn || !ectn.getAttribute('presetClass')) return;
          var cls = ectn.getAttribute('presetClass'), pid = num(ectn.getAttribute('presetID'), 0), sub = num(ectn.getAttribute('presetSubtype'), 0);
          var tg = ectn.getElementsByTagNameNS(NS_P, 'spTgt')[0], spid = tg && tg.getAttribute('spid');
          var start = iStart + cTnDelay(ectn), dur = maxBehaviorDur(ectn) || 500;
          gEnd = Math.max(gEnd, start + dur);
          var name = cls === 'path' ? pathFxName(ectn) : pptFxName(cls, pid, sub);
          if (!name || !spid || !spidMap[spid]) return;
          var loop = ectn.getAttribute('repeatCount') === 'indefinite' || Array.prototype.some.call(ectn.getElementsByTagNameNS(NS_P, 'cTn'), function (c) { return c.getAttribute('repeatCount') === 'indefinite'; });
          if (loop && cls === 'emph') name = name === 'spin' ? 'spin' : (name === 'swing' ? 'float' : 'pulseLoop');
          spidMap[spid].forEach(function (o) {
            if (o.animName) return;                           // bitta obyektga bitta effekt (birinchisi)
            o.animName = name;
            o.animDur = Math.max(0.2, Math.min(6, Math.round(dur / 100) / 10));
            o.animDelay = Math.max(0, Math.min(10, Math.round(start / 100) / 10));
            if (loop) o.animLoop = true;
          });
        });
      });
      t = gEnd;
    });
  }
  var TR_FROM_PPT = { fade: 'fade', dissolve: 'blur', zoom: 'zoom', flip: 'flip', split: 'split', circle: 'circle',
    push: { u: 'up', d: 'down', l: 'left', r: 'right' }, wipe: { r: 'wipeR', l: 'wipeL', d: 'wipeD', u: 'wipeU' }, cover: { l: 'coverL', r: 'coverR', u: 'coverU', d: 'coverD' },
    pull: { l: 'uncoverL', r: 'uncoverR', u: 'uncoverU', d: 'uncoverD' }, randomBar: 'blur', cut: 'cut', newsflash: 'zoom', wheel: 'wheel', wedge: 'wedge', diamond: 'diamond', plus: 'plus',
    blinds: 'blindsH', checker: 'blur', comb: 'split', strips: 'wipeD', random: 'fade', vortex: 'zoom', ripple: 'circle', shred: 'blur', switch: 'flip',
    gallery: 'left', cube: 'left', doors: 'split', box: 'zoom', reveal: 'fade', honeycomb: 'blur', glitter: 'blur', flash: 'flash', prism: 'flip',
    ferris: 'left', flythrough: 'zoom', warp: 'zoom', conveyor: 'left', pan: 'left', vortex2: 'zoom', morph: 'fade', curtains: 'split', wind: 'left',
    airplane: 'left', origami: 'flip', fracture: 'blur', crush: 'zoom', peelOff: 'left', pageCurlDouble: 'left', pageCurlSingle: 'left', fallOver: 'down', drape: 'down' };
  function importTransition(sdoc) {
    var trs = sdoc.getElementsByTagNameNS(NS_P, 'transition');
    if (!trs.length) return null;
    var tr = trs[0];                                         // mc:Choice (p14) birinchi keladi — aniqroq
    var dur = 0;
    var p14d = tr.getAttribute('p14:dur') || tr.getAttributeNS('http://schemas.microsoft.com/office/powerpoint/2010/main', 'dur');
    if (p14d) dur = num(p14d, 0) / 1000;
    else dur = ({ fast: 0.5, med: 0.75, slow: 1 })[tr.getAttribute('spd') || 'med'] || 0.75;
    var auto = tr.getAttribute('advTm') ? num(tr.getAttribute('advTm'), 0) / 1000 : 0;
    var eff = tr.firstElementChild, key = 'none';
    if (eff) {
      var ln = eff.localName, dir = eff.getAttribute('dir') || '';
      // v68: atributlari bilan aniq mos keladiganlar (eksportdagi SS_TR jadvalining teskarisi)
      var exact = null;
      if (ln === 'cut') exact = 'cut';
      else if (ln === 'fade') exact = eff.getAttribute('thruBlk') === '1' || eff.getAttribute('thruBlk') === 'true' ? 'fadeBlack' : 'fade';
      else if (ln === 'zoom') exact = dir === 'out' ? 'zoomOut' : 'zoom';
      else if (ln === 'pull') exact = ({ l: 'uncoverL', r: 'uncoverR', u: 'uncoverU', d: 'uncoverD' })[dir[0] === 'l' || dir[0] === 'r' ? dir[0] : (dir[0] || 'l')] || 'uncoverL';
      else if (ln === 'cover') exact = ({ l: 'coverL', r: 'coverR', u: 'coverU', d: 'coverD' })[dir[0] || 'l'] || 'coverL';
      else if (ln === 'split') exact = eff.getAttribute('orient') === 'horz' ? 'splitH' : 'split';
      else if (ln === 'wheel') exact = num(eff.getAttribute('spokes'), 4) === 1 ? 'clock' : 'wheel';
      else if (ln === 'wedge') exact = 'wedge';
      else if (ln === 'blinds') exact = dir === 'vert' ? 'blindsV' : 'blindsH';
      else if (ln === 'diamond') exact = 'diamond';
      else if (ln === 'plus') exact = 'plus';
      else if (ln === 'flash') exact = 'flash';
      if (exact && (!window.SS_TR || SS_TR.map[exact])) key = exact;
      else {
        var m = TR_FROM_PPT[ln];
        if (typeof m === 'string') key = m;
        else if (m) key = m[dir[0]] || m[Object.keys(m)[0]];
        else key = 'fade';
        if (window.SS_TR && key !== 'none' && !SS_TR.map[key]) key = 'fade';
      }
    }
    if (key === 'none' && !auto) return { transition: 'none', transDur: 0, transAuto: 0 };
    return { transition: key, transDur: Math.max(0.2, Math.min(5, Math.round(dur * 10) / 10)), transAuto: auto };
  }

  // v68: slayd «barmoq izi» — PowerPoint'da tahrir qilinganini bilish uchun. XML qayta yozilishiga (atribut tartibi,
  // prefikslar) chidamli: faqat joylashuv/o'lcham raqamlari, matnlar, ranglar va shakl soni olinadi.
  function slideFp(xml) {
    xml = String(xml || '');
    var parts = [], m, re;
    re = /<a:(off|ext|chOff|chExt)\b[^>]*?\b(x|cx)="(-?\d+)"[^>]*?\b(y|cy)="(-?\d+)"/g;
    while ((m = re.exec(xml))) parts.push(m[3] + ',' + m[5]);
    re = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g;
    while ((m = re.exec(xml))) parts.push('t' + m[1]);
    re = /<a:srgbClr\b[^>]*?\bval="([0-9A-Fa-f]{6})"/g;
    while ((m = re.exec(xml))) parts.push('c' + m[1].toUpperCase());
    parts.push('n' + (xml.match(/<p:(sp|pic|graphicFrame|cxnSp)>/g) || []).length);
    var str = parts.join(';'), h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36) + ':' + parts.length;
  }
  async function slidePathsInOrder(zip) {
    var out = [];
    try {
      var presF = zip.file('ppt/presentation.xml');
      if (presF) {
        var pres = parseXml(await presF.async('string'));
        var presRels = await readRels(zip, 'ppt/presentation.xml');
        var idLst = pres.getElementsByTagNameNS(NS_P, 'sldIdLst')[0];
        if (idLst) kids(idLst, NS_P, 'sldId').forEach(function (s) {
          var rid = s.getAttributeNS(NS_R, 'id');
          if (rid && presRels[rid]) out.push(presRels[rid].target);
        });
      }
    } catch (e) {}
    if (!out.length) {
      Object.keys(zip.files).filter(function (p) { return /^ppt\/slides\/slide\d+\.xml$/.test(p); })
        .sort(function (a, b) { return parseInt(a.match(/(\d+)\.xml$/)[1], 10) - parseInt(b.match(/(\d+)\.xml$/)[1], 10); })
        .forEach(function (p) { out.push(p); });
    }
    return out;
  }
  async function slideFps(zip) {
    var paths = await slidePathsInOrder(zip), out = [];
    for (var i = 0; i < paths.length; i++) { var f = zip.file(paths[i]); out.push(f ? slideFp(await f.async('string')) : ''); }
    return out;
  }
  window.ssPptxSlideFp = slideFp;

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
    if (!title && file && file.name) title = file.name.replace(/\.(pptx|ppsx|pptm|potx|potm|ppsm)$/i, '');

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
      var layoutDoc = null, masterDoc = null, layoutRels = null, masterRels = null;
      try {
        var lrel = Object.keys(srels).map(function (k) { return srels[k]; }).filter(function (r) { return /slideLayout$/.test(r.type); })[0];
        if (lrel && zip.file(lrel.target)) {
          layoutDoc = parseXml(await zip.file(lrel.target).async('string'));
          var lrels = await readRels(zip, lrel.target);
          layoutRels = lrels;
          var mrel = Object.keys(lrels).map(function (k) { return lrels[k]; }).filter(function (r) { return /slideMaster$/.test(r.type); })[0];
          if (mrel && zip.file(mrel.target)) { masterDoc = parseXml(await zip.file(mrel.target).async('string')); masterRels = await readRels(zip, mrel.target); }
        }
      } catch (e) {  }

      var out = { version: FAB_VER, objects: [], background: '#ffffff' };

      var bgDone = false;
      var bgDocs = [[sdoc, srels], [layoutDoc, layoutRels], [masterDoc, masterRels]];
      for (var bi = 0; bi < bgDocs.length && !bgDone; bi++) {
        var bd = bgDocs[bi][0];
        if (!bd) continue;
        var bg = bd.getElementsByTagNameNS(NS_P, 'bg')[0];
        var bgPr = bg && kid(bg, NS_P, 'bgPr');
        if (!bgPr) continue;
        var bgc = kid(bgPr, NS_A, 'solidFill') ? readColorNode(kid(bgPr, NS_A, 'solidFill'), theme) : null;
        if (bgc) {
          var ba = bgc.alpha == null ? 1 : bgc.alpha;           // v67: shaffof fon rangi oq ustida aralashtiriladi
          if (ba < 0.999) { var bv = parseInt(bgc.hex.slice(1), 16), mix = function (c) { return Math.round(c * ba + 255 * (1 - ba)); };
            bgc = { hex: '#' + [mix((bv >> 16) & 255), mix((bv >> 8) & 255), mix(bv & 255)].map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('') }; }
          out.background = bgc.hex; bgDone = true; break;
        }
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

      var curRels = srels, curDecor = false;     // v67: layout/master bezaklari ham o'qiladi (o'z rels'i bilan)
      var spidMap = {};
      var walk = async function (container, groups, gFill) {
        var nodes = kids(container);
        for (var ni = 0; ni < nodes.length; ni++) {
          var n = nodes[ni];
          var objBefore = out.objects.length;
          try {
            if (n.namespaceURI !== NS_P) continue;
            var ln = n.localName;
            if (ln === 'grpSp') {
              var gp = kid(n, NS_P, 'grpSpPr'), gx = gp && kid(gp, NS_A, 'xfrm');
              var gf2 = (gp && kid(gp, NS_A, 'grpFill')) ? gFill : ((gp && fillOf(gp, theme)) || gFill);
              if (gx) {
                var o1 = kid(gx, NS_A, 'off'), e1 = kid(gx, NS_A, 'ext'), co = kid(gx, NS_A, 'chOff'), ce = kid(gx, NS_A, 'chExt');
                if (o1 && e1 && co && ce) {
                  await walk(n, groups.concat([{
                    rot: num(gx.getAttribute('rot'), 0) / 60000, flipH: gx.getAttribute('flipH') === '1', flipV: gx.getAttribute('flipV') === '1',
                    offX: num(o1.getAttribute('x'), 0), offY: num(o1.getAttribute('y'), 0),
                    extX: num(e1.getAttribute('cx'), 1), extY: num(e1.getAttribute('cy'), 1),
                    chOffX: num(co.getAttribute('x'), 0), chOffY: num(co.getAttribute('y'), 0),
                    chExtX: num(ce.getAttribute('cx'), 1), chExtY: num(ce.getAttribute('cy'), 1)
                  }]), gf2);
                  continue;
                }
              }
              await walk(n, groups, gf2);
              continue;
            }
            if (ln === 'graphicFrame') {
              var gd = n.getElementsByTagNameNS(NS_A, 'graphicData')[0];
              var uri = gd ? (gd.getAttribute('uri') || '') : '';
              var okObj = null;
              try { okObj = await importGraphicFrame(n, gd, uri, groups, curRels); } catch (e) { console.warn('PPTX jadval/diagramma:', e); }
              if (okObj) { out.objects.push(okObj); continue; }
              if (/table/i.test(uri)) skipped.table++; else if (/chart/i.test(uri)) skipped.chart++; else skipped.other++;
              continue;
            }
            if (ln !== 'sp' && ln !== 'pic' && ln !== 'cxnSp') continue;

            var spPr = kid(n, NS_P, 'spPr');
            var nv = kid(n, NS_P, ln === 'sp' ? 'nvSpPr' : (ln === 'pic' ? 'nvPicPr' : 'nvCxnSpPr'));
            var nvPr = nv && kid(nv, NS_P, 'nvPr');
            var ph = nvPr && kid(nvPr, NS_P, 'ph');
            if (curDecor && ph) continue;                 // layout/master'dagi joy egallovchilar (placeholder) — slaydning o'zida bor
            var xf = readXfrm(spPr) || findPlaceholderXfrm(phDocs, ph);
            if (!xf) continue;
            xf = applyGroups(xf, groups);
            var W = xf.cx * scale, H = xf.cy * scale;
            var CX = offX + (xf.x + xf.cx / 2) * scale, CY = offY + (xf.y + xf.cy / 2) * scale;
            var pos = fabricPos(CX, CY, W, H, xf.rot);

            if (ln === 'pic') {
              var blipF = kid(n, NS_P, 'blipFill'), blipN = blipF && kid(blipF, NS_A, 'blip');
              var rid = blipN && blipN.getAttributeNS(NS_R, 'embed');
              if (!rid || !curRels || !curRels[rid]) continue;
              var md2 = await mediaData(curRels[rid].target);
              if (!md2) continue;
              var src = blipF && kid(blipF, NS_A, 'srcRect');
              var l = src ? num(src.getAttribute('l'), 0) / 100000 : 0, t = src ? num(src.getAttribute('t'), 0) / 100000 : 0;
              var r = src ? num(src.getAttribute('r'), 0) / 100000 : 0, b = src ? num(src.getAttribute('b'), 0) / 100000 : 0;
              var cw = Math.max(1, md2.w * (1 - l - r)), ch = Math.max(1, md2.h * (1 - t - b));
              var picObj = {
                type: 'image', version: FAB_VER, originX: 'left', originY: 'top',
                left: pos.left, top: pos.top, width: cw, height: ch,
                scaleX: W / cw, scaleY: H / ch,
                flipX: !!xf.flipH, flipY: !!xf.flipV, angle: xf.rot,
                cropX: md2.w * l, cropY: md2.h * t, src: md2.src, crossOrigin: null, filters: []
              };
              // v55: animatsiyali GIF (Telegram bot slaydlari) muharrirda ham harakatlansin
              if (/^data:image\/gif/i.test(md2.src || '')) {
                picObj.type = 'gifImage'; picObj.isGif = true; picObj.gifUrl = md2.src;
                picObj.width = md2.w; picObj.height = md2.h; picObj.scaleX = W / md2.w; picObj.scaleY = H / md2.h;
                picObj.cropX = 0; picObj.cropY = 0;
              }
              var picLink = curDecor ? null : ssShapeLink(nv, curRels);
              if (picLink) picObj.linkUrl = picLink;
              out.objects.push(picObj);
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
            var fill = (spPr && kid(spPr, NS_A, 'grpFill')) ? gFill : fillOf(spPr, theme);
            var lnS = spPr && kid(spPr, NS_A, 'ln');
            // v68: PowerPoint'da chizilgan shakl rangini ko'pincha <p:style> (mavzu ranglari) dan oladi
            var pStyle = kid(n, NS_P, 'style');
            var styleLine = null, styleFont = null;
            if (pStyle) {
              // v83: text colour of a shape with no run colour comes from <a:fontRef> (PowerPoint / python-pptx shapes:
              // white «lt1» text on an accent fill). Before, it was read as black.
              var fRef = kid(pStyle, NS_A, 'fontRef');
              if (fRef && fRef.firstElementChild) styleFont = readColorNode(fRef.firstElementChild, theme);
              var hasF = spPr && ['solidFill', 'gradFill', 'noFill', 'grpFill', 'blipFill', 'pattFill'].some(function (k) { return kid(spPr, NS_A, k); });
              var fr = kid(pStyle, NS_A, 'fillRef');
              if (!hasF && fr && num(fr.getAttribute('idx'), 0) > 0) { var fc = readColorNode(fr.firstElementChild, theme); if (fc) fill = fc; }
              var lr = kid(pStyle, NS_A, 'lnRef');
              if (lr && num(lr.getAttribute('idx'), 0) > 0) styleLine = { color: readColorNode(lr.firstElementChild, theme), w: [0, 6350, 12700, 19050][Math.min(3, num(lr.getAttribute('idx'), 1))] };
            }
            // v67: joy egallovchi o'z rangini/chegarasini bermasa — layout/master'dagi shu placeholder'dan meros oladi
            if (ph && !curDecor && (!fill || !lnS)) {
              var hasFillEl = spPr && ['solidFill', 'gradFill', 'noFill', 'grpFill', 'blipFill', 'pattFill'].some(function (k) { return kid(spPr, NS_A, k); });
              [layoutDoc, masterDoc].some(function (d) {
                var psp = findPhSp(d, ph), pPr2 = psp && kid(psp, NS_P, 'spPr');
                if (!pPr2) return false;
                if (!hasFillEl && !fill) { var f2 = fillOf(pPr2, theme); if (f2) fill = f2; }
                if (!lnS && kid(pPr2, NS_A, 'ln')) lnS = kid(pPr2, NS_A, 'ln');
                return !!(fill && lnS);
              });
            }
            var stroke = lnS && !kid(lnS, NS_A, 'noFill') ? readColorNode(kid(lnS, NS_A, 'solidFill'), theme) : null;
            var strokeW = stroke ? Math.max(0.5, num(lnS.getAttribute('w'), 12700) * scale) : 0;
            if (!stroke && styleLine && styleLine.color && !(lnS && kid(lnS, NS_A, 'noFill'))) {
              stroke = styleLine.color; strokeW = Math.max(0.5, num(lnS && lnS.getAttribute('w'), styleLine.w) * scale);
            }
            var txBody = kid(n, NS_P, 'txBody');
            var isPlaceholder = !!ph;
            var hasVisual = (fill && !fill.none) || stroke;
            if (hasVisual && !isPlaceholder || (hasVisual && isPlaceholder)) {
              var base = {
                version: FAB_VER, originX: 'left', originY: 'top', left: pos.left, top: pos.top,
                angle: xf.rot, scaleX: 1, scaleY: 1,
                fill: fill && !fill.none ? (fill.grad ? fabricGradient(fill, W, H) : fill.hex) : 'rgba(0,0,0,0)',
                opacity: fill && !fill.none && !fill.grad ? fill.alpha : 1,
                stroke: stroke ? stroke.hex : null, strokeWidth: strokeW
              };
              var cg = spPr && kid(spPr, NS_A, 'custGeom');
              var cgObj = cg ? custGeomToPath(cg, xf, base, scale, offX, offY) : null;
              if (cgObj) {
                out.objects.push(cgObj);
              } else if (!cg && !/^(rect|roundRect|ellipse|triangle)$/.test(prst) && /^[A-Za-z0-9]+$/.test(prst)) {
                // v68: boshqa 183 ta PowerPoint shakli — o'z nomi va sariq tutqich qiymatlari bilan (tahrirlanadi, qayta eksportda ham o'sha shakl)
                var adjO = null;
                if (geom) kids(kid(geom, NS_A, 'avLst') || geom, NS_A, 'gd').forEach(function (g) {
                  var mv = /^val\s+(-?\d+(?:\.\d+)?)$/.exec(g.getAttribute('fmla') || '');
                  if (mv) (adjO = adjO || {})[g.getAttribute('name')] = +mv[1];
                });
                var po = Object.assign({ type: 'prstShape', prst: prst, width: W, height: H, strokeUniform: true, flipX: !!xf.flipH, flipY: !!xf.flipV }, base);
                if (adjO) po.adj = adjO;
                po.originX = 'center'; po.originY = 'center'; po.left = CX; po.top = CY;   // markaz — chegara qalinligidan qat'i nazar aniq
                out.objects.push(po);
              } else if (prst === 'ellipse') {
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
              var tb = readTextBody(txBody, theme, defPt, phType, ph ? phInherit(ph, phType, layoutDoc, masterDoc, theme) : null);
              if (tb) {
                var bp = kid(txBody, NS_A, 'bodyPr');
                var lIns = bp && bp.getAttribute('lIns') != null ? num(bp.getAttribute('lIns'), 91440) : 91440;
                var rIns = bp && bp.getAttribute('rIns') != null ? num(bp.getAttribute('rIns'), 91440) : 91440;
                var tIns = bp && bp.getAttribute('tIns') != null ? num(bp.getAttribute('tIns'), 45720) : 45720;
                var bIns = bp && bp.getAttribute('bIns') != null ? num(bp.getAttribute('bIns'), 45720) : 45720;
                var fontPx = tb.pt * 12700 * scale;
                var tw = Math.max(10, W - (lIns + rIns) * scale);
                var th = Math.max(10, H - (tIns + bIns) * scale);
                var tcol = tb.color ? tb.color.hex : (styleFont && styleFont.hex ? styleFont.hex
                  : ((fill && !fill.none && isDark(fill.hex)) ? '#ffffff' : '#1f1f1f'));
                var tObj = {
                  type: 'textbox', version: FAB_VER, originX: 'left', originY: 'top',
                  width: tw, angle: xf.rot, scaleX: 1, scaleY: 1,
                  text: tb.text, fontSize: Math.max(4, Math.round(fontPx * 10) / 10),
                  fontFamily: tb.font || 'Arial', fill: tcol,
                  fontWeight: tb.bold ? 'bold' : 'normal', fontStyle: tb.italic ? 'italic' : 'normal',
                  underline: !!tb.underline, textAlign: tb.align, lineHeight: Math.round(1.2 / 1.13 * tb.lineScale * 100) / 100, splitByGrapheme: false
                };
                // har bo'lakning o'z uslubi (asosiy uslubdan farq qilsa)
                var styles = {};
                (tb.runs || []).forEach(function (r) {
                  var st = {}, e = r.e;
                  var fpx = Math.max(4, Math.round(e.pt * 12700 * scale * 10) / 10);
                  if (Math.abs(fpx - tObj.fontSize) > 0.05) st.fontSize = fpx;
                  if (e.bold !== tb.bold) st.fontWeight = e.bold ? 'bold' : 'normal';
                  if (e.italic !== tb.italic) st.fontStyle = e.italic ? 'italic' : 'normal';
                  if (e.underline !== !!tb.underline) st.underline = e.underline;
                  if (e.color && e.color.hex !== tcol) st.fill = e.color.hex;
                  if (e.font && e.font !== tObj.fontFamily) st.fontFamily = e.font;
                  if (!Object.keys(st).length) return;
                  (styles[r.line] = styles[r.line] || {})[r.ch] = st;
                });
                if (Object.keys(styles).length) tObj.styles = styles;
                // vertikal joylashuv (anchor) — haqiqiy matn balandligi Fabric bilan o'lchanadi
                var anchor = bp ? bp.getAttribute('anchor') : null;
                var realH = tb.paraCount * fontPx * 1.3;
                try {
                  if (typeof fabric !== 'undefined') {
                    var mt = new fabric.Textbox(tObj.text, Object.assign({}, tObj, { styles: tObj.styles || {} }));
                    if (mt.height > 0) realH = mt.height;
                  }
                } catch (e) {}
                var dy = 0;
                if (anchor === 'ctr') dy = (th - realH) / 2;
                else if (anchor === 'b') dy = th - realH;
                if (dy < 0 && anchor === 'ctr') dy = Math.max(dy, -tIns * scale);   // sig'masa ham qutidan tepaga ko'p chiqmasin
                var tpos = fabricPos(CX, CY, W, H, xf.rot);
                var ang = xf.rot * Math.PI / 180;
                var lx = lIns * scale, ly = tIns * scale + dy;
                tObj.left = tpos.left + lx * Math.cos(ang) - ly * Math.sin(ang);
                tObj.top = tpos.top + lx * Math.sin(ang) + ly * Math.cos(ang);
                tObj.height = Math.max(th, realH);
                out.objects.push(tObj);
                var spLink = curDecor ? null : ssShapeLink(nv, curRels);         // v55: botdagi tugma/havola muharrirda ham bosiladi
                if (spLink) out.objects[out.objects.length - 1].linkUrl = spLink;
              }
            }
          } catch (e) {
            skipped.other++;
            console.warn('PPTX import element:', e);
          } finally {
            // v67: animatsiya nishoni (spid) → shu shakldan hosil bo'lgan obyektlar
            if (!curDecor && out.objects.length > objBefore) {
              var cnv = n.getElementsByTagNameNS && n.getElementsByTagNameNS(NS_P, 'cNvPr')[0];
              var cid = cnv && cnv.getAttribute('id');
              if (cid) spidMap[cid] = (spidMap[cid] || []).concat(out.objects.slice(objBefore));
            }
          }
        }
      };
      // v67: bezaklar tartibi: master → layout → slayd (showMasterSp="0" bo'lsa master/layout shakllari chizilmaydi)
      var showSp = function (d) { var r = d && d.documentElement; return !(r && r.getAttribute('showMasterSp') === '0'); };
      var decorDocs = [];
      if (showSp(sdoc)) {
        if (masterDoc && showSp(layoutDoc)) decorDocs.push([masterDoc, masterRels]);
        if (layoutDoc) decorDocs.push([layoutDoc, layoutRels]);
      }
      for (var di = 0; di < decorDocs.length; di++) {
        var dtree = decorDocs[di][0].getElementsByTagNameNS(NS_P, 'spTree')[0];
        if (!dtree) continue;
        curRels = decorDocs[di][1] || {}; curDecor = true;
        try { await walk(dtree, [], null); } catch (e) { console.warn('PPTX layout bezaklari:', e); }
      }
      curRels = srels; curDecor = false;
      if (tree) await walk(tree, [], null);
      // v67: PowerPoint animatsiyalari va slayd o'tishi ham o'qiladi
      try { importTiming(sdoc, spidMap); } catch (e) { console.warn('PPTX animatsiya:', e); }
      var trn = null;
      try { trn = importTransition(sdoc); } catch (e) { console.warn('PPTX o\'tish:', e); }
      result.push(Object.assign({ json: JSON.stringify(out), thumb: '', imageNumbers: [] }, trn || {}));
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
      return { json: s.json || '{}', thumb: s.thumb || '', imageNumbers: s.imageNumbers || [], transition: s.transition || '', transDur: s.transDur || 0, transAuto: s.transAuto || 0 };
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

  async function importPptxClient(file, opts) {
    // v83: quiet = a deck that comes from the bot / the account: no «PPTX ochilmoqda / ochildi» file dialogs,
    // only a small toast — for the user it simply IS their presentation, not a file being opened.
    var quiet = !!(opts && opts.quiet);
    var SwalQ = quiet ? { fire: function (a, b, c) {
      var o = (a && typeof a === 'object') ? a : { title: a, text: b, icon: c };
      if (o.icon === 'error') { try { showToast((o.title || 'Xato') + ': ' + (o.text || ''), 'error'); } catch (e) {} }
      return Promise.resolve({});
    }, showLoading: function () {} } : null;
    var Swal = SwalQ || window.Swal;
    Swal.fire({ title: 'PPTX ochilmoqda…', allowOutsideClick: false, didOpen: function () { Swal.showLoading(); } });
    try {
      if (!window.JSZip) { Swal.fire('Xato', 'JSZip yuklanmadi. Internetni tekshiring.', 'error'); return; }
      var zip = await JSZip.loadAsync(await file.arrayBuffer());

      var projFile = zip.file('slide-studio/project.json');
      if (projFile) {
        try {
          var data = JSON.parse(await projFile.async('string'));
          var list = data.slides || [];
          // v68: fayl PowerPoint / LibreOffice'da o'zgartirilgan bo'lsa — o'zgargan slaydlar ichki nusxadan EMAS,
          // faylning o'zidan o'qiladi (avval tahrirlar jimgina yo'qolardi). O'zgarmagan slaydlar — 1:1 nusxadan.
          if (list.length && Array.isArray(data.fp) && data.fp.length === list.length) {
            var now = await slideFps(zip), same = now.length === data.fp.length && now.every(function (f, i) { return f === data.fp[i]; });
            if (!same) {
              var nat = await importNativePptx(zip, file), used = {}, merged = [], fromFile = 0;
              nat.slides.forEach(function (ns, i) {
                var k = data.fp.indexOf(now[i]);
                while (k >= 0 && used[k]) k = data.fp.indexOf(now[i], k + 1);
                if (k >= 0) { used[k] = 1; merged.push(list[k]); }
                else { fromFile++; merged.push(window.ssAdaptImported ? Object.assign({}, ns, { json: window.ssAdaptImported(ns.json) }) : ns); }
              });
              if (merged.length) {
                await applyImportedSlides(merged, data.title || nat.title);
                Swal.fire({ icon: 'success', title: 'PPTX ochildi', text: merged.length + ' ta slayd. ' + fromFile + " tasi boshqa dasturda o'zgartirilgan — o'zgarishlar saqlandi.", timer: 2600, showConfirmButton: false });
                return;
              }
            }
          }
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
