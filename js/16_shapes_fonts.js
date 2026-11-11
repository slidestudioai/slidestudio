/* v27c: ko'p shakllar (AI ham qo'ya oladi) + 30 ta shrift */
(function () {
  'use strict';
  if (typeof fabric === 'undefined') return;

  // ---------- Shakllar kutubxonasi (0..100 birlik) ----------
  function regular(n, rot) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (rot != null ? rot : -90) * Math.PI / 180 + i * 2 * Math.PI / n;
      pts.push([50 + 50 * Math.cos(a), 50 + 50 * Math.sin(a)]);
    }
    return 'M ' + pts.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' L ') + ' Z';
  }
  function star(n, ratio) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n, r = (i % 2 === 0) ? 50 : 50 * ratio;
      pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
    }
    return 'M ' + pts.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' L ') + ' Z';
  }
  const CIRCLE = 'M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z';
  const LIB = {
    triangle:       ['Uchburchak', 'M 50 0 L 100 100 L 0 100 Z'],
    right_triangle: ['To\'g\'ri burchakli uchburchak', 'M 0 0 L 100 100 L 0 100 Z'],
    diamond:        ['Romb', 'M 50 0 L 100 50 L 50 100 L 0 50 Z'],
    parallelogram:  ['Parallelogramm', 'M 25 0 L 100 0 L 75 100 L 0 100 Z'],
    trapezoid:      ['Trapetsiya', 'M 20 0 L 80 0 L 100 100 L 0 100 Z'],
    pentagon:       ['Beshburchak', regular(5)],
    hexagon:        ['Oltiburchak', regular(6, 0)],
    heptagon:       ['Yettiburchak', regular(7)],
    octagon:        ['Sakkizburchak', regular(8, -67.5)],
    decagon:        ['O\'nburchak', regular(10)],
    star4:          ['4 qirrali yulduz', star(4, 0.38)],
    star5:          ['Yulduz', star(5, 0.4)],
    star6:          ['6 qirrali yulduz', star(6, 0.55)],
    star8:          ['8 qirrali yulduz', star(8, 0.6)],
    burst:          ['Portlash', star(12, 0.78)],
    seal:           ['Muhr', star(20, 0.88)],
    heart:          ['Yurak', 'M 50 95 C 10 62 0 40 0 25 C 0 8 14 0 27 0 C 38 0 46 6 50 14 C 54 6 62 0 73 0 C 86 0 100 8 100 25 C 100 40 90 62 50 95 Z'],
    plus:           ['Plyus', 'M 35 0 L 65 0 L 65 35 L 100 35 L 100 65 L 65 65 L 65 100 L 35 100 L 35 65 L 0 65 L 0 35 L 35 35 Z'],
    x_mark:         ['Xoch (X)', 'M 20 0 L 50 30 L 80 0 L 100 20 L 70 50 L 100 80 L 80 100 L 50 70 L 20 100 L 0 80 L 30 50 L 0 20 Z'],
    check:          ['Galochka', 'M 0 55 L 15 40 L 38 62 L 85 10 L 100 25 L 38 92 Z'],
    arrow_right:    ['O\'ng strelka', 'M 0 30 L 60 30 L 60 0 L 100 50 L 60 100 L 60 70 L 0 70 Z'],
    arrow_left:     ['Chap strelka', 'M 100 30 L 40 30 L 40 0 L 0 50 L 40 100 L 40 70 L 100 70 Z'],
    arrow_up:       ['Tepaga strelka', 'M 30 100 L 30 40 L 0 40 L 50 0 L 100 40 L 70 40 L 70 100 Z'],
    arrow_down:     ['Pastga strelka', 'M 30 0 L 70 0 L 70 60 L 100 60 L 50 100 L 0 60 L 30 60 Z'],
    arrow_lr:       ['Ikki tomonlama strelka', 'M 0 50 L 28 15 L 28 35 L 72 35 L 72 15 L 100 50 L 72 85 L 72 65 L 28 65 L 28 85 Z'],
    chevron_right:  ['Chevron (o\'ng)', 'M 0 0 L 55 0 L 100 50 L 55 100 L 0 100 L 45 50 Z'],
    chevron_left:   ['Chevron (chap)', 'M 100 0 L 45 0 L 0 50 L 45 100 L 100 100 L 55 50 Z'],
    home_arrow:     ['Besh burchakli strelka', 'M 0 15 L 70 15 L 100 50 L 70 85 L 0 85 Z'],
    ring:           ['Halqa', CIRCLE + ' M 50 22 A 28 28 0 1 0 50 78 A 28 28 0 1 0 50 22 Z'],
    crescent:       ['Yarim oy', 'M 62 2 A 48 48 0 1 0 98 72 A 40 40 0 1 1 62 2 Z'],
    half_circle:    ['Yarim doira', 'M 0 50 A 50 50 0 0 1 100 50 Z'],
    quarter_circle: ['Chorak doira', 'M 0 100 L 0 0 A 100 100 0 0 1 100 100 Z'],
    drop:           ['Tomchi', 'M 50 0 C 80 35 100 55 100 70 C 100 88 78 100 50 100 C 22 100 0 88 0 70 C 0 55 20 35 50 0 Z'],
    cloud:          ['Bulut', 'M 25 80 C 8 80 0 68 5 55 C 8 45 18 42 25 44 C 25 25 42 12 58 18 C 68 8 90 14 90 35 C 102 38 106 55 98 66 C 94 76 85 80 75 80 Z'],
    lightning:      ['Chaqmoq', 'M 60 0 L 15 58 L 45 58 L 35 100 L 85 38 L 55 38 Z'],
    speech:         ['Gap pufagi', 'M 15 0 L 85 0 C 94 0 100 6 100 15 L 100 55 C 100 64 94 70 85 70 L 40 70 L 18 95 L 22 70 L 15 70 C 6 70 0 64 0 55 L 0 15 C 0 6 6 0 15 0 Z'],
    speech_oval:    ['Oval gap pufagi', 'M 50 0 C 78 0 100 15 100 36 C 100 57 78 72 50 72 C 45 72 40 72 36 71 L 14 92 L 20 66 C 8 58 0 48 0 36 C 0 15 22 0 50 0 Z'],
    shield:         ['Qalqon', 'M 50 0 L 95 15 L 95 50 C 95 75 72 92 50 100 C 28 92 5 75 5 50 L 5 15 Z'],
    flag:           ['Bayroq', 'M 10 0 L 90 0 L 70 30 L 90 60 L 20 60 L 20 100 L 10 100 Z'],
    ribbon:         ['Lenta', 'M 0 15 L 100 15 L 85 50 L 100 85 L 0 85 L 15 50 Z'],
    bookmark:       ['Belgi', 'M 15 0 L 85 0 L 85 100 L 50 75 L 15 100 Z'],
    gear:           ['Tishli g\'ildirak', (function () {
      const pts = []; const n = 8;
      for (let i = 0; i < n; i++) {
        const a0 = i * 2 * Math.PI / n, d = Math.PI / n;
        [[-0.55, 38], [-0.3, 50], [0.3, 50], [0.55, 38]].forEach(function (q) {
          const a = a0 + q[0] * d * 1.6; pts.push([50 + q[1] * Math.cos(a), 50 + q[1] * Math.sin(a)]);
        });
      }
      return 'M ' + pts.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' L ') + ' Z M 50 36 A 14 14 0 1 0 50 64 A 14 14 0 1 0 50 36 Z';
    })()],
    // fabric obyektlari bilan quriladigan oddiy shakllar
    square:         ['Kvadrat', null],
    rounded_rect:   ['Yumaloq to\'rtburchak', null],
    pill:           ['Kapsula', null],
    ellipse:        ['Oval', null]
  };
  window.SHAPE_LIBRARY = LIB;

  function build(type, o) {
    o = o || {};
    const fill = o.fill || (typeof selectedColorHex !== 'undefined' ? selectedColorHex : '#3b82f6') || '#3b82f6';
    const base = { fill: fill, id: 'el_shape_' + Date.now() + Math.random().toString(36).slice(2, 5) };
    ['stroke', 'strokeWidth', 'opacity', 'angle', '_oid'].forEach(function (k) { if (o[k] != null) base[k] = o[k]; });
    const left = o.left != null ? +o.left : 400, top = o.top != null ? +o.top : 200;
    const W = +o.width || 0, H = +o.height || 0;
    let obj = null;
    if (type === 'square') { const s = W || 120; obj = new fabric.Rect(Object.assign({ left: left, top: top, width: s, height: H || s }, base)); }
    else if (type === 'rounded_rect') obj = new fabric.Rect(Object.assign({ left: left, top: top, width: W || 180, height: H || 110, rx: 22, ry: 22 }, base));
    else if (type === 'pill') obj = new fabric.Rect(Object.assign({ left: left, top: top, width: W || 220, height: H || 72, rx: 36, ry: 36 }, base));
    else if (type === 'ellipse') obj = new fabric.Ellipse(Object.assign({ left: left, top: top, rx: (W || 180) / 2, ry: (H || 110) / 2 }, base));
    else if (LIB[type] && LIB[type][1]) {
      obj = new fabric.Path(LIB[type][1], Object.assign({ left: left, top: top }, base));
      const w0 = obj.width || 100, h0 = obj.height || 100;
      const tw = W || 140;
      const sx = tw / w0, sy = H ? (H / h0) : sx;
      obj.set({ scaleX: sx, scaleY: sy });
    }
    if (obj) obj.shapeType = type;
    return obj;
  }
  window.buildShape = build;
  // v62: shakl nomi (star5, heart ...) saqlanadi — AI va foydalanuvchi uni keyin ham «ko'radi»
  try { if (typeof SERIALIZE_PROPS !== 'undefined' && SERIALIZE_PROPS.indexOf('shapeType') < 0) SERIALIZE_PROPS.push('shapeType'); } catch (e) {}

  // eski addShape ni kengaytiramiz (eski nomlar o'z holicha ishlaydi)
  const LEGACY = ['rect', 'circle', 'triangle', 'line', 'arrow_right', 'arrow_up', 'arrow_down', 'star', 'pentagon', 'hexagon', 'heart', 'chat_bubble'];
  const origAddShape = (typeof addShape === 'function') ? addShape : null;
  window.addShape = addShape = function (type) {
    if (origAddShape && LEGACY.indexOf(type) >= 0 && ['triangle', 'arrow_right', 'arrow_up', 'arrow_down', 'pentagon', 'hexagon', 'heart'].indexOf(type) < 0) return origAddShape(type);
    const shape = build(type, {});
    if (!shape) return origAddShape ? origAddShape(type) : undefined;
    shape.set({ left: 480 - shape.getScaledWidth() / 2, top: 270 - shape.getScaledHeight() / 2 });
    try { ensureObjectId(shape); } catch (e) {}
    canvas.add(shape); canvas.bringToFront(shape); canvas.setActiveObject(shape); canvas.requestRenderAll();
    try { saveCurrentSlideState(); recordGlobalState(); } catch (e) {}
    const m = document.getElementById('shapesMenu'); if (m) m.style.display = 'none';
  };

  // menyuni to'ldiramiz
  function svgIcon(d) { return '<svg viewBox="-4 -4 108 108" width="26" height="26"><path d="' + d + '" fill="#475569" fill-rule="nonzero"/></svg>'; }
  function fillMenu() {
    const menu = document.getElementById('shapesMenu');
    if (!menu || menu.dataset.v27) return;
    menu.dataset.v27 = '1';
    // eski elementlarning bir qismini yangi, bir xil uslubdagi ikonlar bilan almashtiramiz
    menu.innerHTML = '';
    const items = [['rect', 'To\'rtburchak', 'M 0 15 L 100 15 L 100 85 L 0 85 Z'], ['circle', 'Aylana', CIRCLE], ['line', 'Chiziq', 'M 0 46 L 100 46 L 100 54 L 0 54 Z']];
    Object.keys(LIB).forEach(function (k) {
      const d = LIB[k][1] || (k === 'square' ? 'M 10 10 L 90 10 L 90 90 L 10 90 Z' : k === 'rounded_rect' ? 'M 18 18 L 82 18 Q 98 18 98 34 L 98 66 Q 98 82 82 82 L 18 82 Q 2 82 2 66 L 2 34 Q 2 18 18 18 Z' : k === 'pill' ? 'M 30 28 L 70 28 A 22 22 0 0 1 70 72 L 30 72 A 22 22 0 0 1 30 28 Z' : 'M 50 20 A 50 30 0 1 1 50 80 A 50 30 0 1 1 50 20 Z');
      items.push([k, LIB[k][0], d]);
    });
    items.forEach(function (it) {
      const div = document.createElement('div');
      div.className = 'shape-opt'; div.title = it[1];
      div.innerHTML = svgIcon(it[2]);
      div.onclick = function () { window.addShape(it[0]); };
      menu.appendChild(div);
    });
    menu.style.gridTemplateColumns = 'repeat(6, 1fr)';
    menu.style.maxHeight = '60vh'; menu.style.overflowY = 'auto';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillMenu); else fillMenu();

  // ---------- AI: {"type":"shape","shape":"star5",...} yoki {"type":"star5"} ----------
  if (typeof parseElementToFabric === 'function' && !parseElementToFabric.__ssShapes) {
    const prev = parseElementToFabric;
    const w2 = async function (el) {
      if (el && el.type) {
        let name = null;
        if (el.type === 'shape') name = el.shape || el.name || el.kind;
        else if (LIB[el.type] && el.type !== 'triangle') name = el.type;
        else if (el.type === 'triangle' && !el.width) name = null;
        if (name) {
          name = String(name).toLowerCase().replace(/[\s-]+/g, '_');
          const alias = { star: 'star5', circle: null, rectangle: 'square', oval: 'ellipse', cross: 'plus', bubble: 'speech', callout: 'speech', arrow: 'arrow_right', moon: 'crescent', thunder: 'lightning', donut: 'ring', rounded: 'rounded_rect', capsule: 'pill', octagon: 'octagon' };
          if (alias[name] !== undefined) name = alias[name];
          if (name && (LIB[name])) {
            const obj = build(name, el);
            if (obj) {
              if (el.rx != null && obj.type === 'rect') { obj.set({ rx: +el.rx, ry: el.ry != null ? +el.ry : +el.rx }); }
              try { ensureObjectId(obj); } catch (e) {}
              // v62: avval bu funksiya boshqa faylda yopiq edi — AI yaratgan yulduz/yurak va boshqa shakllarning animatsiyasi tushib qolardi
              if ((el.animation || el.anim || el.animName) && typeof window.ssApplyAnimFromEl === 'function') { try { window.ssApplyAnimFromEl(obj, el); } catch (e) {} }
              return obj;
            }
          }
        }
      }
      return prev(el);
    };
    w2.__ssShapes = true; w2.__ssWrapped = true;
    parseElementToFabric = w2;
  }

  // ---------- 30 ta shrift ----------
  const FONTS = [
    ['Inter', '400;700'], ['Montserrat', '400;700'], ['Roboto', '400;700'], ['Open Sans', '400;700'], ['Lato', '400;700'],
    ['Poppins', '400;700'], ['Nunito', '400;700'], ['Raleway', '400;700'], ['Ubuntu', '400;700'], ['Work Sans', '400;700'],
    ['Playfair Display', '400;700'], ['Merriweather', '400;700'], ['Lora', '400;700'], ['Bree Serif', ''], ['Cinzel', '400;700'],
    ['Libre Baskerville', '400;700'], ['Oswald', '400;700'], ['Bebas Neue', ''], ['Anton', ''], ['Righteous', ''],
    ['Abril Fatface', ''], ['Pacifico', ''], ['Caveat', '400;700'], ['Dancing Script', '400;700'], ['Lobster', ''],
    ['Sacramento', ''], ['Shadows Into Light', '']
  ];
  const SYSTEM = ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Impact'];
  window.SS_FONTS = SYSTEM.concat(FONTS.map(function (f) { return f[0]; }));
  function loadFonts() {
    const q = FONTS.map(function (f) { return 'family=' + f[0].replace(/ /g, '+') + (f[1] ? ':wght@' + f[1] : ''); }).join('&');
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?' + q + '&display=swap';
    l.onload = function () { try { document.fonts.ready.then(function () { canvas.requestRenderAll(); }); } catch (e) {} };
    document.head.appendChild(l);
    const sel = document.getElementById('fontFamily');
    if (sel) {
      const have = {}; Array.from(sel.options).forEach(function (o) { have[o.value] = 1; });
      window.SS_FONTS.forEach(function (n) {
        if (have[n]) return;
        const op = document.createElement('option'); op.value = n; op.textContent = n; op.style.fontFamily = '"' + n + '"';
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () {
        const f = sel.value;
        try { document.fonts.load('16px "' + f + '"').then(function () { canvas.requestRenderAll(); try { saveCurrentSlideState(); } catch (e) {} }); } catch (e) {}
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadFonts); else loadFonts();
})();
