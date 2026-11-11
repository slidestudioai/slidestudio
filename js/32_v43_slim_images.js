/* =====================================================================
 * 32_v43_slim_images.js  (v43) — RASMLARNI SIQISH (fayl hajmi muammosi tuzatmasi)
 *
 * Muammo: yuklangan rasmlar asl o'lchamda (masalan 4000x3000, 3-5 MB) slayd JSON'iga
 *   base64 qilib yozilar edi. Eksportda esa shu JSON PDF/PPTX/HTML ichiga yana nusxa
 *   bo'lib joylanardi, slaydlar esa PNG x3 sifatida chizilardi -> 15 slayd = ~13 MB.
 *
 * Yechim:
 *   1) Rasm slaydda ko'rinadigan o'lchamidan ~2x kattaroq (max 1920px) qilib, JPEG ga
 *      siqiladi (shaffof PNG bo'lsa PNG qoladi, GIF tegilmaydi).
 *   2) fabric obyekti width/height/scale/crop qiymatlari mos o'zgartiriladi -> slaydda
 *      rasm xuddi avvalgidek ko'rinadi.
 *   3) Yangi yuklanayotgan rasmlar ham darrov siqiladi (max 1600px).
 *
 * API: window.ssSlimSlideJson(parsedSlide) -> Promise<son>,  window.ssSlimDataUrl(dataUrl, maxDim)
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ssSlimSlideJson) return;

  var MIN_CHARS = 120 * 1024;     // shundan kichik data: URL larga tegilmaydi
  var JPEG_Q = 0.86;
  var MIN_DIM = 900, MAX_DIM = 1920;
  var cache = new Map();          // src -> Map(key -> Promise)

  function loadImg(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }

  function hasAlpha(ctx, w, h) {
    try {
      var d = ctx.getImageData(0, 0, w, h).data;
      for (var i = 3; i < d.length; i += 4) { if (d[i] < 250) return true; }
      return false;
    } catch (e) { return true; }   // aniqlab bo'lmasa — PNG qoldiramiz (xavfsiz yo'l)
  }

  /** Asosiy siqish. dimFn(W,H) -> maksimal tomon (px). Natija: {url,W,H,nw,nh} yoki null (o'zgarmaydi). */
  async function core(src, dimFn) {
    if (typeof src !== 'string' || src.length < MIN_CHARS) return null;
    var m = /^data:image\/(png|jpe?g|webp|bmp);base64,/i.exec(src);
    if (!m) return null;                         // gif, svg, video va boshqalar — tegilmaydi
    var im = await loadImg(src);
    if (!im) return null;
    var W = im.naturalWidth, H = im.naturalHeight;
    if (!W || !H) return null;
    var maxDim = Math.max(64, Math.round(dimFn(W, H)));
    var k = Math.min(1, maxDim / Math.max(W, H));
    var isJpeg = /jpe?g/i.test(m[1]);
    if (k >= 1 && isJpeg && src.length < 400 * 1024) return null;   // allaqachon yengil
    var nw = Math.max(1, Math.round(W * k)), nh = Math.max(1, Math.round(H * k));
    var c = document.createElement('canvas');
    c.width = nw; c.height = nh;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, 0, 0, nw, nh);
    var out;
    if (!isJpeg && hasAlpha(ctx, nw, nh)) out = c.toDataURL('image/png');
    else out = c.toDataURL('image/jpeg', JPEG_Q);
    if (!out || out.length >= src.length) return null;               // foyda yo'q — asl qoladi
    return { url: out, W: W, H: H, nw: nw, nh: nh };
  }

  function cached(src, key, fn) {
    var m = cache.get(src);
    if (!m) { m = new Map(); cache.set(src, m); if (cache.size > 60) cache.delete(cache.keys().next().value); }
    if (!m.has(key)) m.set(key, fn());
    return m.get(key);
  }

  /** Tashqi API: oddiy data: URL ni siqadi (yuklashda ishlatiladi). Xato bo'lsa asl qaytadi. */
  async function slimDataUrl(src, maxDim) {
    try {
      var r = await cached(src, 'u' + (maxDim || 1600), function () { return core(src, function () { return maxDim || 1600; }); });
      return r ? r.url : src;
    } catch (e) { return src; }
  }
  window.ssSlimDataUrl = slimDataUrl;

  /** fabric 'image' obyekti yoki backgroundImage ni siqadi (o'lcham/scale mos o'zgaradi). */
  async function slimImageObj(o, isBg) {
    if (!o || typeof o.src !== 'string' || o.src.length < MIN_CHARS) return false;
    if (o.isGif || o.type === 'gifImage' || o.isVideo || o.type === 'videoImage') return false;
    var sx = Math.abs(+o.scaleX || 1), sy = Math.abs(+o.scaleY || 1);
    var key = 'o' + (isBg ? 'b' : '') + Math.round(sx * 1000) + '_' + Math.round(sy * 1000);
    var src = o.src;
    var r = await cached(src, key, function () {
      return core(src, function (W, H) {
        if (isBg) return MAX_DIM;
        var shown = Math.max(W * sx, H * sy);              // rasmning to'liq ko'rinadigan kattaligi (canvas px)
        return Math.min(MAX_DIM, Math.max(MIN_DIM, shown * 2));   // eksport x2 sifat uchun yetarli
      });
    });
    if (!r) return false;
    var kx = r.nw / r.W, ky = r.nh / r.H;
    if (kx !== 1 || ky !== 1) {
      if (typeof o.width === 'number') o.width = o.width * kx;
      if (typeof o.height === 'number') o.height = o.height * ky;
      o.scaleX = (typeof o.scaleX === 'number' ? o.scaleX : 1) / kx;
      o.scaleY = (typeof o.scaleY === 'number' ? o.scaleY : 1) / ky;
      if (typeof o.cropX === 'number') o.cropX = o.cropX * kx;
      if (typeof o.cropY === 'number') o.cropY = o.cropY * ky;
    }
    o.src = r.url;
    return true;
  }

  async function walkObjects(list, st) {
    var n = 0;
    for (var i = 0; i < (list || []).length; i++) {
      var o = list[i];
      if (!o) continue;
      if (o.type === 'image' && !o.isGif) { if (await slimImageObj(o, false)) n++; }
      if (Array.isArray(o.objects)) n += await walkObjects(o.objects, st);   // guruhlar
    }
    return n;
  }

  /** Bitta slayd (JSON.parse qilingan obyekt) ichidagi rasmlarni siqadi. Siqilgan rasmlar sonini qaytaradi. */
  window.ssSlimSlideJson = async function (p, st) {
    var n = 0;
    try {
      if (!p || typeof p !== 'object') return 0;
      if (p.backgroundImage && !p.backgroundGif) { if (await slimImageObj(p.backgroundImage, true)) n++; }
      n += await walkObjects(p.objects, st);
    } catch (e) { console.warn('[v43] slim', e); }
    if (st && n) st.slimmed = (st.slimmed || 0) + n;
    return n;
  };

  /* --- Yangi yuklanayotgan rasmlar darrov siqilsin (GIF/video tegilmaydi) --- */
  (function wrapUpload() {
    var f = window.placeImageDirectlyOnSlide;
    if (typeof f !== 'function' || f.__v43slim) { if (!f) setTimeout(wrapUpload, 800); return; }
    var w = async function (base64Data) {
      var args = Array.prototype.slice.call(arguments);
      try {
        if (typeof base64Data === 'string' && /^data:image\/(png|jpe?g|webp|bmp);base64,/i.test(base64Data)) {
          args[0] = await slimDataUrl(base64Data, 1600);
        }
      } catch (e) {}
      return f.apply(this, args);
    };
    w.__v43slim = true;
    for (var k in f) { try { w[k] = f[k]; } catch (e) {} }
    window.placeImageDirectlyOnSlide = w;
  })();
})();
