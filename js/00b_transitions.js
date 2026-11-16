/* v50 — Slayd o'tish effektlari KATALOGI (yagona manba).
 *  Bitta jadvaldan: muharrir ko'rib chiqishi, namoyish (iframe), HTML eksport va PowerPoint (<p:transition>) hosil bo'ladi.
 *  slide.transition = kalit | ''   (''  = standart: yengil fade)
 *  slide.transDur   = soniya (0.2 … 5)   — o'tish davomiyligi
 *  slide.transAuto  = soniya (0 = faqat bosganda) — avtomatik keyingi slaydga o'tish (PowerPoint: «After»)
 *
 *  ppt: PowerPoint elementi. dir: harakat yo'nalishi (OOXML: dir = harakat tomoni).
 *  in/out: CSS keyframe tanasi (yangi slayd kiradi / eskisi chiqadi). out bo'lmasa — eskisi joyida turadi, yangisi ustidan yopadi.
 */
(function () {
  'use strict';
  if (window.SS_TR) return;
  var E = 'cubic-bezier(.22,.61,.36,1)';
  var L = [
    { k: 'fade',   t: 'Fade',          g: 'Yumshoq',  ppt: '<p:fade/>',                   i: 'from{opacity:0}to{opacity:1}', o: 'from{opacity:1}to{opacity:0}', ease: 'ease' },
    { k: 'blur',   t: 'Dissolve',      g: 'Yumshoq',  ppt: '<p:dissolve/>',               i: 'from{opacity:0;filter:blur(18px)}to{opacity:1;filter:blur(0)}', o: 'from{opacity:1;filter:blur(0)}to{opacity:0;filter:blur(18px)}', ease: 'ease' },
    { k: 'zoom',   t: 'Zoom',          g: 'Yumshoq',  ppt: '<p:zoom dir="in"/>',          i: 'from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}', o: 'from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(1.18)}', ease: E },
    { k: 'flip',   t: 'Flip',          g: 'Yumshoq',  ppt: '<p14:flip dir="r"/>', p14: true, i: 'from{opacity:0;transform:perspective(1200px) rotateY(75deg)}to{opacity:1;transform:perspective(1200px) rotateY(0)}', o: 'from{opacity:1;transform:perspective(1200px) rotateY(0)}to{opacity:0;transform:perspective(1200px) rotateY(-75deg)}', ease: E },
    { k: 'up',     t: 'Push ↑',        g: 'Surish',   ppt: '<p:push dir="u"/>',           i: 'from{transform:translateY(100%)}to{transform:translateY(0)}', o: 'from{transform:translateY(0)}to{transform:translateY(-100%)}', ease: E },
    { k: 'down',   t: 'Push ↓',        g: 'Surish',   ppt: '<p:push dir="d"/>',           i: 'from{transform:translateY(-100%)}to{transform:translateY(0)}', o: 'from{transform:translateY(0)}to{transform:translateY(100%)}', ease: E },
    { k: 'left',   t: 'Push ←',        g: 'Surish',   ppt: '<p:push dir="l"/>',           i: 'from{transform:translateX(100%)}to{transform:translateX(0)}', o: 'from{transform:translateX(0)}to{transform:translateX(-100%)}', ease: E },
    { k: 'right',  t: 'Push →',        g: 'Surish',   ppt: '<p:push dir="r"/>',           i: 'from{transform:translateX(-100%)}to{transform:translateX(0)}', o: 'from{transform:translateX(0)}to{transform:translateX(100%)}', ease: E },
    { k: 'wipeR',  t: 'Wipe →',        g: 'Ochilish', ppt: '<p:wipe dir="r"/>',           i: 'from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}', ease: 'ease-in-out' },
    { k: 'wipeL',  t: 'Wipe ←',        g: 'Ochilish', ppt: '<p:wipe dir="l"/>',           i: 'from{clip-path:inset(0 0 0 100%)}to{clip-path:inset(0 0 0 0)}', ease: 'ease-in-out' },
    { k: 'wipeD',  t: 'Wipe ↓',        g: 'Ochilish', ppt: '<p:wipe dir="d"/>',           i: 'from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}', ease: 'ease-in-out' },
    { k: 'wipeU',  t: 'Wipe ↑',        g: 'Ochilish', ppt: '<p:wipe dir="u"/>',           i: 'from{clip-path:inset(100% 0 0 0)}to{clip-path:inset(0 0 0 0)}', ease: 'ease-in-out' },
    { k: 'coverL', t: 'Cover ←',       g: 'Ochilish', ppt: '<p:cover dir="l"/>',          i: 'from{transform:translateX(100%)}to{transform:translateX(0)}', ease: E },
    { k: 'coverR', t: 'Cover →',       g: 'Ochilish', ppt: '<p:cover dir="r"/>',          i: 'from{transform:translateX(-100%)}to{transform:translateX(0)}', ease: E },
    { k: 'split',  t: 'Split',         g: 'Ochilish', ppt: '<p:split orient="vert" dir="out"/>', i: 'from{clip-path:inset(0 50% 0 50%)}to{clip-path:inset(0 0 0 0)}', ease: 'ease-in-out' },
    { k: 'circle', t: 'Circle',        g: 'Ochilish', ppt: '<p:circle/>',                 i: 'from{clip-path:circle(0% at 50% 50%)}to{clip-path:circle(78% at 50% 50%)}', ease: 'ease-in-out' },
    /* v68: PowerPoint va LibreOffice'da ham bor, brauzerda aynan shunday chiziladigan o'tishlar */
    { k: 'cut',      t: 'Cut',            g: 'Yumshoq',  ppt: '<p:cut/>',                           i: 'from{opacity:1}to{opacity:1}', ease: 'linear' },
    { k: 'fadeBlack', t: 'Fade (qora)',   g: 'Yumshoq',  ppt: '<p:fade thruBlk="1"/>',              i: '0%{filter:brightness(0)}45%{filter:brightness(0)}100%{filter:brightness(1)}', o: 'from{filter:brightness(1)}to{filter:brightness(0)}', ease: 'ease' },
    { k: 'zoomOut',  t: 'Zoom (tashqaridan)', g: 'Yumshoq', ppt: '<p:zoom dir="out"/>',             i: 'from{opacity:0;transform:scale(1.25)}to{opacity:1;transform:scale(1)}', o: 'from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.8)}', ease: E },
    { k: 'flash',    t: 'Flash',          g: 'Yumshoq',  ppt: '<p14:flash/>', p14: true,            i: '0%{opacity:0;filter:brightness(4)}35%{opacity:1;filter:brightness(4)}100%{filter:brightness(1)}', ease: 'ease-out' },
    { k: 'coverU',   t: 'Cover ↑',        g: 'Surish',   ppt: '<p:cover dir="u"/>',                 i: 'from{transform:translateY(100%)}to{transform:translateY(0)}', ease: E },
    { k: 'coverD',   t: 'Cover ↓',        g: 'Surish',   ppt: '<p:cover dir="d"/>',                 i: 'from{transform:translateY(-100%)}to{transform:translateY(0)}', ease: E },
    { k: 'uncoverL', t: 'Uncover ←',      g: 'Ochilish', ppt: '<p:pull dir="l"/>',                  i: 'from{clip-path:inset(0 0 0 100%)}to{clip-path:inset(0 0 0 0)}', o: 'from{transform:translateX(0)}to{transform:translateX(-100%)}', ease: E },
    { k: 'uncoverR', t: 'Uncover →',      g: 'Ochilish', ppt: '<p:pull dir="r"/>',                  i: 'from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}', o: 'from{transform:translateX(0)}to{transform:translateX(100%)}', ease: E },
    { k: 'uncoverU', t: 'Uncover ↑',      g: 'Ochilish', ppt: '<p:pull dir="u"/>',                  i: 'from{clip-path:inset(100% 0 0 0)}to{clip-path:inset(0 0 0 0)}', o: 'from{transform:translateY(0)}to{transform:translateY(-100%)}', ease: E },
    { k: 'uncoverD', t: 'Uncover ↓',      g: 'Ochilish', ppt: '<p:pull dir="d"/>',                  i: 'from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}', o: 'from{transform:translateY(0)}to{transform:translateY(100%)}', ease: E },
    { k: 'splitH',   t: 'Split (gorizontal)', g: 'Ochilish', ppt: '<p:split orient="horz" dir="out"/>', i: 'from{clip-path:inset(50% 0 50% 0)}to{clip-path:inset(0 0 0 0)}', ease: 'ease-in-out' },
    { k: 'diamond',  t: 'Diamond',        g: 'Ochilish', ppt: '<p:diamond/>',                       i: 'from{clip-path:polygon(50% 50%,50% 50%,50% 50%,50% 50%)}to{clip-path:polygon(50% -50%,150% 50%,50% 150%,-50% 50%)}', ease: 'ease-in-out' },
    { k: 'plus',     t: 'Plus',           g: 'Ochilish', ppt: '<p:plus/>',                          i: 'from{clip-path:' + plusPoly(0) + '}to{clip-path:' + plusPoly(1) + '}', ease: 'ease-in-out' },
    { k: 'clock',    t: 'Clock',          g: 'Ochilish', ppt: '<p:wheel spokes="1"/>',              st: maskSt('conic-gradient(#000 var(--ssa),transparent 0)'), i: 'from{--ssa:0deg}to{--ssa:360deg}', ease: 'linear' },
    { k: 'wheel',    t: 'Wheel',          g: 'Ochilish', ppt: '<p:wheel spokes="4"/>',              st: maskSt('repeating-conic-gradient(#000 0 var(--ssa),transparent var(--ssa) 90deg)'), i: 'from{--ssa:0deg}to{--ssa:90deg}', ease: 'linear' },
    { k: 'wedge',    t: 'Wedge',          g: 'Ochilish', ppt: '<p:wedge/>',                         st: maskSt('conic-gradient(#000 var(--ssa),transparent var(--ssa) calc(360deg - var(--ssa)),#000 calc(360deg - var(--ssa)))'), i: 'from{--ssa:0deg}to{--ssa:180deg}', ease: 'linear' },
    { k: 'blindsH',  t: 'Blinds (gorizontal)', g: 'Ochilish', ppt: '<p:blinds dir="horz"/>',        st: maskSt('repeating-linear-gradient(to bottom,#000 0 var(--ssp),transparent var(--ssp) 16.667%)'), i: 'from{--ssp:0%}to{--ssp:16.667%}', ease: 'ease-in-out' },
    { k: 'blindsV',  t: 'Blinds (vertikal)', g: 'Ochilish', ppt: '<p:blinds dir="vert"/>',          st: maskSt('repeating-linear-gradient(to right,#000 0 var(--ssp),transparent var(--ssp) 16.667%)'), i: 'from{--ssp:0%}to{--ssp:16.667%}', ease: 'ease-in-out' }
  ];
  var MAP = {};
  L.forEach(function (x) { MAP[x.k] = x; });
  function plusPoly(sc) {
    var w = 50 * sc, l = 100 * sc, p = function (x, y) { return (50 + x) + '% ' + (50 + y) + '%'; };
    return 'polygon(' + [p(-w, -l), p(w, -l), p(w, -w), p(l, -w), p(l, w), p(w, w), p(w, l), p(-w, l), p(-w, w), p(-l, w), p(-l, -w), p(-w, -w)].join(',') + ')';
  }
  function maskSt(m) { return '-webkit-mask-image:' + m + ';mask-image:' + m + ';'; }

  function clampDur(v, def) {
    var n = parseFloat(v);
    if (!isFinite(n) || n <= 0) return def == null ? 0.7 : def;
    return Math.max(0.2, Math.min(5, Math.round(n * 10) / 10));
  }
  /** keyframes + klass qoidalari. prefixIn / prefixOut — masalan '.tr-' va '.tr-out-' */
  function css(prefixIn, prefixOut, scope) {
    var sc = scope ? scope + ' ' : '';
    var out = [];
    L.forEach(function (x) {
      out.push('@keyframes ssTrIn_' + x.k + '{' + x.i + '}');
      if (x.o) out.push('@keyframes ssTrOut_' + x.k + '{' + x.o + '}');
      out.push(sc + prefixIn + x.k + '{animation:ssTrIn_' + x.k + ' var(--trd,.7s) ' + (x.ease || E) + ' both;will-change:transform,opacity;' + (x.st || '') + '}');
      if (x.o) out.push(sc + prefixOut + x.k + '{animation:ssTrOut_' + x.k + ' var(--trd,.7s) ' + (x.ease || E) + ' both;will-change:transform,opacity}');
    });
    out.unshift('@property --ssa{syntax:"<angle>";inherits:false;initial-value:0deg}', '@property --ssp{syntax:"<percentage>";inherits:false;initial-value:0%}');
    out.push('@media (prefers-reduced-motion:reduce){[class*="' + prefixIn.split('.').pop() + '"],[class*="' + prefixOut.split('.').pop() + '"]{animation:none!important}}');
    return out.join('\n');
  }

  /** PowerPoint <p:transition> (mc:AlternateContent bilan — p14:dur aniq davomiylik uchun). */
  function pptXml(key, dur, auto) {
    var x = MAP[key == null || key === '' ? 'fade' : key];
    if (!x || key === 'none') return '';
    var d = clampDur(dur, 0.7), ms = Math.round(d * 1000);
    var spd = d <= 0.5 ? 'fast' : (d <= 1.0 ? 'med' : 'slow');
    var adv = auto > 0 ? ' advTm="' + Math.round(auto * 1000) + '"' : '';
    var fbInner = x.p14 ? '<p:fade/>' : x.ppt;
    var ns14 = 'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"';
    return '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
      '<mc:Choice ' + ns14 + ' Requires="p14"><p:transition spd="' + spd + '"' + adv + ' p14:dur="' + ms + '">' + x.ppt + '</p:transition></mc:Choice>' +
      '<mc:Fallback><p:transition spd="' + spd + '"' + adv + '>' + fbInner + '</p:transition></mc:Fallback></mc:AlternateContent>';
  }

  window.SS_TR = { list: L, map: MAP, css: css, pptXml: pptXml, clampDur: clampDur, ease: E };
})();
