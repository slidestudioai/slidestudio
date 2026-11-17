/* js/48_design_kit.js (v67) — DIZAYN TO'PLAMI: kartochkalar, ramkalar, stikerlar, fonlar.
 *
 * Bitta standart — saytda (Fabric.js) va PowerPoint'da (PptxGenJS) bir xil:
 *   - Hamma narsa FAQAT oddiy, PowerPoint'da tahrirlanadigan bo'laklardan quriladi:
 *     rect (rx, qalin stroke, qattiq soya), circle, line, matn, va SHAPE_LIBRARY yo'llari (path).
 *     14_pptx_io.js ularni PowerPoint'ning o'z shakllariga 1:1 o'giradi (roundRect, ellipse, line, custGeom).
 *   - Qattiq soya = fabric.Shadow { blur: 0, offsetX, offsetY } → PPTX <a:outerShdw blurRad="0" dist dir>.
 *   - Shriftlar: faqat PowerPoint'da bor shriftlar (Arial, Georgia, Courier New) — qator bo'linishi bir xil.
 *   - Koordinatalar: slayd 960×540 px = 10×5.625 dyuym (1 px = 1/96 dyuym = 0.75 pt = 9525 EMU).
 *
 * Foydalanuvchi: toolbar boshidagi «Dizayn» tugmasi → menyu (Kartochkalar / Ramkalar / Stikerlar / Fon) + uslub tanlash.
 *   (slayd burchagidagi «+» — avvalgidek faqat rasm yuklaydi.)
 * AI: elements[] ichida {"type":"kit","item":"window_card","style":"neo_brutalism",...} yozadi —
 *     bu yerda oddiy bo'laklarga yoyiladi (ssFixCardLayout dan keyin, karta sifatida joylashtirilgach).
 */
(function () {
  'use strict';
  if (window.SS_KIT) return;
  if (typeof fabric === 'undefined') return;

  var SW = 960, SH = 540;
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function rnd(v) { return Math.round(v * 100) / 100; }
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'success'); } catch (e) {} }

  /* ------------------------------------------------------------------ 1) USLUBLAR (design tokens) */
  var HARD = function (x, y, c) { return { color: c || '#111111', blur: 0, offsetX: x, offsetY: y }; };
  var STYLES = {
    neo_brutalism: {
      label: 'Neo-Brutalism', hint: 'Retro oyna, qalin chegara, qattiq soya',
      bg: '#FFF4D6', bgs: ['#FFF4D6', '#FFE3EC', '#E0F4FF', '#E9F7D4', '#FFFFFF', '#111111'],
      card: '#FFFFFF', ink: '#111111', muted: '#2B2B2B', onAccent: '#111111',
      accent: '#FF5C8A', accent2: '#FFD23F', accent3: '#3EC1D3',
      bar: '#FFD23F', highlight: '#FFD23F', tag: '#3EC1D3',
      border: '#111111', borderW: 3, radius: 6, pad: 20, shadow: HARD(6, 6), stickerShadow: HARD(4, 4),
      dots: ['#FF5C8A', '#FFFFFF', '#3EC1D3'], dotStroke: '#111111',
      fontTitle: 'Courier New', fontBody: 'Arial', stickerStroke: true
    },
    modern_cards: {
      label: 'Zamonaviy', hint: 'Yumshoq kartochkalar, katta radius',
      bg: '#F5F7FB', bgs: ['#F5F7FB', '#FFFFFF', '#EEF2FF', '#ECFEFF', '#0F172A', '#111827'],
      card: '#FFFFFF', ink: '#0F172A', muted: '#475569', onAccent: '#FFFFFF',
      accent: '#4F46E5', accent2: '#06B6D4', accent3: '#F59E0B',
      bar: '#F1F5F9', highlight: '#EEF2FF', tag: '#EEF2FF',
      border: '#E2E8F0', borderW: 1, radius: 18, pad: 24, shadow: { color: 'rgba(15,23,42,0.14)', blur: 24, offsetX: 0, offsetY: 8 }, stickerShadow: null,
      dots: ['#FF5F57', '#FEBC2E', '#28C840'], dotStroke: null,
      fontTitle: 'Arial', fontBody: 'Arial', stickerStroke: false
    },
    academic: {
      label: 'Akademik', hint: 'Klassik, serifli shrift, ingichka chiziqlar',
      bg: '#FFFFFF', bgs: ['#FFFFFF', '#FAF8F3', '#F3F1EA', '#EEF2F6', '#1B2A41'],
      card: '#FAF8F3', ink: '#1B2A41', muted: '#3D4B5C', onAccent: '#FFFFFF',
      accent: '#8C1C13', accent2: '#1B2A41', accent3: '#B08D2A',
      bar: '#1B2A41', highlight: '#F3EBD3', tag: '#F3EBD3',
      border: '#1B2A41', borderW: 1.5, radius: 0, pad: 24, shadow: null, stickerShadow: null,
      dots: null, dotStroke: null, barInk: '#FFFFFF',
      fontTitle: 'Georgia', fontBody: 'Georgia', stickerStroke: false
    },
    /* v68: yana 7 ta uslub — hammasi PowerPoint'da bor shriftlar bilan (sayt va .pptx bir xil) */
    dark_neon: {
      label: 'Neon (qorong\'i)', hint: 'Qora fon, yorqin neon chegaralar va nur',
      bg: '#0B1020', bgs: ['#0B1020', '#111827', '#1E1B4B', '#0F172A', '#000000'],
      card: '#141B34', ink: '#F8FAFC', muted: '#CBD5E1', onAccent: '#0B1020',
      accent: '#22D3EE', accent2: '#A855F7', accent3: '#F472B6',
      bar: '#1E293B', barInk: '#F8FAFC', highlight: '#1E1B4B', tag: '#1E293B',
      border: '#22D3EE', borderW: 2, radius: 14, pad: 22, shadow: { color: 'rgba(34,211,238,0.45)', blur: 18, offsetX: 0, offsetY: 0 }, stickerShadow: { color: 'rgba(168,85,247,0.55)', blur: 14, offsetX: 0, offsetY: 0 },
      dots: ['#F472B6', '#FACC15', '#22D3EE'], dotStroke: null,
      fontTitle: 'Trebuchet MS', fontBody: 'Verdana', stickerStroke: false
    },
    pastel_soft: {
      label: 'Pastel', hint: 'Yumshoq pastel ranglar, katta radius',
      bg: '#FDF6F0', bgs: ['#FDF6F0', '#FFFFFF', '#F3EEFB', '#EAF6F2', '#FFF4E6'],
      card: '#FFFFFF', ink: '#3F3D56', muted: '#6B6880', onAccent: '#FFFFFF',
      accent: '#F28CAB', accent2: '#A0D8C8', accent3: '#C3B1E1',
      bar: '#F9E1E8', highlight: '#FFF1C9', tag: '#E8F6F1',
      border: '#E9DDE3', borderW: 1.5, radius: 24, pad: 24, shadow: { color: 'rgba(63,61,86,0.10)', blur: 20, offsetX: 0, offsetY: 6 }, stickerShadow: null,
      dots: ['#F28CAB', '#FFD59E', '#A0D8C8'], dotStroke: null,
      fontTitle: 'Trebuchet MS', fontBody: 'Trebuchet MS', stickerStroke: false
    },
    corporate_blue: {
      label: 'Korporativ', hint: 'Biznes hisobot: ko\'k, toza, aniq',
      bg: '#FFFFFF', bgs: ['#FFFFFF', '#F3F6FB', '#EAF1FF', '#0B2545'],
      card: '#F3F6FB', ink: '#0B2545', muted: '#4A5D7A', onAccent: '#FFFFFF',
      accent: '#1D4ED8', accent2: '#0EA5E9', accent3: '#F59E0B',
      bar: '#0B2545', barInk: '#FFFFFF', highlight: '#E0ECFF', tag: '#E0ECFF',
      border: '#C9D6EA', borderW: 1, radius: 8, pad: 24, shadow: { color: 'rgba(11,37,69,0.12)', blur: 12, offsetX: 0, offsetY: 4 }, stickerShadow: null,
      dots: null, dotStroke: null,
      fontTitle: 'Arial', fontBody: 'Arial', stickerStroke: false
    },
    minimal_mono: {
      label: 'Minimal', hint: 'Oq-qora, ko\'p bo\'sh joy, ingichka chiziq',
      bg: '#FFFFFF', bgs: ['#FFFFFF', '#F5F5F5', '#111111'],
      card: '#FFFFFF', ink: '#111111', muted: '#555555', onAccent: '#FFFFFF',
      accent: '#111111', accent2: '#E5E5E5', accent3: '#999999',
      bar: '#F2F2F2', highlight: '#F2F2F2', tag: '#F2F2F2',
      border: '#111111', borderW: 1, radius: 0, pad: 24, shadow: null, stickerShadow: null,
      dots: null, dotStroke: null,
      fontTitle: 'Arial', fontBody: 'Arial', stickerStroke: false
    },
    playful_kids: {
      label: 'Bolalar uchun', hint: 'Quvnoq ranglar, qalin chegara, yumaloq',
      bg: '#FFF9E6', bgs: ['#FFF9E6', '#E8FAF7', '#FFEDED', '#FFFFFF'],
      card: '#FFFFFF', ink: '#2D2A32', muted: '#4B4453', onAccent: '#FFFFFF',
      accent: '#FF6B6B', accent2: '#4ECDC4', accent3: '#FFD93D',
      bar: '#FFD93D', highlight: '#FFE8A3', tag: '#4ECDC4',
      border: '#2D2A32', borderW: 3, radius: 20, pad: 22, shadow: HARD(5, 5, '#2D2A32'), stickerShadow: HARD(3, 3, '#2D2A32'),
      dots: ['#FF6B6B', '#FFD93D', '#4ECDC4'], dotStroke: '#2D2A32',
      fontTitle: 'Comic Sans MS', fontBody: 'Trebuchet MS', stickerStroke: true
    },
    eco_green: {
      label: 'Tabiat (yashil)', hint: 'Ekologiya, sog\'liq: yashil va tabiiy',
      bg: '#F3F8F2', bgs: ['#F3F8F2', '#FFFFFF', '#E8F5E9', '#1B3A2B'],
      card: '#FFFFFF', ink: '#1B3A2B', muted: '#44624F', onAccent: '#FFFFFF',
      accent: '#2E7D32', accent2: '#A5D6A7', accent3: '#F9A825',
      bar: '#DCEFD9', highlight: '#E8F5E9', tag: '#E8F5E9',
      border: '#CFE3CC', borderW: 1, radius: 16, pad: 24, shadow: { color: 'rgba(27,58,43,0.12)', blur: 16, offsetX: 0, offsetY: 6 }, stickerShadow: null,
      dots: ['#2E7D32', '#F9A825', '#A5D6A7'], dotStroke: null,
      fontTitle: 'Georgia', fontBody: 'Verdana', stickerStroke: false
    },
    elegant_gold: {
      label: 'Oltin (elegant)', hint: 'To\'q fon, oltin rang, nafis serif',
      bg: '#14110F', bgs: ['#14110F', '#1F1A16', '#000000', '#F5EFE6'],
      card: '#1F1A16', ink: '#F5EFE6', muted: '#CDBFA8', onAccent: '#14110F',
      accent: '#C9A227', accent2: '#8C6D1F', accent3: '#E8D5A2',
      bar: '#2A231D', barInk: '#F5EFE6', highlight: '#2A231D', tag: '#2A231D',
      border: '#C9A227', borderW: 1.5, radius: 4, pad: 26, shadow: { color: 'rgba(0,0,0,0.5)', blur: 18, offsetX: 0, offsetY: 8 }, stickerShadow: null,
      dots: null, dotStroke: null,
      fontTitle: 'Georgia', fontBody: 'Georgia', stickerStroke: false
    }
  };
  var STYLE_ALIAS = {
    neo: 'neo_brutalism', brutal: 'neo_brutalism', brutalism: 'neo_brutalism', neobrutalism: 'neo_brutalism', 'neo-brutalism': 'neo_brutalism',
    retro: 'neo_brutalism', retro_window: 'neo_brutalism', window: 'neo_brutalism',
    modern: 'modern_cards', cards: 'modern_cards', card: 'modern_cards', modern_card: 'modern_cards', zamonaviy: 'modern_cards',
    academic: 'academic', akademik: 'academic', classic: 'academic', scientific: 'academic', ilmiy: 'academic',
    neon: 'dark_neon', dark: 'dark_neon', cyber: 'dark_neon', tech: 'dark_neon', qorongi: 'dark_neon',
    pastel: 'pastel_soft', soft: 'pastel_soft', yumshoq: 'pastel_soft',
    corporate: 'corporate_blue', business: 'corporate_blue', biznes: 'corporate_blue', korporativ: 'corporate_blue', report: 'corporate_blue',
    minimal: 'minimal_mono', mono: 'minimal_mono', monochrome: 'minimal_mono',
    kids: 'playful_kids', playful: 'playful_kids', bolalar: 'playful_kids', fun: 'playful_kids',
    eco: 'eco_green', green: 'eco_green', nature: 'eco_green', tabiat: 'eco_green', yashil: 'eco_green',
    gold: 'elegant_gold', elegant: 'elegant_gold', luxury: 'elegant_gold', oltin: 'elegant_gold'
  };
  function styleKey(s) {
    s = String(s || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    if (STYLES[s]) return s;
    return STYLE_ALIAS[s] || STYLE_ALIAS[s.replace(/_/g, '-')] || null;
  }
  var current = 'neo_brutalism';
  try { var saved = styleKey(localStorage.getItem('ssKitStyle')); if (saved) current = saved; } catch (e) {}
  function setStyle(k) { k = styleKey(k); if (!k) return; current = k; try { localStorage.setItem('ssKitStyle', k); } catch (e) {} }
  function resolveStyle(el) {
    var base = STYLES[styleKey(el && el.style) || current] || STYLES.neo_brutalism;
    var S = Object.assign({}, base);
    if (el) {                                     // AI/foydalanuvchi deck ranglarini berishi mumkin
      if (el.accent) S.accent = el.accent;
      if (el.accent2) { S.accent2 = el.accent2; S.bar = el.accent2; S.highlight = el.accent2; }
      if (el.cardFill || (el.fill && el.type === 'kit')) S.card = el.cardFill || el.fill;
      if (el.textColor || el.ink) { S.ink = el.textColor || el.ink; S.muted = el.textColor || el.ink; }
      if (el.border) S.border = el.border;
    }
    return S;
  }

  /* ------------------------------------------------------------------ 2) qo'shimcha shakllar (SHAPE_LIBRARY ga) */
  var LIB = window.SHAPE_LIBRARY || {};
  if (!LIB.sparkle) LIB.sparkle = ['Uchqun', 'M 50 0 C 54 34 66 46 100 50 C 66 54 54 66 50 100 C 46 66 34 54 0 50 C 34 46 46 34 50 0 Z'];
  if (!LIB.zigzag) LIB.zigzag = ['Zigzag', 'M 0 70 L 20 30 L 40 70 L 60 30 L 80 70 L 100 30'];
  if (!LIB.squiggle) LIB.squiggle = ['To\'lqin', 'M 0 50 C 12.5 20 12.5 20 25 50 C 37.5 80 37.5 80 50 50 C 62.5 20 62.5 20 75 50 C 87.5 80 87.5 80 100 50'];
  if (!LIB.blob) LIB.blob = ['Dog\'', 'M 52 2 C 78 0 98 18 99 44 C 100 70 84 96 56 99 C 28 102 4 86 1 58 C -2 30 22 4 52 2 Z'];
  var OPEN_PATHS = { zigzag: 1, squiggle: 1 };

  /* ------------------------------------------------------------------ 3) matn o'lchash (Fabric bilan ANIQ) */
  function textH(text, width, fs, o) {
    try {
      var tb = new fabric.Textbox(String(text || ' '), { width: width, fontSize: fs, fontFamily: o.fontFamily || 'Arial', fontWeight: o.fontWeight || 'normal', fontStyle: o.fontStyle || 'normal', lineHeight: o.lineHeight || 1.2 });
      return { h: tb.height, w: tb.width };
    } catch (e) { return { h: Math.ceil(String(text).length * fs * 0.55 / Math.max(20, width)) * fs * 1.36, w: width }; }
  }
  /** Matn elementi: shrift quti ichiga sig'guncha kichrayadi — hech qachon kartadan chiqmaydi */
  function T(text, l, t, w, h, fs, o) {
    o = o || {};
    var min = o.minFs || 11, lh = o.lineHeight || 1.2;
    fs = Math.round(fs);
    var m = textH(text, w, fs, Object.assign({ lineHeight: lh }, o));
    while (fs > min && (m.h > h + 0.5 || m.w > w + 0.5)) { fs -= 1; m = textH(text, w, fs, Object.assign({ lineHeight: lh }, o)); }
    var top = t;
    if (o.valign === 'middle') top = t + Math.max(0, (h - m.h) / 2);
    return {
      type: 'text', text: String(text), left: rnd(l), top: rnd(top), width: rnd(w), height: rnd(Math.max(m.h, 1)),
      fontSize: fs, fontWeight: o.fontWeight || 'normal', fontStyle: o.fontStyle || 'normal', fill: o.fill || '#111111',
      fontFamily: o.fontFamily || 'Arial', textAlign: o.textAlign || 'left', lineHeight: lh, ssRole: o.role || 'text'
    };
  }
  function R(l, t, w, h, o) {
    o = o || {};
    var r = { type: 'rect', left: rnd(l), top: rnd(t), width: rnd(w), height: rnd(h), fill: o.fill == null ? '#FFFFFF' : o.fill, rx: o.rx || 0, ry: o.rx || 0, ssRole: o.role || 'rect' };
    if (o.stroke && o.strokeWidth > 0) { r.stroke = o.stroke; r.strokeWidth = o.strokeWidth; }
    if (o.shadow) r.shadow = Object.assign({}, o.shadow);
    if (o.opacity != null) r.opacity = o.opacity;
    return r;
  }
  function C(l, t, d, o) {
    o = o || {};
    var c = { type: 'circle', left: rnd(l), top: rnd(t), radius: rnd(d / 2), width: rnd(d), height: rnd(d), fill: o.fill || '#111111', ssRole: o.role || 'dot' };
    if (o.stroke && o.strokeWidth > 0) { c.stroke = o.stroke; c.strokeWidth = o.strokeWidth; }
    if (o.shadow) c.shadow = Object.assign({}, o.shadow);
    if (o.opacity != null) c.opacity = o.opacity;
    return c;
  }
  function SHP(name, l, t, w, h, o) {
    o = o || {};
    var s = { type: 'shape', shape: name, left: rnd(l), top: rnd(t), width: rnd(w), height: rnd(h), fill: o.fill || '#111111', ssRole: o.role || 'sticker', strokeUniform: true };
    if (o.stroke && o.strokeWidth > 0) { s.stroke = o.stroke; s.strokeWidth = o.strokeWidth; } else s.strokeWidth = 0;
    if (o.shadow) s.shadow = Object.assign({}, o.shadow);
    if (o.opacity != null) s.opacity = o.opacity;
    if (o.angle) s.angle = o.angle;
    return s;
  }
  function frame(L, Tp, W, H, S, o) {
    o = o || {};
    return R(L, Tp, W, H, { fill: o.fill || S.card, rx: S.radius, stroke: S.borderW > 0 ? S.border : null, strokeWidth: S.borderW, shadow: o.noShadow ? null : S.shadow, role: 'frame' });
  }
  function windowBar(L, Tp, W, S, title, out) {
    var BH = S.radius >= 12 ? 38 : 40;
    var barRx = Math.min(S.radius, 8);
    out.push(R(L, Tp, W, BH, { fill: S.bar, rx: barRx, stroke: S.borderW > 0 ? S.border : null, strokeWidth: S.borderW, role: 'bar' }));
    var x = L + 14;
    if (S.dots) {
      S.dots.forEach(function (c, i) { out.push(C(L + 14 + i * 20, Tp + (BH - 12) / 2 + S.borderW / 2, 12, { fill: c, stroke: S.dotStroke, strokeWidth: S.dotStroke ? 2 : 0 })); });
      x = L + 14 + S.dots.length * 20 + 8;
    }
    if (title) out.push(T(title, x, Tp + 4, Math.max(40, L + W - 12 - x), BH - 8, 16, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.barInk || S.ink, valign: 'middle', role: 'title', minFs: 10 }));
    return BH;
  }

  /* ------------------------------------------------------------------ 4) TO'PLAM ELEMENTLARI */
  // Har biri: build(o, S) → oddiy elementlar ro'yxati (AI sxemasi bilan bir xil: rect/circle/text/shape/line)
  var ITEMS = {};
  function item(id, cat, label, size, build) { ITEMS[id] = { id: id, cat: cat, label: label, size: size, build: build }; }

  // ---- Kartochkalar
  item('card', 'cards', 'Kartochka', [360, 220], function (o, S) {
    var out = [frame(o.left, o.top, o.width, o.height, S)], p = S.pad;
    var th = Math.min(70, o.height * 0.32);
    out.push(T(o.title || 'Sarlavha', o.left + p, o.top + p, o.width - 2 * p, th, 26, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.ink, role: 'title' }));
    out.push(T(o.text || 'Bu yerga qisqa matn yozing.', o.left + p, o.top + p + th + 8, o.width - 2 * p, o.height - 2 * p - th - 8, 18, { fontFamily: S.fontBody, fill: S.muted, role: 'body' }));
    return out;
  });
  item('window_card', 'cards', 'Retro oyna', [400, 260], function (o, S) {
    var out = [frame(o.left, o.top, o.width, o.height, S)], p = S.pad;
    var BH = windowBar(o.left, o.top, o.width, S, o.title || 'fikr.txt', out);
    var y = o.top + BH + p * 0.8, avail = o.height - BH - p * 1.8;
    if (o.heading) {
      var hh = Math.min(48, avail * 0.35);
      out.push(T(o.heading, o.left + p, y, o.width - 2 * p, hh, 24, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.ink, role: 'heading' }));
      y += hh + 6; avail -= hh + 6;
    }
    out.push(T(o.text || 'Asosiy fikrni shu yerga yozing.', o.left + p, y, o.width - 2 * p, avail, 18, { fontFamily: S.fontBody, fill: S.muted, role: 'body' }));
    return out;
  });
  item('stat_card', 'cards', 'Raqam', [260, 180], function (o, S) {
    var out = [frame(o.left, o.top, o.width, o.height, S)], p = S.pad;
    var nh = o.height * 0.5;
    out.push(T(String(o.number || o.value || '85%'), o.left + p, o.top + p, o.width - 2 * p, nh, 60, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.accent, role: 'number', minFs: 20 }));
    out.push(T(o.label || o.text || 'Ko\'rsatkich nomi', o.left + p, o.top + p + nh + 4, o.width - 2 * p, o.height - 2 * p - nh - 4, 17, { fontFamily: S.fontBody, fill: S.muted, role: 'body' }));
    return out;
  });
  item('quote_card', 'cards', 'Iqtibos', [520, 200], function (o, S) {
    var out = [frame(o.left, o.top, o.width, o.height, S)], p = S.pad;
    out.push(R(o.left + p, o.top + p, 6, o.height - 2 * p, { fill: S.accent, rx: 3, role: 'accent' }));
    var x = o.left + p + 6 + 18, w = o.width - (x - o.left) - p, ah = 26;
    out.push(T('“' + String(o.text || 'Ilhomlantiruvchi iqtibos shu yerda.').replace(/^["“]|["”]$/g, '') + '”', x, o.top + p, w, o.height - 2 * p - ah - 6, 22, { fontFamily: S.fontTitle, fontStyle: 'italic', fill: S.ink, role: 'body' }));
    out.push(T('— ' + (o.author || o.title || 'Muallif'), x, o.top + o.height - p - ah, w, ah, 15, { fontFamily: S.fontBody, fontWeight: 'bold', fill: S.muted, role: 'author' }));
    return out;
  });
  item('step_card', 'cards', 'Qadam', [300, 200], function (o, S) {
    var out = [frame(o.left, o.top, o.width, o.height, S)], p = S.pad, d = 44;
    out.push(C(o.left + p, o.top + p, d, { fill: S.accent, stroke: S.borderW >= 2 ? S.border : null, strokeWidth: S.borderW >= 2 ? 2 : 0, role: 'badge' }));
    out.push(T(String(o.number || '1'), o.left + p, o.top + p, d, d, 20, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.onAccent, textAlign: 'center', valign: 'middle', role: 'number', minFs: 12 }));
    var x = o.left + p + d + 14;
    out.push(T(o.title || 'Qadam nomi', x, o.top + p, o.left + o.width - p - x, d, 20, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.ink, valign: 'middle', role: 'title' }));
    out.push(T(o.text || 'Qisqa izoh.', o.left + p, o.top + p + d + 12, o.width - 2 * p, o.height - 2 * p - d - 12, 17, { fontFamily: S.fontBody, fill: S.muted, role: 'body' }));
    return out;
  });
  item('list_card', 'cards', 'Ro\'yxat', [400, 260], function (o, S) {
    var out = [frame(o.left, o.top, o.width, o.height, S)], p = S.pad;
    var items = Array.isArray(o.items) ? o.items : String(o.text || 'Birinchi afzallik\nIkkinchi afzallik\nUchinchi afzallik').split(/\n+/);
    items = items.map(function (s) { return String(s).replace(/^\s*[-•*✓]\s*/, '').trim(); }).filter(Boolean).slice(0, 6);
    var th = 36;
    out.push(T(o.title || 'Afzalliklar', o.left + p, o.top + p, o.width - 2 * p, th, 24, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.ink, role: 'title' }));
    var y = o.top + p + th + 10, rowH = Math.min(46, (o.top + o.height - p - y) / Math.max(1, items.length)), m = Math.min(22, rowH - 6);
    items.forEach(function (s, i) {
      var ry = y + i * rowH;
      out.push(SHP('check', o.left + p, ry + (rowH - m) / 2 - 2, m, m, { fill: S.accent, role: 'marker' }));
      out.push(T(s, o.left + p + m + 12, ry, o.width - 2 * p - m - 12, rowH - 4, 18, { fontFamily: S.fontBody, fill: S.ink, valign: 'middle', role: 'item' }));
    });
    return out;
  });
  item('tag_pill', 'cards', 'Teg', [180, 48], function (o, S) {
    var r = R(o.left, o.top, o.width, o.height, { fill: S.tag, rx: o.height / 2, stroke: S.borderW > 0 ? S.border : null, strokeWidth: Math.min(S.borderW, 2), shadow: S.stickerShadow, role: 'frame' });
    return [r, T(o.text || o.title || 'YANGI', o.left + 12, o.top + 4, o.width - 24, o.height - 8, 18, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.tag === '#EEF2FF' ? S.accent : S.ink, textAlign: 'center', valign: 'middle', role: 'title', minFs: 10 })];
  });

  // ---- Ramkalar / bloklar
  item('window_frame', 'frames', 'Oyna ramka', [480, 300], function (o, S) {
    var out = [frame(o.left, o.top, o.width, o.height, S)];
    windowBar(o.left, o.top, o.width, S, o.title || 'rasm.png', out);
    return out;
  });
  item('browser_frame', 'frames', 'Brauzer ramka', [520, 320], function (o, S) {
    var out = [frame(o.left, o.top, o.width, o.height, S)];
    var BH = windowBar(o.left, o.top, o.width, S, null, out);
    var x = o.left + 14 + (S.dots ? S.dots.length * 20 + 8 : 0);
    out.push(R(x, o.top + 8, o.left + o.width - 14 - x, BH - 16, { fill: S.card, rx: (BH - 16) / 2, stroke: S.borderW > 0 ? S.border : null, strokeWidth: Math.min(2, S.borderW), role: 'address' }));
    out.push(T(o.title || 'slidestudio.uz', x + 12, o.top + 9, o.left + o.width - 26 - x - 12, BH - 18, 13, { fontFamily: S.fontBody, fill: S.muted, valign: 'middle', role: 'title', minFs: 9 }));
    return out;
  });
  item('photo_frame', 'frames', 'Rasm ramkasi', [360, 260], function (o, S) {
    return [R(o.left, o.top, o.width, o.height, { fill: S.card, rx: S.radius, stroke: S.border, strokeWidth: Math.max(2, S.borderW * 2), shadow: S.shadow, role: 'frame' })];
  });
  item('highlight_box', 'frames', 'Ajratilgan blok', [440, 120], function (o, S) {
    var p = S.pad;
    return [R(o.left, o.top, o.width, o.height, { fill: S.highlight, rx: S.radius, stroke: S.borderW > 0 ? S.border : null, strokeWidth: S.borderW, shadow: S.shadow, role: 'frame' }),
      T(o.text || 'Muhim fikr — eng asosiy xulosa shu yerda.', o.left + p, o.top + p * 0.7, o.width - 2 * p, o.height - p * 1.4, 22, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.ink, valign: 'middle', role: 'body' })];
  });
  item('title_banner', 'frames', 'Sarlavha bandi', [640, 96], function (o, S) {
    var p = S.pad;
    return [R(o.left, o.top, o.width, o.height, { fill: S.accent, rx: S.radius, stroke: S.borderW >= 2 ? S.border : null, strokeWidth: S.borderW, shadow: S.shadow, role: 'frame' }),
      T(o.text || o.title || 'Katta sarlavha', o.left + p, o.top + 8, o.width - 2 * p, o.height - 16, 40, { fontFamily: S.fontTitle, fontWeight: 'bold', fill: S.onAccent, valign: 'middle', role: 'title' })];
  });
  item('divider', 'frames', 'Chiziq', [400, 0], function (o, S) {
    return [{ type: 'line', left: o.left, top: o.top, width: o.width, height: 0, stroke: o.stroke || S.ink, strokeWidth: Math.max(2, S.borderW + 1), strokeLineCap: 'butt', ssRole: 'line' }];
  });

  // ---- Stikerlar / dekorativ shakllar (hammasi PowerPoint'da tahrirlanadigan shakl bo'lib chiqadi)
  var STICKERS = [['star5', 'Yulduz'], ['sparkle', 'Uchqun'], ['star4', '4 qirrali yulduz'], ['burst', 'Portlash'], ['heart', 'Yurak'], ['lightning', 'Chaqmoq'],
    ['arrow_right', 'Strelka'], ['check', 'Galochka'], ['plus', 'Plyus'], ['triangle', 'Uchburchak'], ['diamond', 'Romb'], ['ring', 'Halqa'],
    ['speech', 'Gap pufagi'], ['half_circle', 'Yarim doira'], ['blob', 'Dog\''], ['zigzag', 'Zigzag'], ['squiggle', 'To\'lqin'], ['circle', 'Doira']];
  STICKERS.forEach(function (s, i) {
    item('sticker_' + s[0], 'stickers', s[1], OPEN_PATHS[s[0]] ? [160, 60] : [110, 110], function (o, S) {
      var cols = [S.accent, S.accent2, S.accent3];
      var fill = o.fill && o.type !== 'kit' ? o.fill : (o.color || cols[i % 3]);
      var st = S.stickerStroke ? { stroke: S.border, strokeWidth: S.borderW } : {};
      if (s[0] === 'circle') return [C(o.left, o.top, Math.min(o.width, o.height), Object.assign({ fill: fill, shadow: S.stickerShadow, role: 'sticker' }, st))];
      if (OPEN_PATHS[s[0]]) return [SHP(s[0], o.left, o.top, o.width, o.height, { fill: 'none', stroke: fill, strokeWidth: 6, role: 'sticker' })];
      return [SHP(s[0], o.left, o.top, o.width, o.height, Object.assign({ fill: fill, shadow: S.stickerShadow, angle: o.angle }, st))];
    });
  });

  // ---- Fon uslublari (slayd foni + dekor; dekor doim eng orqada)
  item('bg_plain', 'backgrounds', 'Toza fon', [SW, SH], function () { return []; });
  item('bg_corners', 'backgrounds', 'Burchak stikerlari', [SW, SH], function (o, S) {
    var st = S.stickerStroke ? { stroke: S.border, strokeWidth: S.borderW } : {};
    return [SHP('burst', 820, 24, 110, 110, Object.assign({ fill: S.accent2, shadow: S.stickerShadow, role: 'bgdecor' }, st)),
      SHP('sparkle', 32, 446, 64, 64, Object.assign({ fill: S.accent, role: 'bgdecor' }, st)),
      C(890, 470, 36, Object.assign({ fill: S.accent3, role: 'bgdecor' }, st))];
  });
  item('bg_soft', 'backgrounds', 'Yumshoq dog\'lar', [SW, SH], function (o, S) {
    return [{ type: 'ellipse', left: 700, top: -120, width: 380, height: 300, fill: S.accent, opacity: 0.12, ssRole: 'bgdecor' },
      { type: 'ellipse', left: -140, top: 360, width: 360, height: 280, fill: S.accent2, opacity: 0.14, ssRole: 'bgdecor' }];
  });
  item('bg_rules', 'backgrounds', 'Akademik chiziqlar', [SW, SH], function (o, S) {
    return [R(0, 0, SW, 8, { fill: S.accent, role: 'bgdecor' }),
      { type: 'line', left: 48, top: 496, width: SW - 96, height: 0, stroke: S.ink, strokeWidth: 1, strokeLineCap: 'butt', ssRole: 'bgdecor' }];
  });
  item('bg_frame', 'backgrounds', 'Ramkali fon', [SW, SH], function (o, S) {
    return [R(18, 18, SW - 36 - Math.max(1, S.borderW), SH - 36 - Math.max(1, S.borderW), { fill: '', rx: S.radius, stroke: S.border, strokeWidth: Math.max(1, S.borderW), role: 'bgdecor' })];
  });

  var ITEM_ALIAS = {
    window: 'window_card', retro_window: 'window_card', retro: 'window_card', oyna: 'window_card',
    stat: 'stat_card', number: 'stat_card', kpi: 'stat_card', quote: 'quote_card', step: 'step_card', list: 'list_card', checklist: 'list_card',
    tag: 'tag_pill', pill: 'tag_pill', badge: 'tag_pill', frame: 'photo_frame', image_frame: 'photo_frame', banner: 'title_banner',
    highlight: 'highlight_box', callout: 'highlight_box', browser: 'browser_frame', line: 'divider'
  };
  function itemKey(k) {
    k = String(k || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    if (ITEMS[k]) return k;
    if (ITEM_ALIAS[k]) return ITEM_ALIAS[k];
    if (ITEMS['sticker_' + k]) return 'sticker_' + k;
    if (ITEMS['bg_' + k]) return 'bg_' + k;
    return null;
  }

  /* ------------------------------------------------------------------ 5) yoyish (kit → oddiy elementlar) */
  var seq = 0;
  function isKitEl(e) { return !!(e && typeof e === 'object' && (e.type === 'kit' || (e.type && !/^sticker_|^bg_/.test(e.type) && ITEMS[e.type] && ITEMS[e.type].cat !== 'stickers'))); }
  function expand(el) {
    var key = itemKey(el.item || el.name || (el.type !== 'kit' ? el.type : '')) || 'card';
    var it = ITEMS[key], S = resolveStyle(el);
    var o = Object.assign({}, el);
    o.width = num(el.width, it.size[0]); o.height = num(el.height, it.size[1]);
    o.left = num(el.left, Math.round((SW - o.width) / 2)); o.top = num(el.top, Math.round((SH - o.height) / 2));
    if (it.cat === 'backgrounds') { o.left = 0; o.top = 0; }
    var parts = it.build(o, S) || [];
    var id = 'kit_' + Date.now().toString(36) + '_' + (seq++);
    parts.forEach(function (p) {
      p.ssKit = id; p.ssKitItem = key;
      if (el.animation && p.ssRole !== 'bgdecor') { p.animation = el.animation; if (el.animDuration) p.animDuration = el.animDuration; if (el.animDelay) p.animDelay = el.animDelay; }
    });
    return parts;
  }
  function expandList(list) {
    if (!Array.isArray(list)) return list;
    var out = [], decor = [];
    list.forEach(function (e) {
      if (isKitEl(e)) {
        var parts = expand(e);
        if (ITEMS[itemKey(e.item || e.name || (e.type !== 'kit' ? e.type : '')) || 'card'].cat === 'backgrounds') decor = decor.concat(parts);
        else out = out.concat(parts);
      } else out.push(e);
    });
    return decor.concat(out);                     // fon dekori eng orqada
  }

  /* ------------------------------------------------------------------ 6) AI ulanishi */
  try { if (typeof SERIALIZE_PROPS !== 'undefined') ['ssKit', 'ssRole', 'ssKitItem'].forEach(function (k) { if (SERIALIZE_PROPS.indexOf(k) < 0) SERIALIZE_PROPS.push(k); }); } catch (e) {}

  function postProps(obj, el) {
    if (!obj || !el) return obj;
    try {
      if (el.ssKit) { obj.ssKit = el.ssKit; obj.ssRole = el.ssRole || 'part'; obj.ssKitItem = el.ssKitItem || null; }
      // eski xato: `el.left || 50` — 0 koordinata 50 ga aylanardi (to'liq ekran foni / chetdagi chiziq siljib ketardi)
      if (el.left === 0 && obj.type !== 'group') obj.set('left', 0);
      if (el.top === 0 && obj.type !== 'group') obj.set('top', 0);
      if (el.fill === 'none' || el.fill === 'transparent' || (el.fill === '' && el.type !== 'text')) obj.set('fill', '');
      if (el.strokeUniform) obj.set('strokeUniform', true);
      if (el.strokeLineCap) obj.set('strokeLineCap', el.strokeLineCap);
      if (el.strokeLineJoin) obj.set('strokeLineJoin', el.strokeLineJoin);
      if (el.stroke && el.strokeWidth === 0 && obj.type !== 'line') obj.set('strokeWidth', 0);
      if (el.stroke && num(el.strokeWidth, 0) > 0 && el.type === 'circle') obj.set({ stroke: el.stroke, strokeWidth: +el.strokeWidth });
      if (el.shadow === 'hard' || el.shadow === 'brutal') obj.set('shadow', new fabric.Shadow(HARD(6, 6)));
      else if (el.shadow && typeof el.shadow === 'object') obj.set('shadow', new fabric.Shadow({ color: el.shadow.color || '#000000', blur: num(el.shadow.blur, 0), offsetX: num(el.shadow.offsetX, 0), offsetY: num(el.shadow.offsetY, 0) }));
      if (el.type === 'text' || el.type === 'textbox') {
        if (el.fontStyle) obj.set('fontStyle', el.fontStyle);
        if (el.ssKit && typeof el.height === 'number') obj._aiBoxH = el.height;
      }
      obj.setCoords && obj.setCoords();
    } catch (e) { console.warn('[kit] props', e); }
    return obj;
  }

  async function partsToObjects(parts, parse) {
    var objs = [];
    for (var i = 0; i < parts.length; i++) {
      var o = await parse(parts[i]);
      if (o) objs.push(o);
    }
    return objs;
  }

  function hookParse() {
    var prev = window.parseElementToFabric;
    if (typeof prev !== 'function' || prev.__ssKit) return false;
    var w = async function (el) {
      if (isKitEl(el)) {
        // bitta element sifatida (add_element) kelsa — guruh; PPTX eksport guruhni baribir alohida tahrirlanadigan shakllarga yoyadi
        var objs = await partsToObjects(expand(el), w);
        if (!objs.length) return null;
        if (objs.length === 1) return objs[0];
        var g = new fabric.Group(objs, { subTargetCheck: false });
        g.ssKit = objs[0].ssKit; g.ssRole = 'group';
        try { if (typeof ensureObjectId === 'function') ensureObjectId(g); } catch (e) {}
        return g;
      }
      var obj = await prev.apply(this, arguments);
      return postProps(obj, el);
    };
    w.__ssKit = true; w.__ssWrapped = prev.__ssWrapped; w.__ssShapes = prev.__ssShapes; w.__v48 = prev.__v48;
    window.parseElementToFabric = w;
    return true;
  }
  function hookLayout() {
    var orig = window.ssFixCardLayout;
    if (typeof orig !== 'function' || orig.__ssKit) return;
    var w = function (elements) {
      if (!Array.isArray(elements)) return elements;
      // kit elementi tartiblashda oddiy KARTA (rect) deb qaraladi — keyin bo'laklarga yoyiladi
      var marked = elements.map(function (e) {
        if (!isKitEl(e)) return e;
        var k = itemKey(e.item || e.name || (e.type !== 'kit' ? e.type : '')) || 'card';
        if (ITEMS[k].cat === 'backgrounds') return e;
        return Object.assign({}, e, { type: 'rect', __kitType: e.type });
      });
      var fixed;
      try { fixed = orig(marked); } catch (e) { console.warn('[kit] layout', e); fixed = marked; }
      return expandList(fixed.map(function (e) { if (e && e.__kitType) { var c = Object.assign({}, e, { type: e.__kitType }); delete c.__kitType; return c; } return e; }));
    };
    w.__ssKit = true;
    window.ssFixCardLayout = w;
  }
  function hookCardFit() {
    // CardFit (avto-tekislash) to'plam bo'laklarini bir-biridan ajratib yubormasin: ular o'z o'lchami bilan qoladi
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var cf = window.CardFit;
      if (cf && typeof cf.fit === 'function' && (cf.__ssV36 || tries > 40)) {
        clearInterval(t);
        if (cf.__ssKit) return;
        var orig = cf.fit;
        cf.fit = function (cv) {
          var kept = [];
          try { (cv.getObjects() || []).forEach(function (o, i) { if (o && o.ssKit) kept.push({ o: o, i: i }); }); kept.forEach(function (k) { cv.remove(k.o); }); } catch (e) {}
          try { return orig.apply(this, arguments); }
          finally { kept.forEach(function (k) { try { cv.insertAt(k.o, Math.min(k.i, cv.getObjects().length)); } catch (e) { cv.add(k.o); } }); }
        };
        cf.__ssKit = true;
      } else if (tries > 80) clearInterval(t);
    }, 100);
  }
  hookParse(); hookLayout(); hookCardFit();
  // boshqa modullar keyinroq o'rab qo'ysa ham — biz eng tashqi qatlam bo'lib qolamiz
  setTimeout(function () { hookParse(); hookLayout(); }, 1500);

  /* ------------------------------------------------------------------ 7) foydalanuvchi: slaydga qo'shish */
  function cv() { return (typeof canvas !== 'undefined' && canvas) ? canvas : null; }
  function saveState() {
    try { if (typeof saveCurrentSlideState === 'function') saveCurrentSlideState(); } catch (e) {}
    try { if (typeof recordGlobalState === 'function') recordGlobalState(); } catch (e) {}
    try { if (typeof refreshSlideThumb === 'function' && typeof activeIndex !== 'undefined') refreshSlideThumb(activeIndex); } catch (e) {}
  }
  async function insert(id, opts) {
    var c = cv(); if (!c) return [];
    var key = itemKey(id); if (!key) return [];
    var it = ITEMS[key];
    if (it.cat === 'backgrounds') return applyBackground(key, opts && opts.bg);
    var parts = expand(Object.assign({ type: 'kit', item: key, style: current }, opts || {}));
    var objs = await partsToObjects(parts, window.parseElementToFabric);
    objs.forEach(function (o) { try { if (typeof ensureObjectId === 'function') ensureObjectId(o); } catch (e) {} c.add(o); });
    try {
      c.discardActiveObject();
      if (objs.length > 1) c.setActiveObject(new fabric.ActiveSelection(objs, { canvas: c }));
      else if (objs[0]) c.setActiveObject(objs[0]);
    } catch (e) {}
    c.requestRenderAll();
    saveState();
    return objs;
  }
  async function applyBackground(key, color) {
    var c = cv(); if (!c) return [];
    var S = resolveStyle({ style: current });
    c.getObjects().filter(function (o) { return o.ssRole === 'bgdecor'; }).forEach(function (o) { c.remove(o); });
    await new Promise(function (r) { c.setBackgroundColor(color || S.bg, r); });
    var objs = await partsToObjects(expand({ type: 'kit', item: key, style: current }), window.parseElementToFabric);
    for (var i = objs.length - 1; i >= 0; i--) { try { if (typeof ensureObjectId === 'function') ensureObjectId(objs[i]); } catch (e) {} c.add(objs[i]); c.sendToBack(objs[i]); }
    c.requestRenderAll();
    saveState();
    return objs;
  }

  /* ------------------------------------------------------------------ 8) «+» menyusi */
  var css = document.createElement('style');
  css.textContent = [
    '#ssKitMenu{position:fixed;z-index:3000;width:min(392px,calc(100vw - 24px));max-height:min(74vh,620px);display:none;flex-direction:column;background:#fff;color:#1f2937;',
    ' border:1px solid #dadce0;border-radius:16px;box-shadow:0 14px 44px rgba(0,0,0,.22);font:13px/1.35 inherit;font-family:inherit;overflow:hidden}',
    '#ssKitMenu.open{display:flex}',
    '#ssKitMenu .kh{padding:12px 12px 8px;border-bottom:1px solid #eef0f3}',
    '#ssKitMenu .kst{display:flex;gap:6px;flex-wrap:wrap}',
    '#ssKitMenu .kst button,#ssKitMenu .ktb button{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:5px 10px;cursor:pointer;font:12px inherit;font-family:inherit;color:#374151}',
    '#ssKitMenu .kst button.on{background:#111827;color:#fff;border-color:#111827}',
    '#ssKitMenu .ktb{display:flex;gap:4px;padding:8px 12px 0;flex-wrap:wrap}',
    '#ssKitMenu .ktb button{border-radius:8px}',
    '#ssKitMenu .ktb button.on{background:#eef2ff;border-color:#6366f1;color:#3730a3;font-weight:600}',
    '#ssKitMenu .kgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 12px 12px;overflow:auto}',
    '#ssKitMenu .kit{border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;cursor:pointer;padding:6px 6px 5px;display:flex;flex-direction:column;align-items:center;gap:4px;font:11px inherit;font-family:inherit;color:#374151}',
    '#ssKitMenu .kit:hover{border-color:#6366f1;background:#fff}',
    '#ssKitMenu .kit img{width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:6px;background:#fff}',
    '#ssKitMenu .kit span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
    '#ssKitMenu .ksw{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 12px}',
    '#ssKitMenu .ksw button{width:30px;height:30px;border-radius:8px;border:1px solid #cbd5e1;cursor:pointer}',
    '#ssKitMenu .kcap{padding:2px 12px 0;color:#6b7280;font-size:11px}',
    // v67: toolbar boshidagi alohida «Dizayn» tugmasi (rasm yuklovchi «+» o'z holicha qoldi)
    '.toolbar-container #ssKitBtn.ss-kit-btn{width:auto!important;min-width:0;padding:0 12px 0 9px!important;border-radius:999px!important}',
    '#ssKitBtn.ss-kit-btn{gap:5px;display:inline-flex;align-items:center;color:#fff;',
    ' background:linear-gradient(135deg,#ff5c8a,#7c3aed);font-weight:600;font-size:13px;white-space:nowrap}',
    '#ssKitBtn.ss-kit-btn:hover{filter:brightness(1.08)}',
    '#ssKitBtn.ss-kit-btn.on{box-shadow:0 0 0 2px #fff,0 0 0 4px #7c3aed}',
    '#ssKitBtn .material-symbols-outlined{font-size:19px;color:#fff}',
    '@media (max-width:760px){.toolbar-container #ssKitBtn.ss-kit-btn{padding:0 8px!important}#ssKitBtn .ss-kit-lbl{display:none}}',
    '#ssKitBtnMob.ss-kit-mab{color:#fff;background:linear-gradient(135deg,#ff5c8a,#7c3aed);border-color:transparent;font-weight:600}',
    '#ssKitBtnMob.ss-kit-mab .material-symbols-outlined{color:#fff}'
  ].join('');
  document.head.appendChild(css);

  // v68: birinchi bo'lim — «Mavzular» (51_design_themes.js): butun slayd(lar) dizayni, PowerPoint'dagi kabi
  var TABS = [['themes', 'Mavzular'], ['cards', 'Kartochkalar'], ['frames', 'Ramkalar'], ['stickers', 'Stikerlar'], ['backgrounds', 'Fon']];
  var tab = 'themes', menu = null, previewCache = {};

  async function preview(key, styleK) {
    var ck = styleK + '|' + key;
    if (previewCache[ck]) return previewCache[ck];
    var it = ITEMS[key], isBg = it.cat === 'backgrounds';
    var w = it.size[0], h = Math.max(it.size[1], 8);
    var parts = expand({ type: 'kit', item: key, style: styleK, left: 0, top: isBg ? 0 : 0, width: w, height: it.size[1] });
    var el = document.createElement('canvas');
    var PW = 240, PH = 135;
    el.width = PW; el.height = PH;
    var sc = new fabric.StaticCanvas(el, { enableRetinaScaling: false, renderOnAddRemove: false, backgroundColor: isBg ? STYLES[styleK].bg : '#ffffff' });
    var pad = isBg ? 0 : 14, z = Math.min((PW - 2 * pad) / (w + 10), (PH - 2 * pad) / (h + 10));
    if (isBg) z = PW / SW;
    sc.setViewportTransform([z, 0, 0, z, isBg ? 0 : (PW - w * z) / 2, isBg ? 0 : (PH - h * z) / 2]);
    var raw = window.parseElementToFabric;
    for (var i = 0; i < parts.length; i++) { try { var o = await raw(parts[i]); if (o) sc.add(o); } catch (e) {} }
    sc.renderAll();
    var url = '';
    try { url = el.toDataURL('image/png'); } catch (e) {}
    try { sc.dispose(); } catch (e) {}
    previewCache[ck] = url;
    return url;
  }

  function buildMenu() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'ssKitMenu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', "Slaydga qo'shish");
    menu.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(menu);
    document.addEventListener('mousedown', function (e) { if (menu.classList.contains('open') && !(e.target.closest && e.target.closest('.ss-kit-trigger'))) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    return menu;
  }
  function render() {
    var m = buildMenu();
    // rasm yuklash bu yerda yo'q — u uchun slayd burchagidagi «+» tugmasi bor
    var TH = window.SS_THEMES;
    if (tab === 'themes' && !TH) tab = 'cards';
    var h = tab === 'themes' ? '' : '<div class="kh"><div class="kcap" style="padding:0 0 6px">Uslub (ranglar)</div><div class="kst">' + Object.keys(STYLES).map(function (k) { return '<button type="button" data-style="' + k + '" class="' + (k === current ? 'on' : '') + '" title="' + STYLES[k].hint + '">' + STYLES[k].label + '</button>'; }).join('') + '</div></div>';
    h += '<div class="ktb">' + TABS.filter(function (t) { return t[0] !== 'themes' || TH; }).map(function (t) { return '<button type="button" data-tab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (tab === 'backgrounds') {
      h += '<div class="kcap">Fon rangi</div><div class="ksw" style="padding-top:6px">' + STYLES[current].bgs.map(function (c) { return '<button type="button" data-bg="' + c + '" title="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div>';
    }
    if (tab === 'themes') {
      m.innerHTML = h + TH.html();
      m.onclick = function (e) {
        e.stopPropagation();
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
        TH.onClick(b, render, close);
      };
      TH.bind(m, close);
      return;
    }
    var keys = Object.keys(ITEMS).filter(function (k) { return ITEMS[k].cat === tab; });
    h += '<div class="kgrid">' + keys.map(function (k) { return '<button type="button" class="kit" data-item="' + k + '" title="' + ITEMS[k].label + '"><img alt="" data-prev="' + k + '"><span>' + ITEMS[k].label + '</span></button>'; }).join('') + '</div>';
    m.innerHTML = h;
    m.onclick = function (e) {
      e.stopPropagation();
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      if (b.dataset.style) { setStyle(b.dataset.style); render(); return; }
      if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
      if (b.dataset.bg) { applyBackground('bg_plain', b.dataset.bg); return; }
      if (b.dataset.item) { insert(b.dataset.item).then(function (objs) { if (objs && objs.length) toast(ITEMS[b.dataset.item].label + " qo'shildi"); }); if (ITEMS[b.dataset.item].cat !== 'backgrounds') close(); }
    };
    var imgs = m.querySelectorAll('img[data-prev]'), st = current;
    (async function () {
      for (var i = 0; i < imgs.length; i++) {
        var u = await preview(imgs[i].getAttribute('data-prev'), st);
        if (st !== current) return;
        if (u) imgs[i].src = u;
      }
    })();
  }
  function place(anchor) {
    if (!menu) return;
    var r = anchor ? anchor.getBoundingClientRect() : { left: 20, bottom: 80, top: 60 };
    var mw = menu.offsetWidth || 392, mh = menu.offsetHeight || 480;
    var x = Math.max(12, Math.min(r.left, window.innerWidth - mw - 12));
    var y = r.bottom + 8;
    if (y + mh > window.innerHeight - 12) y = Math.max(12, window.innerHeight - mh - 12);
    menu.style.left = Math.round(x) + 'px'; menu.style.top = Math.round(y) + 'px';
  }
  function btnState(on) { Array.prototype.forEach.call(document.querySelectorAll('.ss-kit-trigger'), function (b) { b.classList.toggle('on', on); b.setAttribute('aria-expanded', on ? 'true' : 'false'); }); }
  function open(anchor) { render(); menu.classList.add('open'); place(anchor || document.getElementById('ssKitBtn')); btnState(true); }
  function close() { if (menu) menu.classList.remove('open'); btnState(false); }
  function toggle(anchor) { if (menu && menu.classList.contains('open')) close(); else open(anchor); }

  window.SS_KIT = {
    STYLES: STYLES, ITEMS: ITEMS, expand: expand, expandList: expandList, isKitEl: isKitEl,
    insert: insert, applyBackground: applyBackground, setStyle: setStyle,
    get style() { return current; },
    openMenu: open, closeMenu: close, toggleMenu: toggle, preview: preview
  };
})();
