/* js/49_prst_shapes_ui.js (v68) — 187 ta PowerPoint shakli: «Shakllar» menyusi (toifalar bilan) va AI uchun.
 *  AI: {"type":"shape","shape":"flowChartDecision", ...} yoki {"type":"cloudCallout", ...} — har qanday ECMA-376 nomi.
 *  Ixtiyoriy "adj":{"adj":25000} — PowerPoint sariq tutqichi qiymatlari.
 */
(function () {
  'use strict';
  if (!window.SS_PRST || typeof fabric === 'undefined') return;

  var CATS = [
    ['lines', 'Chiziq va ulagichlar', function (n) { return /^(line|lineInv|straightConnector1|bentConnector[2-5]|curvedConnector[2-5]|arc|bracketPair|bracePair|leftBracket|rightBracket|leftBrace|rightBrace)$/.test(n); }],
    ['basic', 'Asosiy shakllar', function (n) { return /^(rect|roundRect|snip1Rect|snip2SameRect|snip2DiagRect|snipRoundRect|round1Rect|round2SameRect|round2DiagRect|ellipse|triangle|rtTriangle|parallelogram|trapezoid|nonIsoscelesTrapezoid|diamond|pentagon|hexagon|heptagon|octagon|decagon|dodecagon|pie|pieWedge|chord|teardrop|frame|halfFrame|corner|diagStripe|plus|plaque|can|cube|bevel|donut|noSmoking|blockArc|foldedCorner|smileyFace|heart|lightningBolt|sun|moon|cloud|funnel|gear6|gear9|squareTabs|cornerTabs|plaqueTabs|chartPlus|chartStar|chartX)$/.test(n); }],
    ['arrows', 'Strelkalar', function (n) { return /Arrow|arrow|^chevron$|^homePlate$|^notchedRightArrow$|^stripedRightArrow$/.test(n) && !/Callout/.test(n); }],
    ['math', 'Tenglama', function (n) { return /^math/.test(n); }],
    ['flow', 'Blok-sxema', function (n) { return /^flowChart/.test(n); }],
    ['stars', 'Yulduz va lentalar', function (n) { return /^star|^irregularSeal|ribbon|Ribbon|^wave$|^doubleWave$|Scroll$/.test(n); }],
    ['callouts', 'Izoh (callout)', function (n) { return /Callout/.test(n); }],
    ['action', 'Harakat tugmalari', function (n) { return /^actionButton/.test(n); }]
  ];
  function catOf(n) { for (var i = 0; i < CATS.length; i++) if (CATS[i][2](n)) return CATS[i][0]; return 'other'; }
  function isLineLike(n) {
    var g = SS_PRST.geometry(n, 100, 70);
    return !!g && g.every(function (p) { return p.fill === 'none'; });
  }
  var lowerMap = null;
  function resolveName(n) {
    if (!n) return null;
    n = String(n).trim();
    if (SS_PRST.has(n)) return n;
    if (!lowerMap) { lowerMap = {}; SS_PRST.names().forEach(function (k) { lowerMap[k.toLowerCase()] = k; }); }
    return lowerMap[n.toLowerCase().replace(/[\s_-]+/g, '')] || null;
  }

  function color() { try { return (typeof selectedColorHex !== 'undefined' && selectedColorHex) || '#3b82f6'; } catch (e) { return '#3b82f6'; } }
  function make(name, o) {
    o = o || {};
    var line = isLineLike(name), sq = /^(ellipse|donut|noSmoking|smileyFace|sun|moon|heart|star\d+|irregularSeal\d|gear\d|pie|chord|blockArc|teardrop|actionButton.*|mathPlus|mathMinus|mathMultiply|mathDivide|mathEqual|mathNotEqual|plus|cube|can|flowChartConnector|flowChartOr|flowChartSummingJunction)$/.test(name);
    var W = +o.width || (line ? 200 : (sq ? 140 : 200)), H = +o.height || (line ? 120 : (sq ? 140 : 130));
    var c = o.fill && o.fill !== 'none' ? o.fill : color();
    var opts = {
      prst: name, width: W, height: H, left: o.left != null ? +o.left : Math.round(480 - W / 2), top: o.top != null ? +o.top : Math.round(270 - H / 2),
      fill: line ? '' : c, stroke: line ? (o.stroke || c) : (o.stroke || null), strokeWidth: line ? (+o.strokeWidth || 3) : (o.stroke ? (+o.strokeWidth || 2) : 0),
      angle: +o.angle || 0, opacity: o.opacity != null ? +o.opacity : 1, strokeUniform: true
    };
    if (o.adj && typeof o.adj === 'object') opts.adj = o.adj;
    if (o.shadow && typeof o.shadow === 'object') opts.shadow = new fabric.Shadow(o.shadow);
    var s = new fabric.PrstShape(opts);
    s.shapeType = name;
    try { if (typeof ensureObjectId === 'function') ensureObjectId(s); } catch (e) {}
    return s;
  }
  window.ssAddPrstShape = function (name, o) {
    var n = resolveName(name); if (!n || typeof canvas === 'undefined') return null;
    var s = make(n, o);
    canvas.add(s); canvas.setActiveObject(s); canvas.requestRenderAll();
    try { saveCurrentSlideState(); recordGlobalState(); } catch (e) {}
    var m = document.getElementById('shapesMenu'); if (m) m.style.display = 'none';
    return s;
  };

  /* ---------- menyu: mavjud «Shakllar» ro'yxatidan keyin toifalar bo'yicha hammasi ---------- */
  function icon(n) {
    var g = SS_PRST.geometry(n, 96, 72);
    if (!g) return '';
    var line = g.every(function (p) { return p.fill === 'none'; });
    var parts = g.map(function (p) {
      var d = SS_PRST.toSvgPath([p]);
      var fill = p.fill === 'none' ? 'none' : (/darken/.test(p.fill) ? '#334155' : (/lighten/.test(p.fill) ? '#94a3b8' : '#64748b'));
      return '<path d="' + d + '" fill="' + fill + '" stroke="' + (p.stroke ? '#334155' : 'none') + '" stroke-width="' + (line ? 4 : 2) + '" vector-effect="non-scaling-stroke"/>';
    });
    return '<svg viewBox="-6 -6 108 84" width="30" height="24">' + parts.join('') + '</svg>';
  }
  function fillMenu() {
    var menu = document.getElementById('shapesMenu');
    if (!menu || menu.dataset.prst || !SS_PRST.ready) return;
    menu.dataset.prst = '1';
    var groups = {};
    SS_PRST.names().forEach(function (n) { var c = catOf(n); (groups[c] = groups[c] || []).push(n); });
    var order = CATS.map(function (c) { return [c[0], c[1]]; }).concat([['other', 'Boshqa']]);
    var h = document.createElement('div');
    h.className = 'ss-prst-head';
    h.style.cssText = 'grid-column:1/-1;font:600 12px/1.3 inherit;color:#1f2937;padding:10px 4px 2px;border-top:1px solid #e5e7eb;margin-top:6px';
    h.textContent = 'PowerPoint shakllari (' + SS_PRST.names().length + ' ta) — PowerPoint va LibreOffice’da ham tahrirlanadi';
    menu.appendChild(h);
    order.forEach(function (c) {
      var list = groups[c[0]]; if (!list || !list.length) return;
      var t = document.createElement('div');
      t.style.cssText = 'grid-column:1/-1;font:600 11px/1.3 inherit;color:#6b7280;padding:8px 4px 2px';
      t.textContent = c[1] + ' (' + list.length + ')';
      menu.appendChild(t);
      list.forEach(function (n) {
        var d = document.createElement('div');
        d.className = 'shape-opt ss-prst-opt';
        d.title = n;
        d.setAttribute('data-prst', n);
        d.innerHTML = icon(n);
        d.onclick = function () { window.ssAddPrstShape(n); };
        menu.appendChild(d);
      });
    });
  }
  // eski menyu (16_shapes_fonts.js) o'zini to'ldirib bo'lgach qo'shamiz — aks holda u menyuni tozalab yuboradi
  var waitT = 0;
  function tryFill() {
    var m = document.getElementById('shapesMenu');
    if (!SS_PRST.ready || !m) return;
    if (!m.dataset.v27 && waitT++ < 100) { setTimeout(tryFill, 100); return; }
    fillMenu();
  }
  document.addEventListener('ss-prst-ready', tryFill);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryFill); else tryFill();

  /* ---------- AI: {"type":"shape","shape":"<PowerPoint nomi>"} ---------- */
  function hook() {
    var prev = window.parseElementToFabric;
    if (typeof prev !== 'function' || prev.__ssPrst) return;
    var w = async function (el) {
      if (el && el.type) {
        var LIB = window.SHAPE_LIBRARY || {};
        var nm = el.type === 'shape' ? (el.shape || el.name || el.kind) : (el.type === 'prstShape' ? el.prst : el.type);
        var isBuiltin = /^(text|textbox|rect|circle|image|gifImage|video|button|line|arrow|check|cross|triangle|ellipse|star|polygon|hexagon|diamond|chevron|pill|kit|table|chart)$/.test(String(el.type));
        if (nm && !LIB[String(nm).toLowerCase().replace(/[\s-]+/g, '_')] && (el.type === 'shape' || el.type === 'prstShape' || !isBuiltin)) {
          try { await SS_PRST.load(); } catch (e) {}
          var n = resolveName(nm);
          if (n) {
            var s = make(n, el);
            if ((el.animation || el.anim || el.animName) && typeof window.ssApplyAnimFromEl === 'function') { try { window.ssApplyAnimFromEl(s, el); } catch (e) {} }
            return s;
          }
        }
      }
      return prev.apply(this, arguments);
    };
    w.__ssPrst = true; w.__ssKit = prev.__ssKit; w.__ssWrapped = prev.__ssWrapped; w.__ssShapes = prev.__ssShapes; w.__v48 = prev.__v48;
    window.parseElementToFabric = w;
  }
  hook();
  setTimeout(hook, 1600);
  try { if (typeof SERIALIZE_PROPS !== 'undefined') ['prst', 'adj'].forEach(function (k) { if (SERIALIZE_PROPS.indexOf(k) < 0) SERIALIZE_PROPS.push(k); }); } catch (e) {}
  window.SS_PRST_UI = { categories: CATS, catOf: catOf, resolveName: resolveName, make: make };
})();
