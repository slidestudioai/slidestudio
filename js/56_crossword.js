/* =====================================================================
 * 56_crossword.js  (v71) — KROSSVORD (crossword) slayd elementi
 *
 *  AI ham, foydalanuvchi ham slaydga professional krossvord qo'yadi:
 *    {"type":"crossword","words":[{"answer":"GERAKL","clue":"..."}, ...],
 *     "left":48,"top":110,"width":864,"height":390,
 *     "showClues":true, "showAnswers":false, "acrossLabel":"Eniga", "downLabel":"Bo'yiga", "letterFont":"hand"|"print"}
 *
 *  • So'zlar kesishadigan qilib AVTOMATIK joylanadi (bir necha urinishdan eng ixchami tanlanadi).
 *    O'zbekcha Oʻ / Gʻ — bitta katak.
 *  • To'r — BITTA guruh (birga suriladi), savollar — oddiy tahrirlanadigan matn.
 *    PPTX eksportda hammasi PowerPoint'ning oddiy shakllari bo'lib chiqadi (guruh yoyiladi).
 *  • Mavzu (theme) almashsa ranglar ham moslashadi (51_design_themes.js -> SS_CROSSWORD.recolor*).
 *  • «Qo'shish → Krossvord» oynasi: so'z + savol, jonli ko'rinish, AI bilan to'ldirish, javoblar slaydi.
 *
 *  API: window.SS_CROSSWORD = { tokens, layout, build, open, recolorCanvas, recolorJson }
 * ===================================================================== */
(function () {
  'use strict';
  if (window.SS_CROSSWORD) return;

  var SW = 960, SH = 540;
  var MAX_WORDS = 14, MIN_LEN = 2, MAX_LEN = 15;
  var HAND_FONT = 'Caveat';
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function rnd(v) { return Math.round(v * 100) / 100; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tr(s) { try { return window.SSI18n && SSI18n.t ? (SSI18n.t(s) || s) : s; } catch (e) { return s; } }
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(tr(m), k || 'success'); } catch (e) {} }
  function lang() { try { return (window.SSI18n && SSI18n.lang) || 'uz'; } catch (e) { return 'uz'; } }

  /* ------------------------------------------------------------------ 1) harflar (Oʻ / Gʻ = bitta katak) */
  function tokens(word) {
    var s = String(word == null ? '' : word).toUpperCase().replace(/[ʻʼ‘’`´']/g, "'"), out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if ((c === 'O' || c === 'G') && s[i + 1] === "'") { out.push(c + '‘'); i++; continue; }
      if (/[A-ZА-ЯЁЎҚҒҲÀ-ÖØ-ÞĀ-ž]/.test(c)) out.push(c);
    }
    return out;
  }
  function cleanWords(words) {
    var seen = {}, out = [];
    (Array.isArray(words) ? words : []).forEach(function (w) {
      if (!w) return;
      var ans = typeof w === 'string' ? w : (w.answer || w.word || w.a || '');
      var clue = typeof w === 'string' ? '' : (w.clue || w.question || w.q || '');
      var t = tokens(ans);
      if (t.length < MIN_LEN || t.length > MAX_LEN) return;
      var key = t.join('');
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ answer: String(ans).trim(), clue: String(clue).trim(), t: t });
    });
    return out.slice(0, MAX_WORDS);
  }

  /* ------------------------------------------------------------------ 2) joylash algoritmi */
  function prng(seed) { var x = seed >>> 0 || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function attempt(items) {
    var G = {};                                   // "r,c" -> {ch, a:bool, d:bool}
    var placed = [], unplaced = [];
    function at(r, c) { return G[r + ',' + c]; }
    function canPlace(t, r, c, dir) {
      var dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0, cross = 0;
      var b = at(r - dr, c - dc), e = at(r + dr * t.length, c + dc * t.length);
      if (b || e) return -1;
      for (var k = 0; k < t.length; k++) {
        var rr = r + dr * k, cc = c + dc * k, cell = at(rr, cc);
        if (cell) {
          if (cell.ch !== t[k] || (dir === 'across' ? cell.a : cell.d)) return -1;
          cross++;
        } else {
          // yonma-yon (parallel) so'zlar yopishmasin
          if (at(rr + dc, cc + dr) || at(rr - dc, cc - dr)) return -1;
        }
      }
      return cross;
    }
    function put(w, r, c, dir) {
      var dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0;
      for (var k = 0; k < w.t.length; k++) {
        var key = (r + dr * k) + ',' + (c + dc * k);
        var cell = G[key] || (G[key] = { ch: w.t[k], a: false, d: false });
        if (dir === 'across') cell.a = true; else cell.d = true;
      }
      placed.push({ answer: w.answer, clue: w.clue, t: w.t, row: r, col: c, dir: dir });
    }
    function bbox() {
      var r0 = 1e9, r1 = -1e9, c0 = 1e9, c1 = -1e9;
      Object.keys(G).forEach(function (k) { var p = k.split(','), r = +p[0], c = +p[1]; r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); });
      return { r0: r0, r1: r1, c0: c0, c1: c1 };
    }
    items.forEach(function (w, idx) {
      if (!idx) { put(w, 0, 0, 'across'); return; }
      var best = null, bb = bbox();
      placed.forEach(function (p) {
        for (var i = 0; i < p.t.length; i++) {
          for (var j = 0; j < w.t.length; j++) {
            if (p.t[i] !== w.t[j]) continue;
            var dir = p.dir === 'across' ? 'down' : 'across';
            var pr = p.row + (p.dir === 'down' ? i : 0), pc = p.col + (p.dir === 'across' ? i : 0);
            var r = dir === 'down' ? pr - j : pr, c = dir === 'across' ? pc - j : pc;
            var cross = canPlace(w.t, r, c, dir);
            if (cross < 1) continue;
            var r1 = dir === 'down' ? r + w.t.length - 1 : r, c1 = dir === 'across' ? c + w.t.length - 1 : c;
            var h = Math.max(bb.r1, r1) - Math.min(bb.r0, r) + 1, wd = Math.max(bb.c1, c1) - Math.min(bb.c0, c) + 1;
            var score = cross * 40 - h * wd * 0.6 - Math.abs(wd / h - 1.6) * 6;
            if (!best || score > best.score) best = { r: r, c: c, dir: dir, score: score };
          }
        }
      });
      if (best) put(w, best.r, best.c, best.dir); else unplaced.push(w);
    });
    var b = bbox();
    return { placed: placed, unplaced: unplaced, rows: b.r1 - b.r0 + 1, cols: b.c1 - b.c0 + 1, r0: b.r0, c0: b.c0, G: G };
  }

  /** so'zlar -> {cells:[{r,c,ch,n}], words:[{num,dir,answer,clue,row,col,len}], rows, cols, unplaced:[...]} */
  function layout(words, aspect) {
    var list = cleanWords(words);
    if (!list.length) return { cells: [], words: [], rows: 0, cols: 0, unplaced: [] };
    aspect = aspect || 1.6;
    var rand = prng(hash(list.map(function (w) { return w.t.join(''); }).join('|')));
    var orders = [list.slice().sort(function (a, b) { return b.t.length - a.t.length; })];
    for (var i = 0; i < 60; i++) {
      var o = list.slice();
      for (var k = o.length - 1; k > 0; k--) { var j = Math.floor(rand() * (k + 1)), x = o[k]; o[k] = o[j]; o[j] = x; }
      orders.push(o);
    }
    var best = null;
    orders.forEach(function (o) {
      var a = attempt(o);
      var ratio = a.cols / Math.max(1, a.rows);
      var score = a.placed.length * 1000 - a.rows * a.cols - Math.abs(Math.log(ratio / aspect)) * 40;
      if (!best || score > best.score) { best = a; best.score = score; }
    });
    // raqamlash: chapdan-o'ngga, tepadan-pastga (an'anaviy krossvord tartibi)
    var starts = {};
    best.placed.forEach(function (p) { starts[(p.row - best.r0) + ',' + (p.col - best.c0)] = 1; });
    var keys = Object.keys(starts).map(function (k) { var p = k.split(','); return [+p[0], +p[1]]; })
      .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var numAt = {};
    keys.forEach(function (k, i) { numAt[k[0] + ',' + k[1]] = i + 1; });
    var cells = Object.keys(best.G).map(function (k) {
      var p = k.split(','), r = +p[0] - best.r0, c = +p[1] - best.c0;
      return { r: r, c: c, ch: best.G[k].ch, n: numAt[r + ',' + c] || 0 };
    }).sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    var ws = best.placed.map(function (p) {
      var r = p.row - best.r0, c = p.col - best.c0;
      return { num: numAt[r + ',' + c], dir: p.dir, answer: p.answer, clue: p.clue, row: r, col: c, len: p.t.length };
    }).sort(function (a, b) { return a.num - b.num || (a.dir === 'across' ? -1 : 1); });
    return { cells: cells, words: ws, rows: best.rows, cols: best.cols, unplaced: best.unplaced.map(function (w) { return w.answer; }) };
  }

  /* ------------------------------------------------------------------ 3) ranglar */
  function lum(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return 1;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  /** kit uslubi (S) yoki slayd mavzusi (T) -> krossvord ranglari */
  function palette(src) {
    src = src || {};
    if (src.title && src.body) {                            // 51_design_themes mavzusi
      var dark = lum(src.bg) < 0.45;
      return { cell: dark ? '#FFFFFF' : '#FFFFFF', line: dark ? src.a1 : src.title, num: dark ? '#334155' : src.a1,
        letter: dark ? '#0F172A' : src.title, head: src.a1, clue: src.body, cnum: src.title, frame: dark ? src.a2 : src.title,
        font: src.fontBody || 'Arial', headFont: src.fontTitle || 'Arial' };
    }
    var darkS = lum(src.bg) < 0.45 && lum(src.card) < 0.45;
    return { cell: '#FFFFFF', line: darkS ? (src.accent || '#6366F1') : (src.ink || '#1F2937'), num: darkS ? '#334155' : (src.accent || '#4F46E5'),
      letter: '#111827', head: src.accent || '#4F46E5', clue: src.muted || src.ink || '#334155', cnum: src.ink || '#111827',
      frame: src.ink || '#1F2937', font: src.fontBody || 'Arial', headFont: src.fontTitle || 'Arial' };
  }
  function currentPalette() {
    try {
      if (window.SS_THEMES && typeof canvas !== 'undefined' && canvas) {
        var k = SS_THEMES.current(canvas);
        if (k && SS_THEMES.THEMES[k]) return palette(SS_THEMES.THEMES[k]);
      }
    } catch (e) {}
    return null;
  }

  /* ------------------------------------------------------------------ 4) matn o'lchash */
  function measure(text, width, fs, o) {
    try {
      var tb = new fabric.Textbox(String(text || ' '), { width: width, fontSize: fs, fontFamily: o.fontFamily || 'Arial', fontWeight: o.fontWeight || 'normal', lineHeight: o.lineHeight || 1.25 });
      return tb.height;
    } catch (e) { return Math.ceil(String(text).length * fs * 0.55 / Math.max(20, width)) * fs * 1.3; }
  }
  function fitFs(text, width, height, fs, min, o) {
    while (fs > min && measure(text, width, fs, o) > height) fs -= 1;
    return fs;
  }
  function labels(el) {
    var L = lang();
    var def = L === 'ru' ? ['По горизонтали', 'По вертикали'] : L === 'en' ? ['Across', 'Down'] : ['Eniga', "Bo'yiga"];
    return [el.acrossLabel || def[0], el.downLabel || def[1]];
  }

  /* ------------------------------------------------------------------ 5) qurish: element -> oddiy bo'laklar */
  /** o — kit elementi (left/top/width/height bor), S — kit uslubi. Qaytaradi: [crossword_grid, matnlar...] */
  function build(o, S) {
    var L = layout(o.words, 1.6);
    var P = o.style ? palette(S) : palette(null);          // uslub berilmasa — neytral, professional ranglar
    if (o.palette && typeof o.palette === 'object') Object.assign(P, o.palette);
    var cp = currentPalette(); if (cp && !o.palette) P = cp;
    var left = num(o.left, 48), top = num(o.top, 110), W = num(o.width, 864), H = num(o.height, 390);
    var showClues = o.showClues !== false && !!L.words.length && L.words.some(function (w) { return w.clue; });
    var showAnswers = !!o.showAnswers;
    var parts = [];
    if (!L.cells.length) {
      parts.push({ type: 'text', text: tr("Krossvord uchun kamida 2 ta so'z kerak"), left: left, top: top, width: W, height: 40, fontSize: 22, fill: P.clue, ssRole: 'cw_clue' });
      return parts;
    }
    // maydonlar: chapda to'r, o'ngda savollar (to'r eni ~ 52%)
    var gap = 28;
    var gridW = showClues ? Math.round(W * (L.cols >= L.rows * 1.6 ? 0.56 : 0.5)) : W;
    var cluesX = left + gridW + gap, cluesW = W - gridW - gap;
    var cell = Math.floor(Math.min(gridW / L.cols, H / L.rows, showClues ? 54 : 64));
    cell = Math.max(cell, 14);
    var gw = cell * L.cols, gh = cell * L.rows;
    var gx = left + (gridW - gw) / 2, gy = top + (H - gh) / 2;
    if (showClues && gx > left) gx = left + Math.max(0, (gridW - gw) / 2);
    var json = JSON.stringify({ words: L.words.map(function (w) { return { answer: w.answer, clue: w.clue }; }).concat((L.unplaced || []).map(function (a) { return { answer: a, clue: '' }; })),
      showClues: o.showClues !== false, showAnswers: showAnswers, acrossLabel: o.acrossLabel || '', downLabel: o.downLabel || '', letterFont: o.letterFont || 'hand' });
    parts.push({ type: 'crossword_grid', left: rnd(gx), top: rnd(gy), cell: cell, cells: L.cells, showAnswers: showAnswers,
      letterFont: o.letterFont === 'print' ? 'Arial' : HAND_FONT, colors: P, ssRole: 'cw_grid', cwData: json, animation: o.animation });

    if (showClues) {
      var lb = labels(o);
      var across = L.words.filter(function (w) { return w.dir === 'across'; });
      var down = L.words.filter(function (w) { return w.dir === 'down'; });
      var lines = function (arr) { return arr.map(function (w) { return w.num + '. ' + (w.clue || '…'); }).join('\n'); };
      var headFs = 20, colH = H;
      var blocks = [[lb[0], across], [lb[1], down]].filter(function (b) { return b[1].length; });
      var totalText = blocks.map(function (b) { return lines(b[1]); }).join('\n');
      var fs = fitFs(totalText, cluesW, colH - blocks.length * (headFs + 18) - 12, 18, 10, { fontFamily: P.font });
      var y = top;
      var hTotal = blocks.reduce(function (s, b) { return s + headFs + 10 + measure(lines(b[1]), cluesW, fs, { fontFamily: P.font }) + 14; }, 0);
      y = top + Math.max(0, (H - hTotal) / 2);
      blocks.forEach(function (b) {
        parts.push({ type: 'text', text: String(b[0]).toUpperCase(), left: rnd(cluesX), top: rnd(y), width: rnd(cluesW), height: headFs + 4,
          fontSize: headFs, fontWeight: 'bold', fill: P.head, fontFamily: P.headFont, charSpacing: 80, ssRole: 'cw_head' });
        y += headFs + 10;
        var t = lines(b[1]), th = measure(t, cluesW, fs, { fontFamily: P.font });
        parts.push({ type: 'text', text: t, left: rnd(cluesX), top: rnd(y), width: rnd(cluesW), height: rnd(th), fontSize: fs,
          fill: P.clue, fontFamily: P.font, lineHeight: 1.25, ssRole: 'cw_clue' });
        y += th + 14;
      });
    }
    return parts;
  }

  /* ------------------------------------------------------------------ 6) to'r -> fabric guruh */
  function gridObjects(el) {
    var P = el.colors || palette({}), cell = num(el.cell, 40), objs = [];
    var lw = Math.max(1.2, cell / 28);
    (el.cells || []).forEach(function (c) {
      var x = c.c * cell, y = c.r * cell;
      objs.push(new fabric.Rect({ left: x, top: y, width: cell, height: cell, fill: P.cell, stroke: P.line, strokeWidth: lw,
        strokeUniform: true, rx: 0, ry: 0, ssRole: 'cw_cell', objectCaching: false }));
      if (c.n) objs.push(new fabric.Text(String(c.n), { left: x + cell * 0.08, top: y + cell * 0.05, fontSize: Math.max(8, Math.round(cell * 0.27)),
        fontWeight: 'bold', fill: P.num, fontFamily: 'Arial', ssRole: 'cw_num' }));
      if (el.showAnswers) {
        var hand = el.letterFont === HAND_FONT;
        var fs = Math.round(cell * (hand ? 0.78 : 0.56));
        var t = new fabric.Text(c.ch, { fontSize: fs, fontWeight: hand ? '600' : 'bold', fill: P.letter, fontFamily: el.letterFont || HAND_FONT,
          originX: 'center', originY: 'center', left: x + cell / 2, top: y + cell * (hand ? 0.56 : 0.55), ssRole: 'cw_letter' });
        objs.push(t);
      }
    });
    return objs;
  }
  async function loadFont(f) {
    try { if (document.fonts && document.fonts.load) await Promise.race([document.fonts.load('600 40px "' + f + '"'), new Promise(function (r) { setTimeout(r, 1500); })]); } catch (e) {}
  }
  async function gridGroup(el) {
    if (el.showAnswers) await loadFont(el.letterFont || HAND_FONT);
    var objs = gridObjects(el);
    if (!objs.length) return null;
    var g = new fabric.Group(objs, { left: num(el.left, 0), top: num(el.top, 0), subTargetCheck: false });
    g.ssRole = 'cw_grid'; g.cwData = el.cwData || '';
    if (el.ssKit) { g.ssKit = el.ssKit; g.ssKitItem = 'crossword'; }
    try { if (typeof ensureObjectId === 'function') ensureObjectId(g); } catch (e) {}
    return g;
  }

  /* ------------------------------------------------------------------ 7) kit / AI ulanishi */
  try { if (typeof SERIALIZE_PROPS !== 'undefined') ['cwData', 'ssKit', 'ssRole', 'ssKitItem'].forEach(function (k) { if (SERIALIZE_PROPS.indexOf(k) < 0) SERIALIZE_PROPS.push(k); }); } catch (e) {}
  function register() {
    if (!window.SS_KIT || !SS_KIT.ITEMS) return false;
    if (!SS_KIT.ITEMS.crossword) SS_KIT.ITEMS.crossword = { id: 'crossword', cat: 'crossword', label: 'Krossvord', size: [864, 390], build: build };
    return true;
  }
  function hookParse() {
    var prev = window.parseElementToFabric;
    if (typeof prev !== 'function') return false;
    if (prev.__ssCw) return true;
    var w = async function (el) {
      if (el && el.type === 'crossword_grid') {
        var g = await gridGroup(el);
        if (g && el.animation) { g.animation = el.animation; }
        return g;
      }
      if (el && (el.type === 'crossword' || (el.type === 'kit' && /^crossword$/i.test(String(el.item || ''))))) {
        // kit qatlami bizdan ichkarida qolgan bo'lsa ham — o'zimiz yoyamiz
        if (!register()) return null;
        var parts = SS_KIT.expand(Object.assign({}, el, { type: 'kit', item: 'crossword' }));
        var objs = [];
        for (var i = 0; i < parts.length; i++) { var o = await w(parts[i]); if (o) objs.push(o); }
        if (!objs.length) return null;
        if (objs.length === 1) return objs[0];
        var grp = new fabric.Group(objs, { subTargetCheck: false });
        grp.ssKit = parts[0].ssKit; grp.ssKitItem = 'crossword'; grp.ssRole = 'cw_all';
        return grp;
      }
      return prev.apply(this, arguments);
    };
    w.__ssCw = true; w.__ssWrapped = prev.__ssWrapped; w.__ssShapes = prev.__ssShapes; w.__v48 = prev.__v48;
    window.parseElementToFabric = w;
    return true;
  }
  register(); hookParse();
  setTimeout(function () { register(); hookParse(); }, 1700);   // boshqa modullar o'rab qo'ygan bo'lsa ham zanjirda bo'lamiz

  /* ------------------------------------------------------------------ 8) mavzu almashganda ranglar */
  function recolorObj(o, P, json) {
    var role = o.ssRole;
    var set = function (k, v) { if (json) o[k] = v; else o.set(k, v); };
    if (role === 'cw_cell') { set('fill', P.cell); set('stroke', P.line); }
    else if (role === 'cw_num') set('fill', P.num);
    else if (role === 'cw_letter') set('fill', P.letter);
    else if (role === 'cw_head') { set('fill', P.head); set('fontFamily', P.headFont); }
    else if (role === 'cw_clue') { set('fill', P.clue); set('fontFamily', P.font); }
  }
  function walk(list, P, json) {
    (list || []).forEach(function (o) {
      if (!o) return;
      if (o.ssKitItem === 'crossword' || /^cw_/.test(String(o.ssRole || ''))) {
        recolorObj(o, P, json);
        var kids = json ? o.objects : (o.getObjects ? o.getObjects() : null);
        if (kids) kids.forEach(function (k) { recolorObj(k, P, json); });
        if (!json && o.type === 'group') { try { o.dirty = true; } catch (e) {} }
      }
    });
  }
  function recolorCanvas(c, T) { try { walk(c.getObjects(), palette(T), false); c.requestRenderAll(); } catch (e) { console.warn('[crossword] recolor', e); } }
  function recolorJson(objs, T) { try { walk(objs, palette(T), true); } catch (e) { console.warn('[crossword] recolor json', e); } }

  /* ------------------------------------------------------------------ 9) foydalanuvchi oynasi */
  var css = document.createElement('style');
  css.textContent = [
    '#ssCw{position:fixed;inset:0;z-index:2147483100;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:12px}',
    '#ssCw .cw{background:#fff;color:#1f2937;width:min(980px,100%);max-height:94vh;display:flex;flex-direction:column;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.3);font:14px/1.4 inherit;font-family:inherit;overflow:hidden}',
    '#ssCw .cwh{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #eef0f3}',
    '#ssCw .cwh b{flex:1;font-size:17px}',
    '#ssCw .cwx{background:#f1f3f4;border:0;border-radius:50%;width:32px;height:32px;font-size:20px;cursor:pointer;color:#5f6368}',
    '#ssCw .cwb{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:16px;padding:14px 18px;overflow:auto}',
    '@media(max-width:760px){#ssCw .cwb{grid-template-columns:minmax(0,1fr);padding:12px}#ssCw .cwai{flex-wrap:wrap}#ssCw .cwai .btn{flex:1 1 100%}#ssCw .row{grid-template-columns:18px minmax(0,.8fr) minmax(0,1.4fr) 26px}}',
    '#ssCw .cwai{display:flex;gap:8px;margin-bottom:10px}',
    '#ssCw input,#ssCw textarea{font:inherit;border:1px solid #d1d5db;border-radius:10px;padding:8px 10px;outline:none;color:#1f2937;background:#fff;min-width:0}',
    '#ssCw input:focus{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.15)}',
    '#ssCw .cwai input{flex:1 1 160px}',
    '#ssCw .btn{border:0;border-radius:10px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer;background:#f1f3f4;color:#1f2937;white-space:nowrap}',
    '#ssCw .btn.pri{background:#7c3aed;color:#fff}#ssCw .btn.ai{background:linear-gradient(135deg,#4f6bff,#8b2cf5);color:#fff}',
    '#ssCw .btn:disabled{opacity:.6;cursor:default}',
    '#ssCw .rows{display:flex;flex-direction:column;gap:6px;max-height:42vh;overflow:auto;padding-right:2px}',
    '#ssCw .row{display:grid;grid-template-columns:22px minmax(0,.8fr) minmax(0,1.6fr) 30px;gap:6px;align-items:center}',
    '#ssCw .row .n{color:#9ca3af;font-size:12px;text-align:right}',
    '#ssCw .row .del{border:0;background:none;color:#9ca3af;font-size:18px;cursor:pointer}',
    '#ssCw .row input.bad{border-color:#f59e0b;background:#fffbeb}',
    '#ssCw .opts{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:13px;color:#374151}',
    '#ssCw .opts label{display:flex;align-items:center;gap:6px;cursor:pointer}',
    '#ssCw .pv{border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:260px;padding:10px}',
    '#ssCw .pv svg{max-width:100%;max-height:52vh}',
    '#ssCw .note{font-size:12.5px;color:#6b7280;margin-top:8px;min-height:18px}',
    '#ssCw .note.warn{color:#b45309}',
    '#ssCw .cwf{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid #eef0f3;flex-wrap:wrap}',
  ].join('\n');
  document.head.appendChild(css);

  var SAMPLE = [
    { answer: 'GERAKL', clue: "Yunon mifologiyasida 12 ta jasorat ko'rsatgan yarim xudo" },
    { answer: 'ANUBIS', clue: "Misr mifologiyasida chiyabo'ri boshli marhumlar xudosi" },
    { answer: 'HUMO', clue: 'Baxt va omad keltiruvchi afsonaviy qush' },
    { answer: 'LOKI', clue: 'Skandinaviya mifologiyasida ayyorlik xudosi' },
    { answer: 'KITSUNE', clue: "Yapon mifologiyasidagi to'qqiz dumli sehrli tulki" },
    { answer: 'ZEVS', clue: 'Olimp xudolarining boshlig\'i' }
  ];

  function previewSvg(L, showAnswers) {
    if (!L.cells.length) return '<div style="color:#9ca3af;text-align:center;padding:30px">' + esc(tr("So'z va savollarni kiriting — krossvord shu yerda ko'rinadi")) + '</div>';
    var s = 32, w = L.cols * s, h = L.rows * s, out = '<svg viewBox="-2 -2 ' + (w + 4) + ' ' + (h + 4) + '" width="' + (w + 4) + '" height="' + (h + 4) + '" xmlns="http://www.w3.org/2000/svg">';
    L.cells.forEach(function (c) {
      out += '<rect x="' + c.c * s + '" y="' + c.r * s + '" width="' + s + '" height="' + s + '" fill="#fff" stroke="#1f2937" stroke-width="1.4"/>';
      if (c.n) out += '<text x="' + (c.c * s + 2.5) + '" y="' + (c.r * s + 9.5) + '" font-size="8.5" font-weight="700" fill="#4f46e5" font-family="Arial">' + c.n + '</text>';
      if (showAnswers) out += '<text x="' + (c.c * s + s / 2) + '" y="' + (c.r * s + s * 0.72) + '" font-size="20" text-anchor="middle" fill="#111827" font-family="' + HAND_FONT + ',cursive">' + esc(c.ch) + '</text>';
    });
    return out + '</svg>';
  }

  function selectedCrossword() {
    try {
      var c = canvas, a = c.getActiveObject(); if (!a) return null;
      var list = a.type === 'activeSelection' ? a.getObjects() : [a];
      var hit = list.find(function (o) { return o && o.ssKitItem === 'crossword'; });
      if (!hit) return null;
      var id = hit.ssKit, all = c.getObjects().filter(function (o) { return o.ssKit === id; });
      var grid = all.find(function (o) { return o.ssRole === 'cw_grid' || o.cwData; }) || all.find(function (o) { return o.ssRole === 'cw_all'; });
      var data = null;
      try { data = JSON.parse((grid && grid.cwData) || 'null'); } catch (e) {}
      if (!data && grid && grid.ssRole === 'cw_all') {
        var inner = grid.getObjects().find(function (o) { return o.cwData; }); try { data = JSON.parse(inner.cwData); } catch (e) {}
      }
      return { id: id, objs: all, data: data };
    } catch (e) { return null; }
  }
  function unionBox(objs) {
    var l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    objs.forEach(function (o) { var bb = o.getBoundingRect(true, true); l = Math.min(l, bb.left); t = Math.min(t, bb.top); r = Math.max(r, bb.left + bb.width); b = Math.max(b, bb.top + bb.height); });
    return { left: l, top: t, width: r - l, height: b - t };
  }
  function saveState() {
    try { if (typeof saveCurrentSlideState === 'function') saveCurrentSlideState(); } catch (e) {}
    try { if (typeof recordGlobalState === 'function') recordGlobalState(); } catch (e) {}
    try { if (typeof refreshSlideThumb === 'function' && typeof activeIndex !== 'undefined') refreshSlideThumb(activeIndex); } catch (e) {}
  }

  /** slaydga qo'yish (yoki tanlangan krossvordni almashtirish) */
  async function insert(opts, replace) {
    var c = (typeof canvas !== 'undefined') ? canvas : null; if (!c || !register()) return [];
    var box = replace ? unionBox(replace.objs) : { left: 48, top: 110, width: 864, height: 390 };
    if (replace && replace.objs.length === 1 && !opts.showClues) box = unionBox(replace.objs);
    var el = Object.assign({ type: 'kit', item: 'crossword' }, box, opts);
    var parts = SS_KIT.expand(el), objs = [];
    for (var i = 0; i < parts.length; i++) { var o = await window.parseElementToFabric(parts[i]); if (o) objs.push(o); }
    if (replace) replace.objs.forEach(function (o) { c.remove(o); });
    objs.forEach(function (o) { try { if (typeof ensureObjectId === 'function') ensureObjectId(o); } catch (e) {} c.add(o); });
    try {
      c.discardActiveObject();
      if (objs.length > 1) c.setActiveObject(new fabric.ActiveSelection(objs, { canvas: c })); else if (objs[0]) c.setActiveObject(objs[0]);
    } catch (e) {}
    c.requestRenderAll();
    saveState();
    return objs;
  }
  /** joriy slaydda (mavzu bezagidan tashqari) biror narsa bormi — bor bo'lsa krossvord ustiga tushmasin */
  function isPh(o) {
    try { return (o.type === 'textbox' || o.type === 'i-text') && window.SSI18n && SSI18n.isPlaceholder && SSI18n.isPlaceholder(o.text); } catch (e) { return false; }
  }
  /** joriy slayd: 'content' (biror narsa bor), 'placeholder' (faqat «Sarlavha kiriting» kabi namuna matn), 'empty' */
  function slideState() {
    try {
      var objs = canvas.getObjects().filter(function (o) { return o && o.ssRole !== 'bgdecor'; });
      if (objs.some(function (o) { return !isPh(o); })) return 'content';
      return objs.length ? 'placeholder' : 'empty';
    } catch (e) { return 'empty'; }
  }
  function addTitleHere(title) {
    canvas.getObjects().filter(isPh).forEach(function (o) { canvas.remove(o); });
    var P = currentPalette() || palette(null);
    var t = new fabric.Textbox(String(title), { left: 48, top: 36, width: 864, fontSize: 36, fontWeight: 'bold', fill: P.cnum || '#111827', fontFamily: P.headFont || 'Arial' });
    try { if (typeof ensureObjectId === 'function') ensureObjectId(t); } catch (e) {}
    canvas.add(t);
  }
  async function addTitled(title) {
    addSlide('blank');
    await new Promise(function (r) { setTimeout(r, 450); });
    addTitleHere(title);
  }
  async function addAnswerSlide(opts) {
    try {
      if (typeof addSlide !== 'function') return;
      await addTitled(tr('Javoblar'));
      await insert(Object.assign({}, opts, { showAnswers: true, showClues: false }), null);
    } catch (e) { console.warn('[crossword] answers slide', e); }
  }

  function close() { var o = document.getElementById('ssCw'); if (o) o.remove(); document.removeEventListener('keydown', onKey, true); }
  function onKey(e) { if (e.key === 'Escape' && document.getElementById('ssCw')) { e.stopPropagation(); close(); } }

  function open() {
    close();
    var sel = selectedCrossword();
    var d = (sel && sel.data) || null;
    var words = d && d.words && d.words.length ? d.words.slice() : [];
    while (words.length < 6) words.push({ answer: '', clue: '' });
    var ov = document.createElement('div'); ov.id = 'ssCw';
    ov.innerHTML = '<div class="cw" role="dialog" aria-modal="true" aria-label="Krossvord">' +
      '<div class="cwh"><span class="material-symbols-outlined" style="color:#7c3aed">grid_on</span><b>' + esc(sel ? 'Krossvordni tahrirlash' : 'Krossvord') + '</b><button type="button" class="cwx" aria-label="Yopish">×</button></div>' +
      '<div class="cwb"><div>' +
      '<div class="cwai"><input id="cwTopic" placeholder="Mavzu, masalan: Dunyo miflari" aria-label="Mavzu"><button type="button" class="btn ai" id="cwAi">✨ AI bilan yaratish</button></div>' +
      '<div class="rows" id="cwRows"></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn" id="cwAdd">+ So\'z qo\'shish</button><button type="button" class="btn" id="cwSample">Namuna</button></div>' +
      '<div class="opts">' +
      '<label><input type="checkbox" id="cwClues"' + (!d || d.showClues !== false ? ' checked' : '') + '> Savollarni slaydda ko\'rsatish</label>' +
      '<label><input type="checkbox" id="cwAns"' + (d && d.showAnswers ? ' checked' : '') + '> Javoblarni yozish (kalit)</label>' +
      '<label><input type="checkbox" id="cwHand"' + (!d || d.letterFont !== 'print' ? ' checked' : '') + '> Qo\'lda yozilgan harflar</label>' +
      (sel ? '' : '<label><input type="checkbox" id="cwKey" checked> «Javoblar» slaydini ham qo\'shish</label>') +
      '</div></div>' +
      '<div><div class="pv" id="cwPv"></div><div class="note" id="cwNote"></div></div></div>' +
      '<div class="cwf"><button type="button" class="btn" id="cwCancel">Bekor qilish</button><button type="button" class="btn pri" id="cwOk">' + esc(sel ? 'Yangilash' : 'Slaydga qo\'shish') + '</button></div></div>';
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    var $ = function (id) { return ov.querySelector('#' + id); };
    var rows = $('cwRows');

    function rowHtml(w, i) {
      return '<div class="row" data-i="' + i + '"><span class="n">' + (i + 1) + '</span>' +
        '<input class="a" placeholder="' + esc(tr('Javob (bitta so\'z)')) + '" value="' + esc(w.answer) + '" maxlength="24" autocomplete="off" spellcheck="false">' +
        '<input class="q" placeholder="' + esc(tr('Savol / ta\'rif')) + '" value="' + esc(w.clue) + '" maxlength="220">' +
        '<button type="button" class="del" title="' + esc(tr("O'chirish")) + '">×</button></div>';
    }
    function draw() { rows.innerHTML = words.map(rowHtml).join(''); refresh(); }
    function read() {
      words = Array.prototype.map.call(rows.querySelectorAll('.row'), function (r) { return { answer: r.querySelector('.a').value, clue: r.querySelector('.q').value }; });
      return words;
    }
    function opts() {
      return { words: read().filter(function (w) { return tokens(w.answer).length >= MIN_LEN; }), showClues: $('cwClues').checked, showAnswers: $('cwAns').checked,
        letterFont: $('cwHand').checked ? 'hand' : 'print' };
    }
    var tmr = null;
    function refresh() {
      clearTimeout(tmr);
      tmr = setTimeout(function () {
        var o = opts(), L = layout(o.words, 1.6);
        $('cwPv').innerHTML = previewSvg(L, o.showAnswers);
        var note = $('cwNote');
        Array.prototype.forEach.call(rows.querySelectorAll('.row'), function (r) {
          var a = r.querySelector('.a'), t = tokens(a.value);
          a.classList.toggle('bad', !!a.value.trim() && (t.length < MIN_LEN || L.unplaced.some(function (u) { return tokens(u).join('') === t.join(''); })));
        });
        if (L.unplaced.length) { note.className = 'note warn'; note.textContent = tr("Joylashmadi (boshqa so'zlar bilan umumiy harfi yo'q):") + ' ' + L.unplaced.join(', '); }
        else if (L.words.length) { note.className = 'note'; note.textContent = L.words.length + ' ' + tr("ta so'z") + ' · ' + L.cols + '×' + L.rows; }
        else { note.className = 'note'; note.textContent = ''; }
      }, 120);
    }
    rows.addEventListener('input', refresh);
    rows.addEventListener('click', function (e) {
      var b = e.target.closest('.del'); if (!b) return;
      read(); words.splice(+b.parentNode.getAttribute('data-i'), 1); if (!words.length) words.push({ answer: '', clue: '' }); draw();
    });
    ['cwClues', 'cwAns', 'cwHand'].forEach(function (id) { $(id).addEventListener('change', refresh); });
    $('cwAdd').onclick = function () { read(); if (words.length >= MAX_WORDS) return toast("Ko'pi bilan 14 ta so'z", 'error'); words.push({ answer: '', clue: '' }); draw(); var a = rows.querySelectorAll('.a'); a[a.length - 1].focus(); };
    $('cwSample').onclick = function () { words = SAMPLE.map(function (w) { return Object.assign({}, w); }); draw(); };
    ov.querySelector('.cwx').onclick = close; $('cwCancel').onclick = close;
    $('cwAi').onclick = function () {
      var topic = $('cwTopic').value.trim();
      if (!topic) { toast('Mavzuni yozing', 'error'); $('cwTopic').focus(); return; }
      close();
      var L = lang();
      var prompt = L === 'ru' ? 'Сделай слайд-кроссворд на тему «' + topic + '»: 7 слов с вопросами, а на следующем слайде — ключ с ответами.'
        : L === 'en' ? 'Make a crossword slide on «' + topic + '»: 7 words with clues, and an answer key on the next slide.'
        : '«' + topic + "» mavzusida krossvord slaydi yasab ber: 7 ta so'z va savol, keyingi slaydda javoblar kaliti.";
      try {
        if (typeof toggleAISidebar === 'function') toggleAISidebar(true);
        var inp = document.getElementById('aiSidebarInput');
        if (inp) { inp.value = prompt; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        if (typeof sendSidebarAiPrompt === 'function') sendSidebarAiPrompt();
      } catch (e) { console.warn('[crossword] ai', e); }
    };
    $('cwOk').onclick = async function () {
      var o = opts();
      var L = layout(o.words, 1.6);
      if (L.words.length < 2) { toast("Kamida 2 ta so'z kerak (har biri 2–15 harf)", 'error'); return; }
      var withKey = !sel && $('cwKey') && $('cwKey').checked && !o.showAnswers;
      var topic = $('cwTopic').value.trim();
      $('cwOk').disabled = true;
      try {
        close();
        if (!sel) {
          var ttl = topic ? topic + ': ' + tr('krossvord') : tr('Krossvord'), stt = slideState();
          if (stt === 'content') await addTitled(ttl); else addTitleHere(ttl);
        }
        await insert(o, sel);
        if (withKey) await addAnswerSlide(o);
        toast(sel ? 'Krossvord yangilandi' : (withKey ? "Krossvord va «Javoblar» slaydi qo'shildi" : "Krossvord qo'shildi"));
        if (L.unplaced.length) toast(tr("Joylashmadi (boshqa so'zlar bilan umumiy harfi yo'q):") + ' ' + L.unplaced.join(', '), 'error');
      } catch (e) { console.warn('[crossword] insert', e); toast("Krossvordni qo'shib bo'lmadi", 'error'); }
    };
    draw();
    setTimeout(function () { try { (d ? rows.querySelector('.a') : $('cwTopic')).focus(); } catch (e) {} }, 60);
  }

  // tanlangan krossvordga ikki marta bosilsa — tahrirlash oynasi
  function hookDblClick() {
    var c = (typeof canvas !== 'undefined') ? canvas : null;
    if (!c || c.__ssCw) return !!c;
    c.__ssCw = true;
    c.on('mouse:dblclick', function (e) { var t = e && e.target; if (t && t.ssKitItem === 'crossword' && t.type === 'group') { try { c.setActiveObject(t); } catch (x) {} open(); } });
    return true;
  }
  if (!hookDblClick()) { var hk = setInterval(function () { if (hookDblClick()) clearInterval(hk); }, 500); setTimeout(function () { clearInterval(hk); }, 20000); }

  window.SS_CROSSWORD = { tokens: tokens, layout: layout, build: build, open: open, insert: insert, recolorCanvas: recolorCanvas, recolorJson: recolorJson, palette: palette };
  window.openCrosswordDialog = open;
})();
