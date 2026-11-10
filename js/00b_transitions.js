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
    { k: 'circle', t: 'Circle',        g: 'Ochilish', ppt: '<p:circle/>',                 i: 'from{clip-path:circle(0% at 50% 50%)}to{clip-path:circle(78% at 50% 50%)}', ease: 'ease-in-out' }
  ];
  var MAP = {};
  L.forEach(function (x) { MAP[x.k] = x; });

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
      out.push(sc + prefixIn + x.k + '{animation:ssTrIn_' + x.k + ' var(--trd,.7s) ' + (x.ease || E) + ' both;will-change:transform,opacity}');
      if (x.o) out.push(sc + prefixOut + x.k + '{animation:ssTrOut_' + x.k + ' var(--trd,.7s) ' + (x.ease || E) + ' both;will-change:transform,opacity}');
    });
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
