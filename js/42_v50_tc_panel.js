/* v50 — JADVAL va GRAFIK (statistika) tahrir paneli.
 *  Jadval yoki grafikka BIR marta bosilsa, shakldagi kabi tahrir paneli ochiladi:
 *   • Jadval: sarlavha/matn/zebra/chegara ranglari, shrift, har bir katak qiymati, TANLANGAN katakning alohida rangi,
 *             qator/ustun qo'shish-o'chirish
 *   • Grafik: turi (ustun/chiziq/doira/donut), sarlavha, matn rangi, har bir ustun/bo'lak uchun alohida rang,
 *             yorliq va raqamlarni tahrirlash, qator qo'shish-o'chirish
 *  Obyekt joyida qayta quriladi (o'rni, masshtabi, animatsiyasi, id saqlanadi) va PPTX / PDF / HTML ga shu holicha chiqadi.
 */
(function () {
  'use strict';
  if (window.__ssV50Tc) return;
  window.__ssV50Tc = true;

  var PAL = ['#4f8cff', '#f5a524', '#2fbf71', '#ef4f5f', '#9b5de5', '#00bbf9', '#f15bb5', '#8ac926'];
  var KEEP = ['_oid', 'id', 'imageNumber', 'animName', 'animDur', 'animDelay', 'animLoop', 'opacity', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY', 'skewX', 'skewY', 'visible'];
  var panel = null, cur = null, busy = false, selCell = null, debounceT = null, lastKey = '';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function hex(c, d) {
    c = String(c || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
    var m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c);
    if (m) return '#' + [m[1], m[2], m[3]].map(function (v) { return ('0' + Math.max(0, Math.min(255, +v)).toString(16)).slice(-2); }).join('');
    return d || '#000000';
  }
  function isTC(o) { return !!o && (o.ssKind === 'table' || o.ssKind === 'chart') && !!o.ssSpec && o.type !== 'activeSelection'; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  /* ------------------------------------------------------------------ CSS */
  var st = document.createElement('style');
  st.textContent = [
    '#ssTcPanel{position:fixed;top:112px;right:18px;z-index:2500;width:312px;max-height:calc(100vh - 140px);overflow:auto;background:#fff;color:#1f2937;border:1px solid #dadce0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.22);padding:12px 14px 14px;font:13px/1.35 inherit;font-family:inherit}',
    '#ssTcPanel h4{margin:0 0 8px;font-size:14px;display:flex;align-items:center;justify-content:space-between}',
    '#ssTcPanel .x{border:0;background:transparent;font-size:20px;cursor:pointer;color:#5f6368;line-height:1}',
    '#ssTcPanel .sec{margin:10px 0 4px;font-size:11.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em}',
    '#ssTcPanel .row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0}',
    '#ssTcPanel .row label{flex:1;font-size:12.5px}',
    '#ssTcPanel input[type=color]{width:34px;height:26px;padding:0;border:1px solid #dadce0;border-radius:6px;background:#fff;cursor:pointer}',
    '#ssTcPanel input[type=range]{flex:1.4}',
    '#ssTcPanel input[type=text],#ssTcPanel input[type=number],#ssTcPanel select{width:100%;padding:5px 7px;border:1px solid #dadce0;border-radius:7px;font-size:12.5px;background:#fff;color:inherit;box-sizing:border-box}',
    '#ssTcPanel .grid{overflow:auto;max-height:220px;border:1px solid #e5e7eb;border-radius:8px;padding:4px}',
    '#ssTcPanel .grid table{border-collapse:separate;border-spacing:3px;width:100%}',
    '#ssTcPanel .grid td{padding:0}',
    '#ssTcPanel .grid input[type=text],#ssTcPanel .grid input[type=number]{min-width:58px;padding:4px 5px}',
    '#ssTcPanel .grid input.sel{outline:2px solid #1a73e8;border-color:#1a73e8}',
    '#ssTcPanel .btns{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}',
    '#ssTcPanel .btns button{flex:1 1 44%;border:1px solid #dadce0;background:#f8f9fa;border-radius:8px;padding:6px 4px;font-size:12px;cursor:pointer;color:inherit}',
    '#ssTcPanel .btns button:hover{background:#eef2ff;border-color:#1a73e8}',
    '#ssTcPanel .hint{font-size:11.5px;color:#6b7280;margin:4px 0}',
    '#ssTcPanel .rm{border:0;background:transparent;color:#d93025;cursor:pointer;font-size:16px;padding:0 4px}',
    '@media (max-width:640px){#ssTcPanel{top:auto;bottom:70px;right:8px;left:8px;width:auto;max-height:46vh}}'
  ].join('\n');
  document.head.appendChild(st);

  /* ------------------------------------------------------------------ qayta qurish */
  function buildFrom(o, sp) {
    if (o.ssKind === 'table') {
      return window.ssBuildTable({ rows: sp.rows, header: sp.header, headerFill: sp.headerFill, headerColor: sp.headerColor, stripe: sp.stripe,
        bodyFill: sp.bodyFill, stripeColor: sp.stripeColor, bodyColor: sp.bodyColor, borderColor: sp.borderColor, cellStyles: sp.cellStyles,
        left: o.left, top: o.top, width: sp.w, maxH: sp.maxH || sp.h || 360, fs0: sp.fs0 || sp.fs });
    }
    return window.ssBuildChart({ chart: sp.chart, title: sp.title, labels: sp.labels, series: sp.series, colors: sp.colors, textColor: sp.textColor,
      left: o.left, top: o.top, width: sp.w || o.width, height: sp.h || o.height });
  }
  function replaceObj(o, sp) {
    var ng = buildFrom(o, sp);
    KEEP.forEach(function (k) { if (o[k] !== undefined) ng[k] = o[k]; });
    ng.set({ left: o.left, top: o.top });
    var idx = canvas.getObjects().indexOf(o);
    busy = true;
    try {
      canvas.remove(o);
      canvas.insertAt(ng, idx < 0 ? canvas.getObjects().length : idx, false);
      ng.setCoords();
      canvas.setActiveObject(ng);
      canvas.requestRenderAll();
    } finally { busy = false; }
    cur = ng;
    try { saveCurrentSlideState(); } catch (e) {}
    try { if (typeof recordGlobalState === 'function') recordGlobalState(); } catch (e) {}
    return ng;
  }
  /** patch — spec'ning o'zgargan maydonlari. structural=true bo'lsa panel qayta chiziladi. */
  function apply(patch, structural, now) {
    if (!isTC(cur)) return;
    var run = function () {
      var sp = Object.assign({}, clone(cur.ssSpec), patch);
      if (cur.ssKind === 'table') { sp.fs0 = patch.fs0 != null ? patch.fs0 : (cur.ssSpec.fs0 || cur.ssSpec.fs); sp.maxH = Math.max(sp.maxH || 0, 360); }
      replaceObj(cur, sp);
      if (structural) render();
    };
    clearTimeout(debounceT);
    if (now) run(); else debounceT = setTimeout(run, 140);
  }

  /* ------------------------------------------------------------------ panel */
  function close() { if (panel) { panel.remove(); panel = null; } cur = null; selCell = null; lastKey = ''; }
  function colorRow(label, id, val) { return '<div class="row"><label for="' + id + '">' + label + '</label><input type="color" id="' + id + '" value="' + hex(val) + '"></div>'; }

  function renderTable() {
    var sp = cur.ssSpec, rows = sp.rows, cols = rows[0].length;
    var cs = sp.cellStyles || {};
    var gridHtml = '<table>' + rows.map(function (r, ri) {
      return '<tr>' + r.map(function (c, ci) {
        var on = selCell && selCell.r === ri && selCell.c === ci;
        return '<td><input type="text" data-r="' + ri + '" data-c="' + ci + '" class="' + (on ? 'sel' : '') + '" value="' + esc(c) + '"></td>';
      }).join('') + '</tr>';
    }).join('') + '</table>';
    var sel = selCell && rows[selCell.r] && rows[selCell.r][selCell.c] != null ? (cs[selCell.r + ',' + selCell.c] || {}) : null;
    panel.innerHTML = '<h4>Jadval <button class="x" id="ssTcX" aria-label="Yopish">×</button></h4>' +
      '<div class="sec">Ranglar</div>' +
      colorRow('Sarlavha foni', 'tcHF', sp.headerFill) + colorRow('Sarlavha matni', 'tcHC', sp.headerColor) +
      colorRow('Katak foni', 'tcBF', sp.bodyFill) + colorRow('Matn rangi (raqamlar)', 'tcBC', sp.bodyColor) +
      '<div class="row"><label for="tcSt">Zebra (oralatib bo\'yash)</label><input type="checkbox" id="tcSt"' + (sp.stripe !== false ? ' checked' : '') + '></div>' +
      colorRow('Zebra rangi', 'tcSC', sp.stripeColor) + colorRow('Chegara rangi', 'tcBR', sp.borderColor) +
      '<div class="row"><label>Shrift: <b id="tcFsV">' + Math.round(sp.fs) + '</b></label><input type="range" id="tcFs" min="10" max="28" step="1" value="' + Math.round(sp.fs0 || sp.fs) + '"></div>' +
      '<div class="sec">Ma\'lumotlar (katakni bosing)</div><div class="grid">' + gridHtml + '</div>' +
      '<div class="btns"><button data-a="addR">+ Qator</button><button data-a="delR">− Qator</button><button data-a="addC">+ Ustun</button><button data-a="delC">− Ustun</button></div>' +
      '<div class="sec">Tanlangan katak' + (selCell ? ' (' + (selCell.r + 1) + '-qator, ' + (selCell.c + 1) + '-ustun)' : '') + '</div>' +
      (sel ? colorRow('Katak foni', 'tcCF', sel.fill || (selCell.r === 0 && sp.header !== false ? sp.headerFill : (sp.stripe !== false && selCell.r % 2 === 0 ? sp.stripeColor : sp.bodyFill))) +
        colorRow('Katak matni', 'tcCC', sel.color || (selCell.r === 0 && sp.header !== false ? sp.headerColor : sp.bodyColor)) +
        '<div class="row"><label for="tcCB">Qalin</label><input type="checkbox" id="tcCB"' + (sel.bold ? ' checked' : '') + '></div>' +
        '<div class="btns"><button data-a="clrCell">Katak rangini tozalash</button><button data-a="clrAll">Hamma katak ranglarini tozalash</button></div>'
        : '<div class="hint">Alohida rang berish uchun jadvaldagi katakka bosing.</div>');
    $('ssTcX').onclick = close;
    var bind = function (id, fn, evt) { var e = $(id); if (e) e.addEventListener(evt || 'input', function () { fn(e); }); };
    bind('tcHF', function (e) { apply({ headerFill: e.value }); });
    bind('tcHC', function (e) { apply({ headerColor: e.value }); });
    bind('tcBF', function (e) { apply({ bodyFill: e.value }); });
    bind('tcBC', function (e) { apply({ bodyColor: e.value }); });
    bind('tcSC', function (e) { apply({ stripeColor: e.value }); });
    bind('tcBR', function (e) { apply({ borderColor: e.value }); });
    bind('tcSt', function (e) { apply({ stripe: e.checked }, true, true); }, 'change');
    bind('tcFs', function (e) { $('tcFsV').textContent = e.value; apply({ fs0: +e.value }); });
    var setCell = function (k, v) {
      if (!selCell) return;
      var map = clone(cur.ssSpec.cellStyles || {}), key = selCell.r + ',' + selCell.c;
      map[key] = Object.assign({}, map[key], k === 'bold' ? { bold: v } : (k === 'fill' ? { fill: v } : { color: v }));
      apply({ cellStyles: map });
    };
    bind('tcCF', function (e) { setCell('fill', e.value); });
    bind('tcCC', function (e) { setCell('color', e.value); });
    bind('tcCB', function (e) { setCell('bold', e.checked); }, 'change');
    Array.prototype.forEach.call(panel.querySelectorAll('.grid input'), function (inp) {
      inp.addEventListener('focus', function () {
        var r = +inp.getAttribute('data-r'), c = +inp.getAttribute('data-c');
        if (selCell && selCell.r === r && selCell.c === c) return;
        selCell = { r: r, c: c }; setTimeout(function () { renderKeepFocus(r, c); }, 0);
      });
      inp.addEventListener('change', function () {
        var rows2 = clone(cur.ssSpec.rows), r = +inp.getAttribute('data-r'), c = +inp.getAttribute('data-c');
        rows2[r][c] = inp.value; apply({ rows: rows2 }, false, true);
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll('.btns button'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-a'), rows2 = clone(cur.ssSpec.rows), cs2 = clone(cur.ssSpec.cellStyles || {});
        var nc = rows2[0].length;
        if (a === 'addR') rows2.push(new Array(nc).fill(''));
        else if (a === 'delR') { if (rows2.length > 1) { rows2.pop(); Object.keys(cs2).forEach(function (k) { if (+k.split(',')[0] >= rows2.length) delete cs2[k]; }); } }
        else if (a === 'addC') { if (nc < 8) rows2.forEach(function (r) { r.push(''); }); }
        else if (a === 'delC') { if (nc > 1) { rows2.forEach(function (r) { r.pop(); }); Object.keys(cs2).forEach(function (k) { if (+k.split(',')[1] >= nc - 1) delete cs2[k]; }); } }
        else if (a === 'clrCell') { if (selCell) delete cs2[selCell.r + ',' + selCell.c]; }
        else if (a === 'clrAll') cs2 = {};
        if (rows2.length > 14) return;
        apply({ rows: rows2, cellStyles: cs2 }, true, true);
      };
    });
  }
  function renderKeepFocus(r, c) {
    render();
    var inp = panel && panel.querySelector('.grid input[data-r="' + r + '"][data-c="' + c + '"]');
    if (inp) { try { inp.focus({ preventScroll: true }); inp.select(); } catch (e) {} }
  }

  function renderChart() {
    var sp = cur.ssSpec, labels = sp.labels, series = sp.series, multi = series.length > 1, pie = sp.chart === 'pie' || sp.chart === 'doughnut';
    // v63: panel AYNAN grafikda ko'ringan ranglarni ko'rsatadi (chizuvchi colors[i % n] qiladi). Avval yetishmagan ranglar
    // standart palitradan to'ldirilib, ustunlar bir rangda turgani holda panelda boshqa ranglar ko'rinardi va bitta rang
    // o'zgartirilsa qolgan ustunlar ham kutilmaganda o'zgarardi (botdan kelgan diagrammalarda).
    var perLabel = pie || (!multi && sp.chart !== 'line');          // har bir yorliqning o'z rangi (doira / bitta seriyali ustun)
    var src = (sp.colors && sp.colors.length ? sp.colors : PAL);
    var need = perLabel ? labels.length : series.length;
    var colors = [];
    for (var ci = 0; ci < Math.max(need, 1); ci++) colors.push(src[ci % src.length]);
    var head = '<tr><td></td><td class="hint">Yorliq</td>' + series.map(function (s, si) {
      return '<td>' + (!perLabel ? '<input type="color" data-sc="' + si + '" value="' + hex(colors[si]) + '" title="' + (multi ? 'Qator rangi' : 'Chiziq rangi') + '"><br>' : '') +
        '<input type="text" data-sn="' + si + '" value="' + esc(s.name || ('Qator ' + (si + 1))) + '" placeholder="Nomi"></td>';
    }).join('') + '<td></td></tr>';
    var body = labels.map(function (lb, i) {
      return '<tr><td>' + (perLabel ? '<input type="color" data-pc="' + i + '" value="' + hex(colors[i]) + '" title="Rangi">' : '') + '</td>' +
        '<td><input type="text" data-l="' + i + '" value="' + esc(lb) + '"></td>' +
        series.map(function (s, si) { return '<td><input type="number" step="any" data-v="' + si + ',' + i + '" value="' + (s.values[i] == null ? 0 : s.values[i]) + '"></td>'; }).join('') +
        '<td><button class="rm" data-rm="' + i + '" title="Qatorni o\'chirish">×</button></td></tr>';
    }).join('');
    panel.innerHTML = '<h4>Grafik <button class="x" id="ssTcX" aria-label="Yopish">×</button></h4>' +
      '<div class="row"><label for="chK">Turi</label><select id="chK">' +
      [['bar', 'Ustunli'], ['line', 'Chiziqli'], ['pie', 'Doira'], ['doughnut', 'Donut']].map(function (k) { return '<option value="' + k[0] + '"' + (sp.chart === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="row"><input type="text" id="chT" placeholder="Sarlavha" value="' + esc(sp.title || '') + '"></div>' +
      colorRow('Matn rangi', 'chInk', sp.textColor || '#374151') +
      '<div class="sec">Raqamlar va ranglar</div><div class="grid"><table>' + head + body + '</table></div>' +
      '<div class="btns"><button data-a="add">+ Qator</button>' + (!multi && !pie ? '<button data-a="ser">+ Qator-seriya</button>' : '') + (multi ? '<button data-a="delser">− Oxirgi seriya</button>' : '') + '<button data-a="pal">Ranglarni tiklash</button></div>';
    $('ssTcX').onclick = close;
    var up = function (patch, structural, now) { apply(patch, structural, now); };
    $('chK').onchange = function () { up({ chart: this.value }, true, true); };
    $('chT').onchange = function () { up({ title: this.value }, false, true); };
    $('chInk').oninput = function () { up({ textColor: this.value }); };
    var setColors = function (arr) { up({ colors: arr }); };
    Array.prototype.forEach.call(panel.querySelectorAll('[data-pc],[data-sc]'), function (inp) {
      inp.oninput = function () { var k = inp.hasAttribute('data-pc') ? +inp.getAttribute('data-pc') : +inp.getAttribute('data-sc'); var c2 = colors.slice(); c2[k] = inp.value; colors = c2; setColors(c2); };
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-l]'), function (inp) {
      inp.onchange = function () { var l2 = labels.slice(); l2[+inp.getAttribute('data-l')] = inp.value; up({ labels: l2 }, false, true); };
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-sn]'), function (inp) {
      inp.onchange = function () { var s2 = clone(series); s2[+inp.getAttribute('data-sn')].name = inp.value; up({ series: s2 }, false, true); };
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-v]'), function (inp) {
      inp.onchange = function () {
        var p = inp.getAttribute('data-v').split(','), s2 = clone(series);
        s2[+p[0]].values[+p[1]] = parseFloat(inp.value) || 0; up({ series: s2 }, false, true);
      };
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-rm]'), function (b) {
      b.onclick = function () {
        if (labels.length <= 1) return;
        var i = +b.getAttribute('data-rm'), l2 = labels.slice(), s2 = clone(series), c2 = colors.slice();
        l2.splice(i, 1); s2.forEach(function (s) { s.values.splice(i, 1); }); if (!multi || pie) c2.splice(i, 1);
        up({ labels: l2, series: s2, colors: c2 }, true, true);
      };
    });
    Array.prototype.forEach.call(panel.querySelectorAll('.btns button'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-a'), l2 = labels.slice(), s2 = clone(series), c2 = colors.slice();
        if (a === 'add') { if (l2.length >= 12) return; l2.push('Yangi'); s2.forEach(function (s) { s.values.push(0); }); if (!multi || pie) c2.push(PAL[l2.length % PAL.length - 1 < 0 ? 0 : (l2.length - 1) % PAL.length]); }
        else if (a === 'ser') { if (s2.length >= 4) return; s2.push({ name: 'Qator ' + (s2.length + 1), values: l2.map(function () { return 0; }) }); }
        else if (a === 'delser') { if (s2.length > 1) s2.pop(); }
        else if (a === 'pal') c2 = PAL.slice();
        up({ labels: l2, series: s2, colors: c2 }, true, true);
      };
    });
  }

  function render() {
    if (!panel || !isTC(cur)) return;
    var sy = panel.scrollTop;
    if (cur.ssKind === 'table') renderTable(); else renderChart();
    panel.scrollTop = sy;
  }
  function open(o) {
    if (!isTC(o)) { close(); return; }
    var key = (o._oid || o.id || '') + '|' + o.ssKind;
    cur = o;
    if (!panel) { panel = document.createElement('div'); panel.id = 'ssTcPanel'; document.body.appendChild(panel); ['mousedown', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) { panel.addEventListener(ev, function (e) { e.stopPropagation(); }); }); }
    if (key !== lastKey) { selCell = null; lastKey = key; }
    render();
  }

  /* ------------------------------------------------------------------ ulash */
  function onSel(e) {
    if (busy) return;
    var t = (e && e.selected && e.selected[0]) || (canvas.getActiveObject && canvas.getActiveObject());
    if (e && e.selected && e.selected.length > 1) { close(); return; }
    if (isTC(t)) open(t); else close();
  }
  function hook() {
    if (typeof canvas === 'undefined' || !canvas || !canvas.on) return false;
    canvas.on('selection:created', onSel);
    canvas.on('selection:updated', onSel);
    canvas.on('selection:cleared', function () { if (!busy) close(); });
    // slayd almashganda / obyekt o'chirilganda panel qolib ketmasin
    setInterval(function () {
      if (!panel) return;
      var a = canvas.getActiveObject && canvas.getActiveObject();
      if (!a || !isTC(a) || (canvas.getObjects().indexOf(a) < 0)) close();
      else if (a !== cur) { cur = a; }
    }, 600);
    return true;
  }
  var tries = 0, iv = setInterval(function () { if (hook() || ++tries > 80) clearInterval(iv); }, 250);

  window.ssTcPanel = { open: open, close: close };
})();
