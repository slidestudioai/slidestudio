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
  var TRANSITIONS = [['', 'Standart'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['flip', 'Flip'], ['up', 'Pastdan'], ['blur', 'Blur'], ['none', "Yo'q"]];

  /* ------------------------------------------------------------------ CSS */
  var css = document.createElement('style');
  css.id = 'ssV48Css';
  css.textContent = [
    '@keyframes ssTrFade{from{opacity:0}to{opacity:1}}',
    '@keyframes ssTrZoom{from{opacity:0;transform:scale(.86)}to{opacity:1;transform:scale(1)}}',
    '@keyframes ssTrFlip{from{opacity:0;transform:perspective(900px) rotateY(80deg)}to{opacity:1;transform:perspective(900px) rotateY(0)}}',
    '@keyframes ssTrUp{from{opacity:0;transform:translateY(48px)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes ssTrBlur{from{opacity:0;filter:blur(14px)}to{opacity:1;filter:blur(0)}}',
    '.presentation-overlay .pres-tr-fade{animation:ssTrFade .6s ease both}',
    '.presentation-overlay .pres-tr-zoom{animation:ssTrZoom .55s cubic-bezier(.22,.61,.36,1) both}',
    '.presentation-overlay .pres-tr-flip{animation:ssTrFlip .7s cubic-bezier(.22,.61,.36,1) both}',
    '.presentation-overlay .pres-tr-up{animation:ssTrUp .5s cubic-bezier(.22,.61,.36,1) both}',
    '.presentation-overlay .pres-tr-blur{animation:ssTrBlur .6s ease both}',
    '@media (prefers-reduced-motion:reduce){.presentation-overlay [class*="pres-tr-"]{animation:none}}',
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
  window.ssSetTransition = function (name, all, index) {
    try {
      var valid = TRANSITIONS.some(function (t) { return t[0] === (name || ''); });
      if (name != null && !valid) return false;
      if (all) {
        var base = (curSlide() || {}).transition || '';
        slides.forEach(function (s) { s.transition = base; });
        try { showToast('Hamma slaydga qo\'llandi', 'info'); } catch (e) {}
      } else {
        var s = (index != null && slides[index]) ? slides[index] : curSlide();
        if (!s) return false;
        s.transition = name || '';
        try { hasUnsavedChanges = true; } catch (e) {}
        try { showToast(name ? ('Slayd o\'tishi: ' + name) : 'Standart o\'tish', 'info'); } catch (e) {}
      }
      rerenderPanel();
      return true;
    } catch (e) { return false; }
  };
  /* Namoyish: hozirgi slaydning o'tishini qo'llaydi (10_export_present.js dan chaqiriladi) */
  window.ssApplyPresTransition = function (stage, slide) {
    try {
      if (!stage) return;
      stage.className = String(stage.className || '').replace(/\bpres-tr-\S+/g, '').replace(/\s+/g, ' ').trim();
      var t = slide && slide.transition;
      if (!t) return;
      stage.classList.remove('pres-anim-next', 'pres-anim-prev');
      if (t !== 'none') { void stage.offsetWidth; stage.classList.add('pres-tr-' + t); }
    } catch (e) {}
  };

  /* ------------------------------------------------------------------ Jadval */
  function txt(s, o) {
    return new fabric.Textbox(String(s == null ? '' : s), Object.assign({
      fontFamily: 'Roboto', fontSize: 18, fill: '#1f2937', textAlign: 'center', splitByGrapheme: false,
      lineHeight: 1.15, selectable: false, evented: false
    }, o || {}));
  }
  function buildTable(el) {
    var rows = Array.isArray(el.rows) ? el.rows.filter(function (r) { return Array.isArray(r) && r.length; }) : [];
    if (!rows.length) rows = [['Ustun 1', 'Ustun 2'], ['—', '—']];
    rows = rows.slice(0, 14);
    var cols = Math.min(8, Math.max.apply(null, rows.map(function (r) { return r.length; })));
    var left = +el.left || 60, top = +el.top || 130, width = Math.max(240, Math.min(900, +el.width || 840));
    var maxH = Math.max(120, Math.min(420, +el.height || 360));
    var header = el.header !== false;
    var fs = Math.max(11, Math.min(26, +el.fontSize || (rows.length > 7 ? 14 : (cols > 4 ? 15 : 18))));
    var rowH = Math.max(fs * 1.9, Math.min(fs * 2.6, maxH / rows.length));
    var colW = width / cols;
    var hFill = el.headerFill || '#1a73e8', hCol = el.headerColor || '#ffffff', stripe = el.stripe !== false;
    var objs = [];
    rows.forEach(function (r, ri) {
      var isH = header && ri === 0;
      for (var ci = 0; ci < cols; ci++) {
        var x = ci * colW, y = ri * rowH;
        objs.push(new fabric.Rect({
          left: x, top: y, width: colW, height: rowH, selectable: false, evented: false,
          fill: isH ? hFill : (stripe && ri % 2 === 0 ? '#f1f5f9' : '#ffffff'), stroke: '#dbe1ea', strokeWidth: 1
        }));
        var tb = txt(r[ci], {
          left: x + 6, top: y + (rowH - fs * 1.15) / 2, width: colW - 12, fontSize: fs,
          fontWeight: isH ? 'bold' : 'normal', fill: isH ? hCol : '#1f2937', textAlign: ci === 0 && !isH ? 'left' : 'center'
        });
        objs.push(tb);
      }
    });
    var g = new fabric.Group(objs, { left: left, top: top, subTargetCheck: false, objectCaching: true });
    g.ssKind = 'table';
    g.ssSpec = { rows: rows.map(function (r) { var o = []; for (var c = 0; c < cols; c++) o.push(String(r[c] == null ? '' : r[c])); return o; }),
      header: header, headerFill: hFill, headerColor: hCol, stripe: stripe, fs: fs, w: width, rowH: rowH };
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
    var objs = [], font = 'Roboto', ink = el.textColor || '#374151';
    if (el.title) objs.push(txt(el.title, { left: 0, top: 0, width: W, fontSize: 20, fontWeight: 'bold', fill: el.titleColor || '#111827' }));
    var y0 = el.title ? 34 : 0, ph = H - y0;
    if (kind === 'pie' || kind === 'donut' || kind === 'doughnut') {
      var vals = series[0].values.slice(0, n).map(function (v) { return Math.max(0, v); });
      var sum = vals.reduce(function (a, b) { return a + b; }, 0) || 1;
      var R = Math.min(ph, W * 0.5) / 2 - 4, cx = R + 6, cy = y0 + ph / 2, a = -Math.PI / 2;
      vals.forEach(function (v, i) {
        var da = (v / sum) * Math.PI * 2; if (da <= 0) return;
        var a1 = a + Math.min(da, Math.PI * 2 - 0.0001);
        objs.push(new fabric.Path(arcPath(cx, cy, R, a, a1, kind === 'pie' ? 0 : R * 0.55), { fill: colors[i % colors.length], stroke: '#ffffff', strokeWidth: 2, selectable: false, evented: false }));
        a += da;
      });
      var lx = cx + R + 28;
      labels.slice(0, n).forEach(function (lb, i) {
        var ly = y0 + 10 + i * 24;
        objs.push(new fabric.Rect({ left: lx, top: ly + 3, width: 14, height: 14, rx: 3, ry: 3, fill: colors[i % colors.length], selectable: false, evented: false }));
        objs.push(txt(lb + '  ' + Math.round((vals[i] / sum) * 100) + '%', { left: lx + 22, top: ly, width: Math.max(80, W - lx - 26), fontSize: 15, textAlign: 'left', fill: ink }));
      });
    } else {
      var padL = 44, padB = 34, cw = W - padL - 6, chH = ph - padB - 14, base = y0 + 14 + chH;
      var maxV = Math.max(1, Math.max.apply(null, series.reduce(function (a, s) { return a.concat(s.values); }, [])));
      var step = Math.pow(10, Math.floor(Math.log10(maxV))), top5 = Math.ceil(maxV / step) * step;
      if (top5 / step < 3) top5 = Math.ceil(maxV / (step / 2)) * (step / 2);
      for (var g = 0; g <= 4; g++) {
        var gy = base - (chH * g) / 4;
        objs.push(new fabric.Line([padL, gy, W, gy], { stroke: g === 0 ? '#9ca3af' : '#e5e7eb', strokeWidth: 1, selectable: false, evented: false }));
        objs.push(txt(fmt((top5 * g) / 4), { left: 0, top: gy - 8, width: padL - 6, fontSize: 12, textAlign: 'right', fill: '#6b7280' }));
      }
      var slot = cw / n;
      if (kind === 'line') {
        series.forEach(function (s, si) {
          var pts = s.values.slice(0, n).map(function (v, i) { return { x: padL + slot * i + slot / 2, y: base - (v / top5) * chH }; });
          if (pts.length > 1) objs.push(new fabric.Polyline(pts, { fill: '', stroke: colors[si % colors.length], strokeWidth: 3, strokeLineJoin: 'round', selectable: false, evented: false }));
          pts.forEach(function (p, i) {
            objs.push(new fabric.Circle({ left: p.x - 5, top: p.y - 5, radius: 5, fill: '#ffffff', stroke: colors[si % colors.length], strokeWidth: 3, selectable: false, evented: false }));
            if (series.length === 1) objs.push(txt(fmt(s.values[i]), { left: p.x - 30, top: p.y - 26, width: 60, fontSize: 12, fill: ink, fontWeight: 'bold' }));
          });
        });
      } else {
        var bw = Math.min(64, (slot * 0.72) / series.length);
        series.forEach(function (s, si) {
          s.values.slice(0, n).forEach(function (v, i) {
            var h = Math.max(1, (v / top5) * chH), x = padL + slot * i + (slot - bw * series.length) / 2 + bw * si;
            objs.push(new fabric.Rect({ left: x, top: base - h, width: bw - 2, height: h, rx: 4, ry: 4, fill: colors[(series.length > 1 ? si : i) % colors.length], selectable: false, evented: false }));
            if (series.length === 1 || bw > 26) objs.push(txt(fmt(v), { left: x - 12, top: base - h - 20, width: bw + 22, fontSize: 12, fontWeight: 'bold', fill: ink }));
          });
        });
      }
      labels.slice(0, n).forEach(function (lb, i) {
        objs.push(txt(lb, { left: padL + slot * i, top: base + 6, width: slot, fontSize: Math.min(14, Math.max(10, slot / 6)), fill: ink }));
      });
      if (series.length > 1) {
        series.forEach(function (s, si) {
          var lx2 = padL + si * 130;
          objs.push(new fabric.Rect({ left: lx2, top: y0 - 12 + (el.title ? 0 : 0), width: 12, height: 12, rx: 3, ry: 3, fill: colors[si % colors.length], selectable: false, evented: false }));
          objs.push(txt(s.name || ('Qator ' + (si + 1)), { left: lx2 + 18, top: y0 - 14, width: 110, fontSize: 13, textAlign: 'left', fill: ink }));
        });
      }
    }
    var grp = new fabric.Group(objs, { left: left, top: top, subTargetCheck: false, objectCaching: true });
    grp.ssKind = 'chart';
    grp.ssSpec = { chart: kind === 'donut' ? 'doughnut' : kind, title: el.title || '', labels: labels.slice(0, n), series: series.map(function (s) { return { name: s.name, values: s.values.slice(0, n) }; }), colors: colors.slice(), textColor: ink };
    try { if (el.id) grp.set('id', el.id); } catch (e) {}
    return grp;
  }
  window.ssBuildTable = buildTable;
  window.ssBuildChart = buildChart;

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
    '#ssTrPanel .x{border:0;background:transparent;font-size:20px;cursor:pointer;color:#5f6368;line-height:1}',
    '.ss-prev-fade{animation:ssTrFade .7s ease both}.ss-prev-zoom{animation:ssTrZoom .65s cubic-bezier(.22,.61,.36,1) both}.ss-prev-flip{animation:ssTrFlip .8s cubic-bezier(.22,.61,.36,1) both}',
    '.ss-prev-up{animation:ssTrUp .6s cubic-bezier(.22,.61,.36,1) both}.ss-prev-blur{animation:ssTrBlur .7s ease both}',
    '@media (max-width:640px){#ssTrPanel{top:auto;bottom:70px;right:10px;left:10px;width:auto}}'
  ].join('\n');
  document.head.appendChild(pcss);

  function previewTransition(name) {
    var nm = name || 'fade';
    var host = document.querySelector('.canvas-container');
    if (!host || nm === 'none') return;
    ['fade', 'zoom', 'flip', 'up', 'blur'].forEach(function (k) { host.classList.remove('ss-prev-' + k); });
    void host.offsetWidth;
    host.classList.add('ss-prev-' + nm);
    setTimeout(function () { host.classList.remove('ss-prev-' + nm); }, 1000);
  }
  function renderTrPanel() {
    var p = document.getElementById('ssTrPanel'); if (!p) return;
    var s = curSlide(), cur = (s && s.transition) || '';
    p.innerHTML = '<h4>Varaq ochilish effekti <button class="x" onclick="ssCloseTrPanel()" aria-label="Yopish">×</button></h4>' +
      '<p>Namoyishda varaqning o\'zi shu effekt bilan ochiladi (birinchi varaq paydo bo\'lgandek). Elementlar animatsiyasi alohida — «Animatsiya».</p>' +
      '<div class="trg">' + TRANSITIONS.map(function (t) {
        return '<button class="t' + (cur === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="acts"><button class="g" data-a="all">Hamma varaqqa</button><button data-a="prev">Ko\'rish</button></div>';
    Array.prototype.forEach.call(p.querySelectorAll('button.t'), function (b) {
      b.onclick = function () { var t = b.getAttribute('data-t'); ssSetTransition(t); previewTransition(t); renderTrPanel(); };
    });
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
  var _origSet = window.ssSetTransition;
  window.ssSetTransition = function () { var r = _origSet.apply(this, arguments); rerenderPanel2(); return r; };
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
