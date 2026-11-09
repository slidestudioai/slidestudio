/* Slide Studio v40 — Mustaqil HTML namoyish eksporti
 * - Matn haqiqiy matn (belgilanadi va nusxalanadi), rasm emas
 * - Muharrirdagi "Namoyish" bilan bir xil: animatsiyalar, slayd o'tishi, tugmalar, havolalar
 * - MP4 / rasm / GIF fayl ichiga joylangan (oflayn ishlaydi), shriftlar ham fayl ichiga joylanadi
 * - Strelkalar, bosish/surish, to'liq ekran (Fullscreen)
 * Foydalanuvchi faylidagi loyiha ma'lumoti (#project-data) saqlanadi — HTML qayta tahrirlash uchun ochiladi.
 */
(function () {
  'use strict';

  function toast(msg, kind) { try { showToast(msg, kind); } catch (e) {  } }
  function pTimeout(p, ms, fb) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(fb); }, ms); })]); }
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function jsonForScript(v) { return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

  // ------------------------------------------------------------------
  // 1) KO'RSATUVCHI (VIEWER) — eksport qilingan fayl ichida ishlaydi.
  //    Oddiy funksiya sifatida yoziladi, faylga toString() orqali joylanadi.
  // ------------------------------------------------------------------
  function ssViewerRuntime() {
    'use strict';
    var W = 960, H = 540, SVGNS = 'http://www.w3.org/2000/svg';
    var LOOPS = { float: 1, spin: 1, pulseLoop: 1 };
    var GENERIC = /^(arial|helvetica|times new roman|times|georgia|verdana|courier new|courier|sans-serif|serif|monospace|tahoma|trebuchet ms|impact|system-ui)$/i;
    function $(id) { return document.getElementById(id); }
    function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
    function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
    function pw(v) { return (v / W * 100) + 'cqw'; }          // kenglik bo'yicha birlik
    function ph(v) { return (v / H * 100) + 'cqh'; }          // balandlik bo'yicha birlik

    var EMBED = !!window.__SS_EMBED;                       // muharrir ichidagi Namoyish (iframe) rejimi
    var D = EMBED ? window.parent.__ssPresData : null;
    var project = D ? D.project : JSON.parse($('project-data').textContent);
    var sprites = D ? (D.sprites || {}) : {};
    if (!D) { try { sprites = JSON.parse($('sprite-data').textContent) || {}; } catch (e) {  } }
    var slides = D ? D.slides : project.slides.map(function (s) { try { return JSON.parse(s.json || '{}'); } catch (e) { return {}; } });
    var stage = $('stage'), counter = $('counter'), app = $('app');
    var idx = 0, current = null, dir = 'next', navToken = 0, textFixList = [];

    // ---------- yirik data: URL larni blob: ga aylantirish (xotira va tezlik) ----------
    function prepareBlobs() {
      var jobs = [], seen = new Map();
      function conv(holder, key) {
        var v = holder[key];
        if (typeof v !== 'string' || v.length < 150000 || v.slice(0, 5) !== 'data:') return;
        if (seen.has(v)) { var j0 = seen.get(v); jobs.push(j0.then(function (u) { if (u) holder[key] = u; })); return; }
        var job = fetch(v).then(function (r) { return r.blob(); }).then(function (b) { return URL.createObjectURL(b); }).catch(function () { return null; });
        seen.set(v, job);
        jobs.push(job.then(function (u) { if (u) holder[key] = u; }));
      }
      (function walk(n, depth) {
        if (!n || typeof n !== 'object' || depth > 8) return;
        Object.keys(n).forEach(function (k) {
          if (k === 'text') return;
          if (typeof n[k] === 'string') conv(n, k); else walk(n[k], depth + 1);
        });
      })(slides, 0);
      Object.keys(sprites).forEach(function (si) { Object.keys(sprites[si]).forEach(function (oi) { conv(sprites[si][oi], 'src'); }); });
      return Promise.all(jobs);
    }

    // ---------- ranglar / gradientlar ----------
    function cssColor(c, fallback) { return (typeof c === 'string' && c) ? c : fallback; }
    function gradientCss(g, w, h) {
      try {
        var stops = (g.colorStops || []).slice().sort(function (a, b) { return a.offset - b.offset; })
          .map(function (s) { return s.color + ' ' + Math.round(s.offset * 100) + '%'; }).join(',');
        if (!stops) return null;
        var c = g.coords || {}, pct = g.gradientUnits === 'percentage';
        if (g.type === 'radial') {
          var cx = num(c.x2, (w || 100) / 2), cy = num(c.y2, (h || 100) / 2);
          if (pct) { cx *= (w || 100); cy *= (h || 100); }
          return 'radial-gradient(circle at ' + (cx / Math.max(1, w || 100) * 100) + '% ' + (cy / Math.max(1, h || 100) * 100) + '%,' + stops + ')';
        }
        var x1 = num(c.x1, 0), y1 = num(c.y1, 0), x2 = num(c.x2, w || 100), y2 = num(c.y2, 0);
        if (pct) { x1 *= (w || 100); x2 *= (w || 100); y1 *= (h || 100); y2 *= (h || 100); }
        var deg = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI + 90;
        return 'linear-gradient(' + deg + 'deg,' + stops + ')';
      } catch (e) { return null; }
    }
    function fillCss(f, w, h) {
      if (typeof f === 'string') return { color: f };
      if (f && typeof f === 'object' && f.colorStops) { var g = gradientCss(f, w, h); if (g) return { gradient: g }; }
      return { color: null };
    }
    function shadowOf(o) {
      var s = o.shadow;
      if (!s) return null;
      if (typeof s === 'string') return { color: 'rgba(0,0,0,0.15)', blur: 14, offsetX: 0, offsetY: 4 };
      return { color: s.color || 'rgba(0,0,0,.3)', blur: num(s.blur, 0), offsetX: num(s.offsetX, 0), offsetY: num(s.offsetY, 0) };
    }

    // ---------- shrift o'lchamlari (fabric bilan bir xil joylashuv) ----------
    var mctx = null, mcache = {};
    function fontMetrics(family, weight, style) {
      var key = family + '|' + weight + '|' + style;
      if (mcache[key]) return mcache[key];
      var a = 0.905, d = 0.212;
      try {
        if (!mctx) mctx = document.createElement('canvas').getContext('2d');
        mctx.font = style + ' ' + weight + ' 100px ' + family;
        var m = mctx.measureText('Mgy\u00C5');
        if (m.fontBoundingBoxAscent > 0) { a = m.fontBoundingBoxAscent / 100; d = m.fontBoundingBoxDescent / 100; }
      } catch (e) {  }
      return (mcache[key] = { a: a, d: d });
    }
    function fixTextOffsets() {
      textFixList.forEach(function (t) {
        if (!t.node.isConnected) return;
        var m = fontMetrics(t.family, t.weight, t.style);
        // fabric: qator balandligi = fs * lineHeight * 1.13, baseline = qator tepasidan 0.879*fs
        var shift = 0.879 - ((1.13 * t.lh - (m.a + m.d)) / 2 + m.a);
        t.node.style.top = (shift * t.fs / H * 100) + 'cqh';
      });
    }

    // ---------- matn ----------
    function styleRun(span, st, o) {
      if (st.fill && typeof st.fill === 'string') span.style.color = st.fill;
      if (st.fontWeight) span.style.fontWeight = st.fontWeight;
      if (st.fontStyle) span.style.fontStyle = st.fontStyle;
      if (st.fontFamily) span.style.fontFamily = st.fontFamily;
      if (st.fontSize) span.style.fontSize = ph(st.fontSize);
      if (st.textBackgroundColor) span.style.backgroundColor = st.textBackgroundColor;
      var deco = [];
      if (st.underline) deco.push('underline');
      if (st.linethrough) deco.push('line-through');
      if (st.overline) deco.push('overline');
      if (deco.length) span.style.textDecoration = deco.join(' ');
    }
    function fillTextContent(host, o) {
      var text = String(o.text == null ? '' : o.text);
      var styles = o.styles && typeof o.styles === 'object' && !Array.isArray(o.styles) ? o.styles : null;
      var has = styles && Object.keys(styles).some(function (k) { return styles[k] && Object.keys(styles[k]).length; });
      if (!has) { host.appendChild(document.createTextNode(text)); return; }
      var lines = text.split('\n');
      lines.forEach(function (line, li) {
        var chars = Array.from(line), ls = styles[li] || {}, run = '', runKey = null, runSt = null;
        function flush() {
          if (!run) return;
          if (runKey && runKey !== '{}') { var sp = mk('span'); styleRun(sp, runSt, o); sp.textContent = run; host.appendChild(sp); }
          else host.appendChild(document.createTextNode(run));
          run = '';
        }
        chars.forEach(function (ch, ci) {
          var st = ls[ci] || {}, key = JSON.stringify(st);
          if (key !== runKey) { flush(); runKey = key; runSt = st; }
          run += ch;
        });
        flush();
        if (li < lines.length - 1) host.appendChild(document.createTextNode('\n'));
      });
    }
    function buildText(o, w, h) {
      var box = mk('div', 'tbox');
      var fs = num(o.fontSize, 24), lh = num(o.lineHeight, 1.16);
      var family = o.fontFamily || 'Arial, sans-serif';
      var weight = o.fontWeight || 'normal', fstyle = o.fontStyle || 'normal';
      var s = box.style;
      s.fontSize = ph(fs); s.lineHeight = String(1.13 * lh);
      s.fontFamily = family; s.fontWeight = weight; s.fontStyle = fstyle;
      s.textAlign = o.textAlign || 'left';
      if (o.charSpacing) s.letterSpacing = (o.charSpacing / 1000) + 'em';
      var deco = [];
      if (o.underline) deco.push('underline');
      if (o.linethrough) deco.push('line-through');
      if (o.overline) deco.push('overline');
      if (deco.length) s.textDecoration = deco.join(' ');
      var f = fillCss(o.fill, w, h);
      if (f.gradient) { s.backgroundImage = f.gradient; s.webkitBackgroundClip = 'text'; s.backgroundClip = 'text'; s.color = 'transparent'; s.webkitTextFillColor = 'transparent'; }
      else s.color = cssColor(f.color, '#1f1f1f');
      var sh = shadowOf(o);
      if (sh) s.textShadow = pw(sh.offsetX) + ' ' + pw(sh.offsetY) + ' ' + pw(sh.blur) + ' ' + sh.color;
      var sw = num(o.strokeWidth, 0);
      if (o.stroke && typeof o.stroke === 'string' && sw > 0) { s.webkitTextStroke = pw(sw) + ' ' + o.stroke; s.paintOrder = 'stroke fill'; }
      if (o.textBackgroundColor) s.backgroundColor = o.textBackgroundColor;
      if (o.type !== 'textbox') s.whiteSpace = 'pre';
      var inner = box;
      if (typeof o.linkUrl === 'string' && /^(https?:|mailto:|tel:)/i.test(o.linkUrl)) {
        var a = mk('a'); a.href = o.linkUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'tlink';
        a.style.color = 'inherit'; a.style.textDecoration = 'underline';
        box.appendChild(a); inner = a;
      }
      fillTextContent(inner, o);
      textFixList.push({ node: box, fs: fs, lh: lh, family: family, weight: weight, style: fstyle });
      return box;
    }

    // ---------- shakllar (SVG) ----------
    var gradSeq = 0;
    function svgEl(tag, attrs) { var e = document.createElementNS(SVGNS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
    function svgPaint(svg, defs, v, w, h) {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object' && v.colorStops) {
        var id = 'sg' + (++gradSeq), c = v.coords || {}, pct = v.gradientUnits === 'percentage', g;
        if (v.type === 'radial') {
          g = svgEl('radialGradient', { id: id, gradientUnits: 'userSpaceOnUse', cx: num(c.x2, w / 2) * (pct ? w : 1), cy: num(c.y2, h / 2) * (pct ? h : 1), r: num(c.r2, Math.max(w, h) / 2) * (pct ? Math.max(w, h) : 1) });
        } else {
          g = svgEl('linearGradient', { id: id, gradientUnits: 'userSpaceOnUse', x1: num(c.x1, 0) * (pct ? w : 1), y1: num(c.y1, 0) * (pct ? h : 1), x2: num(c.x2, w) * (pct ? w : 1), y2: num(c.y2, 0) * (pct ? h : 1) });
        }
        v.colorStops.forEach(function (st) { g.appendChild(svgEl('stop', { offset: (st.offset * 100) + '%', 'stop-color': st.color })); });
        defs.appendChild(g);
        return 'url(#' + id + ')';
      }
      return 'none';
    }
    function buildShape(o, w0, h0) {
      var t = o.type, sx = num(o.scaleX, 1) || 1, sy = num(o.scaleY, 1) || 1, W0, H0, shape;
      if (t === 'circle') { var r = num(o.radius, num(o.width, 100) / 2); W0 = H0 = r * 2; }
      else if (t === 'ellipse') { W0 = num(o.rx, 50) * 2; H0 = num(o.ry, 50) * 2; }
      else { W0 = num(o.width, 100); H0 = num(o.height, 100); }
      var svg = svgEl('svg', { viewBox: '0 0 ' + W0 + ' ' + H0, preserveAspectRatio: 'none' });
      svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;display:block';
      var defs = svgEl('defs'); svg.appendChild(defs);
      if (t === 'rect') shape = svgEl('rect', { x: 0, y: 0, width: W0, height: H0, rx: num(o.rx, 0), ry: num(o.ry, num(o.rx, 0)) });
      else if (t === 'circle' || t === 'ellipse') shape = svgEl('ellipse', { cx: W0 / 2, cy: H0 / 2, rx: W0 / 2, ry: H0 / 2 });
      else shape = svgEl('polygon', { points: (W0 / 2) + ',0 ' + W0 + ',' + H0 + ' 0,' + H0 });
      shape.setAttribute('fill', svgPaint(svg, defs, o.fill, W0, H0));
      var swd = num(o.strokeWidth, 0);
      if (typeof o.stroke === 'string' && o.stroke && swd > 0) {
        shape.setAttribute('stroke', o.stroke); shape.setAttribute('stroke-width', swd);
        if (o.strokeDashArray && o.strokeDashArray.length) shape.setAttribute('stroke-dasharray', o.strokeDashArray.join(' '));
      }
      svg.appendChild(shape);
      return svg;
    }

    // ---------- rasm / GIF ----------
    function buildImage(o, w, h, srcOverride) {
      var holder = mk('div', 'imgwrap');
      var src = srcOverride || (o.isGif || o.type === 'gifImage' ? (o.gifUrl || o.src) : o.src) || '';
      var img = mk('img'); img.alt = ''; img.draggable = false; img.decoding = 'async';
      var cx = num(o.cropX, 0), cy = num(o.cropY, 0), bw = num(o.width, 100), bh = num(o.height, 100);
      if (cx > 0 || cy > 0) {
        img.style.cssText = 'position:absolute;max-width:none;max-height:none;visibility:hidden';
        img.onload = function () {
          var nw = img.naturalWidth || bw, nh = img.naturalHeight || bh;
          img.style.left = (-cx / bw * 100) + '%'; img.style.top = (-cy / bh * 100) + '%';
          img.style.width = (nw / bw * 100) + '%'; img.style.height = (nh / bh * 100) + '%'; img.style.visibility = 'visible';
        };
      } else img.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block';
      img.src = src;
      holder.appendChild(img);
      var cp = o.clipPath, rr = 0, rrY = 0;
      if (cp && typeof cp === 'object') { rr = num(cp.rx, 0) / Math.max(1, num(cp.width, bw)) * 100; rrY = num(cp.ry, 0) / Math.max(1, num(cp.height, bh)) * 100; }
      else if (o.rx) { rr = num(o.rx, 0) / Math.max(1, bw) * 100; rrY = num(o.ry, o.rx) / Math.max(1, bh) * 100; }
      if (rr > 0 || rrY > 0) holder.style.borderRadius = Math.min(50, rr) + '% / ' + Math.min(50, rrY) + '%';
      var swd = num(o.strokeWidth, 0);
      if (o.stroke && typeof o.stroke === 'string' && swd > 0) holder.style.boxShadow = '0 0 0 ' + pw(swd) + ' ' + o.stroke;
      return holder;
    }

    // ---------- video ----------
    function boolOf(v, d) { return v === undefined || v === null ? d : (v === true || v === 'true'); }
    function kick(v) {
      try {
        var p = v.play();
        if (p && p.catch) p.catch(function () { if (!v.muted) { v.muted = true; try { var p2 = v.play(); if (p2 && p2.catch) p2.catch(function () {}); } catch (e) {} } });
      } catch (e) {  }
    }
    function videoNode(src, loop, muted, autoplay, fit) {
      var v = mk('video'); v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
      v.controls = true; v.loop = loop; v.muted = muted; v.autoplay = autoplay;
      v.style.cssText = 'width:100%;height:100%;display:block;border-radius:inherit;background:transparent;object-fit:' + fit;
      v.src = src;
      if (autoplay) { v.addEventListener('canplay', function () { kick(v); }, { once: true }); }
      return v;
    }
    // v42: file:// dan ochilganda YouTube/Vimeo iframe "Referer" bo'lmagani uchun xato beradi (153) — muqova + havola ko'rsatamiz
    var FILE_MODE = (location.protocol === 'file:');
    function watchUrlOf(o) {
      var id = o.embedId;
      return o.embedKind === 'youtube' && id ? 'https://www.youtube.com/watch?v=' + id
        : o.embedKind === 'vimeo' && id ? 'https://vimeo.com/' + id
        : o.embedKind === 'dailymotion' && id ? 'https://www.dailymotion.com/video/' + id : (o.embedUrl || '');
    }
    function posterLink(o) {
      var t = o.embedThumbData || o.embedThumb || (o.embedKind === 'youtube' && o.embedId ? 'https://i.ytimg.com/vi/' + o.embedId + '/hqdefault.jpg' : '');
      var a = mk('a'); a.href = watchUrlOf(o); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = 'Videoni ochish';
      a.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0f172a center/cover no-repeat;text-decoration:none;color:#fff';
      if (t) a.style.backgroundImage = 'url("' + t + '")';
      a.innerHTML = '<svg viewBox="0 0 24 24" style="width:18%;height:18%;max-width:96px;min-width:36px;filter:drop-shadow(0 2px 8px rgba(0,0,0,.5))"><circle cx="12" cy="12" r="11" fill="rgba(255,255,255,.92)"/><path d="M9.5 7.5v9l7-4.5z" fill="#111827"/></svg>' +
        '<span style="position:absolute;left:0;right:0;bottom:0;padding:.5em 0;text-align:center;font:600 12px system-ui,sans-serif;background:linear-gradient(transparent,rgba(0,0,0,.65))">Videoni ochish \u2197</span>';
      return a;
    }
    function buildEmbed(o) {
      var wrap = mk('div', 'embedwrap');
      if (o.rx) wrap.style.borderRadius = pw(num(o.rx, 0) * (num(o.scaleX, 1) || 1));
      var u = o.embedUrl || '';
      if (o.embedKind === 'file') {
        wrap.appendChild(videoNode(u, boolOf(o.embedLoop, true), o.embedMutedUser === true, boolOf(o.embedAutoplay, true), 'contain'));
        return wrap;
      }
      var au = boolOf(o.embedAutoplay, true) ? 1 : 0, mu = o.embedMutedUser === true ? 1 : 0, lp = boolOf(o.embedLoop, true) ? 1 : 0, src = '', id = o.embedId;
      if (o.embedKind === 'youtube') src = 'https://www.youtube.com/embed/' + id + '?rel=0&playsinline=1&controls=1&autoplay=' + au + '&mute=' + (au ? 1 : mu) + (lp ? '&loop=1&playlist=' + id : '') + (o.embedStart ? '&start=' + o.embedStart : '');
      else if (o.embedKind === 'vimeo') src = 'https://player.vimeo.com/video/' + id + '?autoplay=' + au + '&muted=' + (au ? 1 : mu) + '&loop=' + lp + (o.embedHash ? '&h=' + o.embedHash : '');
      else if (o.embedKind === 'dailymotion') src = 'https://www.dailymotion.com/embed/video/' + id + '?autoplay=' + au + '&mute=' + mu;
      if (FILE_MODE && (o.embedKind === 'youtube' || o.embedKind === 'vimeo' || o.embedKind === 'dailymotion')) { wrap.appendChild(posterLink(o)); return wrap; }
      var ph0 = mk('div', 'vidph'); ph0.innerHTML = '<svg viewBox="0 0 24 24" width="22%" height="22%"><circle cx="12" cy="12" r="11" fill="rgba(255,255,255,.9)"/><path d="M9.5 7.5v9l7-4.5z" fill="#111827"/></svg>';
      wrap.appendChild(ph0);
      if (src) {
        var f = mk('iframe'); f.src = src; f.title = 'Video'; f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture'); f.setAttribute('allowfullscreen', ''); f.setAttribute('frameborder', '0');
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;border-radius:inherit';
        wrap.appendChild(f);
      }
      return wrap;
    }
    function buildLocalVideo(o) {
      var wrap = mk('div', 'embedwrap');
      if (o.rx) wrap.style.borderRadius = pw(num(o.rx, 0) * (num(o.scaleX, 1) || 1));
      wrap.appendChild(videoNode(o.videoUrl || o.src || '', boolOf(o.videoLoop, true), boolOf(o.videoMuted, true), boolOf(o.videoAutoplay, true), 'fill'));
      return wrap;
    }

    // ---------- tugma ----------
    function popup(msg) {
      var m = mk('div', 'popup'); var b = mk('div', 'popbox'); b.textContent = String(msg == null ? '' : msg);
      var x = mk('button'); x.textContent = 'OK'; b.appendChild(document.createElement('br')); b.appendChild(x); m.appendChild(b);
      function close() { if (m.parentNode) m.parentNode.removeChild(m); }
      x.onclick = function (e) { e.stopPropagation(); close(); }; m.onclick = close;
      app.appendChild(m); x.focus();
    }
    function runButton(o) {
      var a = o.btnAction || 'next', t = o.btnTarget;
      if (a === 'next') go(idx + 1); else if (a === 'prev') go(idx - 1); else if (a === 'first') go(0);
      else if (a === 'last') go(slides.length - 1); else if (a === 'goto') go((parseInt(t, 10) || 1) - 1);
      else if (a === 'url' && /^(https?:\/\/|mailto:)/i.test(t || '')) { window.open(t, '_blank', 'noopener'); }
      else if (a === 'popup') popup(t);
    }
    function buildButton(o, w, h) {
      var b = mk('div', 'sbtn'); b.setAttribute('role', 'button'); b.tabIndex = 0;
      var s = b.style, f = fillCss(o.fill, w, h);
      if (f.gradient) s.backgroundImage = f.gradient; else s.backgroundColor = cssColor(f.color, '#4F46E5');
      s.borderRadius = pw(num(o.rx, 0) * (num(o.scaleX, 1) || 1));
      s.color = o.btnTextColor || '#fff';
      s.fontSize = ph(num(o.btnFontSize, 22) * ((Math.abs(num(o.scaleX, 1)) + Math.abs(num(o.scaleY, 1))) / 2 || 1));
      s.fontFamily = (o.btnFontFamily || 'Montserrat') + ',Arial,sans-serif';
      s.fontWeight = o.btnBold === false ? 'normal' : 'bold';
      var sh = shadowOf(o);
      if (sh) s.boxShadow = pw(sh.offsetX) + ' ' + pw(sh.offsetY) + ' ' + pw(sh.blur) + ' ' + sh.color;
      b.textContent = o.btnLabel == null ? '' : String(o.btnLabel);
      b.addEventListener('click', function (e) { e.stopPropagation(); runButton(o); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.stopPropagation(); runButton(o); } });
      return b;
    }

    // ---------- obyekt ----------
    function pivot(v) { return v === 'center' ? 0.5 : (v === 'right' || v === 'bottom') ? 1 : (typeof v === 'number' ? v : 0); }
    function buildObject(o, si, oi) {
      if (!o || o.visible === false) return null;
      var sp = sprites[si] && sprites[si][oi];
      if (sp) o = { type: 'image', src: sp.src, left: sp.left, top: sp.top, width: sp.width, height: sp.height, scaleX: 1, scaleY: 1, originX: 'left', originY: 'top', opacity: o.opacity, animName: o.animName, animDur: o.animDur, animDelay: o.animDelay, animLoop: o.animLoop, linkUrl: o.linkUrl };
      var t = o.type, sx = num(o.scaleX, 1) || 1, sy = num(o.scaleY, 1) || 1;
      var w0, h0;
      if (t === 'circle') { w0 = h0 = num(o.radius, num(o.width, 100) / 2) * 2; }
      else if (t === 'ellipse') { w0 = num(o.rx, 50) * 2; h0 = num(o.ry, 50) * 2; }
      else { w0 = num(o.width, 100); h0 = num(o.height, 40); }
      var w = w0 * Math.abs(sx), h = h0 * Math.abs(sy);
      var fx = pivot(o.originX), fy = pivot(o.originY);
      var outer = mk('div', 'obj');
      var os = outer.style;
      os.left = ((num(o.left, 0) - fx * w) / W * 100) + '%';
      os.top = ((num(o.top, 0) - fy * h) / H * 100) + '%';
      os.width = (w / W * 100) + '%'; os.height = (h / H * 100) + '%';
      os.transformOrigin = (fx * 100) + '% ' + (fy * 100) + '%';
      if (o.angle) os.transform = 'rotate(' + o.angle + 'deg)';
      if (o.opacity != null && o.opacity !== 1) os.opacity = o.opacity;
      var inner = mk('div', 'in'), flip = mk('div', 'fl'), body = null;
      var flipX = !!o.flipX !== (sx < 0), flipY = !!o.flipY !== (sy < 0);
      if (flipX || flipY) flip.style.transform = 'scale(' + (flipX ? -1 : 1) + ',' + (flipY ? -1 : 1) + ')';
      var isText = (t === 'textbox' || t === 'i-text' || t === 'text');
      if (isText) {
        body = buildText(o, w0, h0);
        outer.classList.add('txt');
        if (o.backgroundColor && typeof o.backgroundColor === 'string') flip.style.backgroundColor = o.backgroundColor;
      }
      else if (t === 'slideButton' || o.isButton) { body = buildButton(o, w0, h0); outer.classList.add('act'); }
      else if (t === 'embedVideo' || o.isEmbed) { body = buildEmbed(o); outer.classList.add('act'); }
      else if (o.isVideo || t === 'videoImage') { body = buildLocalVideo(o); outer.classList.add('act'); }
      else if (o.isGif || t === 'gifImage' || t === 'image') body = buildImage(o, w, h);
      else if (t === 'rect' || t === 'circle' || t === 'ellipse' || t === 'triangle') body = buildShape(o, w0, h0);
      if (!body) return null;
      var sh = shadowOf(o);
      if (sh && !isText && t !== 'slideButton' && !o.isButton) flip.style.filter = 'drop-shadow(' + pw(sh.offsetX) + ' ' + pw(sh.offsetY) + ' ' + pw(sh.blur / 2) + ' ' + sh.color + ')';
      flip.appendChild(body);
      var link = (!isText && o.linkUrl && /^(https?:|mailto:)/i.test(o.linkUrl)) ? o.linkUrl : '';
      if (link) { var a = mk('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.cssText = 'display:block;width:100%;height:100%'; a.appendChild(flip); inner.appendChild(a); outer.classList.add('act'); }
      else inner.appendChild(flip);
      outer.appendChild(inner);
      if (o.animName) {
        var dur = num(o.animDur, 0) > 0 ? num(o.animDur, 0.8) : (LOOPS[o.animName] ? 2 : 0.8), delay = num(o.animDelay, 0) >= 0 ? num(o.animDelay, 0) : 0;
        var loop = o.animLoop === true || o.animLoop === 'true' || !!LOOPS[o.animName], nm = o.animName;
        inner.classList.add('ssa-anim');
        var is = inner.style;
        is.animationName = 'ssa-' + nm; is.animationDuration = dur + 's'; is.animationDelay = delay + 's'; is.animationFillMode = 'both';
        is.animationTimingFunction = nm === 'spin' ? 'linear' : (nm === 'float' || nm === 'pulseLoop') ? 'ease-in-out' : 'cubic-bezier(.25,.8,.25,1)';
        is.animationIterationCount = loop ? 'infinite' : '1';
      }
      return outer;
    }

    // ---------- fon ----------
    function buildBackground(p) {
      var bg = mk('div', 'bg');
      var f = fillCss(p.background != null ? p.background : p.backgroundColor, W, H);
      if (f.gradient) bg.style.backgroundImage = f.gradient; else bg.style.backgroundColor = cssColor(f.color, '#ffffff');
      var gifSrc = p.backgroundGif && (p.backgroundGif.src || p.backgroundGif.url);
      if (gifSrc) { var gi = mk('img'); gi.src = gifSrc; gi.alt = ''; gi.draggable = false; bg.appendChild(gi); return bg; }
      if (p.backgroundVideo && p.backgroundVideo.url) {
        var vu = String(p.backgroundVideo.url);
        var m = vu.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
        var vm = vu.match(/vimeo\.com\/(?:video\/)?(\d+)/);
        if ((m || vm) && FILE_MODE) {
          var tu = p.backgroundVideo.thumbData || p.backgroundVideo.thumb || (m ? 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg' : '');
          if (tu) bg.style.background = 'center / cover no-repeat url("' + tu + '")';
          return bg;
        }
        if (m || vm) {
          var fr = mk('iframe');
          fr.src = m ? 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1&mute=1&loop=1&playlist=' + m[1] + '&controls=0&showinfo=0&disablekb=1&fs=0&modestbranding=1&rel=0&playsinline=1&iv_load_policy=3'
                     : 'https://player.vimeo.com/video/' + vm[1] + '?background=1&autoplay=1&muted=1&loop=1';
          fr.setAttribute('allow', 'autoplay; encrypted-media'); fr.setAttribute('loading', 'eager'); fr.tabIndex = -1;
          fr.style.cssText = 'position:absolute;left:50%;top:50%;width:100%;height:100%;border:0;pointer-events:none;transform:translate(-50%,-50%) scale(1.4);opacity:0;transition:opacity .6s ease';
          if (m) bg.style.background = 'center / cover no-repeat url(https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg)';
          fr.addEventListener('load', function () { setTimeout(function () { fr.style.opacity = '1'; }, m ? 1400 : 500); });
          setTimeout(function () { fr.style.opacity = '1'; }, 5000);
          bg.appendChild(fr);
        } else {
          var v = mk('video'); v.src = vu; v.autoplay = true; v.loop = p.backgroundVideo.loop !== false; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
          v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none';
          v.addEventListener('canplay', function () { kick(v); }, { once: true });
          bg.appendChild(v);
        }
        return bg;
      }
      if (p.backgroundImage && p.backgroundImage.src) { var bi = mk('img'); bi.src = p.backgroundImage.src; bi.alt = ''; bi.draggable = false; bg.appendChild(bi); }
      return bg;
    }

    function buildSlide(i) {
      var p = slides[i] || {};
      var s = mk('div', 'slide');
      s.appendChild(buildBackground(p));
      var c = mk('div', 'content');
      (p.objects || []).forEach(function (o, oi) { var n = buildObject(o, i, oi); if (n) c.appendChild(n); });
      s.appendChild(c);
      return s;
    }

    // ---------- navigatsiya ----------
    function updateUi() {
      counter.textContent = (idx + 1) + ' / ' + slides.length;
      $('prev').disabled = idx <= 0; $('next').disabled = idx >= slides.length - 1;
      if (!EMBED) { try { if (location.hash !== '#' + (idx + 1)) history.replaceState(null, '', '#' + (idx + 1)); } catch (e) {  } }
    }
    function go(n, instant) {
      n = Math.max(0, Math.min(n, slides.length - 1));
      if (current && n === idx && !instant) return;
      dir = n < idx ? 'prev' : 'next';
      idx = n;
      var token = ++navToken;
      var old = current;
      if (old) { var vs = old.querySelectorAll('video'); for (var k = 0; k < vs.length; k++) { try { vs[k].pause(); } catch (e) {  } } }
      textFixList = [];
      var s = buildSlide(idx);
      var trn = '';
      try { trn = String((project.slides[idx] || {}).transition || ''); } catch (e) {  }
      if (trn === 'none') { /* effektsiz */ }
      else if (trn) { s.classList.add('tr-' + trn); }                       // butun varaq ochilish effekti (fade/zoom/flip/up/blur)
      else if (!instant) s.classList.add(dir === 'prev' ? 'pres-anim-prev' : 'pres-anim-next');
      stage.appendChild(s);
      current = s;
      if (old) { try { old.parentNode.removeChild(old); } catch (e) {  } }
      fixTextOffsets();
      updateUi();
      return token;
    }
    function toggleFs() {
      var d = document, de = d.documentElement;
      var inFs = d.fullscreenElement || d.webkitFullscreenElement;
      try {
        if (!inFs) { (de.requestFullscreen || de.webkitRequestFullscreen || function () { return Promise.reject(); }).call(de); }
        else { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
      } catch (e) {  }
    }
    var fsBtn = $('fs');
    if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) fsBtn.style.display = 'none';
    $('prev').onclick = function (e) { e.stopPropagation(); go(idx - 1); };
    $('next').onclick = function (e) { e.stopPropagation(); go(idx + 1); };
    fsBtn.onclick = function (e) { e.stopPropagation(); toggleFs(); };
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'Spacebar') { if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('sbtn') && k === 'Enter') return; e.preventDefault(); go(idx + 1); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); go(idx - 1); }
      else if (k === 'Home') { e.preventDefault(); go(0); }
      else if (k === 'End') { e.preventDefault(); go(slides.length - 1); }
      else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFs(); }
      else if (k === 'Escape' && EMBED && !document.fullscreenElement && !document.webkitFullscreenElement) { try { window.parent.postMessage({ ss: 'close' }, '*'); } catch (er) {  } }
    });
    var closeBtn = $('closeV');
    if (closeBtn) closeBtn.onclick = function (e) { e.stopPropagation(); try { window.parent.postMessage({ ss: 'close' }, '*'); } catch (er) {  } };
    var tx = 0, ty = 0, tt = 0;
    app.addEventListener('touchstart', function (e) { if (e.touches.length !== 1) { tt = 0; return; } tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now(); }, { passive: true });
    app.addEventListener('touchend', function (e) {
      if (!tt || Date.now() - tt > 900) return;
      var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? idx + 1 : idx - 1);
    }, { passive: true });
    if (!EMBED) window.addEventListener('hashchange', function () { var n = parseInt((location.hash || '').slice(1), 10); if (n >= 1 && n - 1 !== idx) go(n - 1); });

    // interfeysni yashirish (kursor ham) — muharrir namoyishidagidek
    // v42: boshida tugmalar YO'Q. Sichqoncha qimirlasa (yoki bosilsa/tegilsa) chiqadi, 2 soniya qimirlamasa yana yo'qoladi.
    var uiTimer = null, lastMX = -999, lastMY = -999, quietUntil = 0;
    function uiOn(ms) { app.classList.add('ui-on'); clearTimeout(uiTimer); uiTimer = setTimeout(function () { app.classList.remove('ui-on'); }, ms > 0 ? ms : 2000); }
    document.addEventListener('mousemove', function (e) {
      // slayd almashganda brauzer o'zi "soxta" mousemove yuboradi — haqiqiy siljishni ajratamiz
      if (Math.abs(e.clientX - lastMX) < 3 && Math.abs(e.clientY - lastMY) < 3) return;
      lastMX = e.clientX; lastMY = e.clientY;
      if (Date.now() < quietUntil) return;
      uiOn();
    }, { passive: true });
    ['mousedown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, uiOn, { passive: true }); });
    document.addEventListener('fullscreenchange', function () { fsBtn.classList.toggle('on', !!document.fullscreenElement); });
    document.addEventListener('webkitfullscreenchange', function () { fsBtn.classList.toggle('on', !!document.webkitFullscreenElement); });

    // ---------- oldindan yuklash (Namoyishdan oldin hamma media xotiraga olinadi) ----------
    var YT_RE = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/;
    function collectMedia() {
      var imgs = [], vids = [], seen = {};
      function addI(u) { if (u && typeof u === 'string' && !seen['i' + u]) { seen['i' + u] = 1; imgs.push(u); } }
      function addV(u) { if (u && typeof u === 'string' && !seen['v' + u]) { seen['v' + u] = 1; vids.push(u); } }
      slides.forEach(function (p, si) {
        if (p.backgroundGif) addI(p.backgroundGif.src || p.backgroundGif.url);
        if (p.backgroundImage) addI(p.backgroundImage.src);
        if (p.backgroundVideo && p.backgroundVideo.url) {
          var bu = String(p.backgroundVideo.url), bm = YT_RE.exec(bu);
          if (bm) addI('https://i.ytimg.com/vi/' + bm[1] + '/hqdefault.jpg'); else if (!/vimeo\.com/.test(bu)) addV(bu);
        }
        (p.objects || []).forEach(function (o, oi) {
          if (!o || o.visible === false) return;
          var sp = sprites[si] && sprites[si][oi]; if (sp) { addI(sp.src); return; }
          if (o.isVideo || o.type === 'videoImage') addV(o.videoUrl || o.src);
          else if (o.type === 'embedVideo' || o.isEmbed) {
            if (o.embedKind === 'file') addV(o.embedUrl); else if (o.embedKind === 'youtube' && o.embedId) addI('https://i.ytimg.com/vi/' + o.embedId + '/hqdefault.jpg');
          } else if (o.isGif || o.type === 'gifImage') addI(o.gifUrl || o.src);
          else if (o.type === 'image') addI(o.src);
        });
      });
      return { imgs: imgs, vids: vids };
    }
    var keepAlive = [];
    function preloadAll(report) {
      var m = collectMedia(), total = m.imgs.length + m.vids.length + 1, done = 0, tasks = [];
      function tick() { done++; try { report(done, total); } catch (e) {  } }
      function task(fn, ms) { tasks.push(function () { return new Promise(function (res) { var t = setTimeout(res, ms); fn(function () { clearTimeout(t); res(); }); }).then(tick, tick); }); }
      m.imgs.forEach(function (u) {
        task(function (fin) {
          var im = new Image(); keepAlive.push(im);
          im.onload = function () { if (im.decode) im.decode().then(fin, fin); else fin(); };
          im.onerror = fin; im.src = u;
        }, 15000);
      });
      m.vids.forEach(function (u) {
        task(function (fin) {
          var v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.playsInline = true;
          v.addEventListener('loadeddata', fin); v.addEventListener('error', fin); v.src = u; keepAlive.push(v);
        }, 20000);
      });
      task(function (fin) { if (document.fonts && document.fonts.ready) document.fonts.ready.then(fin, fin); else fin(); }, 5000);
      var i = 0;
      function next() { if (i >= tasks.length) return Promise.resolve(); var t = tasks[i++]; return t().then(next); }
      var workers = []; for (var w = 0; w < Math.min(6, tasks.length); w++) workers.push(next());
      return Promise.all(workers);
    }

    // ---------- boshlash ----------
    var skipFn = null;
    function say(msg) { if (EMBED) { try { window.parent.postMessage(msg, '*'); } catch (e) {  } } }
    function boot(startIdx) {
      var loader = $('loader');
      var skipP = new Promise(function (r) { skipFn = r; });
      var start = startIdx != null ? startIdx : Math.max(0, (parseInt((location.hash || '').slice(1), 10) || 1) - 1);
      var work = prepareBlobs().then(function () { return null; }, function () { return null; })
        .then(function () { return preloadAll(function (d, t) { say({ ss: 'progress', done: d, total: t }); }); });
      return Promise.race([work, skipP, new Promise(function (r) { setTimeout(r, 35000); })]).then(function () {
        if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
        go(Math.min(start, slides.length - 1), true);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fixTextOffsets);
        say({ ss: 'ready' });
      });
    }
    window.__ssPres = {
      boot: boot,
      skip: function () { if (skipFn) skipFn(); },
      go: function (n) { go(n); },
      next: function () { go(idx + 1); },
      prev: function () { go(idx - 1); },
      restart: function (n) { go(n || 0, true); quietUntil = Date.now() + 1500; uiOn(3500); },       // namoyish boshida tugmalar ko'rinib turadi, keyin yashirinadi
      pause: function () {
        if (current) { var vs = current.querySelectorAll('video'); for (var k = 0; k < vs.length; k++) { try { vs[k].pause(); } catch (e) {  } } if (current.parentNode) current.parentNode.removeChild(current); current = null; }
        stage.innerHTML = '';
      },
      count: function () { return slides.length; }
    };
    if (!EMBED) boot();
  }

  // ------------------------------------------------------------------
  // 2) CSS
  // ------------------------------------------------------------------
  var VIEWER_CSS = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'html,body{height:100%;background:#0f0f12;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden;-webkit-text-size-adjust:100%}',
    '#app{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0f0f12;touch-action:pan-y}',
    '#stage{--gap:clamp(26px,6vh,64px);position:relative;width:min(94vw,calc((100vh - 2*var(--gap))*16/9));height:min(calc(94vw*9/16),calc(100vh - 2*var(--gap)));max-width:100%;max-height:100%;background:#000;border-radius:10px;overflow:hidden;box-shadow:0 14px 48px rgba(0,0,0,.55);transform:translateZ(0)}',
    '@supports(height:100dvh){#stage{width:min(94vw,calc((100dvh - 2*var(--gap))*16/9));height:min(calc(94vw*9/16),calc(100dvh - 2*var(--gap)))}}',
    ':fullscreen #stage,:-webkit-full-screen #stage{--gap:0px;border-radius:0;box-shadow:none}',
    '.slide{position:absolute;inset:0;container-type:size;overflow:hidden;background:#fff}',
    '.bg{position:absolute;inset:0;z-index:0;overflow:hidden;background-size:cover;background-position:center}',
    '.bg>img{width:100%;height:100%;object-fit:fill;display:block;pointer-events:none}',
    '.content{position:absolute;inset:0;z-index:1;overflow:hidden}',
    '.obj{position:absolute;pointer-events:none}',
    '.obj>.in,.obj .fl{position:absolute;inset:0}',
    '.obj.txt{pointer-events:auto}',
    '.obj.act,.obj.act *{pointer-events:auto}',
    '.tbox{position:relative;width:100%;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;user-select:text;-webkit-user-select:text;cursor:text;font-kerning:normal}',
    '.tbox a.tlink{cursor:pointer}',
    '.imgwrap{position:absolute;inset:0;overflow:hidden}',
    '.imgwrap>img{user-select:none;-webkit-user-select:none}',
    '.embedwrap{position:absolute;inset:0;overflow:hidden;background:#000}',
    '.vidph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a,#334155)}',
    '.sbtn{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;cursor:pointer;user-select:none;-webkit-user-select:none;transition:filter .15s ease,transform .15s ease;outline:none}',
    '.sbtn:hover{filter:brightness(1.08)}.sbtn:active{transform:scale(.97)}.sbtn:focus-visible{box-shadow:0 0 0 3px rgba(255,255,255,.7)!important}',
    '@keyframes presSlideNext{from{transform:translateX(6%) scale(.985);opacity:0}to{transform:translateX(0) scale(1);opacity:1}}',
    '@keyframes presSlidePrev{from{transform:translateX(-6%) scale(.985);opacity:0}to{transform:translateX(0) scale(1);opacity:1}}',
    '.pres-anim-next{animation:presSlideNext .34s cubic-bezier(.22,.61,.36,1)}',
    '.pres-anim-prev{animation:presSlidePrev .34s cubic-bezier(.22,.61,.36,1)}',
    '@keyframes trFade{from{opacity:0}to{opacity:1}}',
    '@keyframes trZoom{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}',
    '@keyframes trFlip{from{opacity:0;transform:perspective(1200px) rotateY(75deg)}to{opacity:1;transform:perspective(1200px) rotateY(0)}}',
    '@keyframes trUp{from{opacity:0;transform:translateY(14%)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes trBlur{from{opacity:0;filter:blur(18px)}to{opacity:1;filter:blur(0)}}',
    '.tr-fade{animation:trFade .7s ease both}.tr-zoom{animation:trZoom .65s cubic-bezier(.22,.61,.36,1) both}.tr-flip{animation:trFlip .8s cubic-bezier(.22,.61,.36,1) both}',
    '.tr-up{animation:trUp .6s cubic-bezier(.22,.61,.36,1) both}.tr-blur{animation:trBlur .7s ease both}',
    '@media (prefers-reduced-motion:reduce){.pres-anim-next,.pres-anim-prev,.tr-fade,.tr-zoom,.tr-flip,.tr-up,.tr-blur{animation:none}}',
    '#controls{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,.85);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-radius:30px;padding:6px 14px;display:flex;align-items:center;gap:10px;color:#fff;z-index:50;border:1px solid rgba(255,255,255,.2);transition:opacity .35s ease,transform .35s ease}',
    '#controls button{background:transparent;border:0;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '#controls button:hover:not(:disabled){background:rgba(255,255,255,.14)}#controls button:disabled{opacity:.35;cursor:default}',
    '#controls svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}',
    '#counter{font-size:13px;font-weight:600;min-width:54px;text-align:center;font-variant-numeric:tabular-nums}',
    '#app:not(.ui-on) #controls{opacity:0;pointer-events:none;transform:translateX(-50%) translateY(12px)}',
    '#app:not(.ui-on),#app:not(.ui-on) *{cursor:none}',
    '#loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:60;background:#0f0f12}',
    '#loader i{width:38px;height:38px;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;animation:ldspin .8s linear infinite}',
    '@keyframes ldspin{to{transform:rotate(360deg)}}',
    '.popup{position:absolute;inset:0;z-index:70;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}',
    '.popbox{background:#fff;color:#111827;border-radius:14px;padding:22px 26px;max-width:min(520px,86vw);font-size:16px;line-height:1.5;text-align:center;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
    '.popbox button{margin-top:14px;background:#4F46E5;color:#fff;border:0;border-radius:10px;padding:8px 26px;font-size:15px;cursor:pointer}',
    '#closeV{position:absolute;top:14px;right:14px;width:42px;height:42px;border-radius:50%;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.3);color:#fff;cursor:pointer;z-index:55;display:flex;align-items:center;justify-content:center;transition:opacity .35s ease}',
    '#closeV svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}',
    '#app:not(.ui-on) #closeV{opacity:0;pointer-events:none}',
    '@media print{#controls,#loader{display:none}}'
  ].join('\n');

  // ------------------------------------------------------------------
  // 3) Shriftlarni fayl ichiga joylash (oflayn ham bir xil ko'rinishi uchun)
  // ------------------------------------------------------------------
  function collectFonts(slideObjs) {
    var fams = new Set(), italic = new Set();
    function add(f, it) {
      if (!f) return;
      f = String(f).split(',')[0].replace(/['"]/g, '').trim();
      if (!f || /^(arial|helvetica|times new roman|times|georgia|verdana|courier new|courier|sans-serif|serif|monospace|tahoma|trebuchet ms|impact|system-ui)$/i.test(f)) return;
      fams.add(f); if (it) italic.add(f);
    }
    slideObjs.forEach(function (p) {
      (p.objects || []).forEach(function (o) {
        if (!o) return;
        add(o.fontFamily, o.fontStyle === 'italic'); add(o.btnFontFamily, false);
        if (o.styles) Object.keys(o.styles).forEach(function (l) { Object.keys(o.styles[l] || {}).forEach(function (c) { var st = o.styles[l][c]; if (st && st.fontFamily) add(st.fontFamily, st.fontStyle === 'italic'); }); });
        if ((o.type === 'slideButton' || o.isButton) && !o.btnFontFamily) add('Montserrat', false);
      });
    });
    return { list: Array.from(fams).slice(0, 14), italic: italic };
  }
  function blobToDataUrl(b) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(fr.error); }; fr.readAsDataURL(b); });
  }
  async function embedFont(family, withItalic) {
    var enc = encodeURIComponent(family).replace(/%20/g, '+');
    var variants = withItalic ? ['family=' + enc + ':ital,wght@0,400;0,700;1,400;1,700', 'family=' + enc + ':wght@400;700', 'family=' + enc] : ['family=' + enc + ':wght@400;700', 'family=' + enc];
    var css = '';
    for (var i = 0; i < variants.length && !css; i++) {
      try {
        var r = await pTimeout(fetch('https://fonts.googleapis.com/css2?' + variants[i] + '&display=swap'), 9000, null);
        if (r && r.ok) css = await r.text();
      } catch (e) {  }
    }
    if (!css) return null;
    var blocks = css.match(/(?:\/\*[^*]*\*\/\s*)?@font-face\s*\{[^}]*\}/g) || [];
    var keep = blocks.filter(function (b) { var m = /\/\*\s*([\w-]+)\s*\*\//.exec(b); return !m || /^(latin|latin-ext|cyrillic|cyrillic-ext)$/.test(m[1]); });
    var out = [];
    for (var j = 0; j < keep.length; j++) {
      var blk = keep[j].replace(/\/\*[^*]*\*\/\s*/, ''), um = /url\((https:[^)]+)\)/.exec(blk);
      if (!um) continue;
      try {
        var fr = await pTimeout(fetch(um[1]), 12000, null);
        if (!fr || !fr.ok) return null;
        var d = await blobToDataUrl(await fr.blob());
        out.push(blk.replace(um[0], 'url(' + d + ')'));
      } catch (e) { return null; }
    }
    return out.length ? out.join('\n') : null;
  }
  async function buildFontAssets(slideObjs) {
    var info = collectFonts(slideObjs), styles = [], links = [];
    var queue = info.list.slice(), workers = [];
    async function work() {
      while (queue.length) {
        var f = queue.shift(), css = null;
        try { css = await embedFont(f, info.italic.has(f)); } catch (e) {  }
        if (css) styles.push(css); else links.push(f);
      }
    }
    for (var w = 0; w < 4; w++) workers.push(work());
    await Promise.all(workers);
    var linkHtml = '';
    if (links.length) {
      linkHtml = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
        links.map(function (f) { return 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;700'; }).join('&') + '&display=swap">';
    }
    return { css: styles.join('\n'), linkHtml: linkHtml, embedded: styles.length, online: links.length };
  }

  // ------------------------------------------------------------------
  // 4) Eksport
  // ------------------------------------------------------------------
  var NATIVE_TYPES = { textbox: 1, 'i-text': 1, text: 1, rect: 1, circle: 1, ellipse: 1, triangle: 1, image: 1, gifImage: 1, slideButton: 1, embedVideo: 1, videoImage: 1 };
  function isNative(o) { return !!(NATIVE_TYPES[o.type] || o.isGif || o.isVideo || o.isEmbed || o.isButton); }

  function shellHtml(count, embed, withLoader) {
    var chev = function (d) { return '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>'; };
    return '<div id="app">\n' + (withLoader ? '<div id="loader"><i></i></div>\n' : '') + '<div id="stage"></div>\n' +
      (embed ? '<button id="closeV" type="button" title="Yopish (Esc)" aria-label="Yopish">' + chev('M6 6l12 12M18 6L6 18') + '</button>\n' : '') +
      '<div id="controls">\n<button id="prev" title="Oldingi (\u2190)" aria-label="Oldingi">' + chev('M15 5l-7 7 7 7') + '</button>\n' +
      '<span id="counter">1 / ' + count + '</span>\n' +
      '<button id="next" title="Keyingi (\u2192)" aria-label="Keyingi">' + chev('M9 5l7 7-7 7') + '</button>\n' +
      '<button id="fs" title="To\u2018liq ekran (F)" aria-label="To\u2018liq ekran">' + chev('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5') + '</button>\n</div>\n</div>\n';
  }

  var _busy = false;
  async function exportHTMLv40() {
    if (_busy) { toast('HTML tayyorlanmoqda, biroz kuting…'); return; }
    if (window.isAiApplyingCommands || window.isAiStreaming) { toast("AI slayd yaratmoqda — tugagach qayta urinib ko'ring", 'error'); return; }
    _busy = true;
    try {
      try { saveCurrentSlideState(); } catch (e) {  }
      toast('HTML tayyorlanmoqda…');
      var st = null;
      try { if (typeof window.ssEmbedAllMedia === 'function') st = await window.ssEmbedAllMedia(); } catch (e) { console.warn('[v40] embed', e); }
      if (st && st.failed) toast(st.failed + ' ta media faylga joylanmadi. Qolganlari to\u2018liq saqlandi.', 'error');

      var title = (typeof projectTitle === 'string' && projectTitle.trim()) ? projectTitle.trim() : 'Taqdimot';
      var parsedAll = [], sprites = {};
      for (var i = 0; i < slides.length; i++) {
        var p = {}; try { p = JSON.parse(slides[i].json || '{}'); } catch (e) { p = {}; }
        // qolgan tashqi rasmlarni ham ichiga joylash (eksport fayli mustaqil bo'lishi uchun)
        var changed = false;
        async function inl(holder, key) {
          var v = holder && holder[key];
          if (typeof v === 'string' && /^https?:/i.test(v) && typeof window.resolveRemoteToDataUrl === 'function') {
            try { var d = await pTimeout(window.resolveRemoteToDataUrl(v), 20000, null); if (d && /^data:/i.test(d)) { holder[key] = d; changed = true; } } catch (e) {  }
          }
        }
        // v42: onlayn video muqovalarini faylga joylaymiz (oflayn ham muqova ko'rinadi)
        async function thumbData(urls) {
          for (var ti = 0; ti < urls.length; ti++) {
            try {
              var td = await pTimeout(window.resolveRemoteToDataUrl(urls[ti]), 12000, null);
              if (td && /^data:image\//i.test(td)) return td;
            } catch (e) {  }
          }
          return '';
        }
        function thumbUrls(kind, id) {
          return kind === 'youtube' ? ['https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg', 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg']
            : kind === 'vimeo' ? ['https://vumbnail.com/' + id + '.jpg'] : [];
        }
        try {
          if (typeof window.resolveRemoteToDataUrl === 'function') {
            var bvv = p.backgroundVideo, bvm = bvv && bvv.url && /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/.exec(String(bvv.url));
            if (bvm && !bvv.thumbData) { var bt = await thumbData(thumbUrls('youtube', bvm[1])); if (bt) { bvv.thumbData = bt; changed = true; } }
            var eo = p.objects || [];
            for (var ei = 0; ei < eo.length; ei++) {
              var eb = eo[ei];
              if (eb && (eb.type === 'embedVideo' || eb.isEmbed) && eb.embedId && !eb.embedThumbData && thumbUrls(eb.embedKind, eb.embedId).length) {
                var et = await thumbData(thumbUrls(eb.embedKind, eb.embedId)); if (et) { eb.embedThumbData = et; changed = true; }
              }
            }
          }
        } catch (e) {  }
        if (p.backgroundGif) { await inl(p.backgroundGif, 'src'); }
        if (p.backgroundImage) { await inl(p.backgroundImage, 'src'); }
        var objs = p.objects || [];
        for (var k = 0; k < objs.length; k++) {
          var o = objs[k]; if (!o) continue;
          if (o.isGif || o.type === 'gifImage' || o.type === 'image') { await inl(o, 'gifUrl'); await inl(o, 'src'); }
          if (!isNative(o) && o.visible !== false && typeof window.renderObjectSprite === 'function') {
            try {
              var sp = await pTimeout(window.renderObjectSprite(o), 8000, null);
              if (sp && sp.url) { (sprites[i] = sprites[i] || {})[k] = { src: sp.url, left: sp.x, top: sp.y, width: sp.w, height: sp.h }; }
            } catch (e) {  }
          }
        }
        if (changed) slides[i].json = JSON.stringify(p);
        parsedAll.push(p);
      }

      toast('Shriftlar fayl ichiga joylanmoqda…');
      var fonts = await buildFontAssets(parsedAll);

      var project = {
        version: 2, format: 'slide-studio', title: title,
        slides: slides.map(function (s) { return { json: s.json, imageNumbers: s.imageNumbers || [], transition: s.transition || '' }; }),
        exportedAt: new Date().toISOString()
      };
      var anim = '';
      try { var ae = document.getElementById('ssAnimStyle'); if (ae) anim = (ae.textContent || '').replace(/<\/style/gi, ''); } catch (e) {  }
      var runtime = '(' + ssViewerRuntime.toString() + ')();';
      var html = '<!DOCTYPE html>\n<html lang="uz">\n<head>\n<meta charset="UTF-8">\n' +
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
        '<meta name="generator" content="Slide Studio v40">\n' +
        '<title>' + escHtml(title) + '</title>\n' + fonts.linkHtml + '\n' +
        '<style id="embedded-fonts">\n' + fonts.css + '\n</style>\n' +
        '<style>\n' + anim + '\n' + VIEWER_CSS + '\n</style>\n</head>\n<body>\n' +
        shellHtml(slides.length, false, true) +
        '<noscript>Bu taqdimotni ko\u2018rish uchun JavaScript yoqilgan bo\u2018lishi kerak.</noscript>\n' +
        '<script type="application/json" id="project-data">' + jsonForScript(project) + '</script>\n' +
        '<script type="application/json" id="sprite-data">' + jsonForScript(sprites) + '</script>\n' +
        '<script>\n' + runtime.replace(/<\/script/gi, '<\\/script') + '\n</script>\n</body>\n</html>';

      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      window.downloadBlob(blob, window.makeSafeFileName(title, 'html'));
      var note = fonts.online ? ' (' + fonts.online + ' ta shrift internet orqali yuklanadi)' : '';
      toast('HTML yuklandi \u2014 matn belgilanadi, animatsiyalar va tugmalar oflayn ishlaydi' + note);
    } catch (e) {
      console.error(e);
      toast('HTML eksport xatolik: ' + ((e && e.message) || e), 'error');
    } finally { _busy = false; }
  }

  // ------------------------------------------------------------------
  // 5) PDF: animatsiyasiz (statik) sahifalar + bosiladigan havolalar
  //    Sahifa rasmi animatsiyasiz chiziladi; matn, tugma (URL), rasm va YouTube/Vimeo
  //    elementlari ustiga ko'rinmas havola (Link annotation) qo'yiladi.
  // ------------------------------------------------------------------
  function linkOfObject(o) {
    var u = '';
    if (o.type === 'slideButton' || o.isButton) { if (o.btnAction === 'url') u = o.btnTarget; }
    else if (o.type === 'embedVideo' || o.isEmbed) {
      var id = o.embedId;
      u = o.embedKind === 'youtube' && id ? 'https://www.youtube.com/watch?v=' + id
        : o.embedKind === 'vimeo' && id ? 'https://vimeo.com/' + id
        : o.embedKind === 'dailymotion' && id ? 'https://www.dailymotion.com/video/' + id : (o.embedUrl || '');
    } else u = o.linkUrl;
    u = String(u || '').trim();
    return /^(https?:\/\/|mailto:)/i.test(u) ? u : '';
  }
  function objBox(o) {
    var sx = Math.abs(Number(o.scaleX) || 1), sy = Math.abs(Number(o.scaleY) || 1), w, h;
    if (o.type === 'circle') { w = h = (Number(o.radius) || (Number(o.width) || 100) / 2) * 2; }
    else if (o.type === 'ellipse') { w = (Number(o.rx) || 50) * 2; h = (Number(o.ry) || 50) * 2; }
    else { w = Number(o.width) || 100; h = Number(o.height) || 40; }
    w *= sx; h *= sy;
    var fx = o.originX === 'center' ? 0.5 : (o.originX === 'right' ? 1 : 0), fy = o.originY === 'center' ? 0.5 : (o.originY === 'bottom' ? 1 : 0);
    var left = (Number(o.left) || 0) - fx * w, top = (Number(o.top) || 0) - fy * h;
    var a = (Number(o.angle) || 0) * Math.PI / 180;
    if (a) {   // aylantirilgan obyekt: chegaraviy to'rtburchak
      var px = (Number(o.left) || 0), py = (Number(o.top) || 0), pts = [[0, 0], [w, 0], [w, h], [0, h]].map(function (q) {
        var dx = q[0] - fx * w, dy = q[1] - fy * h;
        return [px + dx * Math.cos(a) - dy * Math.sin(a), py + dx * Math.sin(a) + dy * Math.cos(a)];
      });
      var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
      left = Math.min.apply(null, xs); top = Math.min.apply(null, ys); w = Math.max.apply(null, xs) - left; h = Math.max.apply(null, ys) - top;
    }
    return { left: left, top: top, w: w, h: h };
  }
  var prevTextLayer = window.ssPdfTextLayer;
  window.ssPdfTextLayer = async function (pdfDoc, page, json, pw, ph) {
    try { if (typeof prevTextLayer === 'function') await prevTextLayer.apply(this, arguments); } catch (e) { console.warn('PDF text layer:', e); }
    try {
      var PL = window.PDFLib; if (!PL || !PL.PDFName || !PL.PDFString) return;
      var parsed = JSON.parse(json || '{}'), k = pw / 960, ctx = pdfDoc.context;
      (parsed.objects || []).forEach(function (o) {
        if (!o || o.visible === false) return;
        var url = linkOfObject(o); if (!url) return;
        var b = objBox(o);
        var annot = ctx.obj({
          Type: 'Annot', Subtype: 'Link', Border: [0, 0, 0],
          Rect: [b.left * k, ph - (b.top + b.h) * k, (b.left + b.w) * k, ph - b.top * k],
          A: { Type: 'Action', S: 'URI', URI: PL.PDFString.of(url) }
        });
        var ref = ctx.register(annot);
        var arr = page.node.lookupMaybe(PL.PDFName.of('Annots'), PL.PDFArray);
        if (arr) arr.push(ref); else page.node.set(PL.PDFName.of('Annots'), ctx.obj([ref]));
      });
    } catch (e) { console.warn('PDF havolalar:', e); }
  };


  /** Qo'llab-quvvatlanmaydigan obyektlar (path, polygon, line…) uchun rasm (sprite) tayyorlaydi */
  async function buildSprites(list) {
    var out = {};
    for (var i = 0; i < list.length; i++) {
      var objs = (list[i] && list[i].objects) || [];
      for (var k = 0; k < objs.length; k++) {
        var o = objs[k];
        if (!o || o.visible === false || isNative(o) || typeof window.renderObjectSprite !== 'function') continue;
        try {
          var sp = await pTimeout(window.renderObjectSprite(o), 8000, null);
          if (sp && sp.url) (out[i] = out[i] || {})[k] = { src: sp.url, left: sp.x, top: sp.y, width: sp.w, height: sp.h };
        } catch (e) {  }
      }
    }
    return out;
  }
  window.ssBuildSprites = buildSprites;
  window.ssViewerShellHtml = shellHtml;

  exportHTMLv40.__v39 = true;           // 28_v39_fixes.js qayta o'ramasin (media allaqachon ichiga joylanadi)
  window.ssExportHTMLv40 = exportHTMLv40;
  window.exportHTML = exportHTMLv40;
  window.ssViewerRuntimeSource = function () { return '(' + ssViewerRuntime.toString() + ')();'; };
  window.ssViewerCss = VIEWER_CSS;
})();
