/* v48 — Slayd o'tish animatsiyasi (butun slayd), JADVAL va GRAFIK elementlari.
 *  - Slayd o'tishi: slides[i].transition = fade | zoom | flip | up | blur | none  (Namoyish rejimida o'ynaydi)
 *  - Jadval / grafik: fabric.Group sifatida yaratiladi (saqlanadi, PDF/HTML/rasmga chiqadi; PPTX da rasm bo'lib o'tadi)
 *  - AI: elements[] ichida {"type":"table"|"chart",...} va {"action":"set_transition",...}
 */
(function () {
  'use strict';
  if (window.__ssV48Fx) return;
  window.__ssV48Fx = true;

  var PALETTE = ['#4f8cff', '#f5a524', '#2fbf71', '#ef4f5f', '#9b5de5', '#00bbf9', '#f15bb5', '#8ac926'];
  var TRANSITIONS = [['', 'Standart']].concat((window.SS_TR ? window.SS_TR.list : []).map(function (x) { return [x.k, x.t, x.g]; })).concat([['none', "Yo'q"]]);

  /* ------------------------------------------------------------------ CSS */
  var css = document.createElement('style');
  css.id = 'ssV48Css';
  css.textContent = [
    (window.SS_TR ? window.SS_TR.css('.presentation-overlay .pres-tr-', '.presentation-overlay .pres-tr-out-') : ''),
    '.ap-trans{margin:10px 0 4px;padding-top:8px;border-top:1px solid rgba(128,128,128,.25)}',
    '.ap-trans b{display:block;font-size:12px;margin-bottom:6px}',
    '.ap-trans .ap-trg{display:flex;flex-wrap:wrap;gap:6px}',
    '.ap-trans button{border:1px solid #dadce0;background:#fff;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}',
    '.ap-trans button.on{background:#e8f0fe;border-color:#1a73e8;color:#1a56db;font-weight:600}',
    '.ap-trans .ap-all{margin-top:6px;width:100%}'
  ].join('\n');
  document.head.appendChild(css);

  /* ------------------------------------------------------------------ Slayd o'tishi */
  function curSlide() { try { return slides[activeIndex]; } catch (e) { return null; } }
  window.ssTransitionsHtml = function () {
    var s = curSlide(), cur = (s && s.transition) || '';
    return '<div class="ap-trans"><b>Slayd o\'tishi (butun slayd)</b><div class="ap-trg">' +
      TRANSITIONS.map(function (t) {
        return '<button class="' + (cur === t[0] ? 'on' : '') + '" onclick="ssSetTransition(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div><button class="ap-all" onclick="ssSetTransition(null,true)">Shuni hamma slaydga qo\'llash</button></div>';
  };
  function rerenderPanel() { try { if (window.AnimKit && AnimKit.renderPanel) AnimKit.renderPanel(); } catch (e) {} }
  function markDirty() { try { hasUnsavedChanges = true; } catch (e) {} try { if (typeof window.ssPrewarmPresentation === 'function') setTimeout(window.ssPrewarmPresentation, 600); } catch (e) {} }
  /** name — effekt kalitu; opts {dur, auto}. all=true: hozirgi slaydning effekt/davomiylik/avto sozlamasi hammasiga. */
  window.ssSetTransition = function (name, all, index, opts) {
    try {
      var valid = TRANSITIONS.some(function (t) { return t[0] === (name || ''); });
      if (name != null && !valid) return false;
      if (all) {
        var cs = (index != null && slides[index]) ? slides[index] : (curSlide() || {});
        var base = cs.transition || '', bd = cs.transDur || 0, ba = cs.transAuto || 0;
        slides.forEach(function (s) { s.transition = base; s.transDur = bd; s.transAuto = ba; });
        try { showToast('Hamma slaydga qo\'llandi', 'info'); } catch (e) {}
      } else {
        var s = (index != null && slides[index]) ? slides[index] : curSlide();
        if (!s) return false;
        if (name != null) s.transition = name || '';
        if (opts && opts.dur != null) s.transDur = window.SS_TR ? SS_TR.clampDur(opts.dur, 0.7) : opts.dur;
        if (opts && opts.auto != null) s.transAuto = Math.max(0, Math.min(600, parseFloat(opts.auto) || 0));
        if (name != null) { try { showToast(name ? ('Slayd o\'tishi: ' + name) : 'Standart o\'tish', 'info'); } catch (e) {} }
      }
      markDirty();
      rerenderPanel();
      return true;
    } catch (e) { return false; }
  };
  /* Muharrir namoyishi (zaxira yo'l): hozirgi slaydning o'tishini qo'llaydi */
  window.ssApplyPresTransition = function (stage, slide) {
    try {
      if (!stage) return;
      stage.className = String(stage.className || '').replace(/\bpres-tr-\S+/g, '').replace(/\s+/g, ' ').trim();
      var t = slide && slide.transition;
      if (!t) return;
      stage.classList.remove('pres-anim-next', 'pres-anim-prev');
      if (t !== 'none') {
        stage.style.setProperty('--trd', (window.SS_TR ? SS_TR.clampDur(slide.transDur, 0.7) : 0.7) + 's');
        void stage.offsetWidth; stage.classList.add('pres-tr-' + t);
      }
    } catch (e) {}
  };

  /* ------------------------------------------------------------------ Yagona layout engine (v49) ----
   *  Jadval va grafik geometriyasi BIR joyda hisoblanadi va ssSpec ichida saqlanadi (colW, rowHs, yMin/yMax/yStep).
   *  Canvas ham, PPTX eksport (14_pptx_io.js) ham, qayta yuklash ham SHU raqamlardan foydalanadi — shuning uchun
   *  ko'rinish hamma joyda bir xil. Sabablar (eski xatolar):
   *   1) qator balandligi 1 qatorga hisoblangan edi — ko'p qatorli katak keyingi qatorga «minib» ketardi;
   *   2) fabric.Textbox uzun so'z katakka sig'masa O'ZI kengayadi (dynamicMinWidth) — «ifloslanishi» shu sabab surilardi;
   *   3) fabric qator balandligi = fontSize × lineHeight × 1.13 (_fontSizeMult) — bu hisobga olinmagan edi;
   *   4) shrift (Roboto) yuklanmasdan o'lchangan — o'lchamlar keyin eskirib qolardi (ssSpec.fontOk bilan qayta quriladi).
   */
  var LAYOUT_V = 2;
  var FAB_MULT = 1.13;                 // fabric 5.x ichki koeffitsienti
  var CELL_LH = 1.2;                   // matn qatori qadami = 1.2 × shrift (PPTX'da aniq lineSpacing sifatida yoziladi)
  var CELL_LINEH = CELL_LH / FAB_MULT; // fabric.lineHeight qiymati
  var PAD_X = 8, PAD_Y = 6;            // katak ichki bo'shlig'i (px) — PPTX'da ham xuddi shunday margin
  var FONT = 'Roboto';

  function fontReady() {
    try { return !(document.fonts && document.fonts.check) || (document.fonts.check('400 16px ' + FONT) && document.fonts.check('700 16px ' + FONT)); } catch (e) { return true; }
  }
  function preloadFont() {
    try { if (document.fonts && document.fonts.load) { document.fonts.load('400 16px ' + FONT); document.fonts.load('700 16px ' + FONT); } } catch (e) {}
  }
  preloadFont();

  function txt(s, o) {
    return new fabric.Textbox(String(s == null ? '' : s), Object.assign({
      fontFamily: FONT, fontSize: 18, fill: '#1f2937', textAlign: 'center', splitByGrapheme: false,
      lineHeight: CELL_LINEH, selectable: false, evented: false, objectCaching: false
    }, o || {}));
  }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  /** Bitta matn qatorining kengligi (fabric'ning o'z o'lchovi bilan). */
  function textW(str, fs, bold) {
    var t = new fabric.Text(String(str), { fontFamily: FONT, fontSize: fs, fontWeight: bold ? 'bold' : 'normal' });
    return t.width;
  }
  /** Katakdagi eng uzun so'z kengligi — ustun bundan tor bo'lsa Textbox o'zi kengayib, qo'shni katakka kirib ketadi. */
  function longestWordW(str, fs, bold) {
    var mx = 0;
    String(str == null ? '' : str).split(/\s+/).forEach(function (w) { if (w) mx = Math.max(mx, textW(w, fs, bold)); });
    return mx;
  }

  /** Jadval layout: shriftni, ustun kengliklarini va qator balandliklarini O'LCHAB topadi. */
  function layoutTable(rows, width, maxH, fs0, header) {
    var cols = rows[0].length, MINFS = 10, res = null, weights = [];
    for (var c = 0; c < cols; c++) {
      var mx = 0; rows.forEach(function (r) { mx = Math.max(mx, String(r[c] == null ? '' : r[c]).length); });
      weights.push(Math.min(30, Math.max(6, mx)));
    }
    var wsum = sum(weights);
    for (var fs = fs0; fs >= MINFS; fs--) {
      var minW = [];
      for (var c2 = 0; c2 < cols; c2++) {
        var m = 0;
        rows.forEach(function (r, ri) { m = Math.max(m, longestWordW(r[c2], fs, header && ri === 0)); });
        minW.push(Math.ceil(m + 2 * PAD_X + 2));
      }
      var sumMin = sum(minW);
      if (sumMin > width && fs > MINFS) continue;            // so'z sig'maydi — shriftni kichraytiramiz
      var extra = Math.max(0, width - sumMin), colW;
      if (sumMin > width) { var k = width / sumMin; colW = minW.map(function (v) { return v * k; }); }
      else colW = minW.map(function (v, i) { return v + extra * weights[i] / wsum; });
      var rowH = [], cellH = [];
      rows.forEach(function (r, ri) {
        var hs = [], mh = fs * CELL_LH;
        for (var cc = 0; cc < cols; cc++) {
          var tb = txt(r[cc], { width: Math.max(10, colW[cc] - 2 * PAD_X), fontSize: fs, fontWeight: (header && ri === 0) ? 'bold' : 'normal' });
          hs.push(tb.height); mh = Math.max(mh, tb.height);
        }
        cellH.push(hs); rowH.push(Math.ceil(mh + 2 * PAD_Y));
      });
      res = { fs: fs, colW: colW, rowH: rowH, cellH: cellH, total: sum(rowH) };
      if (res.total <= maxH) break;                          // sig'di
    }
    return res;                                              // MINFS da ham sig'masa — jadval pastga o'sadi (matn hech qachon ustma-ust tushmaydi)
  }

  function buildTable(el) {
    var rows = Array.isArray(el.rows) ? el.rows.filter(function (r) { return Array.isArray(r) && r.length; }) : [];
    if (!rows.length) rows = [['Ustun 1', 'Ustun 2'], ['—', '—']];
    rows = rows.slice(0, 14);
    var cols = Math.min(8, Math.max.apply(null, rows.map(function (r) { return r.length; })));
    rows = rows.map(function (r) { var o = []; for (var c = 0; c < cols; c++) o.push(String(r[c] == null ? '' : r[c])); return o; });
    var left = +el.left || 60, top = +el.top || 130, width = Math.max(240, Math.min(900, +el.width || 840));
    var maxH = Math.max(120, Math.min(420, +el.maxH || +el.height || 360));
    var header = el.header !== false;
    var fs0 = Math.max(11, Math.min(26, +el.fs0 || +el.fontSize || (rows.length > 7 ? 14 : (cols > 4 ? 15 : 18))));
    var hFill = el.headerFill || '#1a73e8', hCol = el.headerColor || '#ffffff', stripe = el.stripe !== false;
    var bodyFill = el.bodyFill || '#ffffff', stripeColor = el.stripeColor || '#f1f5f9', bodyColor = el.bodyColor || '#1f2937', borderColor = el.borderColor || '#dbe1ea';
    var cellStyles = (el.cellStyles && typeof el.cellStyles === 'object') ? el.cellStyles : {};
    var L = layoutTable(rows, width, maxH, fs0, header);
    var objs = [], y = 0;
    rows.forEach(function (r, ri) {
      var isH = header && ri === 0, rh = L.rowH[ri], x = 0;
      for (var ci = 0; ci < cols; ci++) {
        var cw = L.colW[ci];
        objs.push(new fabric.Rect({
          left: x, top: y, width: cw, height: rh, selectable: false, evented: false, objectCaching: false,
          fill: (cellStyles[ri + ',' + ci] && cellStyles[ri + ',' + ci].fill) || (isH ? hFill : (stripe && ri % 2 === 0 ? stripeColor : bodyFill)), stroke: borderColor, strokeWidth: 1
        }));
        var tb = txt(r[ci], {
          left: x + PAD_X, top: y, width: cw - 2 * PAD_X, fontSize: L.fs,
          fontWeight: ((cellStyles[ri + ',' + ci] && cellStyles[ri + ',' + ci].bold) || isH) ? 'bold' : 'normal',
          fill: (cellStyles[ri + ',' + ci] && cellStyles[ri + ',' + ci].color) || (isH ? hCol : bodyColor), textAlign: ci === 0 && !isH ? 'left' : 'center'
        });
        tb.set('top', y + (rh - tb.height) / 2);              // balandlikka ko'ra markazlash (ko'p qatorli ham)
        objs.push(tb);
        x += cw;
      }
      y += rh;
    });
    var g = new fabric.Group(objs, { left: left, top: top, subTargetCheck: false, objectCaching: false });
    g.ssKind = 'table';
    g.ssSpec = { v: LAYOUT_V, rows: rows, header: header, headerFill: hFill, headerColor: hCol, stripe: stripe,
      bodyFill: bodyFill, stripeColor: stripeColor, bodyColor: bodyColor, borderColor: borderColor, cellStyles: cellStyles,
      fs: L.fs, fs0: fs0, w: width, h: L.total, maxH: maxH, colW: L.colW, rowHs: L.rowH, rowH: L.total / rows.length,
      padX: PAD_X, padY: PAD_Y, lh: CELL_LH, fontOk: fontReady() };
    try { if (el.id) g.set('id', el.id); } catch (e) {}
    return g;
  }

  /* PPTX/PDF import uchun: spetsifikatsiyadan tayyor fabric JSON obyekti (jadval yoki grafik) */
  window.ssSpecToJSON = function (kind, spec) {
    try {
      var g = kind === 'table' ? buildTable(spec) : buildChart(Object.assign({}, spec, { chart: spec.chart }));
      return g.toObject(typeof SERIALIZE_PROPS !== 'undefined' ? SERIALIZE_PROPS : ['ssKind', 'ssSpec']);
    } catch (e) { console.warn('ssSpecToJSON:', e); return null; }
  };

  /* ------------------------------------------------------------------ Grafik */
  function arcPath(cx, cy, r, a0, a1, inner) {
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    if (!inner) return 'M ' + cx + ' ' + cy + ' L ' + x0 + ' ' + y0 + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + ' Z';
    var xi0 = cx + inner * Math.cos(a0), yi0 = cy + inner * Math.sin(a0), xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1);
    return 'M ' + x0 + ' ' + y0 + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 +
      ' L ' + xi1 + ' ' + yi1 + ' A ' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + xi0 + ' ' + yi0 + ' Z';
  }
  function fmt(v) { v = +v; return Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : (Math.round(v * 100) / 100).toString(); }

  /** Y o'qi: chiroyli qadam (backend/tg_decks.chart_axis bilan BIR XIL algoritm) — canvas, PPTX, PDF, HTML bir xil raqam ko'rsatadi. */
  function niceAxis(allv) {
    var vmax = Math.max.apply(null, allv.concat([0])), vmin = Math.min.apply(null, allv.concat([0]));
    if (vmax === vmin) vmax = vmin + 1;
    var span = vmax - vmin, step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    var ms = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < ms.length; i++) { if (span / (step * ms[i]) <= 5) { step *= ms[i]; break; } }
    var top = Math.ceil(vmax / step - 1e-9) * step;
    var bot = vmin < 0 ? Math.floor(vmin / step) * step : 0;
    var ticks = [];
    for (var v = bot, g = 0; v <= top + step * 1e-6 && g < 12; v += step, g++) ticks.push(Math.round(v / step * 1e6) / 1e6 * step);
    return { min: bot, max: top, step: step, ticks: ticks };
  }
  /** Matnni (left, top) qutisi bilan qo'yadi: markaz/o'ng chekka bo'yicha, fabric origin'iga TAYANMASDAN (guruh ichida ham aniq). */
  function placed(str, o, anchor, ax, cy) {
    var t = new fabric.Text(String(str), Object.assign({ fontFamily: FONT, selectable: false, evented: false, objectCaching: false }, o));
    var left = anchor === 'r' ? ax - t.width : (anchor === 'c' ? ax - t.width / 2 : ax);
    t.set({ left: left, top: cy - t.height / 2 });          // cy — qatorning VERTIKAL MARKAZI
    return t;
  }

  function buildChart(el) {
    var kind = String(el.chart || el.kind || 'bar').toLowerCase();
    var labels = (Array.isArray(el.labels) ? el.labels : []).map(String).slice(0, 12);
    var series = Array.isArray(el.series) && el.series.length ? el.series : [{ name: '', values: el.values || [] }];
    series = series.slice(0, 4).map(function (s) { return { name: String(s.name || ''), values: (s.values || []).map(function (v) { return +v || 0; }).slice(0, 12) }; });
    var n = Math.max(labels.length, series[0].values.length);
    if (!n) { labels = ['A', 'B', 'C']; series = [{ name: '', values: [30, 50, 20] }]; n = 3; }
    while (labels.length < n) labels.push(String(labels.length + 1));
    var colors = (Array.isArray(el.colors) && el.colors.length ? el.colors : PALETTE);
    var left = +el.left || 60, top = +el.top || 120, W = Math.max(260, Math.min(900, +el.width || 560)), H = Math.max(200, Math.min(420, +el.height || 340));
    var objs = [], ink = el.textColor || '#374151', axis = null;
    var y0 = 0;
    if (el.title) {
      var ttl = txt(el.title, { left: 0, top: 0, width: W, fontSize: 20, fontWeight: 'bold', fill: el.titleColor || '#111827' });
      objs.push(ttl); y0 = Math.ceil(ttl.height) + 8;
    }
    var ph = H - y0;
    if (kind === 'pie' || kind === 'donut' || kind === 'doughnut') {
      var vals = series[0].values.slice(0, n).map(function (v) { return Math.max(0, v); });
      var sumV = vals.reduce(function (a, b) { return a + b; }, 0) || 1;
      var R = Math.min(ph, W * 0.5) / 2 - 4, cx = R + 6, cy = y0 + ph / 2, a = -Math.PI / 2;
      vals.forEach(function (v, i) {
        var da = (v / sumV) * Math.PI * 2; if (da <= 0) return;
        var a1 = a + Math.min(da, Math.PI * 2 - 0.0001);
        objs.push(new fabric.Path(arcPath(cx, cy, R, a, a1, kind === 'pie' ? 0 : R * 0.55), { fill: colors[i % colors.length], stroke: '#ffffff', strokeWidth: 2, selectable: false, evented: false, objectCaching: false }));
        a += da;
      });
      var lx = cx + R + 28, rowStep = Math.min(26, Math.max(18, (ph - 10) / Math.max(1, n)));
      labels.slice(0, n).forEach(function (lb, i) {
        var ly = y0 + 10 + i * rowStep;
        objs.push(new fabric.Rect({ left: lx, top: ly + (rowStep - 14) / 2 - 2, width: 14, height: 14, rx: 3, ry: 3, fill: colors[i % colors.length], selectable: false, evented: false, objectCaching: false }));
        objs.push(placed(lb + '  ' + Math.round((vals[i] / sumV) * 100) + '%', { fontSize: 15, fill: ink }, 'l', lx + 22, ly + rowStep / 2 - 2));
      });
    } else {
      axis = niceAxis(series.reduce(function (acc, s) { return acc.concat(s.values.slice(0, n)); }, []));
      var YFS = 12;
      var padL = Math.ceil(Math.max.apply(null, axis.ticks.map(function (t) { return textW(fmt(t), YFS, false); }))) + 16;
      var slot = (W - padL - 6) / n;
      var xfs = Math.round(Math.min(14, Math.max(10, slot / 6)));
      var xlH = 0, xl = labels.slice(0, n).map(function (lb) {
        var t = txt(lb, { width: Math.max(10, slot - 4), fontSize: xfs, fill: ink }); xlH = Math.max(xlH, t.height); return t;
      });
      var legendH = series.length > 1 ? 26 : 0;
      var padT = y0 + legendH + 22;                                 // bar ustidagi qiymat yozuvi uchun joy
      var padB = Math.ceil(xlH) + 14;
      var plotH = Math.max(60, H - padT - padB), base = padT + plotH;
      var span = axis.max - axis.min;
      var py = function (v) { return base - ((v - axis.min) / span) * plotH; };
      axis.ticks.forEach(function (tv, gi) {
        var gy = py(tv);
        objs.push(new fabric.Line([padL, gy, W, gy], { stroke: Math.abs(tv) < 1e-9 ? '#9ca3af' : '#e5e7eb', strokeWidth: 1, selectable: false, evented: false, objectCaching: false }));
        objs.push(placed(fmt(tv), { fontSize: YFS, fill: el.textColor ? ink : '#6b7280' }, 'r', padL - 8, gy));        // v63: o'q raqamlari ham «Matn rangi» ga bo'ysunadi (to'q fonda ko'rinadi)
      });
      var zeroY = py(0);
      if (kind === 'line') {
        series.forEach(function (s, si) {
          var pts = s.values.slice(0, n).map(function (v, i) { return { x: padL + slot * i + slot / 2, y: py(v) }; });
          if (pts.length > 1) objs.push(new fabric.Polyline(pts, { fill: '', stroke: colors[si % colors.length], strokeWidth: 3, strokeLineJoin: 'round', selectable: false, evented: false, objectCaching: false }));
          pts.forEach(function (p, i) {
            objs.push(new fabric.Circle({ left: p.x - 5, top: p.y - 5, radius: 5, fill: '#ffffff', stroke: colors[si % colors.length], strokeWidth: 3, selectable: false, evented: false, objectCaching: false }));
            if (series.length === 1) objs.push(placed(fmt(s.values[i]), { fontSize: 12, fontWeight: 'bold', fill: ink }, 'c', p.x, p.y - 16));
          });
        });
      } else {
        var bw = Math.min(64, (slot * 0.72) / series.length);
        series.forEach(function (s, si) {
          s.values.slice(0, n).forEach(function (v, i) {
            var x = padL + slot * i + (slot - bw * series.length) / 2 + bw * si, yv = py(v);
            var bt = Math.min(yv, zeroY), bh = Math.max(1, Math.abs(zeroY - yv));
            objs.push(new fabric.Rect({ left: x, top: bt, width: bw - 2, height: bh, rx: 4, ry: 4, fill: colors[(series.length > 1 ? si : i) % colors.length], selectable: false, evented: false, objectCaching: false }));
            if (series.length === 1 || bw > 26) objs.push(placed(fmt(v), { fontSize: 12, fontWeight: 'bold', fill: ink }, 'c', x + (bw - 2) / 2, (v >= 0 ? bt - 11 : bt + bh + 11)));
          });
        });
      }
      xl.forEach(function (t, i) { t.set({ left: padL + slot * i + 2, top: base + 8 }); objs.push(t); });
      if (series.length > 1) {
        var lx2 = padL;
        series.forEach(function (s, si) {
          var nm = s.name || ('Qator ' + (si + 1)), tw = textW(nm, 13, false);
          objs.push(new fabric.Rect({ left: lx2, top: y0 + 4, width: 12, height: 12, rx: 3, ry: 3, fill: colors[si % colors.length], selectable: false, evented: false, objectCaching: false }));
          objs.push(placed(nm, { fontSize: 13, fill: ink }, 'l', lx2 + 18, y0 + 10));
          lx2 += 18 + tw + 22;
        });
      }
    }
    var grp = new fabric.Group(objs, { left: left, top: top, subTargetCheck: false, objectCaching: false });
    grp.ssKind = 'chart';
    grp.ssSpec = { v: LAYOUT_V, chart: kind === 'donut' ? 'doughnut' : kind, title: el.title || '', labels: labels.slice(0, n),
      series: series.map(function (s) { return { name: s.name, values: s.values.slice(0, n) }; }), colors: colors.slice(), textColor: ink,
      w: W, h: H, fontOk: fontReady() };
    if (axis) { grp.ssSpec.yMin = axis.min; grp.ssSpec.yMax = axis.max; grp.ssSpec.yStep = axis.step; }
    try { if (el.id) grp.set('id', el.id); } catch (e) {}
    return grp;
  }
  window.ssBuildTable = buildTable;
  window.ssBuildChart = buildChart;
  window.ssLayout = { LAYOUT_V: LAYOUT_V, CELL_LH: CELL_LH, PAD_X: PAD_X, PAD_Y: PAD_Y, niceAxis: niceAxis, layoutTable: layoutTable, fontReady: fontReady };

  /* ------------------------------------------------------------------ Eskirgan jadval/grafikni qayta qurish ----
   *  Qachon: (a) shrift yuklanmasdan o'lchangan (fontOk=false), (b) eski versiya (v<2: bir qatorli balandlik).
   *  Obyekt joyida almashtiriladi (o'rni, masshtabi, animatsiyasi, id saqlanadi).                                  */
  var KEEP = ['_oid', 'id', 'imageNumber', 'animName', 'animDur', 'animDelay', 'animLoop', 'opacity', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY', 'skewX', 'skewY', 'visible'];
  function needsRelayout(o) {
    var sp = o && o.ssSpec;
    if (!sp || (o.ssKind !== 'table' && o.ssKind !== 'chart')) return false;
    if (sp.v !== LAYOUT_V) return true;
    if (!sp.fontOk && fontReady()) return true;
    return false;
  }
  function relayoutObject(o) {
    var sp = o.ssSpec, ng;
    if (o.ssKind === 'table') ng = buildTable({ rows: sp.rows, header: sp.header, headerFill: sp.headerFill, headerColor: sp.headerColor, stripe: sp.stripe,
      bodyFill: sp.bodyFill, stripeColor: sp.stripeColor, bodyColor: sp.bodyColor, borderColor: sp.borderColor, cellStyles: sp.cellStyles,
      left: o.left, top: o.top, width: sp.w, maxH: sp.maxH || sp.h || 360, fs0: sp.fs0 || sp.fs });
    else ng = buildChart({ chart: sp.chart, title: sp.title, labels: sp.labels, series: sp.series, colors: sp.colors, textColor: sp.textColor,
      left: o.left, top: o.top, width: sp.w || o.width, height: sp.h || o.height });
    KEEP.forEach(function (k) { if (o[k] !== undefined) ng[k] = o[k]; });
    ng.set({ left: o.left, top: o.top });
    return ng;
  }
  var _rlBusy = false;
  window.ssRelayoutStale = function () {
    if (_rlBusy || typeof canvas === 'undefined' || !canvas) return 0;
    var n = 0;
    _rlBusy = true;
    try {
      var active = canvas.getActiveObject && canvas.getActiveObject();
      canvas.getObjects().slice().forEach(function (o) {
        if (o === active || !needsRelayout(o)) return;
        var idx = canvas.getObjects().indexOf(o), ng = relayoutObject(o);
        canvas.remove(o); canvas.insertAt(ng, idx, false); ng.setCoords(); n++;
      });
      if (n) {
        canvas.requestRenderAll();
        try { setTimeout(function () { saveCurrentSlideState(); }, 60); } catch (e) {}
      }
    } catch (e) { console.warn('[v49] relayout:', e); }
    finally { _rlBusy = false; }
    return n;
  };
  (function hookRelayout() {
    var t = null;
    function soon() { clearTimeout(t); t = setTimeout(window.ssRelayoutStale, 60); }
    try {
      if (document.fonts) {
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', soon);
        if (document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(soon);
      }
      // slayd yuklanganda (loadFromJSON tugagach) — eski jadvallar bir marta yangi layout'ga o'tadi
      var tries = 0, iv = setInterval(function () {
        if (typeof canvas !== 'undefined' && canvas && canvas.on) { clearInterval(iv); canvas.on('after:render', function () { if (!_rlBusy) soon(); }); }
        else if (++tries > 60) clearInterval(iv);
      }, 250);
    } catch (e) {}
  })();

  /* AI elements[] ichidagi table/chart ni tanitish */
  try {
    var orig = window.parseElementToFabric;
    if (typeof orig === 'function' && !orig.__v48) {
      var wrapped = async function (el) {
        try {
          if (el && el.type === 'table') { var t = buildTable(el); try { ensureObjectId(t); } catch (e) {} return t; }
          if (el && el.type === 'chart') { var c = buildChart(el); try { ensureObjectId(c); } catch (e) {} return c; }
        } catch (e) { console.warn('[v48] jadval/grafik:', e); return null; }
        return orig.apply(this, arguments);
      };
      wrapped.__v48 = true;
      window.parseElementToFabric = wrapped;
    }
  } catch (e) { console.warn('[v48] parseElementToFabric:', e); }

  /* ------------------------------------------------------------------ Qo'lda qo'shish (asboblar paneli) */
  function addToCanvas(obj) {
    try { ensureObjectId(obj); } catch (e) {}
    canvas.add(obj);
    try { obj.setCoords(); canvas.setActiveObject(obj); } catch (e) {}
    canvas.requestRenderAll();
    try { saveCurrentSlideState(); } catch (e) {}
    try { if (typeof recordGlobalState === 'function') recordGlobalState(); } catch (e) {}
  }
  function parseGrid(text) {
    return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)
      .map(function (l) { return l.split(/\t|;|,/).map(function (c) { return c.trim(); }); });
  }
  window.ssInsertTable = async function () {
    var r = await Swal.fire({
      title: 'Jadval', html: '<div style="text-align:left;font-size:13px;margin-bottom:6px">Har qator — yangi satr, ustunlar vergul bilan. Birinchi qator — sarlavha.</div>' +
        '<textarea id="ssTblIn" class="swal2-textarea" style="height:150px;margin:0;width:100%">Oy,Sotuv,O\'sish\nYanvar,120,5%\nFevral,150,25%\nMart,190,27%</textarea>',
      showCancelButton: true, confirmButtonText: 'Qo\'shish', cancelButtonText: 'Bekor',
      preConfirm: function () { return document.getElementById('ssTblIn').value; }
    });
    if (!r.isConfirmed) return;
    var rows = parseGrid(r.value);
    if (rows.length) addToCanvas(buildTable({ rows: rows }));
  };
  window.ssInsertChart = async function () {
    var r = await Swal.fire({
      title: 'Grafik', html: '<select id="ssChT" class="swal2-select" style="width:100%;margin:0 0 8px"><option value="bar">Ustunli</option><option value="line">Chiziqli</option><option value="pie">Doira</option><option value="donut">Halqa</option></select>' +
        '<div style="text-align:left;font-size:13px;margin-bottom:6px">Har qator: <b>nom, qiymat</b></div>' +
        '<textarea id="ssChIn" class="swal2-textarea" style="height:130px;margin:0;width:100%">Yanvar,120\nFebral,150\nMart,190\nAprel,170</textarea>' +
        '<input id="ssChTi" class="swal2-input" style="margin:8px 0 0;width:100%" placeholder="Sarlavha (ixtiyoriy)">',
      showCancelButton: true, confirmButtonText: 'Qo\'shish', cancelButtonText: 'Bekor',
      preConfirm: function () { return { kind: document.getElementById('ssChT').value, text: document.getElementById('ssChIn').value, title: document.getElementById('ssChTi').value }; }
    });
    if (!r.isConfirmed) return;
    var g = parseGrid(r.value.text);
    if (g.length) addToCanvas(buildChart({ chart: r.value.kind, title: r.value.title, labels: g.map(function (x) { return x[0]; }), values: g.map(function (x) { return parseFloat(String(x[1] || '0').replace(/[^\d.\-]/g, '')) || 0; }) }));
  };
  function addToolbarButtons() {
    var anim = document.querySelector('.tb-btn[title="Animatsiya"]');
    if (!anim || document.getElementById('ssTblBtn')) return !!document.getElementById('ssTblBtn');
    [['ssTblBtn', 'Jadval', 'table_chart', 'ssInsertTable()'], ['ssChBtn', 'Grafik', 'bar_chart', 'ssInsertChart()']].forEach(function (b) {
      var el = document.createElement('button');
      el.className = 'tb-btn'; el.id = b[0]; el.title = b[1]; el.setAttribute('onclick', b[3]);
      el.innerHTML = '<span class="material-symbols-outlined">' + b[2] + '</span>';
      anim.parentNode.insertBefore(el, anim);
    });
    return true;
  }
  var tries = 0, iv = setInterval(function () { if (addToolbarButtons() || ++tries > 40) clearInterval(iv); }, 500);

  /* ------------------------------------------------------------------ «O'tish» — alohida tugma va panel (Animatsiya panelidan ajratilgan) */
  var pcss = document.createElement('style');
  pcss.textContent = [
    '#ssTrPanel{position:fixed;top:112px;right:18px;z-index:2600;width:264px;background:#fff;color:#1f2937;border:1px solid #dadce0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.2);padding:14px;font-family:inherit}',
    '#ssTrPanel h4{margin:0 0 4px;font-size:14px;display:flex;align-items:center;justify-content:space-between}',
    '#ssTrPanel p{margin:0 0 10px;font-size:12px;color:#6b7280;line-height:1.4}',
    '#ssTrPanel .trg{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    '#ssTrPanel button.t{border:1px solid #dadce0;background:#fff;border-radius:9px;padding:8px 6px;font-size:13px;cursor:pointer}',
    '#ssTrPanel button.t:hover{background:#f1f3f4}#ssTrPanel button.t.on{background:#e8f0fe;border-color:#1a73e8;color:#1a56db;font-weight:700}',
    '#ssTrPanel .acts{display:flex;gap:6px;margin-top:10px}#ssTrPanel .acts button{flex:1;border:0;border-radius:9px;padding:8px;font-size:12.5px;cursor:pointer;background:#1a73e8;color:#fff}',
    '#ssTrPanel .acts button.g{background:#f1f3f4;color:#1f2937}',
    '#ssTrPanel{max-height:calc(100vh - 140px);overflow:auto}#ssTrPanel .trh{margin:10px 0 5px;font-size:11.5px;font-weight:600;color:#6b7280}#ssTrPanel input[type=range]{width:100%}#ssTrPanel input[type=number]{width:100%;padding:6px 8px;border:1px solid #dadce0;border-radius:8px}',
    '#ssTrPanel .x{border:0;background:transparent;font-size:20px;cursor:pointer;color:#5f6368;line-height:1}',
    (window.SS_TR ? window.SS_TR.css('.canvas-container.ss-prev-', '.ss-prev-out-') : ''),
    '@media (max-width:640px){#ssTrPanel{top:auto;bottom:70px;right:10px;left:10px;width:auto}}'
  ].join('\n');
  document.head.appendChild(pcss);

  var _prevTimer = null;
  function previewTransition(name) {
    var nm = name || 'fade';
    var host = document.querySelector('.canvas-container');
    if (!host || nm === 'none') return;
    var s = curSlide() || {}, dur = window.SS_TR ? SS_TR.clampDur(s.transDur, 0.7) : 0.7;
    (window.SS_TR ? SS_TR.list : []).forEach(function (x) { host.classList.remove('ss-prev-' + x.k); });
    host.style.setProperty('--trd', dur + 's');
    void host.offsetWidth;
    host.classList.add('ss-prev-' + nm);
    clearTimeout(_prevTimer);
    _prevTimer = setTimeout(function () { host.classList.remove('ss-prev-' + nm); }, dur * 1000 + 150);
  }
  function renderTrPanel() {
    var p = document.getElementById('ssTrPanel'); if (!p) return;
    var s = curSlide() || {}, cur = s.transition || '';
    var dur = window.SS_TR ? SS_TR.clampDur(s.transDur, 0.7) : 0.7, auto = s.transAuto > 0 ? s.transAuto : 0;
    var groups = {}, order = [];
    TRANSITIONS.forEach(function (t) { var g = t[2] || ''; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(t); });
    var btns = function (arr) { return '<div class="trg">' + arr.map(function (t) { return '<button class="t' + (cur === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>'; };
    p.innerHTML = '<h4>Varaq o\'tishi <button class="x" onclick="ssCloseTrPanel()" aria-label="Yopish">×</button></h4>' +
      '<p>Namoyishda va PowerPoint (.pptx) da varaq shu effekt bilan almashadi. Elementlar animatsiyasi alohida — «Animatsiya».</p>' +
      order.map(function (g) { return (g ? '<div class="trh">' + g + '</div>' : '') + btns(groups[g]); }).join('') +
      '<div class="trh">Davomiyligi: <b id="ssTrDurV">' + dur.toFixed(1) + ' s</b></div>' +
      '<input type="range" id="ssTrDur" min="0.2" max="5" step="0.1" value="' + dur + '">' +
      '<div class="trh">Avtomatik o\'tish (soniya, 0 = faqat bosganda)</div>' +
      '<input type="number" id="ssTrAuto" min="0" max="600" step="0.5" value="' + auto + '">' +
      '<div class="acts"><button class="g" data-a="all">Hamma varaqqa</button><button data-a="prev">Ko\'rish</button></div>';
    Array.prototype.forEach.call(p.querySelectorAll('button.t'), function (b) {
      b.onclick = function () { var t = b.getAttribute('data-t'); ssSetTransition(t); previewTransition(t || 'fade'); renderTrPanel(); };
    });
    var rng = p.querySelector('#ssTrDur'), rv = p.querySelector('#ssTrDurV');
    rng.oninput = function () { rv.textContent = parseFloat(rng.value).toFixed(1) + ' s'; };
    rng.onchange = function () { ssSetTransition(null, false, null, { dur: rng.value }); previewTransition(((curSlide() || {}).transition) || 'fade'); };
    p.querySelector('#ssTrAuto').onchange = function () { ssSetTransition(null, false, null, { auto: this.value }); };
    p.querySelector('[data-a="all"]').onclick = function () { ssSetTransition(null, true); renderTrPanel(); };
    p.querySelector('[data-a="prev"]').onclick = function () { previewTransition(((curSlide() || {}).transition) || 'fade'); };
  }
  window.ssCloseTrPanel = function () { var p = document.getElementById('ssTrPanel'); if (p) p.remove(); };
  window.ssToggleTrPanel = function (e) {
    try { if (e && e.stopPropagation) e.stopPropagation(); } catch (er) {}
    var p = document.getElementById('ssTrPanel');
    if (p) { p.remove(); return; }
    p = document.createElement('div'); p.id = 'ssTrPanel';
    document.body.appendChild(p);
    renderTrPanel();
  };
  function rerenderPanel2() { try { renderTrPanel(); } catch (e) {} }
  // v49.2: panel faqat × bilan yopiladi (Animatsiya paneli kabi); varaq almashsa tanlov yangilanadi
  var _trLast = null;
  setInterval(function () {
    var p = document.getElementById('ssTrPanel'); if (!p) { _trLast = null; return; }
    var s = curSlide(), k = (typeof activeIndex !== 'undefined' ? activeIndex : '') + '|' + ((s && s.transition) || '');
    if (k !== _trLast) { _trLast = k; renderTrPanel(); }
  }, 400);
  function addTransitionButtons() {
    var ok = false;
    var anim = document.querySelector('.tb-btn[title="Animatsiya"]');
    if (anim && !document.getElementById('ssTrBtn')) {
      var b = document.createElement('button');
      b.className = 'tb-btn'; b.id = 'ssTrBtn'; b.title = "Varaq o'tishi (ochilish effekti)"; b.setAttribute('onclick', 'ssToggleTrPanel(event)');
      b.innerHTML = '<span class="material-symbols-outlined">auto_awesome_motion</span>';
      anim.parentNode.insertBefore(b, anim.nextSibling);
      ok = true;
    }
    var top = document.querySelector('.top-menu-anim');
    if (top && !document.getElementById('ssTrTop')) {
      var t = document.createElement('div');
      t.className = 'top-menu-item'; t.id = 'ssTrTop'; t.title = "Varaq o'tishi (ochilish effekti)"; t.setAttribute('onclick', 'ssToggleTrPanel(event)');
      t.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">auto_awesome_motion</span> O\'tish';
      top.parentNode.insertBefore(t, top.nextSibling);
    }
    return ok || !!document.getElementById('ssTrBtn');
  }
  var tries2 = 0, iv2 = setInterval(function () { if (addTransitionButtons() || ++tries2 > 40) clearInterval(iv2); }, 500);
})();
