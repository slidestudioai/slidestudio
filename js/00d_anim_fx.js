/* js/00d_anim_fx.js (v68) — ANIMATSIYALAR JADVALI: sayt (CSS) ⇄ PowerPoint / LibreOffice (<p:timing>) bir manbadan.
 *
 * Har bir effekt: [nom, guruh, o'zbekcha nom, ppt, css]
 *   ppt = [presetClass, presetID, presetSubtype, tur, arg]  — PowerPoint'ning standart effekt raqamlari;
 *         14_pptx_io.js shu turdan haqiqiy xatti-harakat XML'ini yozadi (PowerPoint ham, LibreOffice ham shuni o'ynaydi).
 *   css = @keyframes ichi. Slaydga nisbatan masofalar CSS o'zgaruvchilari orqali (applyVars):
 *         --ss-kl/kr/kt/kb — element o'z o'lchamida slayd chetigacha necha marta (uchib kirish/chiqish);
 *         --ss-mw/mh       — slayd eni/bo'yi element enida/bo'yida (harakat yo'llari, «suzib kirish» 10%).
 * Eski 29 ta nom saqlangan (eski slaydlar buzilmaydi); ularning CSS'i PowerPoint'dagi bilan bir xil qilib aniqlashtirildi.
 */
(function () {
  'use strict';
  if (window.SS_FX) return;
  var KL = 'var(--ss-kl,1.6)', KR = 'var(--ss-kr,1.6)', KT = 'var(--ss-kt,1.6)', KB = 'var(--ss-kb,1.6)', MW = 'var(--ss-mw,4)', MH = 'var(--ss-mh,4)';
  function tx(f, axis) { return 'translate3d(' + (axis === 'x' ? 'calc(' + f + '),0' : '0,calc(' + f + ')') + ',0)'; }
  var DIAMOND0 = 'polygon(50% 50%,50% 50%,50% 50%,50% 50%)', DIAMOND1 = 'polygon(50% -50%,150% 50%,50% 150%,-50% 50%)';
  function plus(s) {
    var w = 50 * s, L = 100 * s, p = function (x, y) { return (50 + x) + '% ' + (50 + y) + '%'; };
    return 'polygon(' + [p(-w, -L), p(w, -L), p(w, -w), p(L, -w), p(L, w), p(w, w), p(w, L), p(-w, L), p(-w, w), p(-L, w), p(-L, -w), p(-w, -w)].join(',') + ')';
  }
  var BL_H = 'repeating-linear-gradient(to bottom,#000 0 var(--ssp),transparent var(--ssp) 16.667%)';
  var BL_V = 'repeating-linear-gradient(to right,#000 0 var(--ssp),transparent var(--ssp) 16.667%)';
  var WHEEL = 'conic-gradient(#000 var(--ssa),transparent 0)';
  // niqobli effektlar: kalit kadr faqat o'zgaruvchini animatsiya qiladi, niqobning o'zi elementga qo'yiladi (prepare)
  var MASKS = {};
  function mask(m, a, b) { return { mask: m, css: 'from{' + a + '}to{' + b + '}' }; }
  function clip(a, b) { return 'from{clip-path:' + a + '}to{clip-path:' + b + '}'; }
  // harakat yo'li: SVG yo'li (slayd ulushlarida) → CSS kalit kadrlari (namuna nuqtalar)
  function motionCss(pts) {
    return pts.map(function (p, i) {
      var pc = Math.round(i / (pts.length - 1) * 10000) / 100;
      return pc + '%{transform:translate3d(calc(' + (p[0] * 100) + '% * ' + MW + '),calc(' + (p[1] * 100) + '% * ' + MH + '),0)}';
    }).join('');
  }
  function bez(p0, p1, p2, p3, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
    return out;
  }
  var R = 0.06, RY = 0.06 * 16 / 9, K = 0.5523;                // aylana yo'li (16:9 slaydda doira)
  var LOOP = [[0, 0], [R * K, 0], [R, -RY + RY * K], [R, -RY], [R, -RY - RY * K], [R * K, -2 * RY], [0, -2 * RY], [-R * K, -2 * RY], [-R, -RY - RY * K], [-R, -RY], [-R, -RY + RY * K], [-R * K, 0], [0, 0]];
  function loopSvg() {
    var f = function (v) { return Math.round(v * 10000) / 10000; }, s = 'M 0 0';
    for (var i = 1; i < LOOP.length; i += 3) s += ' C ' + [LOOP[i], LOOP[i + 1], LOOP[i + 2]].map(function (p) { return f(p[0]) + ' ' + f(p[1]); }).join(' ');
    return s + ' E';
  }
  function loopPts() { var o = []; for (var i = 0; i + 3 < LOOP.length; i += 3) o = o.concat(bez(LOOP[i], LOOP[i + 1], LOOP[i + 2], LOOP[i + 3], 6).slice(i ? 1 : 0)); return o; }
  var ARC = [[0, 0], [0.05, -0.2], [0.2, -0.2], [0.25, 0]];

  var L = [
    /* ---- KIRISH (entrance) ---- */
    ['appear', 'in', 'Paydo bo\'lish (darhol)', ['entr', 1, 0, 'appear'], '0%{opacity:0}0.1%,100%{opacity:1}'],
    ['fadeIn', 'in', 'Asta paydo bo\'lish', ['entr', 10, 0, 'fade'], 'from{opacity:0}to{opacity:1}'],
    ['fadeInUp', 'in', 'Pastdan suzib kirish', ['entr', 42, 0, 'float', 'u'], 'from{opacity:0;transform:' + tx('10% * ' + MH, 'y') + '}to{opacity:1;transform:none}'],
    ['fadeInDown', 'in', 'Tepadan suzib tushish', ['entr', 47, 0, 'float', 'd'], 'from{opacity:0;transform:' + tx('-10% * ' + MH, 'y') + '}to{opacity:1;transform:none}'],
    ['fadeInLeft', 'in', 'Chapdan uchib kirish', ['entr', 2, 8, 'fly', 'l'], 'from{transform:' + tx('-100% * ' + KL, 'x') + '}to{transform:none}'],
    ['fadeInRight', 'in', 'O\'ngdan uchib kirish', ['entr', 2, 2, 'fly', 'r'], 'from{transform:' + tx('100% * ' + KR, 'x') + '}to{transform:none}'],
    ['flyInBottom', 'in', 'Pastdan uchib kirish', ['entr', 2, 4, 'fly', 'b'], 'from{transform:' + tx('100% * ' + KB, 'y') + '}to{transform:none}'],
    ['flyInTop', 'in', 'Tepadan uchib kirish', ['entr', 2, 1, 'fly', 't'], 'from{transform:' + tx('-100% * ' + KT, 'y') + '}to{transform:none}'],
    ['slideInUp', 'in', 'Pastdan mo\'ralab chiqish', ['entr', 12, 4, 'filter', 'slide(fromBottom)'], 'from{transform:translate3d(0,100%,0);clip-path:inset(0 0 100% 0)}to{transform:none;clip-path:inset(0 0 0 0)}'],
    ['slideInLeft', 'in', 'Chapdan mo\'ralab chiqish', ['entr', 12, 8, 'filter', 'slide(fromLeft)'], 'from{transform:translate3d(-100%,0,0);clip-path:inset(0 0 0 100%)}to{transform:none;clip-path:inset(0 0 0 0)}'],
    ['slideInRight', 'in', 'O\'ngdan mo\'ralab chiqish', ['entr', 12, 2, 'filter', 'slide(fromRight)'], 'from{transform:translate3d(100%,0,0);clip-path:inset(0 100% 0 0)}to{transform:none;clip-path:inset(0 0 0 0)}'],
    ['wipeFromBottom', 'in', 'Pastdan ochilish', ['entr', 22, 4, 'filter', 'wipe(up)'], clip('inset(100% 0 0 0)', 'inset(0 0 0 0)')],
    ['wipeFromTop', 'in', 'Tepadan ochilish', ['entr', 22, 1, 'filter', 'wipe(down)'], clip('inset(0 0 100% 0)', 'inset(0 0 0 0)')],
    ['wipeFromLeft', 'in', 'Chapdan ochilish', ['entr', 22, 8, 'filter', 'wipe(right)'], clip('inset(0 100% 0 0)', 'inset(0 0 0 0)')],
    ['wipeFromRight', 'in', 'O\'ngdan ochilish', ['entr', 22, 2, 'filter', 'wipe(left)'], clip('inset(0 0 0 100%)', 'inset(0 0 0 0)')],
    ['splitInV', 'in', 'O\'rtadan ikki yonga ochilish', ['entr', 16, 42, 'filter', 'barn(outVertical)'], clip('inset(0 50% 0 50%)', 'inset(0 0 0 0)')],
    ['splitInH', 'in', 'O\'rtadan tepa-pastga ochilish', ['entr', 16, 26, 'filter', 'barn(outHorizontal)'], clip('inset(50% 0 50% 0)', 'inset(0 0 0 0)')],
    ['circleIn', 'in', 'Doira bo\'lib ochilish', ['entr', 6, 32, 'filter', 'circle(out)'], clip('ellipse(0% 0% at 50% 50%)', 'ellipse(71% 71% at 50% 50%)')],
    ['diamondIn', 'in', 'Romb bo\'lib ochilish', ['entr', 8, 32, 'filter', 'diamond(out)'], clip(DIAMOND0, DIAMOND1)],
    ['plusIn', 'in', 'Plyus bo\'lib ochilish', ['entr', 13, 32, 'filter', 'plus(out)'], clip(plus(0), plus(1))],
    ['boxIn', 'in', 'Quti bo\'lib ochilish', ['entr', 4, 32, 'filter', 'box(out)'], clip('inset(50% 50% 50% 50%)', 'inset(0 0 0 0)')],
    ['wheelIn', 'in', 'G\'ildirak', ['entr', 21, 1, 'filter', 'wheel(1)'], mask(WHEEL, '--ssa:0deg', '--ssa:360deg')],
    ['blindsInH', 'in', 'Jalyuzi (gorizontal)', ['entr', 3, 10, 'filter', 'blinds(horizontal)'], mask(BL_H, '--ssp:0%', '--ssp:16.667%')],
    ['blindsInV', 'in', 'Jalyuzi (vertikal)', ['entr', 3, 5, 'filter', 'blinds(vertical)'], mask(BL_V, '--ssp:0%', '--ssp:16.667%')],
    ['zoomIn', 'in', 'Kattalashib paydo bo\'lish', ['entr', 53, 16, 'zoom'], 'from{opacity:0;transform:scale(0)}to{opacity:1;transform:none}'],
    ['growIn', 'in', 'Nuqtadan kattalashish', ['entr', 23, 16, 'grow'], 'from{transform:scale(0)}to{transform:none}'],
    ['expandIn', 'in', 'Kengayish', ['entr', 55, 0, 'expand'], 'from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}'],
    ['stretchInX', 'in', 'Eniga cho\'zilish', ['entr', 17, 10, 'stretch', 'x'], 'from{transform:scaleX(0)}to{transform:none}'],
    ['stretchInY', 'in', 'Bo\'yiga cho\'zilish', ['entr', 17, 5, 'stretch', 'y'], 'from{transform:scaleY(0)}to{transform:none}'],
    ['bounceIn', 'in', 'Sakrab kirish', ['entr', 26, 0, 'zoom'], null],
    ['flipInX', 'in', 'Aylanib chiqish', ['entr', 19, 5, 'swivel'], null],
    ['rotateIn', 'in', 'Burilib kirish', ['entr', 31, 0, 'spin'], 'from{opacity:0;transform:rotate(90deg) scale(0)}to{opacity:1;transform:none}'],
    ['spinnerIn', 'in', 'Pirildoq', ['entr', 49, 0, 'spin'], 'from{opacity:0;transform:rotate(90deg) scale(0)}to{opacity:1;transform:none}'],
    /* ---- DIQQAT (emphasis) ---- */
    ['growShrink', 'attn', 'Kattalashib qolish', ['emph', 6, 0, 'growHold', 150000], 'from{transform:none}to{transform:scale(1.5)}'],
    ['transparency', 'attn', 'Xiralashish', ['emph', 9, 0, 'opacity', 0.5], 'from{opacity:1}to{opacity:.5}'],
    ['pulse', 'attn', 'Pulsatsiya', ['emph', 26, 0, 'grow', 108000], null],
    ['shakeX', 'attn', 'Silkitish', ['emph', 32, 0, 'teeter'], null],
    /* ---- CHIQISH (exit) ---- */
    ['disappear', 'out', 'G\'oyib bo\'lish (darhol)', ['exit', 1, 0, 'disappear'], '0%{opacity:1}0.1%,100%{opacity:0}'],
    ['fadeOut', 'out', 'So\'nib ketish', ['exit', 10, 0, 'fade'], 'from{opacity:1}to{opacity:0}'],
    ['floatOutUp', 'out', 'Tepaga suzib ketish', ['exit', 47, 0, 'float', 'u'], 'from{opacity:1;transform:none}to{opacity:0;transform:' + tx('-10% * ' + MH, 'y') + '}'],
    ['floatOutDown', 'out', 'Pastga suzib ketish', ['exit', 42, 0, 'float', 'd'], 'from{opacity:1;transform:none}to{opacity:0;transform:' + tx('10% * ' + MH, 'y') + '}'],
    ['slideOutDown', 'out', 'Pastga uchib ketish', ['exit', 2, 4, 'fly', 'b'], 'from{transform:none}to{transform:' + tx('100% * ' + KB, 'y') + '}'],
    ['flyOutTop', 'out', 'Tepaga uchib ketish', ['exit', 2, 1, 'fly', 't'], 'from{transform:none}to{transform:' + tx('-100% * ' + KT, 'y') + '}'],
    ['flyOutLeft', 'out', 'Chapga uchib ketish', ['exit', 2, 8, 'fly', 'l'], 'from{transform:none}to{transform:' + tx('-100% * ' + KL, 'x') + '}'],
    ['flyOutRight', 'out', 'O\'ngga uchib ketish', ['exit', 2, 2, 'fly', 'r'], 'from{transform:none}to{transform:' + tx('100% * ' + KR, 'x') + '}'],
    ['wipeToBottom', 'out', 'Pastga yopilish', ['exit', 22, 4, 'filter', 'wipe(down)'], clip('inset(0 0 0 0)', 'inset(100% 0 0 0)')],
    ['wipeToTop', 'out', 'Tepaga yopilish', ['exit', 22, 1, 'filter', 'wipe(up)'], clip('inset(0 0 0 0)', 'inset(0 0 100% 0)')],
    ['wipeToLeft', 'out', 'Chapga yopilish', ['exit', 22, 8, 'filter', 'wipe(left)'], clip('inset(0 0 0 0)', 'inset(0 100% 0 0)')],
    ['wipeToRight', 'out', 'O\'ngga yopilish', ['exit', 22, 2, 'filter', 'wipe(right)'], clip('inset(0 0 0 0)', 'inset(0 0 0 100%)')],
    ['splitOutV', 'out', 'O\'rtaga yopilish (vertikal)', ['exit', 16, 37, 'filter', 'barn(inVertical)'], clip('inset(0 0 0 0)', 'inset(0 50% 0 50%)')],
    ['splitOutH', 'out', 'O\'rtaga yopilish (gorizontal)', ['exit', 16, 21, 'filter', 'barn(inHorizontal)'], clip('inset(0 0 0 0)', 'inset(50% 0 50% 0)')],
    ['circleOut', 'out', 'Doira bo\'lib yopilish', ['exit', 6, 16, 'filter', 'circle(in)'], clip('ellipse(71% 71% at 50% 50%)', 'ellipse(0% 0% at 50% 50%)')],
    ['diamondOut', 'out', 'Romb bo\'lib yopilish', ['exit', 8, 16, 'filter', 'diamond(in)'], clip(DIAMOND1, DIAMOND0)],
    ['plusOut', 'out', 'Plyus bo\'lib yopilish', ['exit', 13, 16, 'filter', 'plus(in)'], clip(plus(1), plus(0))],
    ['boxOut', 'out', 'Quti bo\'lib yopilish', ['exit', 4, 16, 'filter', 'box(in)'], clip('inset(0 0 0 0)', 'inset(50% 50% 50% 50%)')],
    ['wheelOut', 'out', 'G\'ildirak (chiqish)', ['exit', 21, 1, 'filter', 'wheel(1)'], mask(WHEEL, '--ssa:360deg', '--ssa:0deg')],
    ['blindsOutH', 'out', 'Jalyuzi yopilishi (gorizontal)', ['exit', 3, 10, 'filter', 'blinds(horizontal)'], mask(BL_H, '--ssp:16.667%', '--ssp:0%')],
    ['blindsOutV', 'out', 'Jalyuzi yopilishi (vertikal)', ['exit', 3, 5, 'filter', 'blinds(vertical)'], mask(BL_V, '--ssp:16.667%', '--ssp:0%')],
    ['zoomOut', 'out', 'Kichrayib ketish', ['exit', 53, 32, 'zoom'], 'from{opacity:1;transform:none}to{opacity:0;transform:scale(0)}'],
    ['shrinkOut', 'out', 'Nuqtaga kichrayish', ['exit', 23, 32, 'grow'], 'from{transform:none}to{transform:scale(0)}'],
    ['contractOut', 'out', 'Torayib ketish', ['exit', 55, 0, 'expand'], 'from{opacity:1;transform:none}to{opacity:0;transform:scale(.7)}'],
    ['stretchOutX', 'out', 'Eniga yig\'ilish', ['exit', 17, 10, 'stretch', 'x'], 'from{transform:none}to{transform:scaleX(0)}'],
    ['stretchOutY', 'out', 'Bo\'yiga yig\'ilish', ['exit', 17, 5, 'stretch', 'y'], 'from{transform:none}to{transform:scaleY(0)}'],
    ['spinnerOut', 'out', 'Pirildoq (chiqish)', ['exit', 49, 0, 'spin'], 'from{opacity:1;transform:none}to{opacity:0;transform:rotate(90deg) scale(0)}'],
    ['bounceOut', 'out', 'Sakrab chiqish', ['exit', 26, 0, 'zoom'], null],
    /* ---- HARAKAT YO'LI (motion path) — slayd ulushlarida, PowerPoint <p:animMotion> bilan bir xil ---- */
    ['moveRight', 'path', 'O\'ngga siljish', ['path', 0, 0, 'motion', 'M 0 0 L 0.25 0 E'], motionCss([[0, 0], [0.25, 0]])],
    ['moveLeft', 'path', 'Chapga siljish', ['path', 0, 0, 'motion', 'M 0 0 L -0.25 0 E'], motionCss([[0, 0], [-0.25, 0]])],
    ['moveUp', 'path', 'Tepaga siljish', ['path', 0, 0, 'motion', 'M 0 0 L 0 -0.25 E'], motionCss([[0, 0], [0, -0.25]])],
    ['moveDown', 'path', 'Pastga siljish', ['path', 0, 0, 'motion', 'M 0 0 L 0 0.25 E'], motionCss([[0, 0], [0, 0.25]])],
    ['moveDiagUp', 'path', 'Diagonal tepaga', ['path', 0, 0, 'motion', 'M 0 0 L 0.2 -0.2 E'], motionCss([[0, 0], [0.2, -0.2]])],
    ['moveDiagDown', 'path', 'Diagonal pastga', ['path', 0, 0, 'motion', 'M 0 0 L 0.2 0.2 E'], motionCss([[0, 0], [0.2, 0.2]])],
    ['arcUp', 'path', 'Yoy bo\'ylab', ['path', 0, 0, 'motion', 'M 0 0 C 0.05 -0.2 0.2 -0.2 0.25 0 E'], motionCss(bez(ARC[0], ARC[1], ARC[2], ARC[3], 16))],
    ['loopCircle', 'path', 'Aylana bo\'ylab', ['path', 0, 0, 'motion', loopSvg()], motionCss(loopPts())]
  ];

  var MAP = {}, PPT = {}, GROUP_LABELS = { in: 'Kirish', attn: 'Diqqat tortish', out: 'Chiqish', loop: 'Doimiy harakat', path: 'Harakat yo\'li' };
  L.forEach(function (e) {
    if (e[4] && typeof e[4] === 'object') { MASKS[e[0]] = e[4].mask; e[4] = e[4].css; }
    MAP[e[0]] = { name: e[0], group: e[1], label: e[2], ppt: e[3], css: e[4] }; PPT[e[0]] = e[3];
  });

  var CSS = ['@property --ssa{syntax:"<angle>";inherits:false;initial-value:0deg}', '@property --ssp{syntax:"<percentage>";inherits:false;initial-value:0%}'];
  L.forEach(function (e) { if (e[4]) CSS.push('@keyframes ssa-' + e[0] + '{' + e[4] + '}'); });

  /** Element slayddagi o'rni → CSS o'zgaruvchilari (uchish va harakat yo'llari slaydga nisbatan) */
  function varsFromBox(x, y, w, h, SW, SH) {
    w = Math.max(1, w); h = Math.max(1, h);
    return { '--ss-kl': (x + w) / w, '--ss-kr': (SW - x) / w, '--ss-kt': (y + h) / h, '--ss-kb': (SH - y) / h, '--ss-mw': SW / w, '--ss-mh': SH / h };
  }
  /** Effektga kerak bo'lgan doimiy uslub (niqob) — boshqa effekt qo'yilganda tozalanadi */
  function prepare(dom, name) {
    var m = MASKS[name] || '';
    dom.style.webkitMaskImage = m; dom.style.maskImage = m;
  }
  function applyVars(dom) {
    try {
      var par = dom.offsetParent || dom.parentElement;
      // eng yaqin «slayd» konteyneri (taqdimot / ko'rib chiqish qatlami)
      var stage = dom.closest ? (dom.closest('.pres-x-layer,.anim-preview-layer,#stage,#gifOverlay') || par) : par;
      if (!stage) return;
      var sr = stage.getBoundingClientRect(), r = dom.getBoundingClientRect();
      if (!(sr.width > 0) || !(r.width > 0)) return;
      var v = varsFromBox(r.left - sr.left, r.top - sr.top, r.width, r.height, sr.width, sr.height);
      Object.keys(v).forEach(function (k) { dom.style.setProperty(k, String(Math.round(v[k] * 10000) / 10000)); });
    } catch (e) {}
  }
  function timing(name) {
    var m = MAP[name];
    if (name === 'spin') return 'linear';
    if (name === 'float' || name === 'pulseLoop') return 'ease-in-out';
    if (name === 'appear' || name === 'disappear') return 'linear';
    if (m && m.group === 'path') return 'ease-in-out';
    return m && m.ppt && /^(filter|fly|float|zoom|grow|expand|stretch|spin)$/.test(m.ppt[3]) ? 'ease-out' : 'cubic-bezier(.25,.8,.25,1)';
  }
  window.SS_FX = { list: L, map: MAP, ppt: PPT, css: CSS.join('\n'), groups: GROUP_LABELS, varsFromBox: varsFromBox, applyVars: applyVars, prepare: prepare, masks: MASKS, timing: timing };
})();
