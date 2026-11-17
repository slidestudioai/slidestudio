/* js/51_design_themes.js (v68) — DIZAYN MAVZULARI (PowerPoint / LibreOffice'dagi «Dizayn → Mavzular» kabi).
 *
 * Avval «Dizayn» menyusi faqat bitta kartochka/stikerni har xil rangda qo'shardi. Endi birinchi bo'lim — «Mavzular»:
 * 32 ta tayyor mavzu. Har biri: fon rangi + chetlardagi bezak (dekor) + sarlavha/matn ranglari + shriftlar
 * + mos kartochka uslubi. Mavzu bosilganda u SHU slaydga yoki HAMMA slaydlarga qo'llanadi (tanlov menyuda).
 *
 *  - Bezak faqat slayd CHETLARIDA turadi (matnga xalaqit bermaydi), eng orqada, tanlab/surib bo'lmaydi
 *    (ssRole: 'bgdecor', ssKitItem: 'theme_<id>'). Boshqa mavzu tanlansa — almashtiriladi.
 *  - Faqat oddiy bo'laklar (rect, circle, ellipse, path) — PowerPoint'ga (.pptx) tahrirlanadigan shakl bo'lib chiqadi.
 *  - Slayddagi matnlar: slayd fonida turgan matnlar mavzu rangi va shriftini oladi
 *    (kartochka / shakl ustidagi matnlar o'z holicha qoladi — o'qilishi buzilmasin).
 *  - Yangi slayd qo'shilsa — joriy slayddagi mavzu unga ham qo'llanadi (PowerPoint'dagi kabi).
 *  - Mavzular bo'limidagi bezaklar «Fon» bo'limida ham alohida chiqadi (fon turlari 5 tadan 20 dan ortiq bo'ldi).
 */
(function () {
  'use strict';
  if (window.SS_THEMES) return;
  if (typeof fabric === 'undefined') return;

  var SW = 960, SH = 540;
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'success'); } catch (e) {} }

  /* ------------------------------------------------------------------ 1) qo'shimcha shakllar */
  var LIB = window.SHAPE_LIBRARY || (window.SHAPE_LIBRARY = {});
  var EXTRA = {
    th_tri_br: ['Burchak (o\'ng-past)', 'M 100 0 L 100 100 L 0 100 Z'],
    th_tri_tl: ['Burchak (chap-yuqori)', 'M 0 0 L 100 0 L 0 100 Z'],
    th_stripe: ['Qiya tasma', 'M 40 0 L 100 0 L 60 100 L 0 100 Z'],
    th_wave: ['To\'lqin (pastki)', 'M 0 45 C 18 10 34 10 50 40 C 66 70 82 70 100 30 L 100 100 L 0 100 Z'],
    th_wave2: ['To\'lqin 2', 'M 0 60 C 20 30 40 80 60 55 C 75 38 90 40 100 50 L 100 100 L 0 100 Z'],
    th_arc: ['Yoy', 'M 0 100 C 0 45 45 0 100 0 L 100 100 Z']
  };
  Object.keys(EXTRA).forEach(function (k) { if (!LIB[k]) LIB[k] = EXTRA[k]; });
  if (!LIB.sparkle) LIB.sparkle = ['Uchqun', 'M 50 0 C 54 34 66 46 100 50 C 66 54 54 66 50 100 C 46 66 34 54 0 50 C 34 46 46 34 50 0 Z'];

  /* ------------------------------------------------------------------ 2) bezak bo'laklari */
  function R(l, t, w, h, fill, o) {
    o = o || {};
    var r = { type: 'rect', left: l, top: t, width: w, height: h, fill: fill, rx: o.rx || 0, ry: o.rx || 0 };
    if (o.stroke) { r.stroke = o.stroke; r.strokeWidth = o.sw || 1; }
    if (o.op != null) r.opacity = o.op;
    return r;
  }
  function C(l, t, d, fill, o) {
    o = o || {};
    var c = { type: 'circle', left: l, top: t, radius: d / 2, width: d, height: d, fill: fill };
    if (o.stroke) { c.stroke = o.stroke; c.strokeWidth = o.sw || 2; }
    if (o.op != null) c.opacity = o.op;
    return c;
  }
  function E(l, t, w, h, fill, op) { return { type: 'ellipse', left: l, top: t, width: w, height: h, fill: fill, opacity: op == null ? 1 : op }; }
  function P(name, l, t, w, h, fill, op) { var s = { type: 'shape', shape: name, left: l, top: t, width: w, height: h, fill: fill, strokeWidth: 0 }; if (op != null) s.opacity = op; return s; }

  // Har bir bezak: (T) → bo'laklar. T = mavzu ranglari. Hammasi chetlarda (markaziy 80% bo'sh).
  var DECOR = {
    plain: { label: 'Toza', build: function () { return []; } },
    top_bar: { label: 'Yuqori chiziq', build: function (T) {
      return [R(0, 0, SW, 12, T.a1), R(0, 12, SW, 4, T.a2), R(48, 512, SW - 96, 1.5, T.a2)];
    } },
    band_left: { label: 'Chap tasma', build: function (T) {
      return [R(0, 0, 26, SH, T.a1), R(26, 0, 6, SH, T.a2), R(SW - 120, SH - 26, 72, 6, T.a1, { rx: 3 })];
    } },
    side_panel: { label: 'O\'ng panel', build: function (T) {
      return [R(SW - 40, 0, 40, SH, T.a1), R(SW - 52, 0, 8, SH, T.a2, { op: 0.85 }), C(SW - 70, 28, 14, T.a3)];
    } },
    diagonal: { label: 'Qiya burchak', build: function (T) {
      return [P('th_tri_br', SW - 300, SH - 200, 300, 200, T.a1), P('th_tri_br', SW - 170, SH - 120, 170, 120, T.a2), P('th_tri_tl', 0, 0, 120, 80, T.a3, 0.85)];
    } },
    geo: { label: 'Uchburchaklar', build: function (T) {
      return [P('th_tri_tl', 0, 0, 150, 150, T.a1), P('th_tri_tl', 0, 0, 80, 80, T.a2), P('th_tri_br', SW - 150, SH - 150, 150, 150, T.a2), P('th_tri_br', SW - 80, SH - 80, 80, 80, T.a3)];
    } },
    frame: { label: 'Ramka', build: function (T) {
      return [R(16, 16, SW - 34, SH - 34, '', { stroke: T.a1, sw: 2.5 }), R(26, 26, SW - 54, SH - 54, '', { stroke: T.a2, sw: 1 })];
    } },
    rules: { label: 'Akademik', build: function (T) {
      return [R(0, 0, SW, 8, T.a1), R(48, 498, SW - 96, 1.5, T.title), R(48, 504, 120, 4, T.a1)];
    } },
    corner_circles: { label: 'Doiralar', build: function (T) {
      return [C(SW - 210, -150, 340, T.a1, { op: 0.9 }), C(SW - 120, 120, 70, T.a2), C(-70, SH - 110, 190, T.a2, { op: 0.8 }), C(110, SH - 44, 26, T.a3)];
    } },
    rings: { label: 'Halqalar', build: function (T) {
      return [C(SW - 200, -110, 300, '', { stroke: T.a1, sw: 14 }), C(SW - 120, -40, 150, '', { stroke: T.a2, sw: 6 }), C(-60, SH - 120, 170, '', { stroke: T.a3, sw: 8 })];
    } },
    blobs: { label: 'Yumshoq dog\'lar', build: function (T) {
      return [E(SW - 280, -150, 420, 320, T.a1, 0.18), E(-170, SH - 190, 400, 300, T.a2, 0.22), E(SW - 140, SH - 90, 200, 150, T.a3, 0.25)];
    } },
    dots_grid: { label: 'Nuqtalar', build: function (T) {
      var out = [], i, j;
      for (i = 0; i < 6; i++) for (j = 0; j < 4; j++) out.push(C(SW - 170 + i * 22, 28 + j * 22, 8, T.a1, { op: 0.7 }));
      for (i = 0; i < 4; i++) for (j = 0; j < 3; j++) out.push(C(36 + i * 22, SH - 90 + j * 22, 8, T.a2, { op: 0.7 }));
      out.push(R(0, SH - 6, SW, 6, T.a1));
      return out;
    } },
    ribbon_bottom: { label: 'Pastki tasma', build: function (T) {
      return [R(0, SH - 34, SW, 34, T.a1), R(0, SH - 40, SW, 6, T.a2), R(48, 22, 90, 6, T.a3, { rx: 3 })];
    } },
    thin_lines: { label: 'Ingichka chiziqlar', build: function (T) {
      return [R(48, 26, SW - 96, 1, T.title, { op: 0.6 }), R(48, 22, 46, 6, T.a1), R(48, SH - 28, SW - 96, 1, T.title, { op: 0.6 })];
    } },
    confetti: { label: 'Konfetti', build: function (T) {
      var c = [T.a1, T.a2, T.a3];
      return [C(30, 30, 34, c[0]), C(92, 18, 16, c[1]), P('sparkle', SW - 96, 24, 56, 56, c[2]), C(SW - 150, 40, 18, c[0]),
        C(SW - 60, SH - 70, 40, c[1]), P('sparkle', 34, SH - 86, 46, 46, c[0]), C(110, SH - 44, 18, c[2]), C(SW - 120, SH - 36, 14, c[0]),
        P('star5', SW - 46, 110, 30, 30, c[1])];
    } },
    circuit: { label: 'Texno chiziqlar', build: function (T) {
      return [R(SW - 260, 36, 200, 2, T.a1), R(SW - 62, 36, 2, 90, T.a1), C(SW - 268, 31, 12, T.a1), C(SW - 67, 120, 12, T.a2),
        R(SW - 220, 56, 120, 2, T.a2, { op: 0.7 }), C(SW - 104, 51, 10, T.a2),
        R(40, SH - 60, 200, 2, T.a1), R(40, SH - 140, 2, 80, T.a1), C(35, SH - 146, 12, T.a2), C(236, SH - 65, 12, T.a1)];
    } },
    newspaper: { label: 'Gazeta', build: function (T) {
      return [R(48, 20, SW - 96, 4, T.title), R(48, 28, SW - 96, 1, T.title), R(48, SH - 30, SW - 96, 1, T.title), R(48, SH - 25, 140, 4, T.a1)];
    } },
    stripes: { label: 'Qiya tasmalar', build: function (T) {
      return [P('th_stripe', SW - 150, 0, 70, SH, T.a1), P('th_stripe', SW - 95, 0, 50, SH, T.a2), P('th_stripe', SW - 52, 0, 52, SH, T.a1, 0.6)];
    } },
    stars: { label: 'Yulduzlar', build: function (T) {
      return [P('sparkle', SW - 120, 30, 60, 60, T.a3), P('sparkle', SW - 52, 104, 26, 26, T.a2), C(SW - 180, 60, 6, T.title, { op: 0.8 }),
        C(60, 40, 5, T.title, { op: 0.7 }), C(140, 90, 4, T.title, { op: 0.6 }), P('sparkle', 40, SH - 90, 44, 44, T.a1),
        C(180, SH - 40, 5, T.title, { op: 0.7 }), C(SW - 90, SH - 60, 8, T.a2), C(SW - 260, SH - 30, 4, T.title, { op: 0.6 })];
    } },
    wave_bottom: { label: 'To\'lqin', build: function (T) {
      return [P('th_wave2', 0, SH - 110, SW, 110, T.a2, 0.7), P('th_wave', 0, SH - 82, SW, 82, T.a1)];
    } },
    arc_corner: { label: 'Yoy burchak', build: function (T) {
      return [P('th_arc', SW - 230, SH - 230, 230, 230, T.a1), P('th_arc', SW - 130, SH - 130, 130, 130, T.a2), R(48, 30, 60, 6, T.a1, { rx: 3 })];
    } }
  };

  /* ------------------------------------------------------------------ 3) MAVZULAR */
  // [id, nomi, fon, sarlavha, matn, a1, a2, a3, sarlavha shrifti, matn shrifti, bezak, kartochka uslubi]
  var RAW = [
    ['clean', 'Toza (oq)', '#FFFFFF', '#1F1F1F', '#444746', '#2563EB', '#93C5FD', '#F59E0B', 'Arial', 'Arial', 'plain', 'modern_cards'],
    ['office', 'Ofis', '#FFFFFF', '#1F2937', '#374151', '#2563EB', '#60A5FA', '#F59E0B', 'Arial', 'Arial', 'top_bar', 'corporate_blue'],
    ['ocean', 'Okean', '#F0F7FF', '#0B3C5D', '#1D4E6E', '#1E88E5', '#4FC3F7', '#FFB300', 'Trebuchet MS', 'Verdana', 'wave_bottom', 'modern_cards'],
    ['ion', 'Ion (to\'q)', '#0F3D3E', '#F1FAEE', '#CDE7E3', '#2EC4B6', '#FFBF69', '#CBF3F0', 'Trebuchet MS', 'Trebuchet MS', 'band_left', 'dark_neon'],
    ['facet', 'Faset', '#FFFFFF', '#1B4332', '#2D6A4F', '#40916C', '#95D5B2', '#D8F3DC', 'Georgia', 'Verdana', 'geo', 'eco_green'],
    ['retro', 'Retrospekt', '#FBF7F0', '#3E2723', '#5D4037', '#D84315', '#FFAB91', '#8D6E63', 'Georgia', 'Georgia', 'frame', 'academic'],
    ['integral', 'Integral', '#FFFFFF', '#212121', '#424242', '#7B1FA2', '#CE93D8', '#FFC107', 'Arial', 'Arial', 'side_panel', 'modern_cards'],
    ['slice', 'Kesim', '#1A1A2E', '#FFFFFF', '#D6D6E7', '#E94560', '#0F3460', '#FFC947', 'Trebuchet MS', 'Verdana', 'diagonal', 'dark_neon'],
    ['berlin', 'Berlin', '#2B2B2B', '#FFFFFF', '#E0E0E0', '#FF7043', '#FFCA28', '#26C6DA', 'Arial', 'Arial', 'ribbon_bottom', 'dark_neon'],
    ['gallery', 'Galereya', '#FAFAFA', '#263238', '#455A64', '#00897B', '#80CBC4', '#FF7043', 'Georgia', 'Arial', 'rings', 'modern_cards'],
    ['spring', 'Bahor (pastel)', '#FFF5F7', '#4A2C40', '#6B4E63', '#F48FB1', '#B39DDB', '#80DEEA', 'Trebuchet MS', 'Trebuchet MS', 'blobs', 'pastel_soft'],
    ['sun', 'Quyosh', '#FFFBEB', '#78350F', '#92400E', '#F59E0B', '#FCD34D', '#EF4444', 'Verdana', 'Verdana', 'corner_circles', 'playful_kids'],
    ['midnight', 'Tun', '#0B1020', '#F8FAFC', '#CBD5E1', '#6366F1', '#22D3EE', '#F472B6', 'Trebuchet MS', 'Verdana', 'dots_grid', 'dark_neon'],
    ['minimal', 'Minimal', '#FFFFFF', '#111111', '#444444', '#111111', '#BBBBBB', '#E5E5E5', 'Arial', 'Arial', 'thin_lines', 'minimal_mono'],
    ['academic', 'Akademik', '#FFFFFF', '#1B2A41', '#3D4B5C', '#8C1C13', '#B08D2A', '#1B2A41', 'Georgia', 'Georgia', 'rules', 'academic'],
    ['gold', 'Oltin', '#14110F', '#F5EFE6', '#CDBFA8', '#C9A227', '#8C6D1F', '#E8D5A2', 'Georgia', 'Georgia', 'frame', 'elegant_gold'],
    ['leaf', 'Yashil barg', '#F3F8F2', '#1B3A2B', '#44624F', '#2E7D32', '#A5D6A7', '#F9A825', 'Georgia', 'Verdana', 'blobs', 'eco_green'],
    ['brutal', 'Neo-brutal', '#FFF4D6', '#111111', '#2B2B2B', '#FF5C8A', '#FFD23F', '#3EC1D3', 'Courier New', 'Arial', 'confetti', 'neo_brutalism'],
    ['kids', 'Bolalar', '#FFF9E6', '#2D2A32', '#4B4453', '#FF6B6B', '#4ECDC4', '#FFD93D', 'Comic Sans MS', 'Trebuchet MS', 'confetti', 'playful_kids'],
    ['tech', 'Texnologiya', '#0F172A', '#E2E8F0', '#94A3B8', '#38BDF8', '#818CF8', '#34D399', 'Verdana', 'Verdana', 'circuit', 'dark_neon'],
    ['lavender', 'Lavanda', '#F5F3FF', '#3B0764', '#5B21B6', '#8B5CF6', '#C4B5FD', '#F0ABFC', 'Trebuchet MS', 'Trebuchet MS', 'corner_circles', 'pastel_soft'],
    ['coral', 'Marjon', '#FFF1EE', '#7F1D1D', '#9A3412', '#F97316', '#FB7185', '#FDBA74', 'Trebuchet MS', 'Verdana', 'diagonal', 'pastel_soft'],
    ['blue', 'Moviy', '#EFF6FF', '#1E3A8A', '#1E40AF', '#3B82F6', '#93C5FD', '#1E3A8A', 'Arial', 'Arial', 'band_left', 'corporate_blue'],
    ['red', 'Qizil biznes', '#FFFFFF', '#7F1D1D', '#374151', '#DC2626', '#FCA5A5', '#111827', 'Arial', 'Arial', 'arc_corner', 'corporate_blue'],
    ['coffee', 'Qahva', '#F5EDE3', '#3E2C23', '#5C4033', '#8B5E3C', '#C8A27C', '#D4A373', 'Georgia', 'Georgia', 'rules', 'academic'],
    ['graphite', 'Grafit', '#1F2937', '#F9FAFB', '#D1D5DB', '#F59E0B', '#10B981', '#60A5FA', 'Arial', 'Arial', 'side_panel', 'dark_neon'],
    ['ice', 'Muz', '#F0FDFF', '#083344', '#155E75', '#06B6D4', '#67E8F9', '#A5F3FC', 'Verdana', 'Verdana', 'rings', 'modern_cards'],
    ['berry', 'Rezavor', '#2A0E1F', '#FCE7F3', '#F9A8D4', '#EC4899', '#A855F7', '#FDE68A', 'Trebuchet MS', 'Trebuchet MS', 'blobs', 'dark_neon'],
    ['newspaper', 'Gazeta', '#FAFAF7', '#111111', '#333333', '#B91C1C', '#111111', '#D4D4D4', 'Times New Roman', 'Georgia', 'newspaper', 'academic'],
    ['desert', 'Sahro', '#FDF6E3', '#5C3D2E', '#7A5C45', '#E07A5F', '#F2CC8F', '#81B29A', 'Georgia', 'Verdana', 'geo', 'pastel_soft'],
    ['sport', 'Sport', '#FFFFFF', '#0A0A0A', '#262626', '#16A34A', '#FACC15', '#0A0A0A', 'Arial', 'Arial', 'stripes', 'corporate_blue'],
    ['space', 'Kosmos', '#050816', '#FFFFFF', '#C7D2FE', '#A78BFA', '#F472B6', '#FDE047', 'Trebuchet MS', 'Verdana', 'stars', 'dark_neon'],
    ['mint', 'Yalpiz', '#ECFDF5', '#064E3B', '#065F46', '#10B981', '#6EE7B7', '#FBBF24', 'Verdana', 'Verdana', 'wave_bottom', 'eco_green']
  ];
  var THEMES = {}, ORDER = [];
  RAW.forEach(function (r) {
    THEMES[r[0]] = { id: r[0], label: r[1], bg: r[2], title: r[3], body: r[4], a1: r[5], a2: r[6], a3: r[7], fontTitle: r[8], fontBody: r[9], decor: r[10], kit: r[11] };
    ORDER.push(r[0]);
  });

  /* ------------------------------------------------------------------ 4) bezakni elementlarga aylantirish */
  var seq = 0;
  function decorParts(T, decorKey) {
    var d = DECOR[decorKey || T.decor] || DECOR.plain;
    var parts = d.build(T) || [];
    var gid = 'theme_' + Date.now().toString(36) + '_' + (seq++);
    parts.forEach(function (p) { p.ssRole = 'bgdecor'; p.ssKit = gid; p.ssKitItem = 'theme_' + T.id; });
    return parts;
  }
  async function toObjects(parts) {
    var out = [], parse = window.parseElementToFabric;
    if (typeof parse !== 'function') return out;
    for (var i = 0; i < parts.length; i++) {
      try {
        var o = await parse(parts[i]);
        if (!o) continue;
        if (parts[i].fill === '' && o.set) o.set('fill', '');
        out.push(o);
      } catch (e) { console.warn('[themes] parse', e); }
    }
    return out;
  }
  function lockDecor(o) {
    if (!o || o.ssRole !== 'bgdecor' || !/^theme_/.test(String(o.ssKitItem || ''))) return;
    o.selectable = false; o.evented = false; o.hoverCursor = 'default';
    o.hasControls = false; o.lockMovementX = true; o.lockMovementY = true;
  }

  /* ------------------------------------------------------------------ 5) slaydga qo'llash */
  function cv() { return (typeof canvas !== 'undefined' && canvas) ? canvas : null; }
  function isText(o) { return o && (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text'); }
  function hasFill(o) {
    if (!o || isText(o) || o.ssRole === 'bgdecor') return false;
    var f = o.fill;
    if (!f || f === 'transparent' || f === 'none') return o.type === 'image' || o.type === 'group';
    if (typeof f === 'string' && /rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(f)) return false;
    return true;
  }
  // matn biror shakl / rasm / kartochka USTIDA turibdimi? (unda rangini o'zgartirmaymiz — o'qilishi buzilmasin)
  function onShape(t, objs, idx) {
    var b = t.getBoundingRect(true, true), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    for (var i = idx - 1; i >= 0; i--) {
      var o = objs[i];
      if (!hasFill(o) || (o.opacity != null && o.opacity < 0.35)) continue;
      var r = o.getBoundingRect(true, true);
      if (r.width < 24 || r.height < 16) continue;
      if (cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height) return true;
    }
    return false;
  }
  function clearStyleKeys(t, keys) {
    try {
      var st = t.styles; if (!st) return;
      Object.keys(st).forEach(function (ln) {
        Object.keys(st[ln] || {}).forEach(function (ch) { keys.forEach(function (k) { delete st[ln][ch][k]; }); });
      });
    } catch (e) {}
  }
  function restyleTexts(c, T) {
    var objs = c.getObjects(), texts = [];
    objs.forEach(function (o, i) { if (isText(o) && !o.ssKit && !o.ssKind && !o.isButton && !o.linkUrl) texts.push({ o: o, i: i }); });
    if (!texts.length) return;
    var maxFs = Math.max.apply(null, texts.map(function (x) { return (x.o.fontSize || 0) * (x.o.scaleY || 1); }));
    texts.forEach(function (x) {
      var o = x.o;
      if (onShape(o, objs, x.i)) return;
      var fs = (o.fontSize || 0) * (o.scaleY || 1);
      var isTitle = fs >= 30 || (fs >= maxFs - 0.5 && (o.fontWeight === 'bold' || +o.fontWeight >= 600));
      clearStyleKeys(o, ['fill', 'fontFamily']);
      o.set({ fill: isTitle ? T.title : T.body, fontFamily: isTitle ? T.fontTitle : T.fontBody });
      try { o.initDimensions && o.initDimensions(); o.setCoords(); } catch (e) {}
    });
  }
  async function applyToCanvas(c, T) {
    c.getObjects().filter(function (o) { return o.ssRole === 'bgdecor'; }).forEach(function (o) { c.remove(o); });
    try { if (c.backgroundImage) c.setBackgroundImage(null, function () {}); } catch (e) {}
    try { if (typeof GifBackground !== 'undefined' && GifBackground.clear) GifBackground.clear(); } catch (e) {}
    await new Promise(function (r) { c.setBackgroundColor(T.bg, r); });
    var objs = await toObjects(decorParts(T));
    for (var i = objs.length - 1; i >= 0; i--) {
      try { if (typeof ensureObjectId === 'function') ensureObjectId(objs[i]); } catch (e) {}
      lockDecor(objs[i]);
      c.add(objs[i]); c.sendToBack(objs[i]);
    }
    restyleTexts(c, T);
    c.requestRenderAll();
  }
  function saveState() {
    try { if (typeof saveCurrentSlideState === 'function') saveCurrentSlideState(); } catch (e) {}
    try { if (typeof refreshSlideThumb === 'function' && typeof activeIndex !== 'undefined') refreshSlideThumb(activeIndex); } catch (e) {}
  }
  function aiBusy() {
    return !!(window.isAiStreaming || window.isAiApplyingCommands || window.aiSessionActive ||
      (typeof isAiStreaming !== 'undefined' && isAiStreaming) || (typeof isAiApplyingCommands !== 'undefined' && isAiApplyingCommands));
  }
  /* --- boshqa (ochiq bo'lmagan) slaydga: to'g'ridan-to'g'ri JSON ustida — slaydlar orasida sakramaydi, tez --- */
  function jbox(o) {
    var w = (+o.width || 0) * (o.scaleX == null ? 1 : +o.scaleX), h = (+o.height || 0) * (o.scaleY == null ? 1 : +o.scaleY);
    if (o.type === 'circle' && !o.width) { w = h = 2 * (+o.radius || 0) * (o.scaleX || 1); }
    var l = +o.left || 0, t = +o.top || 0;
    if (o.originX === 'center') l -= w / 2; else if (o.originX === 'right') l -= w;
    if (o.originY === 'center') t -= h / 2; else if (o.originY === 'bottom') t -= h;
    return { left: l, top: t, width: w, height: h };
  }
  function jHasFill(o) {
    if (!o || isText(o) || o.ssRole === 'bgdecor') return false;
    var f = o.fill;
    if (!f || f === 'transparent' || f === 'none') return o.type === 'image' || o.type === 'group' || !!o.isEmbed || !!o.isGif || !!o.isVideo;
    if (typeof f === 'string' && /rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(f)) return false;
    return true;
  }
  async function decorJson(T) {
    var objs = await toObjects(decorParts(T)), out = [];
    var props = (typeof SERIALIZE_PROPS !== 'undefined') ? SERIALIZE_PROPS : ['ssKit', 'ssRole', 'ssKitItem'];
    objs.forEach(function (o) { try { if (typeof ensureObjectId === 'function') ensureObjectId(o); } catch (e) {} out.push(o.toObject(props)); });
    return out;
  }
  async function applyToSlideJson(idx, T) {
    var s = slides[idx]; if (!s) return false;
    var j; try { j = JSON.parse(s.json || '{}'); } catch (e) { j = {}; }
    var objs = (j.objects || []).filter(function (o) { return o && o.ssRole !== 'bgdecor'; });
    j.background = T.bg; delete j.backgroundImage; delete j.backgroundGif; delete j.backgroundVideo;
    var texts = [];
    objs.forEach(function (o, i) { if (isText(o) && !o.ssKit && !o.ssKind && !o.isButton && !o.linkUrl) texts.push(i); });
    var maxFs = Math.max.apply(null, [0].concat(texts.map(function (i) { return (objs[i].fontSize || 0) * (objs[i].scaleY || 1); })));
    texts.forEach(function (ti) {
      var o = objs[ti], b = jbox(o), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      for (var k = ti - 1; k >= 0; k--) {
        var q = objs[k];
        if (!jHasFill(q) || (q.opacity != null && q.opacity < 0.35)) continue;
        var r = jbox(q);
        if (r.width >= 24 && r.height >= 16 && cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height) return;
      }
      var fs = (o.fontSize || 0) * (o.scaleY || 1);
      var isTitle = fs >= 30 || (fs >= maxFs - 0.5 && (o.fontWeight === 'bold' || +o.fontWeight >= 600));
      clearStyleKeys(o, ['fill', 'fontFamily']);
      o.fill = isTitle ? T.title : T.body; o.fontFamily = isTitle ? T.fontTitle : T.fontBody;
    });
    j.objects = (await decorJson(T)).concat(objs);
    s.json = JSON.stringify(j);
    try { if (typeof refreshSlideThumb === 'function') refreshSlideThumb(idx); } catch (e) {}
    return true;
  }
  function themeKey(v) {
    v = String(v || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    if (THEMES[v]) return v;
    for (var k in THEMES) if (THEMES[k].label.toLowerCase().replace(/[\s-]+/g, '_') === v) return k;
    var AL = { office: 'office', ofis: 'office', ocean: 'ocean', okean: 'ocean', dark: 'midnight', night: 'midnight', tun: 'midnight',
      neon: 'tech', tech: 'tech', texnologiya: 'tech', kids: 'kids', bolalar: 'kids', nature: 'leaf', eco: 'leaf', green: 'leaf', tabiat: 'leaf',
      gold: 'gold', oltin: 'gold', luxury: 'gold', academic: 'academic', akademik: 'academic', science: 'academic', minimal: 'minimal',
      pastel: 'spring', space: 'space', kosmos: 'space', business: 'office', corporate: 'office', biznes: 'office', white: 'clean', plain: 'clean', none: 'clean' };
    return AL[v] || null;
  }
  var busy = false;
  /** scope: 'all' | 'one' | massiv [slayd indekslari, 0 dan]. opts.ai — AI chaqirdi (AI ishlayotgan payt ruxsat) */
  async function apply(id, scope, opts) {
    opts = opts || {};
    var key = themeKey(id), T = key && THEMES[key], c = cv();
    if (!T || !c) return false;
    if (busy) return false;
    if (!opts.ai && aiBusy()) { toast('AI slayd yasayapti — tugagach mavzuni tanlang', 'error'); return false; }
    busy = true;
    try {
      try { if (window.SS_KIT && SS_KIT.setStyle) SS_KIT.setStyle(T.kit); } catch (e) {}
      try { c.discardActiveObject(); } catch (e) {}
      var n = (typeof slides !== 'undefined') ? slides.length : 1, list;
      if (Array.isArray(scope)) list = scope.filter(function (i) { return i >= 0 && i < n; });
      else if (scope === 'all') list = Array.from({ length: n }, function (_, i) { return i; });
      else list = [activeIndex];
      for (var x = 0; x < list.length; x++) {
        if (list[x] === activeIndex) { await applyToCanvas(c, T); saveState(); }
        else await applyToSlideJson(list[x], T);
      }
      try { if (!opts.ai && typeof recordGlobalState === 'function') recordGlobalState(); } catch (e) {}
      try { if (typeof renderSidebar === 'function') renderSidebar(); } catch (e) {}
      if (!opts.silent) toast('«' + T.label + '» mavzusi ' + (list.length > 1 ? 'hamma slaydlarga' : 'shu slaydga') + ' qo\'llandi');
      return true;
    } finally { busy = false; }
  }
  /** AI buyrug'i: {"action":"set_theme","theme":"midnight","target":"all"} yoki {"slide":N} yoki {"slides":[1,3]} */
  async function aiSetTheme(cmd) {
    cmd = cmd || {};
    var id = cmd.theme || cmd.name || cmd.design || cmd.style;
    var scope;
    if (Array.isArray(cmd.slides)) scope = cmd.slides.map(function (v) { return (parseInt(v, 10) || 0) - 1; });
    else if (cmd.slide != null && cmd.target !== 'all') scope = [(parseInt(cmd.slide, 10) || 1) - 1];
    else scope = 'all';
    return apply(id, scope, { ai: true, silent: true });
  }
  function currentThemeOf(c) {
    c = c || cv(); if (!c) return null;
    var objs = c.getObjects();
    for (var i = 0; i < objs.length; i++) {
      var m = /^theme_(.+)$/.exec(String(objs[i].ssKitItem || ''));
      if (objs[i].ssRole === 'bgdecor' && m && THEMES[m[1]]) return m[1];
    }
    return null;
  }

  /* ------------------------------------------------------------------ 6) bog'lanishlar */
  function hookCanvas() {
    var c = cv();
    if (!c || c.__ssThemes) return !!c;
    c.__ssThemes = true;
    c.on('object:added', function (e) { lockDecor(e && e.target); });
    c.getObjects().forEach(lockDecor);
    return true;
  }
  // yangi slayd — joriy slayd mavzusini oladi (PowerPoint'dagi kabi)
  function hookAddSlide() {
    var orig = window.addSlide;
    if (typeof orig !== 'function' || orig.__ssThemes) return;
    var w = function () {
      var th = null;
      // «Hamma varaqni tozalash» (slides = []) — toza boshlang'ich holat, mavzu o'tkazilmaydi
      try { if (typeof slides !== 'undefined' && slides.length) th = currentThemeOf(); } catch (e) {}
      var r = orig.apply(this, arguments);
      if (th && THEMES[th]) {
        var idx = typeof activeIndex !== 'undefined' ? activeIndex : -1;
        Promise.resolve().then(function () { return applyToCanvas(cv(), THEMES[th]); }).then(function () {
          saveState();
          // yuklanish oynasi hali tugamagan bo'lsa saqlash o'tkazib yuboriladi — bir oz keyin yana
          setTimeout(function () { if (typeof activeIndex === 'undefined' || activeIndex === idx) saveState(); }, 700);
        }).catch(function (e) { console.warn('[themes] new slide', e); });
      }
      return r;
    };
    w.__ssThemes = true;
    window.addSlide = w;
  }
  // SERIALIZE_PROPS'da ssKit/ssRole/ssKitItem bor (48_design_kit.js) — bo'lmasa qo'shamiz
  try { if (typeof SERIALIZE_PROPS !== 'undefined') ['ssKit', 'ssRole', 'ssKitItem'].forEach(function (k) { if (SERIALIZE_PROPS.indexOf(k) < 0) SERIALIZE_PROPS.push(k); }); } catch (e) {}
  function boot() { hookCanvas(); hookAddSlide(); }
  boot();
  var tries = 0, bt = setInterval(function () { boot(); if ((cv() && cv().__ssThemes && window.addSlide && window.addSlide.__ssThemes) || ++tries > 40) clearInterval(bt); }, 250);

  // «Fon» bo'limiga ham hamma bezaklarni qo'shamiz (joriy kartochka uslubi ranglarida)
  try {
    var KIT = window.SS_KIT;
    if (KIT && KIT.ITEMS) {
      Object.keys(DECOR).forEach(function (k) {
        if (k === 'plain' || KIT.ITEMS['bg_th_' + k]) return;
        KIT.ITEMS['bg_th_' + k] = { id: 'bg_th_' + k, cat: 'backgrounds', label: DECOR[k].label, size: [SW, SH], build: function (o, S) {
          var T = { title: S.ink, a1: S.accent, a2: S.accent2, a3: S.accent3 };
          return DECOR[k].build(T).map(function (p) { p.ssRole = 'bgdecor'; return p; });
        } };
      });
    }
  } catch (e) { console.warn('[themes] bg items', e); }

  /* ------------------------------------------------------------------ 7) ko'rinish (menyu) */
  var css = document.createElement('style');
  css.textContent = [
    '#ssKitMenu .kscope{display:flex;align-items:center;gap:6px;padding:10px 12px 0;flex-wrap:wrap;font-size:12px;color:#4b5563}',
    '#ssKitMenu .kscope button{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:5px 11px;cursor:pointer;font:12px inherit;font-family:inherit;color:#374151}',
    '#ssKitMenu .kscope button.on{background:#111827;color:#fff;border-color:#111827}',
    '#ssKitMenu .kgrid.kthemes{grid-template-columns:repeat(3,1fr)}',
    '#ssKitMenu .kit.cur{border-color:#6366f1;box-shadow:0 0 0 2px #c7d2fe}',
    '#ssKitMenu .kit[disabled]{opacity:.6;cursor:progress}'
  ].join('');
  document.head.appendChild(css);

  var scope = 'all';
  try { if (localStorage.getItem('ssThemeScope') === 'one') scope = 'one'; } catch (e) {}
  function html() {
    var cur = currentThemeOf();
    var h = '<div class="kscope"><span>Qo\'llash:</span>' +
      '<button type="button" data-scope="all" class="' + (scope === 'all' ? 'on' : '') + '">Hamma slaydlarga</button>' +
      '<button type="button" data-scope="one" class="' + (scope === 'one' ? 'on' : '') + '">Faqat shu slaydga</button></div>';
    h += '<div class="kgrid kthemes">' + ORDER.map(function (k) {
      return '<button type="button" class="kit' + (k === cur ? ' cur' : '') + '" data-theme="' + k + '" title="' + THEMES[k].label + '"><img alt="" data-tprev="' + k + '"><span>' + THEMES[k].label + '</span></button>';
    }).join('') + '</div>';
    return h;
  }
  var prevCache = {};
  async function preview(id) {
    if (prevCache[id]) return prevCache[id];
    var T = THEMES[id], PW = 240, PH = 135, z = PW / SW;
    var el = document.createElement('canvas'); el.width = PW; el.height = PH;
    var sc = new fabric.StaticCanvas(el, { enableRetinaScaling: false, renderOnAddRemove: false, backgroundColor: T.bg });
    sc.setViewportTransform([z, 0, 0, z, 0, 0]);
    var objs = await toObjects(decorParts(T));
    objs.forEach(function (o) { sc.add(o); });
    sc.add(new fabric.Textbox('Sarlavha', { left: 90, top: 150, width: 780, fontSize: 64, fontWeight: 'bold', fill: T.title, fontFamily: T.fontTitle }));
    sc.add(new fabric.Rect({ left: 92, top: 262, width: 560, height: 16, rx: 8, ry: 8, fill: T.body, opacity: 0.55 }));
    sc.add(new fabric.Rect({ left: 92, top: 300, width: 420, height: 16, rx: 8, ry: 8, fill: T.body, opacity: 0.4 }));
    sc.add(new fabric.Rect({ left: 92, top: 352, width: 130, height: 34, rx: 8, ry: 8, fill: T.a1 }));
    sc.renderAll();
    var url = '';
    try { url = el.toDataURL('image/png'); } catch (e) {}
    try { sc.dispose(); } catch (e) {}
    prevCache[id] = url;
    return url;
  }
  function bind(menu, closeMenu) {
    var imgs = menu.querySelectorAll('img[data-tprev]');
    (async function () {
      for (var i = 0; i < imgs.length; i++) {
        if (!imgs[i].isConnected) return;
        var u = await preview(imgs[i].getAttribute('data-tprev'));
        if (u) imgs[i].src = u;
      }
    })();
  }
  function onClick(b, rerender, closeMenu) {
    if (b.dataset.scope) {
      scope = b.dataset.scope === 'one' ? 'one' : 'all';
      try { localStorage.setItem('ssThemeScope', scope); } catch (e) {}
      rerender();
      return true;
    }
    if (b.dataset.theme) {
      var btns = b.parentNode ? b.parentNode.querySelectorAll('.kit') : [];
      Array.prototype.forEach.call(btns, function (x) { x.disabled = true; });
      apply(b.dataset.theme, scope).then(function (ok) {
        Array.prototype.forEach.call(btns, function (x) { x.disabled = false; });
        if (ok) rerender();
      });
      return true;
    }
    return false;
  }

  window.SS_THEMES = {
    THEMES: THEMES, ORDER: ORDER, DECOR: DECOR,
    apply: apply, applyToCanvas: applyToCanvas, applyToSlideJson: applyToSlideJson, aiSetTheme: aiSetTheme, themeKey: themeKey, current: currentThemeOf,
    html: html, bind: bind, onClick: onClick, preview: preview
  };
})();
