/* =====================================================================
 * 15_video_anim_btn.js  (v27)
 *   1) VIDEO  — YouTube / Vimeo / Dailymotion / MP4-WebM havola yoki fayl
 *               (element sifatida ham, orqa fon sifatida ham)
 *   2) TUGMA  — interaktiv tugma (keyingi slayd, havola, popup ...)
 *   3) ANIMATSIYA — "Animatsiya" paneli (1 bosish bilan), taqdimotda ijro
 * Barcha modullar bir xil global scope da (ES module emas).
 * ===================================================================== */
(function () {
  'use strict';
  if (typeof fabric === 'undefined' || typeof canvas === 'undefined') return;

  const SW = 960, SH = 540;
  const toast = function (m, t) { try { showToast(m, t); } catch (e) {} };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const isTrue = function (v, d) { return v === undefined || v === null ? d : !(v === false || v === 'false' || v === 0 || v === '0'); };

  // ---------------------------------------------------------------------
  // 0. Serialize props
  // ---------------------------------------------------------------------
  ['animName', 'animDur', 'animDelay', 'animLoop', 'mRadius', 'mCrop', 'mBase'].forEach(function (p) {
    if (SERIALIZE_PROPS.indexOf(p) < 0) SERIALIZE_PROPS.push(p);
  });

  /** mCrop = [chap, tepa, o'ng, past] (0..1 ulush) -> ichki element uchun CSS (overlay lar uchun) */
  window.mediaCropStyle = function (o) {
    const c = o && o.mCrop;
    if (!c || !(c[0] || c[1] || c[2] || c[3])) return null;
    const w = Math.max(0.05, 1 - c[0] - c[2]), h = Math.max(0.05, 1 - c[1] - c[3]);
    return { width: (100 / w) + '%', height: (100 / h) + '%', left: (-c[0] / w * 100) + '%', top: (-c[1] / h * 100) + '%' };
  };
  window.applyMediaInnerCrop = function (inner, o) {
    if (!inner) return;
    const cs = window.mediaCropStyle(o);
    if (!cs) {
      if (inner.dataset.cropped) { inner.style.position = ''; inner.style.maxWidth = ''; inner.style.width = '100%'; inner.style.height = '100%'; inner.style.left = ''; inner.style.top = ''; delete inner.dataset.cropped; }
      return;
    }
    inner.dataset.cropped = '1';
    inner.style.position = 'absolute'; inner.style.maxWidth = 'none';
    inner.style.width = cs.width; inner.style.height = cs.height; inner.style.left = cs.left; inner.style.top = cs.top;
  };

  // ---------------------------------------------------------------------
  // 1. VIDEO URL parser  (havolani o'zi mos formatga o'tkazadi)
  // ---------------------------------------------------------------------
  function parseTime(t) {
    if (!t) return 0;
    t = String(t);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!m) return 0;
    return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
  }
  /**
   * @returns {null | {kind:'youtube'|'vimeo'|'dailymotion'|'file', id?:string, url:string, start?:number, hash?:string}}
   */
  function parseVideoUrl(raw) {
    let u = String(raw == null ? '' : raw).trim();
    if (!u) return null;
    const ifr = u.match(/<iframe[^>]+src=["']([^"']+)["']/i);   // <iframe ...> kodi tashlansa ham ishlaydi
    if (ifr) u = ifr[1];
    if (/^(data:video\/|blob:)/i.test(u)) return { kind: 'file', url: u };
    if (/^\/\//.test(u)) u = 'https:' + u;
    if (!/^https?:\/\//i.test(u) && /^(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|player\.vimeo\.com|dailymotion\.com|dai\.ly)/i.test(u)) u = 'https://' + u;
    if (/^\/api\/proxy-/i.test(u) || /^\/[^/]/.test(u)) {
      if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(u)) return { kind: 'file', url: u };
      return null;
    }
    let url;
    try { url = new URL(u); } catch (e) { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
    const path = url.pathname;
    const start = parseTime(url.searchParams.get('t') || url.searchParams.get('start') || '');
    let id = '';
    if (host === 'youtu.be') {
      id = path.split('/')[1] || '';
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (path === '/watch') id = url.searchParams.get('v') || '';
      else {
        const m = path.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
        if (m) id = m[1];
      }
    }
    if (id) {
      id = id.slice(0, 11);
      if (/^[\w-]{11}$/.test(id)) return { kind: 'youtube', id: id, url: 'https://www.youtube.com/watch?v=' + id, start: start };
      return null;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const m = path.match(/\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,12}))?/i);
      if (m) {
        const hash = m[2] || url.searchParams.get('h') || '';
        return { kind: 'vimeo', id: m[1], hash: hash, url: 'https://vimeo.com/' + m[1] + (hash ? '/' + hash : ''), start: start };
      }
      return null;
    }
    if (host === 'dailymotion.com' || host === 'dai.ly') {
      const m = host === 'dai.ly' ? path.match(/^\/([a-z0-9]+)/i) : path.match(/\/video\/([a-z0-9]+)/i);
      if (m) return { kind: 'dailymotion', id: m[1], url: 'https://www.dailymotion.com/video/' + m[1] };
      return null;
    }
    if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(path + url.search) || /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(path)) {
      return { kind: 'file', url: url.href };
    }
    return null;
  }
  window.parseVideoUrl = parseVideoUrl;

  /** iframe manzili (YouTube/Vimeo/Dailymotion) */
  function embedSrc(spec, interactive) {
    const auto = isTrue(spec.embedAutoplay, true) ? 1 : 0;
    const bg = spec.embedBg === true;
    const mute = (interactive && !bg) ? (isTrue(spec.embedMuted, true) ? 1 : 0) : 1;   // muharrirda va fonda doim ovozsiz
    const loop = isTrue(spec.embedLoop, true) ? 1 : 0;
    const ctl = (interactive && !bg) ? 1 : 0;
    const start = spec.embedStart || 0;
    let origin = '';
    try { if (/^https?:$/.test(location.protocol)) origin = '&origin=' + encodeURIComponent(location.origin); } catch (e) {}
    if (spec.embedKind === 'youtube') {
      const q = ['autoplay=' + auto, 'mute=' + mute, 'controls=' + ctl, 'rel=0', 'modestbranding=1', 'playsinline=1', 'iv_load_policy=3', 'enablejsapi=1', 'cc_load_policy=0'];
      if (!ctl) q.push('disablekb=1', 'fs=0');
      if (bg) q.push('showinfo=0');
      if (loop) q.push('loop=1', 'playlist=' + spec.embedId);
      if (start) q.push('start=' + start);
      return 'https://www.youtube.com/embed/' + spec.embedId + '?' + q.join('&') + origin;
    }
    if (spec.embedKind === 'vimeo') {
      const q = ['autoplay=' + auto, 'muted=' + mute, 'loop=' + loop, 'controls=' + ctl, 'title=0', 'byline=0', 'portrait=0', 'playsinline=1', 'dnt=1'];
      if (bg) q.push('background=1');   // Vimeo: sarlavha, tugmalar, profil — hech biri chiqmaydi
      if (spec.embedHash) q.push('h=' + spec.embedHash);
      return 'https://player.vimeo.com/video/' + spec.embedId + '?' + q.join('&') + (start ? '#t=' + start + 's' : '');
    }
    if (spec.embedKind === 'dailymotion') {
      return 'https://www.dailymotion.com/embed/video/' + spec.embedId + '?autoplay=' + auto + '&mute=' + mute + '&controls=' + ctl + '&ui-logo=0&sharing-enable=0&queue-enable=0&ui-start-screen-info=0';
    }
    return '';
  }

  // ---- v30: yuklanish holati (spinner) + silliq paydo bo'lish; YouTube/Vimeo "play" signalini kutadi ----
  const __ssByWin = [];
  window.addEventListener('message', function (ev) {
    try {
      for (let i = __ssByWin.length - 1; i >= 0; i--) {
        const it = __ssByWin[i];
        if (!it.node.isConnected) { __ssByWin.splice(i, 1); continue; }
        if (it.node.contentWindow !== ev.source) continue;
        let d = ev.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
        if (!d) return;
        const yt = d.event === 'onStateChange' && d.info === 1;
        const yt2 = d.event === 'infoDelivery' && d.info && d.info.playerState === 1;
        const vm = d.event === 'play' || d.event === 'playProgress' || d.event === 'timeupdate';
        if (yt || yt2 || vm) it.ready();
        return;
      }
    } catch (e) {}
  });
  function ssAttachLoading(node, spec) {
    let done = false;
    node.style.opacity = '0';
    node.style.transition = 'opacity .5s ease';
    function spinnerParent() {
      const p = node.parentNode;
      if (!p) return null;
      return p;
    }
    function showSpinner(tries) {
      if (done || (spec && spec.embedBg)) return;   // v32: fon videosida qora/aylanuvchi quti yo'q — plakat ko'rinib turadi
      const p = spinnerParent();
      if (!p) { if ((tries || 0) < 40) setTimeout(function () { showSpinner((tries || 0) + 1); }, 25); return; }
      p.classList.add('ss-loading');
      if (!p.querySelector(':scope > .ss-spin')) {
        const sp = document.createElement('div');
        sp.className = 'ss-spin';
        sp.innerHTML = '<i></i>';
        p.appendChild(sp);
      }
    }
    function reveal() {
      node.dataset.ssReady = '1';
      node.style.opacity = '1';
      const p = node.parentNode;
      if (p) {
        p.classList.remove('ss-loading');
        const sp = p.querySelector(':scope > .ss-spin');
        if (sp) { sp.classList.add('done'); setTimeout(function () { try { sp.remove(); } catch (e) {} }, 550); }
      }
    }
    function ready() {
      if (done) return;
      done = true;
      // v33: fon iframe (YouTube) — boshlang'ich 1-3 soniyada chiqadigan sarlavha/tugmalar ko'rinmasligi uchun kechiktirib ochamiz
      if (spec && spec.embedBg && node.tagName === 'IFRAME' && spec.embedKind === 'youtube') setTimeout(reveal, SS_BG_REVEAL_DELAY);
      else reveal();
    }
    node.__ssReady = ready;
    setTimeout(function () { showSpinner(0); }, 0);
    if (node.tagName === 'VIDEO') {
      node.addEventListener('playing', ready, { once: true });
      node.addEventListener('loadeddata', function () { setTimeout(ready, 120); }, { once: true });
      node.addEventListener('error', ready, { once: true });
      setTimeout(ready, 12000);
    } else {
      const kind = spec && spec.embedKind;
      __ssByWin.push({ node: node, ready: ready });
      node.addEventListener('load', function () {
        try {
          const w = node.contentWindow;
          if (kind === 'youtube') {
            w.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
            w.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'widget' }), '*');
          } else if (kind === 'vimeo') {
            ['play', 'playProgress'].forEach(function (n) { w.postMessage(JSON.stringify({ method: 'addEventListener', value: n }), '*'); });
          }
        } catch (e) {}
        // signal kelmasa ham (masalan, autoplay bloklangan) — sahifa yuklangach 2.5 soniyadan so'ng ko'rsatamiz
        setTimeout(ready, kind === 'dailymotion' ? 1200 : (spec && spec.embedBg ? 4500 : 2500));
      }, { once: true });
      setTimeout(ready, 15000);
    }
  }
  // v33: 1.15 yetmasdi — YouTube sarlavha paneli (tepa) va logotip (past) ko'rinib qolardi. 1.4 => tepa/pastdan ~14% kesiladi
  const SS_BG_CROP = 1.4;
  const SS_BG_REVEAL_DELAY = 3200;   // YouTube sarlavhasi video boshlangach ~3 soniya turadi — shu vaqt plakat ko'rinadi
  /** Fon iframe: YouTube sarlavhasi/tugmalari ko'rinmasligi uchun kattalashtirib, chetlarini kesamiz */
  function ssBgIframeStyle(node) {
    if (!node || node.tagName !== 'IFRAME') return;
    node.style.position = 'absolute';
    node.style.left = '50%'; node.style.top = '50%';
    node.style.right = 'auto'; node.style.bottom = 'auto';
    node.style.width = '100%'; node.style.height = '100%';
    node.style.transformOrigin = 'center center';
    node.style.transform = 'translate(-50%,-50%) scale(' + SS_BG_CROP + ')';
    node.style.pointerEvents = 'none';
    try { if (node.parentNode) node.parentNode.style.overflow = 'hidden'; } catch (e) {}
  }

  /** Player DOM (iframe yoki <video>) */
  function buildPlayer(spec, interactive, fit) {
    let node;
    if (spec.embedKind === 'file') {
      node = document.createElement('video');
      node.src = spec.embedUrl;
      node.playsInline = true;
      node.setAttribute('playsinline', '');
      node.muted = interactive ? isTrue(spec.embedMuted, true) : true;
      node.loop = isTrue(spec.embedLoop, true);
      node.autoplay = isTrue(spec.embedAutoplay, true);
      node.controls = !!interactive;
      node.preload = 'auto';
      node.style.objectFit = fit || 'contain';
      node.style.background = 'transparent';
      const kick = function () {
        try {
          if (!node.autoplay) return;
          const p = node.play();
          if (p && p.catch) p.catch(function () {
            // brauzer ovozli avto-ijroni bloklasa — ovozsiz boshlaymiz, boshqaruv tugmalari orqali yoqiladi
            if (!node.muted) { try { node.muted = true; const p2 = node.play(); if (p2 && p2.catch) p2.catch(function () {}); } catch (e) {} }
          });
        } catch (e) {}
      };
      node.addEventListener('canplay', kick, { once: true });
      kick();
    } else {
      node = document.createElement('iframe');
      node.src = embedSrc(spec, interactive);
      node.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write; accelerometer; gyroscope');
      node.setAttribute('allowfullscreen', '');
      node.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      node.setAttribute('frameborder', '0');
      node.setAttribute('loading', 'eager');
      node.title = 'Video';
    }
    node.style.cssText += ';width:100%;height:100%;border:0;display:block;border-radius:inherit;';
    try { ssAttachLoading(node, spec); } catch (e) {}
    return node;
  }

  function specFromObj(o) {
    return {
      embedKind: o.embedKind, embedId: o.embedId, embedUrl: o.embedUrl, embedHash: o.embedHash,
      embedAutoplay: o.embedAutoplay, embedLoop: o.embedLoop, embedMuted: o.embedMutedUser === true, embedStart: o.embedStart
    };
  }
  function specFromParsed(info, o) {
    o = o || {};
    return {
      embedKind: info.kind, embedId: info.id || '', embedUrl: info.url, embedHash: info.hash || '',
      embedStart: info.start || 0,
      embedAutoplay: isTrue(o.autoplay, true), embedLoop: isTrue(o.loop, true), embedMuted: isTrue(o.muted, false)
    };
  }

  // ---------------------------------------------------------------------
  // 2. Fabric class: EmbedVideo  ("teshik" usuli — video canvas ostida)
  // ---------------------------------------------------------------------
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  const EMBED_KEYS = ['embedUrl', 'embedKind', 'embedId', 'embedHash', 'embedThumb', 'embedAutoplay', 'embedLoop', 'embedMuted', 'embedMutedUser', 'embedStart'];
  const EDITOR_LIVE = true;   // taqdimot uchun "teshik" rejimi
  const EDITOR_HOLES = false; // v29: muharrirda YouTube/Vimeo plakat bo'lib chiziladi (teshik usuli videoni yo'qotib/siljitib yuborardi)
  //   // muharrirda video plakat (poster) sifatida chiziladi: har doim ko'rinadi, z-tartib va thumbnail to'g'ri; ijro — taqdimotda
  window.__ssStaticRender = 0;   // >0 bo'lsa video o'rniga placeholder chiziladi (PDF / thumbnail)

  const EmbedVideo = fabric.util.createClass(fabric.Rect, {
    type: 'embedVideo',
    objectCaching: false,
    embedUrl: '', embedKind: 'file', embedId: '', embedHash: '', embedThumb: '',
    embedAutoplay: true, embedLoop: true, embedMuted: false, embedMutedUser: false, embedStart: 0,
    initialize: function (options) {
      options = options || {};
      const o = Object.assign({ width: 480, height: 270, fill: '#0f172a', rx: 0, ry: 0, objectCaching: false }, options);
      this.callSuper('initialize', o);
      this.isEmbed = true;
      this.objectCaching = false;
      if (this.embedUrl && (!this.embedKind || (this.embedKind !== 'file' && !this.embedId))) {
        const p = parseVideoUrl(this.embedUrl);
        if (p) { this.embedKind = p.kind; this.embedId = p.id || ''; this.embedHash = p.hash || ''; }
      }
    },
    _ensureThumb: function () {
      if (this._thumbTried) return;
      this._thumbTried = true;
      let src = this.embedThumb;
      if (!src && this.embedKind === 'youtube' && this.embedId) src = 'https://i.ytimg.com/vi/' + this.embedId + '/hqdefault.jpg';
      if (!src && this.embedKind === 'vimeo' && this.embedId) src = 'https://vumbnail.com/' + this.embedId + '.jpg';
      if (!src && this.embedKind === 'dailymotion' && this.embedId) src = 'https://www.dailymotion.com/thumbnail/video/' + this.embedId;
      const self = this;
      if (!src && this.embedKind === 'file' && this.embedUrl) {
        // mp4: birinchi kadrni plakat sifatida olamiz (faqat o'z-origin / blob / data bo'lsa — aks holda canvas "tainted" bo'ladi)
        try {
          const u = this.embedUrl;
          const ok = /^(data:|blob:|\/)/.test(u) || (function () { try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; } })();
          if (!ok) return;
          const v = document.createElement('video');
          v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = u;
          v.addEventListener('loadeddata', function () { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 4); } catch (e) {} }, { once: true });
          v.addEventListener('seeked', function () {
            try {
              const c = document.createElement('canvas');
              c.width = Math.min(960, v.videoWidth || 640); c.height = Math.round(c.width * (v.videoHeight || 360) / (v.videoWidth || 640));
              c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
              self._thumbImg = c; self.dirty = true;
              if (self.canvas) self.canvas.requestRenderAll();
            } catch (e) {}
          }, { once: true });
        } catch (e) {}
        return;
      }
      if (!src) return;
      const tries = /^(data:|blob:|\/)/.test(src) ? [src] : [src, '/api/proxy-image?raw=1&url=' + encodeURIComponent(src)];
      let i = 0;
      (function next() {
        if (i >= tries.length) return;
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () {
          self._thumbImg = im; self.dirty = true;
          try { if (self.canvas) self.canvas.requestRenderAll(); } catch (e) {}
        };
        im.onerror = next;
        im.src = tries[i++];
      })();
    },
    _ensureVid: function () {
      if (this._vid) return this._vid;
      const self = this;
      const u = this.embedUrl;
      // v30: bir xil manzilli video elementi qayta ishlatiladi — slayd almashganda/undo da video to'xtab yo'qolmaydi
      const _cache = window.__ssVidCache || (window.__ssVidCache = {});
      const _hit = _cache[u];
      if (_hit && _hit.v && _hit.v.isConnected && !_hit.v.error) {
        _hit.miss = 0; this._vid = _hit.v;
        try { const pp = _hit.v.play(); if (pp && pp.catch) pp.catch(function () {}); } catch (e) {}
        return _hit.v;
      }
      const v = document.createElement('video');
      v.muted = true; v.defaultMuted = true;
      v.loop = this.embedLoop !== false;
      v.playsInline = true; v.setAttribute('playsinline', '');
      v.autoplay = true; v.preload = 'auto';
      try { if (!/^(blob:|data:|\/)/.test(u) && new URL(u, location.href).origin !== location.origin) v.crossOrigin = 'anonymous'; } catch (e) {}
      v.addEventListener('error', function () { self._vidFailed = true; try { canvas.requestRenderAll(); } catch (e) {} });
      const kick = function () { try { const p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} };
      v.addEventListener('canplay', kick);
      v.addEventListener('loadeddata', function () { try { canvas.requestRenderAll(); } catch (e) {} });
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
      v.src = u;
      try { (document.getElementById('gifKeepAlive') || document.body).appendChild(v); } catch (e) {}
      kick();
      this._vid = v;
      _cache[u] = { v: v, miss: 0 };
      try { if (window.VideoLive) window.VideoLive.register(this, v); } catch (e) {}
      return v;
    },
    _drawVideoFrame: function (ctx, x, y, w, h, r) {
      const v = this._ensureVid();
      const vw = v.videoWidth, vh = v.videoHeight;
      if (!(v.readyState >= 2 && vw && vh)) return false;   // kadr tayyor emas — plakat chiziladi
      ctx.save();
      roundRectPath(ctx, x, y, w, h, r);
      ctx.clip();
      {
        const s = Math.min(w / vw, h / vh);
        const dw = vw * s, dh = vh * s;
        const c = this.mCrop;
        try {
          if (c && (c[0] || c[1] || c[2] || c[3])) {
            ctx.drawImage(v, c[0] * vw, c[1] * vh, Math.max(1, (1 - c[0] - c[2]) * vw), Math.max(1, (1 - c[1] - c[3]) * vh), x, y, w, h);
          } else {
            ctx.drawImage(v, -dw / 2, -dh / 2, dw, dh);
          }
        } catch (e) { this._vidFailed = true; ctx.restore(); return false; }
      }
      ctx.restore();
      return true;
    },
    _render: function (ctx) {
      const w = this.width, h = this.height, x = -w / 2, y = -h / 2;
      if (this.embedKind === 'file' && !this._vidFailed && this.canvas && EDITOR_LIVE && !window.__ssStaticRender &&
          this.canvas === canvas && ctx.canvas === canvas.lowerCanvasEl) {
        if (this._drawVideoFrame(ctx, x, y, w, h, Math.min(this.rx || 0, w / 2, h / 2))) return;
      }
      const r = Math.min(this.rx || 0, w / 2, h / 2);
      const c = this.canvas;
      const live = !!c && EDITOR_LIVE && (c.__holes === true || (EDITOR_HOLES && !window.__ssStaticRender && c === canvas && ctx.canvas === canvas.lowerCanvasEl));
      if (live) {
        // video canvas ostida — shu joyni shaffof qilamiz; ustidagi obyektlar to'g'ri tartibda qoladi
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        roundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.restore();
        return;
      }
      this._ensureThumb();
      ctx.save();
      roundRectPath(ctx, x, y, w, h, r);
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#1e293b'); g.addColorStop(1, '#0f172a');
      ctx.fillStyle = g;
      ctx.fill();
      const im = this._thumbImg;
      const iw = im ? (im.naturalWidth || im.width) : 0, ih = im ? (im.naturalHeight || im.height) : 0;
      if (im && iw) {
        ctx.save();
        ctx.clip();
        const s = Math.max(w / iw, h / ih);
        const dw = iw * s, dh = ih * s;
        try { ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh); } catch (e) {}
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
      const R = Math.max(18, Math.min(46, Math.min(w, h) * 0.14));
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-R * 0.28, -R * 0.45);
      ctx.lineTo(R * 0.52, 0);
      ctx.lineTo(-R * 0.28, R * 0.45);
      ctx.closePath();
      ctx.fillStyle = this.embedKind === 'youtube' ? '#dc2626' : '#0f172a';
      ctx.fill();
      const _loadingPoster = !this._vidFailed && ((this.embedKind === 'file' && !!this._vid) || (!im && this._thumbTried));
      if (_loadingPoster && !window.__ssStaticRender) {
        const t = (Date.now() % 900) / 900 * Math.PI * 2, sr = Math.max(10, R * 0.6);
        ctx.beginPath(); ctx.arc(0, 0, R + 10, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, R + 10, t, t + Math.PI * 0.55); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
        try { const cv = this.canvas; if (cv) setTimeout(function () { try { cv.requestRenderAll(); } catch (e) {} }, 60); } catch (e) {}
      }
      const label = ({ youtube: 'YouTube', vimeo: 'Vimeo', dailymotion: 'Dailymotion', file: 'VIDEO' })[this.embedKind] || 'VIDEO';
      ctx.font = 'bold ' + Math.max(11, Math.min(15, w * 0.035)) + 'px Roboto, Arial, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(label, x + 12, y + h - 10);
      ctx.restore();
    },
    toObject: function (propertiesToInclude) {
      const base = this.callSuper('toObject', propertiesToInclude);
      EMBED_KEYS.forEach(function (k) { base[k] = this[k]; }, this);
      base.isEmbed = true;
      return base;
    }
  });
  EmbedVideo.async = true;
  EmbedVideo.fromObject = function (object, callback) {
    const o = new EmbedVideo(object);
    if (callback) callback(o);
    return o;
  };
  fabric.EmbedVideo = EmbedVideo;
  try { if (fabric.util.registerClass) fabric.util.registerClass('embedVideo', EmbedVideo); } catch (e) {}

  // PDF / thumbnail uchun: placeholder chizilsin
  (function patchSafeToDataURL() {
    if (typeof safeToDataURL !== 'function' || safeToDataURL.__ssPatched) return;
    const orig = safeToDataURL;
    const patched = function () {
      window.__ssStaticRender++;
      try { return orig.apply(this, arguments); }
      finally { window.__ssStaticRender--; }
    };
    patched.__ssPatched = true;
    safeToDataURL = patched;
  })();

  function isEmbedObj(o) { return !!o && (o.type === 'embedVideo' || o.isEmbed === true); }
  function isButtonObj(o) { return !!o && (o.type === 'slideButton' || o.isButton === true); }
  window.isEmbedObj = isEmbedObj;

  // ---------------------------------------------------------------------
  // 3. Fabric class: SlideButton
  // ---------------------------------------------------------------------
  const BTN_KEYS = ['btnLabel', 'btnAction', 'btnTarget', 'btnTextColor', 'btnFontSize', 'btnFontFamily', 'btnBold', 'btnUnderline'];
  const SlideButton = fabric.util.createClass(fabric.Rect, {
    type: 'slideButton',
    objectCaching: false,
    btnLabel: 'Tugma', btnAction: 'next', btnTarget: '', btnTextColor: '#ffffff',
    btnFontSize: 22, btnFontFamily: 'Montserrat', btnBold: true,
    initialize: function (options) {
      options = options || {};
      const o = Object.assign({ width: 200, height: 56, fill: '#4F46E5', rx: 14, ry: 14, objectCaching: false }, options);
      this.callSuper('initialize', o);
      this.isButton = true;
      this.objectCaching = false;
    },
    _render: function (ctx) {
      this.callSuper('_render', ctx);
      const sx = this.scaleX || 1, sy = this.scaleY || 1;
      const w = this.width * sx;
      ctx.save();
      ctx.scale(1 / sx, 1 / sy);
      let fs = this.btnFontSize || 22;
      const fam = (this.btnFontFamily || 'Montserrat') + ', Arial, sans-serif';
      const label = String(this.btnLabel == null ? '' : this.btnLabel);
      const setFont = function (self, size) { ctx.font = (self.btnBold === false ? '' : 'bold ') + size + 'px ' + fam; };
      setFont(this, fs);
      const tw = ctx.measureText(label).width;
      const maxW = Math.max(10, w - 24);
      if (tw > maxW && tw > 0) { fs = Math.max(8, Math.floor(fs * maxW / tw)); setFont(this, fs); }
      ctx.fillStyle = this.btnTextColor || '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 1);
      if (this.btnUnderline) {
        const tw2 = ctx.measureText(label).width;
        ctx.fillRect(-tw2 / 2, fs * 0.55, tw2, Math.max(1.5, fs / 14));
      }
      ctx.restore();
    },
    toObject: function (propertiesToInclude) {
      const base = this.callSuper('toObject', propertiesToInclude);
      BTN_KEYS.forEach(function (k) { base[k] = this[k]; }, this);
      base.isButton = true;
      return base;
    }
  });
  SlideButton.async = true;
  SlideButton.fromObject = function (object, callback) {
    const o = new SlideButton(object);
    if (callback) callback(o);
    return o;
  };
  fabric.SlideButton = SlideButton;
  try { if (fabric.util.registerClass) fabric.util.registerClass('slideButton', SlideButton); } catch (e) {}

  const BTN_ACTIONS = {
    next: 'Keyingi slayd', prev: 'Oldingi slayd', first: 'Birinchi slayd', last: 'Oxirgi slayd',
    goto: 'Slaydga o\'tish (raqam)', url: 'Havolani ochish', popup: 'Oynacha (popup) ochish', none: 'Hech narsa'
  };

  // ---------------------------------------------------------------------
  // 4. EmbedOverlay (muharrir) — video canvas ostida
  // ---------------------------------------------------------------------
  const EmbedOverlay = (function () {
    const items = new Map();
    let layer = null, scheduled = false;
    function getLayer() {
      if (layer && layer.isConnected) return layer;
      const card = document.getElementById('canvasCard');
      if (!card) return null;
      layer = document.getElementById('embedUnderlay');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'embedUnderlay';
        layer.className = 'embed-underlay';
        const bg = document.getElementById('gifBgOverlay');
        if (bg && bg.nextSibling) card.insertBefore(layer, bg.nextSibling); else card.insertBefore(layer, card.firstChild);
      }
      return layer;
    }
    function boxOf(obj) {
      if (obj.group) {   // v29: tanlov guruhi ichida left/top guruhga nisbatan — mutlaq o'rinni hisoblaymiz
        try {
          const d = fabric.util.qrDecompose(obj.calcTransformMatrix());
          const gw = Math.max(1, (obj.width || 0) * d.scaleX), gh = Math.max(1, (obj.height || 0) * d.scaleY);
          return { w: gw, h: gh, ox: 0, oy: 0, left: d.translateX - gw / 2, top: d.translateY - gh / 2, angle: d.angle };
        } catch (e) {}
      }
      const w = Math.max(1, (obj.width || 0) * (obj.scaleX || 1));
      const h = Math.max(1, (obj.height || 0) * (obj.scaleY || 1));
      const ox = obj.originX === 'center' ? 0.5 : (obj.originX === 'right' ? 1 : 0);
      const oy = obj.originY === 'center' ? 0.5 : (obj.originY === 'bottom' ? 1 : 0);
      return { w: w, h: h, ox: ox, oy: oy, left: (obj.left || 0) - w * ox, top: (obj.top || 0) - h * oy };
    }
    function contentKey(o) { return [o.embedKind, o.embedId, o.embedUrl, o.embedLoop, o.embedAutoplay, o.embedStart].join('|'); }
    function cropKey(o) { return (o.mCrop || []).join(','); }
    function sync() {
      const lyr = getLayer();
      if (!lyr) return;
      if (!EDITOR_HOLES) { if (items.size) clear(); return; }
      const seen = new Set();
      canvas.getObjects().forEach(function (o) {
        if (!isEmbedObj(o) || o.visible === false) return;
        if (o.embedKind === 'file' && !o._vidFailed) return;   // v28: kanvasda chiziladi
        if (o._oid == null) o._oid = nextObjectId();
        seen.add(o._oid);
        let e = items.get(o._oid);
        const ck = contentKey(o);
        if (!e) {
          const wrap = document.createElement('div');
          wrap.className = 'embed-underlay-item';
          wrap.dataset.oid = String(o._oid);
          e = { el: wrap, ck: '', tk: '' };
          items.set(o._oid, e);
          lyr.appendChild(wrap);
        }
        if (e.ck !== ck) {
          e.ck = ck;
          e.el.innerHTML = '';
          e.el.appendChild(buildPlayer(specFromObj(o), false, 'contain'));
        }
        const b = boxOf(o);
        const tk = [b.left, b.top, b.w, b.h, o.angle, o.flipX, o.flipY, o.opacity, o.rx, o.scaleX, cropKey(o)].join('|');
        if (e.tk !== tk) {
          e.tk = tk;
          try { window.applyMediaInnerCrop(e.el.firstChild, o); } catch (er) {}
          const s = e.el.style;
          s.width = b.w + 'px'; s.height = b.h + 'px';
          s.left = b.left + 'px'; s.top = b.top + 'px';
          s.transformOrigin = (b.ox * 100) + '% ' + (b.oy * 100) + '%';
          s.transform = 'rotate(' + (o.angle || 0) + 'deg) scale(' + (o.flipX ? -1 : 1) + ',' + (o.flipY ? -1 : 1) + ')';
          s.opacity = o.opacity != null ? o.opacity : 1;
          s.borderRadius = Math.max(0, (o.rx || 0) * (o.scaleX || 1)) + 'px';
        }
      });
      Array.from(items.keys()).forEach(function (oid) {
        if (!seen.has(oid)) {
          const e = items.get(oid);
          try { e.el.remove(); } catch (er) {}
          items.delete(oid);
        }
      });
      try { verifyHoles(lyr); } catch (er) {}
    }
    /** Teshik ishlamasa (video ko'rinmasa) — videoni canvas ustiga chiqaramiz, shunda hech qachon yo'qolmaydi */
    function verifyHoles(lyr) {
      const embeds = canvas.getObjects().filter(function (o) { return isEmbedObj(o) && o.visible !== false && !(o.embedKind === 'file' && !o._vidFailed); });
      if (!embeds.length) { lyr.classList.remove('on-top'); return; }
      const ctx = canvas.getContext && canvas.getContext();
      if (!ctx) return;
      const vt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const ratio = (canvas.getRetinaScaling && canvas.getRetinaScaling()) || 1;
      let ok = 0, bad = 0;
      embeds.forEach(function (o) {
        const b = boxOf(o);
        const pts = [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88], [0.5, 0.5]];
        let holes = 0;
        pts.forEach(function (p) {
          const x = (b.left + b.w * p[0]) * vt[0] + vt[4], y = (b.top + b.h * p[1]) * vt[3] + vt[5];
          try { if (ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data[3] < 20) holes++; } catch (er) { holes = 5; }
        });
        if (holes > 0) ok++; else bad++;
      });
      if (bad > 0 && ok === 0) lyr.classList.add('on-top'); else if (ok > 0) lyr.classList.remove('on-top');
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; try { sync(); } catch (e) { console.warn('EmbedOverlay:', e); } });
    }
    function clear() {
      items.forEach(function (e) { try { e.el.remove(); } catch (er) {} });
      items.clear();
    }
    function elementFor(oid) { const e = items.get(oid); return e ? e.el : null; }
    canvas.on('after:render', schedule);
    return { sync: sync, schedule: schedule, clear: clear, elementFor: elementFor };
  })();
  window.EmbedOverlay = EmbedOverlay;

  // ---------------------------------------------------------------------
  // 5. VideoBackground (muharrir) — orqa fon videosi
  // ---------------------------------------------------------------------
  const VideoBackground = (function () {
    let active = false, curKey = '', killTimer = null;
    function cancelKill() { if (killTimer) { clearTimeout(killTimer); killTimer = null; } }
    function layer() {
      let l = document.getElementById('videoBgOverlay');
      if (!l) {
        const card = document.getElementById('canvasCard');
        if (!card) return null;
        l = document.createElement('div');
        l.id = 'videoBgOverlay';
        l.className = 'gif-bg-overlay video-bg-overlay';
        card.insertBefore(l, card.firstChild);
      }
      return l;
    }
    function bgSpec(bv) {
      const p = parseVideoUrl(bv.url) || { kind: 'file', url: bv.url };
      return Object.assign(specFromParsed(p, { autoplay: true, loop: bv.loop, muted: true }), { embedMuted: true, embedAutoplay: true, embedBg: true });
    }
    function show(bv, parsed) {
      const lyr = layer();
      if (!lyr) return;
      const key = bv.url + '|' + bv.loop;
      cancelKill();
      // v31: bir xil video qayta qo'llanganda (slayd almashganda, AI tahririda) iframe QAYTA yaratilmaydi — qotish/yo'qolish shundan edi
      if (key !== curKey || !lyr.firstChild) {
        curKey = key;
        lyr.innerHTML = '';
        const node = buildPlayer(bgSpec(bv), false, 'cover');
        lyr.appendChild(node);
        ssBgIframeStyle(node);
      }
      lyr.style.visibility = 'visible';
      lyr.style.display = 'block';
      lyr.style.overflow = 'hidden';
      try {
        if (window.ssVideoPoster && lyr.dataset.poster !== bv.url) {
          lyr.dataset.poster = bv.url;
          window.ssVideoPoster(bv.url).then(function (u) { if (u && lyr.dataset.poster === bv.url) { lyr.style.background = 'center / cover no-repeat url("' + u + '")'; } });
        }
      } catch (e) {}
      active = true;
      try {
        const card = document.getElementById('canvasCard');
        if (card) card.classList.add('has-gif-bg');
        canvas.backgroundColor = 'rgba(0,0,0,0)';
        canvas.setBackgroundImage(null, function () { canvas.requestRenderAll(); });
      } catch (e) {}
    }
    function hide(parsed) {
      const lyr = document.getElementById('videoBgOverlay');
      if (lyr && lyr.firstChild) {
        // darhol ko'rinmas qilamiz, lekin 2.5 s davomida o'chirmaymiz — shu video qayta kelsa to'xtamay davom etadi
        lyr.style.visibility = 'hidden';
        cancelKill();
        killTimer = setTimeout(function () {
          killTimer = null;
          if (lyr.style.visibility === 'hidden') { lyr.innerHTML = ''; lyr.style.display = 'none'; curKey = ''; }
        }, 2500);
      } else if (lyr) { lyr.style.display = 'none'; curKey = ''; }
      if (!active) return;
      active = false;
      try {
        const gifOn = typeof GifBackground !== 'undefined' && GifBackground.hasGif && GifBackground.hasGif();
        if (!gifOn) {
          const card = document.getElementById('canvasCard');
          if (card) card.classList.remove('has-gif-bg');
          let col = '#ffffff';
          if (parsed && typeof parsed.background === 'string' && parsed.background && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(parsed.background)) col = parsed.background;
          canvas.backgroundColor = col;
          canvas.requestRenderAll();
        }
      } catch (e) {}
    }
    function apply(json) {
      let parsed = {};
      try { parsed = JSON.parse(json || '{}'); } catch (e) { parsed = {}; }
      const bv = parsed.backgroundVideo;
      if (bv && bv.url && !(parsed.backgroundGif && (parsed.backgroundGif.src || parsed.backgroundGif.url))) show(bv, parsed);
      else hide(parsed);
    }
    function clear() { hide(null); }
    return { apply: apply, clear: clear, isActive: function () { return active; } };
  })();
  window.VideoBackground = VideoBackground;

  // GifBackground ga ulaymiz — barcha mavjud chaqiruv joylari avtomatik ishlaydi
  (function hookGifBackground() {
    if (typeof GifBackground === 'undefined' || GifBackground.__ssHooked) return;
    const oApply = GifBackground.applyFromSlide, oClear = GifBackground.clear;
    GifBackground.applyFromSlide = function (json) {
      oApply.apply(GifBackground, arguments);
      try { VideoBackground.apply(json); } catch (e) {}
    };
    GifBackground.clear = function () {
      oClear.apply(GifBackground, arguments);
      try { VideoBackground.clear(); } catch (e) {}
    };
    GifBackground.__ssHooked = true;
  })();

  // ---------------------------------------------------------------------
  // 6. VideoKit — qo'shish / dialog / AI
  // ---------------------------------------------------------------------
  function nextImgNumber() {
    try { return assignNextImageNumber(); } catch (e) { globalImageCounter++; return globalImageCounter; }
  }
  function probeVideoSize(url) {
    return new Promise(function (resolve) {
      try {
        const v = document.createElement('video');
        v.preload = 'metadata'; v.muted = true;
        const done = function (r) { clearTimeout(t); v.removeAttribute('src'); try { v.load(); } catch (e) {} resolve(r); };
        const t = setTimeout(function () { done(null); }, 4500);
        v.onloadedmetadata = function () { done(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null); };
        v.onerror = function () { done(null); };
        v.src = url;
      } catch (e) { resolve(null); }
    });
  }
  function readFileAsDataURL(file) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('read')); };
      r.readAsDataURL(file);
    });
  }
  const MAX_INLINE_VIDEO = 60 * 1024 * 1024;  // v39: 60MB gacha lokal video slayd ichiga to'liq (base64) joylanadi
  async function fileToVideoUrl(file) {
    if (!file) return null;
    if (!/^video\//i.test(file.type || '') && !/\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(file.name || '')) {
      toast('Faqat video fayl tanlang (mp4, webm...)', 'error');
      return null;
    }
    if (file.size <= MAX_INLINE_VIDEO) {
      try { return await readFileAsDataURL(file); } catch (e) { /* blob ga tushamiz */ }
    }
    toast('Video 60MB dan katta: faqat shu sessiyada ishlaydi. Faylga to\'liq saqlash uchun kichikroq video yoki havola (YouTube) ishlating', 'error');
    return URL.createObjectURL(file);
  }

  window.fileToVideoUrlPublic = fileToVideoUrl;

  function buildEmbedOptions(spec, extra) {
    extra = extra || {};
    const info = typeof spec.url === 'string' ? parseVideoUrl(spec.url) : null;
    if (!info) return null;
    const base = specFromParsed(info, spec);
    const opts = Object.assign({
      left: spec.left != null ? +spec.left : 80, top: spec.top != null ? +spec.top : 100,
      width: +spec.width || 480, height: +spec.height || 270,
      embedThumb: spec.thumb || spec.thumbnail || '',
      embedMutedUser: spec.userMuted === true
    }, base, extra);
    opts.embedMuted = opts.embedMutedUser === true;
    if (!isFinite(opts.left)) opts.left = 80;
    if (!isFinite(opts.top)) opts.top = 100;
    return opts;
  }

  /** Aktiv slaydga video element qo'shadi */
  async function addVideoToActiveSlide(spec) {
    const info = parseVideoUrl(spec.url);
    if (!info) { toast('Video havolasi tanilmadi (YouTube, Vimeo yoki .mp4 link kiriting)', 'error'); return null; }
    let w = +spec.width || 0, h = +spec.height || 0;
    if (!w || !h) {
      w = 480; h = 270;
      if (info.kind === 'file') {
        const sz = await probeVideoSize(info.url);
        if (sz) { h = Math.round(w * sz.h / sz.w); if (h > 360) { h = 360; w = Math.round(h * sz.w / sz.h); } }
      }
    }
    const opts = buildEmbedOptions(Object.assign({}, spec, { width: w, height: h }),
      { left: spec.left != null ? +spec.left : Math.round((SW - w) / 2), top: spec.top != null ? +spec.top : Math.round((SH - h) / 2) });
    const num = nextImgNumber();
    const oid = nextObjectId();
    const obj = new EmbedVideo(Object.assign(opts, { imageNumber: num, imageHash: 'video_' + num, _oid: oid, id: 'embed_' + num + '_' + Date.now() }));
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    if (!slides[activeIndex].imageNumbers) slides[activeIndex].imageNumbers = [];
    if (slides[activeIndex].imageNumbers.indexOf(num) < 0) slides[activeIndex].imageNumbers.push(num);
    saveCurrentSlideState();
    try { recordGlobalState(); } catch (e) {}
    try { updateAllImageBadges(); } catch (e) {}
    try { refreshSlideThumb(activeIndex); } catch (e) {}
    EmbedOverlay.schedule();
    toast('#' + num + '-Video qo\'yildi');
    return obj;
  }

  /** Istalgan slaydning JSON iga video element qo'shadi (AI uchun) */
  async function addVideoToSlideJson(slideIdx, spec) {
    if (slideIdx < 0 || slideIdx >= slides.length) return null;
    if (slideIdx === activeIndex) return addVideoToActiveSlide(spec);
    const opts = buildEmbedOptions(spec);
    if (!opts) return null;
    const num = nextImgNumber();
    const oid = nextObjectId();
    const obj = new EmbedVideo(Object.assign(opts, { imageNumber: num, imageHash: 'video_' + num, _oid: oid }));
    const parsed = JSON.parse(slides[slideIdx].json || '{}');
    parsed.objects = parsed.objects || [];
    parsed.objects.push(obj.toObject(SERIALIZE_PROPS));
    slides[slideIdx].json = JSON.stringify(parsed);
    slides[slideIdx].imageNumbers = slides[slideIdx].imageNumbers || [];
    slides[slideIdx].imageNumbers.push(num);
    try { await refreshSlideThumb(slideIdx); } catch (e) {}
    return obj;
  }

  /** Orqa fon video */
  async function setVideoBackground(slideIdx, spec) {
    if (slideIdx == null) slideIdx = activeIndex;
    if (slideIdx < 0 || slideIdx >= slides.length) return false;
    const info = parseVideoUrl(spec.url);
    if (!info) { toast('Video havolasi tanilmadi', 'error'); return false; }
    if (slideIdx === activeIndex) saveCurrentSlideState({ force: true });
    const parsed = JSON.parse(slides[slideIdx].json || '{}');
    const prevColor = (typeof parsed.background === 'string' && parsed.background && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(parsed.background)) ? parsed.background : '#ffffff';
    parsed.backgroundVideo = { url: info.url, kind: info.kind, id: info.id || '', hash: info.hash || '', loop: isTrue(spec.loop, true), muted: true, thumb: spec.thumb || '' };
    delete parsed.backgroundGif;
    delete parsed.backgroundImage;
    parsed.background = prevColor;
    parsed.backgroundColor = prevColor;
    slides[slideIdx].json = JSON.stringify(parsed);
    slides[slideIdx].bgType = 'video';
    slides[slideIdx].bgVal = null;
    if (slideIdx === activeIndex) {
      try { GifBackground.applyFromSlide(slides[slideIdx].json); } catch (e) {}
      try { saveCurrentSlideState({ force: true }); } catch (e) {}
      try { recordGlobalState(); } catch (e) {}
    }
    try { await refreshSlideThumb(slideIdx); } catch (e) {}
    toast('Video orqa fon qo\'yildi');
    return true;
  }

  // ---- Dialog: video qo'shish / tahrirlash ----
  async function openVideoDialog(existing) {
    const isEdit = !!existing;
    const html =
      '<div class="ss-dlg">' +
      '<label class="ss-lbl">Video havolasi <small>(YouTube, Vimeo, Dailymotion, .mp4/.webm)</small></label>' +
      '<input id="ssVidUrl" class="swal2-input ss-inp" placeholder="https://www.youtube.com/watch?v=..." value="' + esc(existing ? existing.embedUrl : '') + '">' +
      '<div id="ssVidPrev" class="ss-vid-prev"><div class="ss-vid-prev-empty">Ko\'rib chiqish (preview)</div></div>' +
      (isEdit ? '' :
        '<div class="ss-or">yoki</div>' +
        '<label class="ss-filebtn"><span class="material-symbols-outlined">upload</span> Kompyuterdan video tanlash' +
        '<input type="file" id="ssVidFile" accept="video/*" style="display:none"></label>' +
        '<div id="ssVidFileName" class="ss-fname"></div>') +
      '<div class="ss-checks">' +
      '<label><input type="checkbox" id="ssVidAuto" ' + (!existing || isTrue(existing.embedAutoplay, true) ? 'checked' : '') + '> Avto ijro</label>' +
      '<label><input type="checkbox" id="ssVidLoop" ' + (!existing || isTrue(existing.embedLoop, true) ? 'checked' : '') + '> Takrorlash</label>' +
      '<label><input type="checkbox" id="ssVidMute" ' + (existing && existing.embedMutedUser === true ? 'checked' : '') + '> Ovozsiz</label>' +
      '</div>' +
      (isEdit ? '' :
        '<label class="ss-lbl">Qayerga qo\'yilsin?</label>' +
        '<select id="ssVidWhere" class="swal2-select ss-sel"><option value="element">Slayd ichiga (element)</option><option value="background">Orqa fon sifatida</option></select>') +
      '</div>';
    const res = await Swal.fire({
      title: isEdit ? '🎬 Video sozlamalari' : '🎬 Video qo\'shish',
      html: html, showCancelButton: true, focusConfirm: false, heightAuto: false,
      confirmButtonText: isEdit ? 'Saqlash' : 'Qo\'shish', cancelButtonText: 'Bekor', confirmButtonColor: '#0b57d0',
      didOpen: function () {
        const f = document.getElementById('ssVidFile');
        const urlEl = document.getElementById('ssVidUrl');
        const prev = document.getElementById('ssVidPrev');
        let objUrl = '', timer = null, lastKey = '';
        function clearObj() { if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) {} objUrl = ''; } }
        function showPreview() {
          if (!prev) return;
          let raw = (urlEl && urlEl.value || '').trim();
          const file = f && f.files && f.files[0];
          if (!raw && file) { clearObj(); try { objUrl = URL.createObjectURL(file); } catch (e) {} raw = objUrl; }
          const info = raw ? parseVideoUrl(raw) : null;
          const key = raw + '|' + (document.getElementById('ssVidLoop') || {}).checked + '|' + (document.getElementById('ssVidMute') || {}).checked;
          if (key === lastKey) return;
          lastKey = key;
          prev.innerHTML = '';
          if (!raw) { prev.innerHTML = '<div class="ss-vid-prev-empty">Ko\'rib chiqish (preview)</div>'; return; }
          if (!info) { prev.innerHTML = '<div class="ss-vid-prev-empty err">Bu havola video emas</div>'; return; }
          const mutedUser = !!(document.getElementById('ssVidMute') || {}).checked;
          const spec = specFromParsed(info, { autoplay: true, loop: (document.getElementById('ssVidLoop') || {}).checked !== false, muted: mutedUser });
          spec.embedMuted = true;                       // oldindan ko'rishda avto-ijro uchun ovozsiz; boshqaruvdan yoqiladi
          const node = buildPlayer(spec, true, 'contain');
          node.controls = true;
          if (node.tagName === 'VIDEO') node.muted = true;
          prev.appendChild(node);
        }
        function later() { clearTimeout(timer); timer = setTimeout(showPreview, 450); }
        if (urlEl) { urlEl.addEventListener('input', later); urlEl.addEventListener('change', showPreview); }
        ['ssVidLoop', 'ssVidMute', 'ssVidAuto'].forEach(function (id) { const c = document.getElementById(id); if (c) c.addEventListener('change', function () { lastKey = ''; later(); }); });
        if (f) f.addEventListener('change', function () {
          const n = document.getElementById('ssVidFileName');
          if (n) n.textContent = f.files && f.files[0] ? ('📁 ' + f.files[0].name) : '';
          if (urlEl && f.files && f.files[0]) urlEl.value = '';
          lastKey = ''; showPreview();
        });
        showPreview();
        window.__ssVidPrevCleanup = function () { clearTimeout(timer); clearObj(); if (prev) prev.innerHTML = ''; };
      },
      willClose: function () { try { if (window.__ssVidPrevCleanup) window.__ssVidPrevCleanup(); } catch (e) {} },
      preConfirm: async function () {
        const url = (document.getElementById('ssVidUrl').value || '').trim();
        const fileEl = document.getElementById('ssVidFile');
        const file = fileEl && fileEl.files && fileEl.files[0];
        let finalUrl = url;
        if (!finalUrl && file) {
          finalUrl = await fileToVideoUrl(file);
          if (!finalUrl) { Swal.showValidationMessage('Faylni o\'qib bo\'lmadi'); return false; }
        }
        if (!finalUrl) { Swal.showValidationMessage('Havola kiriting yoki fayl tanlang'); return false; }
        if (!parseVideoUrl(finalUrl)) { Swal.showValidationMessage('Bu havola video emas. YouTube, Vimeo yoki .mp4 manzil kiriting'); return false; }
        const whereEl = document.getElementById('ssVidWhere');
        return {
          url: finalUrl,
          autoplay: document.getElementById('ssVidAuto').checked,
          loop: document.getElementById('ssVidLoop').checked,
          muted: document.getElementById('ssVidMute').checked,
          userMuted: document.getElementById('ssVidMute').checked,
          where: whereEl ? whereEl.value : 'element'
        };
      }
    });
    if (!res.isConfirmed || !res.value) return null;
    const v = res.value;
    if (isEdit) {
      const info = parseVideoUrl(v.url);
      existing.set({
        embedUrl: info.url, embedKind: info.kind, embedId: info.id || '', embedHash: info.hash || '', embedStart: info.start || 0,
        embedAutoplay: v.autoplay, embedLoop: v.loop, embedMuted: v.muted, embedMutedUser: v.muted
      });
      existing._thumbTried = false; existing._thumbImg = null;
      existing.dirty = true;
      canvas.requestRenderAll();
      EmbedOverlay.schedule();
      saveCurrentSlideState(); try { recordGlobalState(); } catch (e) {}
      return existing;
    }
    if (v.where === 'background') { await setVideoBackground(activeIndex, v); return true; }
    return addVideoToActiveSlide(v);
  }

  /** Media galereya / URL maydoni uchun: havola video bo'lsa joylaydi */
  async function placeVideoFromUrl(url, opts) {
    opts = opts || {};
    if (opts.background) return setVideoBackground(activeIndex, Object.assign({ url: url }, opts));
    return addVideoToActiveSlide(Object.assign({ url: url }, opts));
  }

  window.VideoKit = {
    parse: parseVideoUrl, isVideoUrl: function (u) { return !!parseVideoUrl(u); },
    openDialog: function () { return openVideoDialog(null); },
    addToActive: addVideoToActiveSlide, addToSlide: addVideoToSlideJson,
    setBackground: setVideoBackground, placeFromUrl: placeVideoFromUrl, embedSrc: embedSrc
  };
  window.openVideoDialog = function () { return openVideoDialog(null); };

  // ---------------------------------------------------------------------
  // 7. Tugma — dialog va qo'shish
  // ---------------------------------------------------------------------
  function buttonFormHtml(b) {
    b = b || {};
    const opt = Object.keys(BTN_ACTIONS).map(function (k) {
      return '<option value="' + k + '"' + ((b.btnAction || 'next') === k ? ' selected' : '') + '>' + esc(BTN_ACTIONS[k]) + '</option>';
    }).join('');
    return '<div class="ss-dlg">' +
      '<label class="ss-lbl">Tugma yozuvi</label>' +
      '<input id="ssBtnLabel" class="swal2-input ss-inp" value="' + esc(b.btnLabel || 'Keyingi ➜') + '" maxlength="40">' +
      '<label class="ss-lbl">Bosilganda nima bo\'lsin?</label>' +
      '<select id="ssBtnAction" class="swal2-select ss-sel">' + opt + '</select>' +
      '<input id="ssBtnTarget" class="swal2-input ss-inp" placeholder="" value="' + esc(b.btnTarget || '') + '">' +
      '<div class="ss-row">' +
      '<label>Tugma rangi <input type="color" id="ssBtnFill" value="' + esc(typeof b.fill === 'string' && /^#[0-9a-f]{6}$/i.test(b.fill) ? b.fill : '#4F46E5') + '"></label>' +
      '<label>Yozuv rangi <input type="color" id="ssBtnText" value="' + esc(/^#[0-9a-f]{6}$/i.test(b.btnTextColor || '') ? b.btnTextColor : '#ffffff') + '"></label>' +
      '<label>Burchak <input type="range" id="ssBtnRx" min="0" max="40" value="' + (b.rx != null ? b.rx : 14) + '"></label>' +
      '</div></div>';
  }
  async function openButtonDialog(existing) {
    const res = await Swal.fire({
      title: existing ? '🔘 Tugma sozlamalari' : '🔘 Tugma qo\'shish',
      html: buttonFormHtml(existing), showCancelButton: true, focusConfirm: false, heightAuto: false,
      confirmButtonText: existing ? 'Saqlash' : 'Qo\'shish', cancelButtonText: 'Bekor', confirmButtonColor: '#0b57d0',
      didOpen: function () {
        const sel = document.getElementById('ssBtnAction'), tgt = document.getElementById('ssBtnTarget');
        const upd = function () {
          const a = sel.value;
          tgt.style.display = (a === 'goto' || a === 'url' || a === 'popup') ? '' : 'none';
          tgt.placeholder = a === 'goto' ? 'Slayd raqami (masalan: 3)' : (a === 'url' ? 'https://example.com' : 'Oynachada ko\'rsatiladigan matn');
        };
        sel.addEventListener('change', upd); upd();
      },
      preConfirm: function () {
        const a = document.getElementById('ssBtnAction').value;
        let t = (document.getElementById('ssBtnTarget').value || '').trim();
        if (a === 'goto') {
          const n = parseInt(t, 10);
          if (!n || n < 1) { Swal.showValidationMessage('Slayd raqamini kiriting (1, 2, 3...)'); return false; }
          t = String(n);
        }
        if (a === 'url') {
          if (t && !/^https?:\/\//i.test(t)) t = 'https://' + t;
          if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(t)) { Swal.showValidationMessage('To\'g\'ri havola kiriting'); return false; }
        }
        return {
          btnLabel: (document.getElementById('ssBtnLabel').value || 'Tugma').trim() || 'Tugma',
          btnAction: a, btnTarget: t,
          fill: document.getElementById('ssBtnFill').value,
          btnTextColor: document.getElementById('ssBtnText').value,
          rx: +document.getElementById('ssBtnRx').value, ry: +document.getElementById('ssBtnRx').value
        };
      }
    });
    if (!res.isConfirmed || !res.value) return null;
    const v = res.value;
    if (existing) {
      existing.set(v); existing.dirty = true;
      canvas.requestRenderAll();
      saveCurrentSlideState(); try { recordGlobalState(); } catch (e) {}
      return existing;
    }
    return addButtonToActiveSlide(v);
  }
  function addButtonToActiveSlide(props) {
    const w = +props.width || 220, h = +props.height || 56;
    const obj = new SlideButton(Object.assign({
      left: Math.round((SW - w) / 2), top: SH - h - 50, width: w, height: h, _oid: nextObjectId(), id: 'btn_' + Date.now()
    }, props));
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    saveCurrentSlideState(); try { recordGlobalState(); } catch (e) {}
    try { refreshSlideThumb(activeIndex); } catch (e) {}
    toast('Tugma qo\'yildi (Namoyishda ishlaydi)');
    return obj;
  }
  /** Havola (link) tugmasi: bitta bosish bilan URL ga o'tadigan tayyor tugma */
  function linkDefaults(label, extra) {
    const fs = 26;
    const w = Math.max(120, Math.min(800, Math.round(label.length * fs * 0.58) + 24));
    return Object.assign({ btnLabel: label, btnAction: 'url', fill: 'rgba(0,0,0,0)', btnTextColor: '#38bdf8', btnUnderline: true,
      btnBold: false, btnFontSize: fs, rx: 0, ry: 0, width: w, height: 44 }, extra || {});
  }
  window.__linkDefaults = linkDefaults;
  async function openLinkDialog() {
    const res = await Swal.fire({
      title: '🔗 Havola qo\'shish', heightAuto: false, showCancelButton: true, focusConfirm: false,
      confirmButtonText: 'Qo\'shish', cancelButtonText: 'Bekor', confirmButtonColor: '#0b57d0',
      html: '<div class="ss-dlg"><label class="ss-lbl">Havola (URL)</label>' +
        '<input id="ssLnkUrl" class="swal2-input ss-inp" placeholder="https://example.com">' +
        '<label class="ss-lbl">Matn <small>(bo\'sh qoldirsangiz — havolaning o\'zi)</small></label>' +
        '<input id="ssLnkLabel" class="swal2-input ss-inp" placeholder="Batafsil o\'qish">' +
        '<div class="ss-row"><label>Rang <input type="color" id="ssLnkText" value="#38bdf8"></label></div>' +
        '<div class="ss-or">Tugma shaklidagi havola kerak bo\'lsa — "Tugma" dan foydalaning</div></div>',
      preConfirm: function () {
        let u = (document.getElementById('ssLnkUrl').value || '').trim();
        if (u && !/^(https?:|mailto:|tel:)/i.test(u)) u = 'https://' + u;
        if (!/^(https?:\/\/[^\s]+\.[^\s]+|mailto:[^\s]+|tel:[^\s]+)/i.test(u)) { Swal.showValidationMessage('To\'g\'ri havola kiriting'); return false; }
        let label = (document.getElementById('ssLnkLabel').value || '').trim();
        if (!label) label = u.replace(/^https?:\/\//i, '').replace(/\/$/, '');
        return { u: u, label: label, tc: document.getElementById('ssLnkText').value };
      }
    });
    if (!res.isConfirmed || !res.value) return null;
    const v = res.value;
    return addButtonToActiveSlide(linkDefaults(v.label, { btnTarget: v.u, btnTextColor: v.tc }));
  }
  window.openLinkDialog = openLinkDialog;
  window.addLinkDialog = function () { try { document.querySelectorAll('.dropdown-menu').forEach(function (m) { m.style.display = 'none'; }); } catch (e) {} return openLinkDialog(); };
  window.openButtonDialog = function () { return openButtonDialog(null); };
  window.ButtonKit = { openDialog: function () { return openButtonDialog(null); }, add: addButtonToActiveSlide, actions: BTN_ACTIONS };

  // ikki marta bosish -> sozlamalar
  canvas.on('mouse:dblclick', function (opt) {
    const t = opt && opt.target;
    if (!t) return;
    if (isEmbedObj(t)) openVideoDialog(t);
    else if (isButtonObj(t)) openButtonDialog(t);
  });

  // ---------------------------------------------------------------------
  // 8. ANIMATSIYA
  // ---------------------------------------------------------------------
  const EFFECT_GROUPS = [
    { id: 'in', title: 'Kirish', list: [
      ['fadeIn', 'Paydo bo\'lish'], ['fadeInUp', 'Pastdan chiqish'], ['fadeInDown', 'Tepadan tushish'],
      ['fadeInLeft', 'Chapdan kirish'], ['fadeInRight', 'O\'ngdan kirish'], ['zoomIn', 'Kattalashib kirish'],
      ['bounceIn', 'Sakrab kirish'], ['slideInUp', 'Pastdan sirpanish'], ['slideInLeft', 'Chapdan sirpanish'],
      ['slideInRight', 'O\'ngdan sirpanish'], ['flipInX', 'Aylanib chiqish'], ['rotateIn', 'Burilib kirish']] },
    { id: 'attn', title: 'Diqqat tortish', list: [
      ['pulse', 'Pulsatsiya'], ['bounce', 'Sakrash'], ['shakeX', 'Silkitish'], ['tada', 'Ta-da!'],
      ['heartBeat', 'Yurak urishi'], ['swing', 'Tebranish'], ['wobble', 'Chayqalish'], ['flash', 'Yonib-o\'chish'],
      ['rubberBand', 'Rezina'], ['jello', 'Jele']] },
    { id: 'out', title: 'Chiqish', list: [
      ['fadeOut', 'So\'nib ketish'], ['zoomOut', 'Kichrayib ketish'], ['slideOutDown', 'Pastga sirpanish'], ['bounceOut', 'Sakrab chiqish']] },
    { id: 'loop', title: 'Doimiy harakat', list: [
      ['float', 'Suzib turish'], ['spin', 'Aylanib turish'], ['pulseLoop', 'Nafas olish']] }
  ];
  const EFFECTS = {};
  EFFECT_GROUPS.forEach(function (g) { g.list.forEach(function (e) { EFFECTS[e[0]] = { label: e[1], group: g.id }; }); });
  window.ANIMATION_NAMES = Object.keys(EFFECTS);

  (function injectKeyframes() {
    if (document.getElementById('ssAnimStyle')) return;
    const css = [
      '@keyframes ssa-fadeIn{from{opacity:0}to{opacity:1}}',
      '@keyframes ssa-fadeInUp{from{opacity:0;transform:translate3d(0,60%,0)}to{opacity:1;transform:none}}',
      '@keyframes ssa-fadeInDown{from{opacity:0;transform:translate3d(0,-60%,0)}to{opacity:1;transform:none}}',
      '@keyframes ssa-fadeInLeft{from{opacity:0;transform:translate3d(-60%,0,0)}to{opacity:1;transform:none}}',
      '@keyframes ssa-fadeInRight{from{opacity:0;transform:translate3d(60%,0,0)}to{opacity:1;transform:none}}',
      '@keyframes ssa-zoomIn{from{opacity:0;transform:scale3d(.3,.3,.3)}50%{opacity:1}to{opacity:1;transform:none}}',
      '@keyframes ssa-bounceIn{0%{opacity:0;transform:scale3d(.3,.3,.3)}20%{transform:scale3d(1.1,1.1,1.1)}40%{transform:scale3d(.9,.9,.9)}60%{opacity:1;transform:scale3d(1.03,1.03,1.03)}80%{transform:scale3d(.97,.97,.97)}100%{opacity:1;transform:scale3d(1,1,1)}}',
      '@keyframes ssa-slideInUp{from{transform:translate3d(0,120%,0)}to{transform:none}}',
      '@keyframes ssa-slideInLeft{from{transform:translate3d(-120%,0,0)}to{transform:none}}',
      '@keyframes ssa-slideInRight{from{transform:translate3d(120%,0,0)}to{transform:none}}',
      '@keyframes ssa-flipInX{from{opacity:0;transform:perspective(400px) rotateX(90deg)}40%{transform:perspective(400px) rotateX(-20deg)}60%{opacity:1;transform:perspective(400px) rotateX(10deg)}80%{transform:perspective(400px) rotateX(-5deg)}to{transform:perspective(400px)}}',
      '@keyframes ssa-rotateIn{from{opacity:0;transform:rotate(-200deg)}to{opacity:1;transform:none}}',
      '@keyframes ssa-pulse{from,to{transform:scale3d(1,1,1)}50%{transform:scale3d(1.08,1.08,1.08)}}',
      '@keyframes ssa-bounce{0%,20%,53%,100%{transform:translate3d(0,0,0)}40%,43%{transform:translate3d(0,-30px,0)}70%{transform:translate3d(0,-15px,0)}90%{transform:translate3d(0,-4px,0)}}',
      '@keyframes ssa-shakeX{from,to{transform:none}10%,30%,50%,70%,90%{transform:translate3d(-10px,0,0)}20%,40%,60%,80%{transform:translate3d(10px,0,0)}}',
      '@keyframes ssa-tada{from{transform:scale3d(1,1,1)}10%,20%{transform:scale3d(.9,.9,.9) rotate3d(0,0,1,-3deg)}30%,50%,70%,90%{transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,3deg)}40%,60%,80%{transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,-3deg)}to{transform:scale3d(1,1,1)}}',
      '@keyframes ssa-heartBeat{0%{transform:scale(1)}14%{transform:scale(1.3)}28%{transform:scale(1)}42%{transform:scale(1.3)}70%{transform:scale(1)}}',
      '@keyframes ssa-swing{20%{transform:rotate3d(0,0,1,15deg)}40%{transform:rotate3d(0,0,1,-10deg)}60%{transform:rotate3d(0,0,1,5deg)}80%{transform:rotate3d(0,0,1,-5deg)}to{transform:rotate3d(0,0,1,0deg)}}',
      '@keyframes ssa-wobble{from{transform:none}15%{transform:translate3d(-25%,0,0) rotate3d(0,0,1,-5deg)}30%{transform:translate3d(20%,0,0) rotate3d(0,0,1,3deg)}45%{transform:translate3d(-15%,0,0) rotate3d(0,0,1,-3deg)}60%{transform:translate3d(10%,0,0) rotate3d(0,0,1,2deg)}75%{transform:translate3d(-5%,0,0) rotate3d(0,0,1,-1deg)}to{transform:none}}',
      '@keyframes ssa-flash{from,50%,to{opacity:1}25%,75%{opacity:0}}',
      '@keyframes ssa-rubberBand{from{transform:scale3d(1,1,1)}30%{transform:scale3d(1.25,.75,1)}40%{transform:scale3d(.75,1.25,1)}50%{transform:scale3d(1.15,.85,1)}65%{transform:scale3d(.95,1.05,1)}75%{transform:scale3d(1.05,.95,1)}to{transform:scale3d(1,1,1)}}',
      '@keyframes ssa-jello{from,11.1%,to{transform:translate3d(0,0,0)}22.2%{transform:skewX(-12.5deg) skewY(-12.5deg)}33.3%{transform:skewX(6.25deg) skewY(6.25deg)}44.4%{transform:skewX(-3.125deg) skewY(-3.125deg)}55.5%{transform:skewX(1.5625deg) skewY(1.5625deg)}66.6%{transform:skewX(-.78125deg) skewY(-.78125deg)}77.7%{transform:skewX(.390625deg) skewY(.390625deg)}88.8%{transform:skewX(-.1953125deg) skewY(-.1953125deg)}}',
      '@keyframes ssa-fadeOut{from{opacity:1}to{opacity:0}}',
      '@keyframes ssa-zoomOut{from{opacity:1}50%{opacity:0;transform:scale3d(.3,.3,.3)}to{opacity:0}}',
      '@keyframes ssa-slideOutDown{from{transform:none}to{transform:translate3d(0,120%,0)}}',
      '@keyframes ssa-bounceOut{20%{transform:scale3d(.9,.9,.9)}50%,55%{opacity:1;transform:scale3d(1.1,1.1,1.1)}to{opacity:0;transform:scale3d(.3,.3,.3)}}',
      '@keyframes ssa-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}',
      '@keyframes ssa-spin{to{transform:rotate(360deg)}}',
      '@keyframes ssa-pulseLoop{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}',
      '@media (prefers-reduced-motion: reduce){.ssa-anim{animation:none!important}}'
    ].join('\n');
    const st = document.createElement('style');
    st.id = 'ssAnimStyle';
    st.textContent = css;
    document.head.appendChild(st);
  })();

  function specOfObj(o) {
    if (!o || !o.animName || !EFFECTS[o.animName]) return null;
    const grp = EFFECTS[o.animName].group;
    return {
      name: o.animName,
      dur: (typeof o.animDur === 'number' && o.animDur > 0) ? o.animDur : (grp === 'loop' ? 2 : 0.8),
      delay: (typeof o.animDelay === 'number' && o.animDelay >= 0) ? o.animDelay : 0,
      loop: o.animLoop === true || o.animLoop === 'true' || grp === 'loop'
    };
  }
  /** DOM elementga CSS animatsiya qo'yadi */
  function applyAnimStyle(dom, spec, preview) {
    if (!dom || !spec) return;
    dom.classList.add('ssa-anim');
    const s = dom.style;
    s.animation = 'none';
    void dom.offsetWidth;
    s.animationName = 'ssa-' + spec.name;
    s.animationDuration = spec.dur + 's';
    s.animationDelay = spec.delay + 's';
    s.animationFillMode = 'both';
    s.animationTimingFunction = (spec.name === 'float' || spec.name === 'spin' || spec.name === 'pulseLoop') ? 'ease-in-out' : 'cubic-bezier(.25,.8,.25,1)';
    if (spec.name === 'spin') s.animationTimingFunction = 'linear';
    s.animationIterationCount = spec.loop ? (preview ? '2' : 'infinite') : '1';
  }
  window.applyAnimStyle = applyAnimStyle;

  /** Obyektni alohida shaffof PNG (sprite) ga aylantiradi — taqdimotda alohida animatsiya qilish uchun */
  function renderSprite(objJson) {
    return new Promise(function (resolve) {
      try {
        const el = document.createElement('canvas');
        el.width = SW; el.height = SH;
        const sc = new fabric.StaticCanvas(el, { backgroundColor: null, renderOnAddRemove: false });
        sc.__holes = false;
        const copy = Object.assign({}, objJson);
        delete copy.animName; delete copy.animDur; delete copy.animDelay; delete copy.animLoop;
        let finished = false;
        const fin = function (r) { if (finished) return; finished = true; try { sc.dispose(); } catch (e) {} resolve(r); };
        setTimeout(function () { fin(null); }, 7000);
        sc.loadFromJSON({ objects: [copy] }, function () {
          try {
            const o = sc.getObjects()[0];
            if (!o) { fin(null); return; }
            sc.renderAll();
            const r = o.getBoundingRect(true, true);
            const pad = 28;
            const x = Math.max(0, Math.floor(r.left - pad)), y = Math.max(0, Math.floor(r.top - pad));
            const w = Math.max(2, Math.min(SW - x, Math.ceil(r.width + pad * 2)));
            const h = Math.max(2, Math.min(SH - y, Math.ceil(r.height + pad * 2)));
            window.__ssStaticRender++;
            let url = '';
            try { url = sc.toDataURL({ format: 'png', left: x, top: y, width: w, height: h, multiplier: 2 }); }
            finally { window.__ssStaticRender--; }
            fin(url ? { url: url, x: x, y: y, w: w, h: h } : null);
          } catch (e) { console.warn('renderSprite:', e); fin(null); }
        });
      } catch (e) { resolve(null); }
    });
  }
  window.renderObjectSprite = renderSprite;

  // ---- Muharrirda ko'rib chiqish (preview) ----
  const AnimKit = (function () {
    let previewLayer = null;
    let busy = new Set();
    let running = [];   // v33: hozir o'ynayotgan ko'rib chiqish ishlari — bekor qilish uchun
    /** v33: ko'rib chiqishni darhol to'xtatadi: element qaytadan ko'rinadi va tanlanadi (qayta-qayta bosish shart emas) */
    function cancelPreview() {
      if (!running.length) return;
      const list = running; running = [];
      list.forEach(function (j) { try { j.restore(); } catch (e) {} });
      try { canvas.requestRenderAll(); } catch (e) {}
    }
    // v35: ko'rib chiqish paytida element visible=false EMAS (shunda u tanlanmay, tutqichlari yo'qolardi), deyarli shaffof qilinadi
    function hideForPreview(o) { if (o.__ssOp == null) o.__ssOp = o.opacity; o.opacity = 0.01; }
    function showAfterPreview(o) { if (o.__ssOp != null) { o.opacity = o.__ssOp; delete o.__ssOp; } }
    function layer() {
      if (previewLayer && previewLayer.isConnected) return previewLayer;
      const card = document.getElementById('canvasCard');
      if (!card) return null;
      previewLayer = document.getElementById('animPreviewLayer');
      if (!previewLayer) {
        previewLayer = document.createElement('div');
        previewLayer.id = 'animPreviewLayer';
        previewLayer.className = 'anim-preview-layer';
        card.appendChild(previewLayer);
      }
      return previewLayer;
    }
    function waitEnd(dom, spec, preview) {
      return new Promise(function (resolve) {
        const total = (spec.delay + spec.dur * (spec.loop ? (preview ? 2 : 1) : 1)) * 1000 + 400;
        const t = setTimeout(resolve, total);
        dom.addEventListener('animationend', function () { clearTimeout(t); resolve(); }, { once: true });
      });
    }
    /** GIF / video overlay elementi bo'lsa — uning ichki elementini animatsiya qilamiz */
    function overlayInner(obj) {
      if (obj.isGif || obj.type === 'gifImage') {
        const it = document.querySelector('#gifOverlay .gif-overlay-item[data-oid="' + obj._oid + '"] img');
        return it || null;
      }
      return null;
    }
    /** v29: GIF / video uchun jonli kanvasdan sprite (loadFromJSON asinxron yuklanib bo'sh chiqardi) */
    function liveSprite(o) {
      try {
        const r = o.getBoundingRect(true, true);
        const c = o.toCanvasElement({ multiplier: 2, withoutShadow: true });
        if (!c || !c.width) return null;
        c.className = 'anim-preview-sprite';
        c.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
        return c;
      } catch (e) { return null; }
    }
    async function previewObjects(objs) {
      const lyr = layer();
      if (!lyr || !objs || !objs.length) return;
      cancelPreview();   // v33: avvalgi ko'rib chiqish bekor — qayta bosilganda animatsiya boshidan BIR marta takrorlanadi
      try {
        const as = canvas.getActiveObject();
        if (as && as.type === 'activeSelection') canvas.discardActiveObject();
      } catch (e) {}
      const jobs = [];
      for (const o of objs) {
        const spec = specOfObj(o);
        if (!spec) continue;
        if (o.__animBusy) continue;
        if (o.isGif || o.type === 'gifImage' || isEmbedObj(o)) {
          const lc = liveSprite(o);
          if (lc) {
            lyr.appendChild(lc);
            hideForPreview(o); o.__animBusy = true;
            jobs.push({ obj: o, spec: spec, dom: lc, restore: function () { try { lc.remove(); } catch (e) {} showAfterPreview(o); o.__animBusy = false; } });
            continue;
          }
        }
        const inner = overlayInner(o);
        if (inner) { jobs.push({ obj: o, spec: spec, dom: inner, restore: function () { inner.style.animation = ''; inner.classList.remove('ssa-anim'); } }); continue; }
        if (isEmbedObj(o)) {
          const w = EmbedOverlay.elementFor(o._oid);
          const player = w && w.firstChild;
          if (player) jobs.push({ obj: o, spec: spec, dom: player, restore: function () { player.style.animation = ''; player.classList.remove('ssa-anim'); } });
          continue;
        }
        let js;
        try { js = o.toObject(SERIALIZE_PROPS); } catch (e) { continue; }
        const sp = await renderSprite(js);
        if (!sp) continue;
        const img = document.createElement('img');
        img.src = sp.url; img.alt = '';
        img.className = 'anim-preview-sprite';
        img.style.cssText = 'left:' + sp.x + 'px;top:' + sp.y + 'px;width:' + sp.w + 'px;height:' + sp.h + 'px;';
        lyr.appendChild(img);
        hideForPreview(o); o.__animBusy = true;
        jobs.push({ obj: o, spec: spec, dom: img, restore: function () { try { img.remove(); } catch (e) {} showAfterPreview(o); o.__animBusy = false; } });
      }
      if (!jobs.length) return;
      jobs.forEach(function (j) {
        const r0 = j.restore; j.done = false;
        j.restore = function () {
          if (j.done) return; j.done = true;
          try { j.dom.style.animation = ''; j.dom.classList.remove('ssa-anim'); } catch (e) {}
          r0();
        };
      });
      running = running.concat(jobs);
      canvas.requestRenderAll();
      jobs.forEach(function (j) { applyAnimStyle(j.dom, j.spec, true); });
      await Promise.all(jobs.map(function (j) { return waitEnd(j.dom, j.spec, true); }));
      jobs.forEach(function (j) { j.restore(); });
      running = running.filter(function (j) { return jobs.indexOf(j) < 0; });
      canvas.requestRenderAll();
    }
    function targets() {
      let a = [];
      try { a = canvas.getActiveObjects(); } catch (e) {}
      return a;
    }
    function applyToSelection(patch) {
      const objs = targets();
      if (!objs.length) { toast('Avval slayddagi elementni tanlang', 'error'); return []; }
      objs.forEach(function (o) {
        o.set(patch);
        if (patch.animName === '') { o.animDur = undefined; o.animDelay = undefined; o.animLoop = undefined; }
      });
      saveCurrentSlideState();
      try { recordGlobalState(); } catch (e) {}
      return objs;
    }
    async function choose(name) {
      const group = EFFECTS[name] && EFFECTS[name].group;
      const objs = applyToSelection({ animName: name || '' });
      if (!objs.length) return;
      if (name) {
        objs.forEach(function (o) {
          if (group === 'loop') o.animLoop = true;
          else if (group !== 'attn') o.animLoop = false;
          if (typeof o.animDur !== 'number') o.animDur = group === 'loop' ? 2 : 0.8;
          if (typeof o.animDelay !== 'number') o.animDelay = 0;
        });
        saveCurrentSlideState();
        renderPanel();
        await previewObjects(objs);
      } else renderPanel();
    }
    function setParam(key, val) {
      const objs = targets().filter(function (o) { return o.animName; });
      if (!objs.length) return;
      objs.forEach(function (o) { o.set(key, val); });
      saveCurrentSlideState();
    }
    async function previewSelected() { await previewObjects(targets()); }
    async function previewSlide() {
      const all = canvas.getObjects().filter(function (o) { return o.animName; });
      if (!all.length) { toast('Bu slaydda animatsiyali element yo\'q', 'error'); return; }
      await previewObjects(all);
    }
    function stagger() {
      const all = canvas.getObjects().filter(function (o) { return o.animName; });
      if (!all.length) { toast('Avval elementlarga animatsiya bering', 'error'); return; }
      all.forEach(function (o, i) { o.animDelay = Math.round(i * 0.4 * 10) / 10; });
      saveCurrentSlideState(); try { recordGlobalState(); } catch (e) {}
      renderPanel();
      toast('Animatsiyalar ketma-ket qilindi');
      previewSlide();
    }
    function clearSlide() {
      canvas.getObjects().forEach(function (o) { if (o.animName) { o.animName = ''; o.animDur = undefined; o.animDelay = undefined; o.animLoop = undefined; } });
      saveCurrentSlideState(); try { recordGlobalState(); } catch (e) {}
      renderPanel();
      toast('Slayddagi barcha animatsiyalar olib tashlandi');
    }

    // ---- Panel ----
    let panel = null, open = false, activeGroup = 'in';
    function ensurePanel() {
      if (panel && panel.isConnected) return panel;
      panel = document.getElementById('animPanel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'animPanel';
        panel.className = 'anim-panel';
        panel.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        panel.addEventListener('click', function (e) { e.stopPropagation(); });
        document.body.appendChild(panel);
      }
      return panel;
    }
    function kindName(o) {
      if (!o) return '';
      if (isEmbedObj(o)) return 'Video';
      if (isButtonObj(o)) return 'Tugma';
      if (o.isGif || o.type === 'gifImage') return 'GIF';
      if (o.type === 'image') return 'Rasm';
      if (/text/.test(o.type || '')) return 'Matn';
      return 'Shakl';
    }
    function renderPanel() {
      if (!open) return;
      const p = ensurePanel();
      const sel = targets();
      const first = sel[0];
      const cur = first && first.animName && EFFECTS[first.animName] ? first : null;
      const spec = cur ? specOfObj(cur) : null;
      let h = '<div class="ap-head"><span class="material-symbols-outlined">animation</span><b>Animatsiya</b>' +
        '<button class="ap-x" onclick="AnimKit.closePanel()" title="Yopish"><span class="material-symbols-outlined">close</span></button></div>';
      if (!first) {
        h += '<div class="ap-hint">Slayddagi matn, rasm, GIF, video yoki tugmani tanlang — keyin effektni bosing. Bitta bosish yetarli.</div>';
      } else {
        h += '<div class="ap-sel">Tanlangan: <b>' + esc(sel.length > 1 ? (sel.length + ' ta element') : kindName(first)) + '</b>' +
          (cur ? ' · <span class="ap-cur">' + esc(EFFECTS[cur.animName].label) + '</span>' : '') +
          ((sel.length === 1 && (isEmbedObj(first) || isButtonObj(first))) ? ' <button class="ap-mini" onclick="AnimKit.editSelected()">Sozlamalar</button>' : '') + '</div>';
      }
      h += '<div class="ap-tabs">' + EFFECT_GROUPS.map(function (g) {
        return '<button class="ap-tab' + (g.id === activeGroup ? ' on' : '') + '" onclick="AnimKit.setGroup(\'' + g.id + '\')">' + g.title + '</button>';
      }).join('') + '</div>';
      const grp = EFFECT_GROUPS.filter(function (g) { return g.id === activeGroup; })[0];
      h += '<div class="ap-grid">' +
        '<button class="ap-fx none' + (!cur ? ' on' : '') + '" onclick="AnimKit.choose(\'\')"><span class="material-symbols-outlined">block</span>Yo\'q</button>' +
        grp.list.map(function (e) {
          return '<button class="ap-fx' + (cur && cur.animName === e[0] ? ' on' : '') + '" onclick="AnimKit.choose(\'' + e[0] + '\')">' + esc(e[1]) + '</button>';
        }).join('') + '</div>';
      if (cur && spec) {
        h += '<div class="ap-params">' +
          '<label>Davomiyligi <b id="apDurV">' + spec.dur.toFixed(1) + 's</b><input type="range" min="0.2" max="4" step="0.1" value="' + spec.dur + '" oninput="AnimKit.param(\'animDur\',+this.value,\'apDurV\')" onchange="AnimKit.preview()"></label>' +
          '<label>Kechikish <b id="apDelV">' + spec.delay.toFixed(1) + 's</b><input type="range" min="0" max="6" step="0.1" value="' + spec.delay + '" oninput="AnimKit.param(\'animDelay\',+this.value,\'apDelV\')" onchange="AnimKit.preview()"></label>' +
          '<label class="ap-chk"><input type="checkbox" ' + (spec.loop ? 'checked' : '') + ' onchange="AnimKit.param(\'animLoop\',this.checked);AnimKit.preview()"> Takrorlash (cheksiz)</label>' +
          '</div>';
      }
      h += '<div class="ap-actions">' +
        '<button class="ap-btn" onclick="AnimKit.preview()"><span class="material-symbols-outlined">play_arrow</span> Ko\'rish</button>' +
        '<button class="ap-btn" onclick="AnimKit.previewSlide()"><span class="material-symbols-outlined">slideshow</span> Butun slayd</button>' +
        '<button class="ap-btn" onclick="AnimKit.stagger()" title="Hamma animatsiyali elementlar ketma-ket chiqadi"><span class="material-symbols-outlined">format_list_numbered</span> Ketma-ket</button>' +
        '<button class="ap-btn ghost" onclick="AnimKit.clearSlide()"><span class="material-symbols-outlined">delete_sweep</span> Hammasini olib tashlash</button>' +
        '</div>';
      h += '<div class="ap-foot">Animatsiyalar <b>Namoyish</b> rejimida o\'ynaydi.</div>';
      p.innerHTML = h;
    }
    let autoOpened = false;
    function openPanel(auto) {
      open = true; autoOpened = auto === true;
      ensurePanel().classList.add('open'); document.body.classList.add('anim-open'); renderPanel();
    }
    function closePanel() { open = false; autoOpened = false; if (panel) panel.classList.remove('open'); document.body.classList.remove('anim-open'); }
    /** v31: bitta bosish = faqat tanlash. Panel o'zi ochilmaydi/yopilmaydi, element yashirilmaydi (tanlash xatosi shundan edi).
     *  Animatsiyani ko'rish faqat paneldagi "Ko'rish" tugmasi / animatsiya tanlanganda ishga tushadi. */
    function syncPanelToSelection() {
      if (!open) return;
      // v35: o'zi ochilgan panel — animatsiyasiz element tanlansa yopiladi
      if (autoOpened) {
        let any = false;
        try { any = canvas.getActiveObjects().some(function (o) { return o && o.animName; }); } catch (e) {}
        if (!any) { closePanel(); return; }
      }
      renderPanel();
    }
    function togglePanel(e) {
      if (e && e.stopPropagation) e.stopPropagation();
      try { document.querySelectorAll('.dropdown-menu').forEach(function (m) { m.style.display = 'none'; }); } catch (er) {}
      if (open) closePanel(); else openPanel();
    }
    canvas.on('selection:created', syncPanelToSelection);
    canvas.on('selection:updated', syncPanelToSelection);
    // v33: kanvasga bosilgan zahoti (fabric target qidirishidan OLDIN) ko'rib chiqish to'xtaydi — yashirin element darhol tanlanadi
    try {
      const up = canvas.upperCanvasEl;
      if (up) {
        up.addEventListener('mousedown', cancelPreview, true);
        up.addEventListener('touchstart', cancelPreview, { capture: true, passive: true });
        up.addEventListener('pointerdown', cancelPreview, true);
      }
    } catch (e) {}
    canvas.on('selection:cleared', function () { if (open && autoOpened) closePanel(); else if (open) renderPanel(); });
    // v35: animatsiyali elementni BOSGANDA: animatsiya 1 marta o'ynaydi, o'ngdagi panel ochiladi (tanlangan effekt ko'k).
    // Boshqa joyga bosilsa (tanlov bekor) panel yopiladi.
    canvas.on('mouse:up', function (opt) {
      try {
        const t = opt && opt.target, ev = opt && opt.e;
        if (!t || !opt.isClick || t.type === 'activeSelection' || !t.animName) return;
        if (ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || ev.button === 2)) return;
        // v36: element allaqachon tanlangan bo'lsa (yoki matn tahrirlanayotgan bo'lsa) animatsiya QAYTA o'ynamaydi —
        // aks holda 2-bosishda matn yo'qolib-paydo bo'lib, tahrirlashga xalaqit berardi.
        if (t.isEditing || canvas.__ssPrevActive === t) return;
        if (!open) openPanel(true); else renderPanel();
        previewObjects([t]);
      } catch (e) { console.warn('anim click:', e); }
    });
    return {
      choose: choose, cancel: cancelPreview, preview: previewSelected, previewSlide: previewSlide, stagger: stagger, clearSlide: clearSlide,
      openPanel: function () { return openPanel(false); }, closePanel: closePanel, togglePanel: togglePanel, renderPanel: renderPanel,
      setGroup: function (g) { activeGroup = g; renderPanel(); },
      param: function (k, v, labelId) {
        setParam(k, v);
        if (labelId) { const l = document.getElementById(labelId); if (l) l.textContent = (+v).toFixed(1) + 's'; }
      },
      editSelected: function () {
        const t = canvas.getActiveObject();
        if (isEmbedObj(t)) openVideoDialog(t); else if (isButtonObj(t)) openButtonDialog(t);
      },
      isOpen: function () { return open; }
    };
  })();
  window.AnimKit = AnimKit;
  window.toggleAnimPanel = AnimKit.togglePanel;

  // ---------------------------------------------------------------------
  // 9. AI element / action adapterlari
  // ---------------------------------------------------------------------
  function applyAnimFromEl(obj, el) {
    if (!obj || !el) return obj;
    const name = el.animation || el.anim || el.animName;
    if (name && EFFECTS[name]) {
      obj.animName = name;
      const d = parseFloat(el.animDuration != null ? el.animDuration : (el.animDur != null ? el.animDur : el.duration));
      const dl = parseFloat(el.animDelay != null ? el.animDelay : el.delay);
      if (isFinite(d) && d > 0) obj.animDur = Math.min(6, d);
      if (isFinite(dl) && dl >= 0) obj.animDelay = Math.min(10, dl);
      if (el.animLoop === true || el.loop_animation === true) obj.animLoop = true;
    }
    return obj;
  }

  // parseElementToFabric ni kengaytiramiz (video / tugma / animatsiya)
  if (typeof parseElementToFabric === 'function' && !parseElementToFabric.__ssWrapped) {
    const origParse = parseElementToFabric;
    const wrapped = async function (el) {
      if (!el || !el.type) return origParse(el);
      let obj = null;
      if (el.type === 'video' || el.type === 'embedVideo' || el.type === 'embed') {
        let url = el.embedUrl || el.url || el.src || el.videoUrl;
        let thumbFix = '';
        try {
          const pv0 = parseVideoUrl(url || '');
          if (pv0 && pv0.kind === 'youtube') {
            let okYt = true;
            try { const r0 = await fetch('/api/video-check?id=' + encodeURIComponent(pv0.id)); okYt = !!(await r0.json()).ok; } catch (e0) { okYt = true; }
            if (!okYt) {
              url = '';
              const q0 = (el.query || el.title || el.alt || el.topic || '').toString().trim();
              if (q0) {
                const r1 = await fetch('/api/media-search?provider=video&limit=6&q=' + encodeURIComponent(q0));
                const hit = ((await r1.json()).results || []).filter(function (x) { return x && parseVideoUrl(x.url); })[0];
                if (hit) { url = hit.url; thumbFix = hit.thumbnail || ''; }
              }
              if (!url) { try { toast('YouTube video topilmadi (ID noto\'g\'ri) — o\'tkazib yuborildi', 'error'); } catch (e2) {} return null; }
            }
          }
        } catch (e) {}
        if (thumbFix && !el.embedThumb) el = Object.assign({}, el, { embedThumb: thumbFix });
        const opts = buildEmbedOptions(Object.assign({}, el, {
          url: url, autoplay: el.embedAutoplay != null ? el.embedAutoplay : el.autoplay,
          loop: el.embedLoop != null ? el.embedLoop : el.loop, muted: el.embedMuted != null ? el.embedMuted : el.muted
        }));
        if (!opts) return null;
        if (el.embedThumb) opts.embedThumb = el.embedThumb;
        ['rx', 'ry', 'angle', 'opacity', '_oid', 'imageNumber', 'imageHash', 'scaleX', 'scaleY'].forEach(function (k) { if (el[k] != null) opts[k] = el[k]; });
        obj = new EmbedVideo(opts);
        ensureObjectId(obj);
      } else if (el.type === 'button' || el.type === 'slideButton') {
        const rawAct = el.btnAction || el.click || el.on_click || el.onClick || el.action;
        const act = BTN_ACTIONS[rawAct] ? rawAct : 'next';
        const opts = {
          left: el.left != null ? +el.left : 380, top: el.top != null ? +el.top : 440,
          width: +el.width || 220, height: +el.height || 56,
          fill: el.fill || '#4F46E5', rx: el.rx != null ? +el.rx : 14, ry: el.ry != null ? +el.ry : (el.rx != null ? +el.rx : 14),
          btnLabel: String(el.btnLabel || el.text || el.label || 'Tugma').slice(0, 40),
          btnAction: act, btnTarget: String(el.btnTarget != null ? el.btnTarget : (el.target != null ? el.target : (el.url || el.link || ''))),
          btnTextColor: el.btnTextColor || el.textColor || '#ffffff',
          btnFontSize: +el.btnFontSize || +el.fontSize || 22,
          btnFontFamily: el.btnFontFamily || el.fontFamily || 'Montserrat',
          btnBold: el.btnBold !== false && el.fontWeight !== 'normal',
          btnUnderline: el.btnUnderline === true,
          opacity: typeof el.opacity === 'number' ? el.opacity : 1,
          angle: el.angle || 0
        };
        if (el.stroke) { opts.stroke = el.stroke; opts.strokeWidth = el.strokeWidth || 2; }
        if (el._oid != null) opts._oid = el._oid;
        obj = new SlideButton(opts);
        if (el.shadow) { try { obj.set('shadow', new fabric.Shadow({ color: 'rgba(0,0,0,0.25)', blur: 12, offsetX: 0, offsetY: 4 })); } catch (e) {} }
        ensureObjectId(obj);
      }
      if (!obj) {
        obj = await origParse(el);
      }
      if (obj) {
        applyAnimFromEl(obj, el);
        try {
          if (typeof MediaFx !== 'undefined' && MediaFx.isMedia(obj)) {
            const rad = el.radius != null ? el.radius : (el.cornerRadius != null ? el.cornerRadius : el.mRadius);
            const okRound = !window.ssRoundingAllowed || window.ssRoundingAllowed() || (el.mRadius != null && el.radius == null && el.cornerRadius == null);
            if (el.circle === true && okRound) MediaFx.setRadius(obj, 50);
            else if (rad != null && okRound) MediaFx.setRadius(obj, rad);
            const cr = el.crop;
            if (cr && typeof cr === 'object') MediaFx.setCrop(obj, [(+cr.left || 0) / 100, (+cr.top || 0) / 100, (+cr.right || 0) / 100, (+cr.bottom || 0) / 100]);
          }
        } catch (e) { console.warn('MediaFx parse:', e); }
      }
      return obj;
    };
    wrapped.__ssWrapped = true;
    parseElementToFabric = wrapped;
  }

  /** AI action: add_video / set_background_video / add_button / set_animation */
  async function aiVideoAction(cmd) {
    const dest = ((cmd.target_slide || cmd.slide) || (activeIndex + 1)) - 1;
    if (dest < 0 || dest >= slides.length) return false;
    let url = (cmd.url || cmd.src || cmd.link || '').toString().trim();
    let pv = parseVideoUrl(url);
    // YouTube ID ni AI o'ylab topgan bo'lishi mumkin — mavjudligini tekshiramiz, bo'lmasa qidirib topamiz
    if (pv && pv.kind === 'youtube') {
      let okYt = true;
      try { const r = await fetch('/api/video-check?id=' + encodeURIComponent(pv.id)); const j = await r.json(); okYt = !!j.ok; } catch (e) { okYt = true; }
      if (!okYt) pv = null;
    }
    if (!pv) {
      const q = (cmd.query || cmd.q || cmd.topic || cmd.title || cmd.search || '').toString().trim();
      if (q) {
        try {
          const r = await fetch('/api/media-search?provider=video&limit=6&q=' + encodeURIComponent(q));
          const j = await r.json();
          const hit = (j.results || []).filter(function (x) { return x && parseVideoUrl(x.url); })[0];
          if (hit) { url = hit.url; pv = parseVideoUrl(url); cmd = Object.assign({}, cmd, { url: url, thumb: cmd.thumb || hit.thumbnail }); }
        } catch (e) {}
      }
    }
    if (!pv) { toast('Video topilmadi yoki havola noto\'g\'ri — o\'tkazib yuborildi', 'error'); return false; }
    if (!cmd.url || cmd.url !== url) cmd = Object.assign({}, cmd, { url: url });
    if (cmd.as_background === true || cmd.background === true || cmd.action === 'set_background_video') {
      return setVideoBackground(dest, cmd);
    }
    const o = await addVideoToSlideJson(dest, cmd);
    if (o && (cmd.animation || cmd.anim)) {
      // JSON ga animatsiyani qo'shamiz
      try {
        const parsed = JSON.parse(slides[dest].json || '{}');
        const last = (parsed.objects || [])[parsed.objects.length - 1];
        if (last) { const tmp = {}; applyAnimFromEl(tmp, cmd); Object.assign(last, tmp); slides[dest].json = JSON.stringify(parsed); }
      } catch (e) {}
    }
    return !!o;
  }
  async function aiButtonAction(cmd) {
    const dest = ((cmd.target_slide || cmd.slide) || (activeIndex + 1)) - 1;
    if (dest < 0 || dest >= slides.length) return false;
    const el = Object.assign({ type: 'button' }, cmd);
    if (!el.text && !el.btnLabel && !el.label) el.btnLabel = cmd.title || cmd.name || '';
    delete el.action;                   // 'action' bu yerda AI action nomi, tugma harakati emas
    el.btnAction = cmd.btn_action || cmd.btnAction || cmd.on_click || cmd.onClick || cmd.click || cmd.target_action || ((cmd.url || cmd.link || cmd.href) ? 'url' : 'next');
    el.btnTarget = cmd.btn_target != null ? cmd.btn_target : (cmd.btnTarget != null ? cmd.btnTarget : (cmd.target != null ? cmd.target : (cmd.url || cmd.link || cmd.href)));
    const obj = await parseElementToFabric(el);
    if (!obj) return false;
    if (dest === activeIndex) {
      canvas.add(obj); canvas.requestRenderAll();
      saveCurrentSlideState(); try { await refreshSlideThumb(dest); } catch (e) {}
      return true;
    }
    const parsed = JSON.parse(slides[dest].json || '{}');
    parsed.objects = parsed.objects || [];
    parsed.objects.push(obj.toObject(SERIALIZE_PROPS));
    slides[dest].json = JSON.stringify(parsed);
    try { await refreshSlideThumb(dest); } catch (e) {}
    return true;
  }
  /** set_animation: {slide, id | image_number | target:'all', animation, duration, delay, loop, stagger} */
  async function aiAnimationAction(cmd) {
    const dest = ((cmd.target_slide || cmd.slide) || (activeIndex + 1)) - 1;
    if (dest < 0 || dest >= slides.length) return false;
    const name = cmd.animation || cmd.name || cmd.effect || cmd.animName || '';
    if (name && !EFFECTS[name]) { toast('Noma\'lum animatsiya: ' + name, 'error'); return false; }
    if (dest === activeIndex) saveCurrentSlideState({ force: true });
    const parsed = JSON.parse(slides[dest].json || '{}');
    const objs = parsed.objects || [];
    let targets = [];
    if (cmd.id != null) targets = objs.filter(function (o) { return o._oid === cmd.id || o._oid === +cmd.id; });
    else if (cmd.image_number != null) targets = objs.filter(function (o) { return String(o.imageNumber) === String(cmd.image_number); });
    else if (cmd.target === 'all' || cmd.all === true || (cmd.id == null && cmd.image_number == null)) targets = objs.filter(function (o) { return o.type !== 'rect' || cmd.include_shapes; });
    if (!targets.length) return false;
    const stagger = parseFloat(cmd.stagger);
    targets.forEach(function (o, i) {
      if (!name) { delete o.animName; delete o.animDur; delete o.animDelay; delete o.animLoop; return; }
      o.animName = name;
      const d = parseFloat(cmd.duration != null ? cmd.duration : cmd.animDuration);
      if (isFinite(d) && d > 0) o.animDur = Math.min(6, d);
      const dl = parseFloat(cmd.delay != null ? cmd.delay : cmd.animDelay);
      if (isFinite(stagger) && stagger > 0) o.animDelay = Math.round(i * stagger * 10) / 10;
      else if (isFinite(dl) && dl >= 0) o.animDelay = Math.min(10, dl);
      if (cmd.loop === true) o.animLoop = true;
    });
    slides[dest].json = JSON.stringify(parsed);
    if (dest === activeIndex) {
      try { await loadSlideCanvasAsync(dest); } catch (e) {}
    }
    try { await refreshSlideThumb(dest); } catch (e) {}
    return true;
  }
  window.aiVideoAction = aiVideoAction;
  async function aiLinkAction(cmd) {
    const url = (cmd.url || cmd.link || cmd.href || cmd.target || '').toString().trim();
    if (!url) return false;
    const label = (cmd.text || cmd.btnLabel || cmd.label || cmd.title || url.replace(/^https?:\/\//i, '').replace(/\/$/, '')).toString();
    const d = linkDefaults(label);
    const c = Object.assign({}, cmd, { url: url, btn_action: 'url', btn_target: url, btnLabel: label });
    delete c.text;
    ['fill', 'btnTextColor', 'btnUnderline', 'btnBold', 'btnFontSize', 'rx', 'ry', 'width', 'height'].forEach(function (k) { if (c[k] == null) c[k] = d[k]; });
    if (cmd.color && cmd.btnTextColor == null) c.btnTextColor = cmd.color;
    return aiButtonAction(c);
  }
  window.aiLinkAction = aiLinkAction;
  window.aiButtonAction = aiButtonAction;
  window.aiAnimationAction = aiAnimationAction;

  // ---------------------------------------------------------------------
  // 10. TAQDIMOT — video, tugma, animatsiya
  // ---------------------------------------------------------------------
  const PresExtras = (function () {
    let embedLayer = null, topLayer = null, bgLayer = null;
    function ensure() {
      const st = document.getElementById('presStage');
      if (!st) return false;
      if (!bgLayer || !bgLayer.isConnected) {
        bgLayer = document.getElementById('presVideoBg');
        if (!bgLayer) { bgLayer = document.createElement('div'); bgLayer.id = 'presVideoBg'; bgLayer.className = 'pres-x-layer pres-x-bg'; st.appendChild(bgLayer); }
      }
      if (!embedLayer || !embedLayer.isConnected) {
        embedLayer = document.getElementById('presEmbedLayer');
        if (!embedLayer) { embedLayer = document.createElement('div'); embedLayer.id = 'presEmbedLayer'; embedLayer.className = 'pres-x-layer pres-x-embed'; st.appendChild(embedLayer); }
      }
      if (!topLayer || !topLayer.isConnected) {
        topLayer = document.getElementById('presTopLayer');
        if (!topLayer) { topLayer = document.createElement('div'); topLayer.id = 'presTopLayer'; topLayer.className = 'pres-x-layer pres-x-top'; st.appendChild(topLayer); }
      }
      return true;
    }
    function clear() {
      ['presVideoBg', 'presEmbedLayer', 'presTopLayer'].forEach(function (id) {
        const l = document.getElementById(id);
        if (l) l.innerHTML = '';
      });
      const pop = document.getElementById('presPopup');
      if (pop) pop.remove();
    }
    function box(o) {
      const w = (o.width || 0) * (o.scaleX != null ? o.scaleX : 1);
      const h = (o.height || 0) * (o.scaleY != null ? o.scaleY : 1);
      let l = o.left || 0, t = o.top || 0;
      if (o.originX === 'center') l -= w / 2; else if (o.originX === 'right') l -= w;
      if (o.originY === 'center') t -= h / 2; else if (o.originY === 'bottom') t -= h;
      return { l: l, t: t, w: w, h: h };
    }
    function place(div, o) {
      const b = box(o);
      const s = div.style;
      s.position = 'absolute';
      s.left = (b.l / SW * 100) + '%'; s.top = (b.t / SH * 100) + '%';
      s.width = (b.w / SW * 100) + '%'; s.height = (b.h / SH * 100) + '%';
      s.transformOrigin = 'center center';
      const flip = (o.flipX ? ' scaleX(-1)' : '') + (o.flipY ? ' scaleY(-1)' : '');
      if (o.angle || flip) s.transform = 'rotate(' + (o.angle || 0) + 'deg)' + flip;
      if (o.opacity != null && o.opacity !== 1) s.opacity = o.opacity;
      return b;
    }
    function radius(div, o) {
      const b = box(o);
      const r = Math.max(0, (o.rx || 0) * (o.scaleX != null ? o.scaleX : 1));
      if (r > 0 && b.w > 0 && b.h > 0) div.style.borderRadius = (r / b.w * 100) + '% / ' + (r / b.h * 100) + '%';
    }
    function goto(i) {
      if (i < 0 || i >= slides.length) return;
      _presTransitionDir = i >= presentationIndex ? 'next' : 'prev';
      presentationIndex = i;
      renderPresentationSlide();
    }
    function showPopup(text) {
      const st = document.getElementById('presStage');
      if (!st) return;
      let pop = document.getElementById('presPopup');
      if (pop) pop.remove();
      pop = document.createElement('div');
      pop.id = 'presPopup';
      pop.className = 'pres-popup';
      pop.innerHTML = '<div class="pres-popup-card"><button class="pres-popup-x" aria-label="Yopish">&times;</button><div class="pres-popup-text"></div></div>';
      pop.querySelector('.pres-popup-text').textContent = text || '';
      const stop = function (e) { e.stopPropagation(); };
      pop.addEventListener('click', function (e) { e.stopPropagation(); if (e.target === pop || e.target.classList.contains('pres-popup-x')) pop.remove(); });
      pop.addEventListener('mousedown', stop); pop.addEventListener('touchstart', stop, { passive: true });
      st.appendChild(pop);
    }
    function runAction(o) {
      const a = o.btnAction || 'next', t = o.btnTarget;
      if (a === 'next') { if (presentationIndex < slides.length - 1) goto(presentationIndex + 1); }
      else if (a === 'prev') { if (presentationIndex > 0) goto(presentationIndex - 1); }
      else if (a === 'first') goto(0);
      else if (a === 'last') goto(slides.length - 1);
      else if (a === 'goto') goto((parseInt(t, 10) || 1) - 1);
      else if (a === 'url') { if (/^https?:\/\//i.test(t || '')) window.open(t, '_blank', 'noopener'); }
      else if (a === 'popup') showPopup(t);
    }
    function addEmbed(o) {
      const spec = {
        embedKind: o.embedKind, embedId: o.embedId, embedUrl: o.embedUrl, embedHash: o.embedHash,
        embedAutoplay: o.embedAutoplay, embedLoop: o.embedLoop, embedMuted: o.embedMutedUser === true, embedStart: o.embedStart
      };
      if (!spec.embedUrl) return null;
      const wrap = document.createElement('div');
      wrap.className = 'pres-embed-item';
      place(wrap, o);
      radius(wrap, o);
      const player = buildPlayer(spec, true, 'contain');
      wrap.appendChild(player);
      try { window.applyMediaInnerCrop(player, o); } catch (er) {}
      ['click', 'mousedown', 'touchstart', 'pointerdown'].forEach(function (ev) { wrap.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
      embedLayer.appendChild(wrap);
      const sp = specOfObj(o);
      if (sp) applyAnimStyle(player, sp);
      return wrap;
    }
    function addBgVideo(bv) {
      const p = parseVideoUrl(bv.url) || { kind: 'file', url: bv.url };
      const spec = Object.assign(specFromParsed(p, { autoplay: true, loop: bv.loop, muted: true }), { embedMuted: true, embedBg: true });
      const node = buildPlayer(spec, false, 'cover');
      bgLayer.appendChild(node);
      ssBgIframeStyle(node);
      try {   // v33: video ochilguncha plakat (qora/bo'sh fon va sarlavha ko'rinmaydi)
        if (window.ssVideoPoster) window.ssVideoPoster(bv.url).then(function (u) { if (u && node.isConnected) bgLayer.style.background = 'center / cover no-repeat url("' + u + '")'; });
      } catch (e) {}
    }
    async function render(slide, gen) {
      if (!ensure()) return;
      clear();
      let parsed = {};
      try { parsed = JSON.parse((slide && slide.json) || '{}'); } catch (e) { return; }
      const objs = parsed.objects || [];
      if (parsed.backgroundVideo && parsed.backgroundVideo.url && !parsed.backgroundGif) addBgVideo(parsed.backgroundVideo);
      const LAY = window.presLayout(objs);
      // 1..n bo'laklar (oddiy obyektlar, maxsus obyektlar orasida)
      try {
        const segs = (window.__presSegCache && window.__presSegCache.slide === slide) ? window.__presSegCache.urls : [];
        segs.forEach(function (u, idx) {
          if (!u) return;
          const im = document.createElement('img');
          im.className = 'pres-seg'; im.alt = ''; im.src = u;
          im.style.zIndex = String(10 + 2 * (idx + 1));
          embedLayer.appendChild(im);
        });
      } catch (e) {}
      objs.forEach(function (o, i) {
        if (o && (o.type === 'embedVideo' || o.isEmbed)) { const w = addEmbed(o); if (w && LAY.lay[i]) w.style.zIndex = String(LAY.lay[i].z); }
      });

      // GIF animatsiyalari (mavjud overlay ichidagi <img> larga)
      try {
        const gifObjs = objs.filter(function (o) { return o && (o.isGif || o.type === 'gifImage'); });
        const items = document.querySelectorAll('#presentationGifOverlay .gif-overlay-item');
        gifObjs.forEach(function (g, i) {
          const sp = specOfObj(g);
          const im = items[i] && items[i].querySelector('img');
          if (sp && im) applyAnimStyle(im, sp);
          const li = objs.indexOf(g);
          if (items[i] && li >= 0 && LAY.lay[li]) items[i].style.zIndex = String(LAY.lay[li].z);
        });
      } catch (e) {}

      // tugma hotspotlari
      objs.forEach(function (o) {
        if (!o || !(o.type === 'slideButton' || o.isButton) || (o.btnAction || 'next') === 'none') return;
        const hs = document.createElement('div');
        hs.className = 'pres-hotspot';
        hs.title = o.btnLabel || '';
        const b = place(hs, o);
        radius(hs, o);
        const go = function (e) { e.stopPropagation(); e.preventDefault(); runAction(o); };
        hs.addEventListener('click', go);
        hs.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        hs.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
        hs.setAttribute('role', 'button');
        topLayer.appendChild(hs);
      });

      // matn havolalari (haqiqiy link) hotspotlari
      objs.forEach(function (o) {
        if (!o || !o.linkUrl || !(o.type === 'textbox' || o.type === 'i-text' || o.type === 'text')) return;
        if (!/^(https?:|mailto:|tel:)/i.test(o.linkUrl)) return;
        const hs = document.createElement('div');
        hs.className = 'pres-hotspot';
        hs.title = o.linkUrl;
        place(hs, o);
        const go = function (e) { e.stopPropagation(); e.preventDefault(); try { window.open(o.linkUrl, '_blank', 'noopener'); } catch (er) {} };
        hs.addEventListener('click', go);
        hs.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        hs.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
        hs.setAttribute('role', 'link');
        topLayer.appendChild(hs);
      });

      // animatsiyali oddiy obyektlar -> sprite
      const animObjs = objs.filter(function (o) {
        return o && specOfObj(o) && !(o.isGif || o.type === 'gifImage') && !(o.type === 'embedVideo' || o.isEmbed);
      });
      if (!animObjs.length) return;
      const sprites = await Promise.all(animObjs.map(function (o) { return renderSprite(o); }));
      if (gen != null && gen !== _presGifGen) return;
      sprites.forEach(function (sp, i) {
        if (!sp) return;
        const o = animObjs[i];
        const img = document.createElement('img');
        img.src = sp.url; img.alt = ''; img.className = 'pres-sprite';
        img.style.cssText = 'position:absolute;left:' + (sp.x / SW * 100) + '%;top:' + (sp.y / SH * 100) + '%;width:' + (sp.w / SW * 100) + '%;height:' + (sp.h / SH * 100) + '%;pointer-events:none;';
        const li = objs.indexOf(o);
        img.style.zIndex = String(li >= 0 && LAY.lay[li] ? LAY.lay[li].z : 11);
        embedLayer.appendChild(img);
        applyAnimStyle(img, specOfObj(o));
      });
    }
    return { render: render, clear: clear, runAction: runAction };
  })();
  window.PresExtras = PresExtras;

  // ---- Taqdimot: z-tartib (qatlamlar) ----
  // "Maxsus" obyektlar (GIF, video, animatsiyali) alohida DOM elementlar; ular orasidagi
  // oddiy obyektlar alohida shaffof PNG bo'laklariga bo'linadi — shunda tartib aynan editordagidek.
  window.presIsSpecial = function (o) {
    return !!o && (o.isGif || o.type === 'gifImage' || o.type === 'embedVideo' || o.isEmbed === true || !!specOfObj(o));
  };
  window.presLayout = function (objs) {
    objs = objs || [];
    let k = 0, nSeg = 1;
    const lay = [], segHas = [false];
    objs.forEach(function (o) {
      if (window.presIsSpecial(o)) { lay.push({ sp: true, k: k, z: 11 + 2 * k }); k++; nSeg++; segHas.push(false); }
      else { lay.push({ sp: false, seg: nSeg - 1 }); segHas[nSeg - 1] = true; }
    });
    return { lay: lay, nSeg: nSeg, segHas: segHas };
  };
  /** 1..n-1 bo'laklarni oldindan chizadi (0-bo'lak asosiy rasm) */
  window.presRenderSegments = async function (slide) {
    const out = [];
    let parsed = {};
    try { parsed = JSON.parse((slide && slide.json) || '{}'); } catch (e) { return out; }
    const L = window.presLayout(parsed.objects || []);
    for (let j = 1; j < L.nSeg; j++) {
      if (!L.segHas[j]) { out.push(null); continue; }
      try { out.push(await renderSlideToOptimizedDataURL(slide.json, { skipElementGifs: true, segment: j })); }
      catch (e) { out.push(null); }
    }
    return out;
  };

  // mavjud taqdimot funksiyalariga ulash
  if (typeof renderPresentationGifs === 'function' && !renderPresentationGifs.__ssWrapped) {
    const o = renderPresentationGifs;
    renderPresentationGifs = function (slide, gen) {
      try { o.apply(this, arguments); } catch (e) { console.warn(e); }
      try { PresExtras.render(slide, gen); } catch (e) { console.warn('PresExtras:', e); }
    };
    renderPresentationGifs.__ssWrapped = true;
  }
  if (typeof clearPresentationGifs === 'function' && !clearPresentationGifs.__ssWrapped) {
    const o = clearPresentationGifs;
    clearPresentationGifs = function () { o.apply(this, arguments); try { PresExtras.clear(); } catch (e) {} };
    clearPresentationGifs.__ssWrapped = true;
  }
  if (typeof closePresentation === 'function' && !closePresentation.__ssWrapped) {
    const o = closePresentation;
    closePresentation = function () { try { PresExtras.clear(); } catch (e) {} return o.apply(this, arguments); };
    closePresentation.__ssWrapped = true;
    window.closePresentation = closePresentation;
  }

  // ---------------------------------------------------------------------
  // 10b. RASM / GIF / VIDEO: burchak yumshatish, doira, kesish (crop)
  // ---------------------------------------------------------------------
  const MediaFx = (function () {
    function isMedia(o) { return !!o && (o.type === 'image' || o.type === 'gifImage' || o.isGif || isEmbedObj(o)); }
    function rotated(dx, dy, deg) {
      const a = (deg || 0) * Math.PI / 180;
      return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
    }
    function clampPct(v) { v = +v; return isFinite(v) ? Math.max(0, Math.min(50, v)) : 0; }

    /** burchak foizi (0..50, 50 = doira/oval) */
    function setRadius(o, pct) {
      if (!isMedia(o) && !(o && o.type === 'rect')) return;
      pct = clampPct(pct);
      o.mRadius = pct;
      if (!isMedia(o)) {
        const r0 = pct / 100 * Math.min(o.width, o.height);
        o.set({ rx: r0, ry: r0 });
      } else if (isEmbedObj(o)) {
        const r = pct / 100 * Math.min(o.width, o.height);
        o.set({ rx: r, ry: r });
      } else if (o.type === 'image') {
        if (!pct) o.clipPath = null;
        else o.clipPath = new fabric.Rect({
          originX: 'center', originY: 'center', left: 0, top: 0,
          width: o.width, height: o.height, rx: pct / 100 * o.width, ry: pct / 100 * o.height
        });
      }   // GIF: overlay CSS o'zi mRadius dan oladi
      o.dirty = true; o.objectCaching = false;
      try { if (typeof GifOverlay !== 'undefined') GifOverlay.scheduleSync(); GifOverlay.updateObject(o); } catch (e) {}
    }
    function refreshClip(o) { if (o && o.mRadius) setRadius(o, o.mRadius); }

    function ensureBase(o) {
      if (!o.mBase) {
        o.mBase = { left: o.left, top: o.top, width: o.width, height: o.height, scaleX: o.scaleX || 1, scaleY: o.scaleY || 1, cropX: o.cropX || 0, cropY: o.cropY || 0 };
      }
      return o.mBase;
    }
    /** crop: [chap, tepa, o'ng, past] ulush 0..0.9 */
    function setCrop(o, c) {
      if (!isMedia(o)) return;
      c = (c || [0, 0, 0, 0]).map(function (v) { v = +v; return isFinite(v) ? Math.max(0, Math.min(0.9, v)) : 0; });
      if (c[0] + c[2] > 0.9) { const k = 0.9 / (c[0] + c[2]); c[0] *= k; c[2] *= k; }
      if (c[1] + c[3] > 0.9) { const k = 0.9 / (c[1] + c[3]); c[1] *= k; c[3] *= k; }
      if (!(c[0] || c[1] || c[2] || c[3])) { reset(o, true); return; }
      const b = ensureBase(o);
      const off = rotated(c[0] * b.width * b.scaleX, c[1] * b.height * b.scaleY, o.angle);
      o.mCrop = c;
      o.set({
        width: b.width * (1 - c[0] - c[2]), height: b.height * (1 - c[1] - c[3]),
        scaleX: b.scaleX, scaleY: b.scaleY, left: b.left + off.x, top: b.top + off.y
      });
      if (o.type === 'image') o.set({ cropX: b.cropX + c[0] * b.width, cropY: b.cropY + c[1] * b.height });
      refreshClip(o);
      o.setCoords(); o.dirty = true;
      try { if (typeof GifOverlay !== 'undefined') GifOverlay.scheduleSync(); } catch (e) {}
    }
    function reset(o, cropOnly) {
      if (!isMedia(o)) return;
      if (o.mBase) {
        const b = o.mBase;
        o.set({ width: b.width, height: b.height, scaleX: b.scaleX, scaleY: b.scaleY, left: b.left, top: b.top });
        if (o.type === 'image') o.set({ cropX: b.cropX, cropY: b.cropY });
      }
      o.mBase = undefined; o.mCrop = undefined;
      if (!cropOnly) { o.mRadius = 0; if (isEmbedObj(o)) o.set({ rx: 0, ry: 0 }); else if (o.type === 'image') o.clipPath = null; }
      else refreshClip(o);
      if (isEmbedObj(o) && !cropOnly) o.mRadius = 0;
      o.setCoords(); o.dirty = true;
      try { if (typeof GifOverlay !== 'undefined') GifOverlay.scheduleSync(); } catch (e) {}
    }
    // o'lchami/joyi qo'lda o'zgarsa — baza ham yangilanadi (keyin "asl holat" to'g'ri ishlaydi)
    function rebase(o) {
      if (!o || !o.mBase || !o.mCrop) return;
      const b = o.mBase, c = o.mCrop;
      const sx = o.scaleX || 1, sy = o.scaleY || 1;
      const off = rotated(c[0] * b.width * sx, c[1] * b.height * sy, o.angle);
      b.scaleX = sx; b.scaleY = sy; b.left = o.left - off.x; b.top = o.top - off.y;
    }
    canvas.on('object:modified', function (e) { if (e && e.target) rebase(e.target); });

    // ---- panel ----
    let bar = null, mode = 'main';
    const SHAPE_TYPES = ['rect', 'circle', 'ellipse', 'triangle', 'polygon', 'path', 'line', 'polyline'];
    function isShape(o) { return !!o && SHAPE_TYPES.indexOf(o.type) >= 0 && !o.isButton && !o.isEmbed && o.type !== 'textbox'; }
    function ensureBar() {
      if (bar && bar.isConnected) return bar;
      bar = document.getElementById('mediaEditBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'mediaEditBar';
        bar.className = 'media-edit-bar';
        ['mousedown', 'click', 'touchstart', 'pointerdown'].forEach(function (ev) { bar.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
        document.body.appendChild(bar);
      }
      return bar;
    }
    function current() {
      let o = null;
      try { o = canvas.getActiveObject(); } catch (e) {}
      return (isMedia(o) || isShape(o)) ? o : null;
    }
    function commit() {
      try { canvas.renderAll(); } catch (e) { canvas.requestRenderAll(); }
      const _i = activeIndex;
      const _after = function () { try { refreshSlideThumb(_i); } catch (e) {} };
      if (window.ssDeferSave) window.ssDeferSave(_after);   // v42
      else { try { saveCurrentSlideState(); recordGlobalState(); } catch (e) {} _after(); }
    }
    function hex(c, fb) { return (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? c : (fb || '#3b82f6'); }
    function render() {
      const o = current();
      const b = ensureBar();
      if (!o) { b.classList.remove('open'); return; }
      const media = isMedia(o);
      const kind = isEmbedObj(o) ? 'Video' : ((o.type === 'gifImage' || o.isGif) ? 'GIF' : (o.type === 'image' ? 'Rasm' : 'Shakl'));
      const canRound = media || o.type === 'rect';
      if (mode === 'main' && !canRound) mode = 'color';
      if (mode === 'crop' && !media) mode = canRound ? 'main' : 'color';
      const r = Math.round(o.mRadius || (o.type === 'rect' && !media ? (Math.min(o.rx || 0, 999) / Math.max(1, Math.min(o.width, o.height)) * 100) : 0));
      const c = o.mCrop || [0, 0, 0, 0];
      const op = Math.round((o.opacity != null ? o.opacity : 1) * 100);
      const row = function (label, val, max, fn, unit) {
        return '<label class="me-row"><span>' + label + '</span><input type="range" min="0" max="' + max + '" value="' + val + '" oninput="' + fn + '" onchange="MediaFx.commit()"><b>' + val + (unit || '') + '</b></label>';
      };
      const tab = function (id, ico, label) { return '<button class="' + (mode === id ? 'on' : '') + '" onclick="MediaFx.setMode(\'' + id + '\')"><span class="material-symbols-outlined">' + ico + '</span>' + label + '</button>'; };
      let h = '<div class="me-head"><b>' + kind + ' sozlamalari</b><button class="me-x" onclick="MediaFx.hide()" aria-label="Yopish">&times;</button></div>';
      h += '<div class="me-tabs">' + (canRound ? tab('main', 'rounded_corner', 'Burchak') : '') + (media ? tab('crop', 'crop', 'Kesish') : '') + tab('color', 'palette', media ? 'Ko\'rinish' : 'Rang') + tab('order', 'layers', 'Tartib') + '</div>';
      if (mode === 'main') {
        h += row('Yumshatish', r, 50, 'MediaFx.liveRadius(this.value,this)', '%');
        h += '<div class="me-chips">' + [0, 8, 16, 28, 50].map(function (v) { return '<button onclick="MediaFx.liveRadius(' + v + ');MediaFx.commit()">' + (v === 50 ? '⬤ Doira' : (v === 0 ? '▢ To\'g\'ri' : v + '%')) + '</button>'; }).join('') + '</div>';
      } else if (mode === 'crop') {
        h += row('Chapdan', Math.round(c[0] * 100), 80, 'MediaFx.liveCrop(0,this.value,this)', '%');
        h += row('Tepadan', Math.round(c[1] * 100), 80, 'MediaFx.liveCrop(1,this.value,this)', '%');
        h += row('O\'ngdan', Math.round(c[2] * 100), 80, 'MediaFx.liveCrop(2,this.value,this)', '%');
        h += row('Pastdan', Math.round(c[3] * 100), 80, 'MediaFx.liveCrop(3,this.value,this)', '%');
        h += '<div class="me-chips"><button onclick="MediaFx.cropRatio(1)">1:1</button><button onclick="MediaFx.cropRatio(4/3)">4:3</button><button onclick="MediaFx.cropRatio(16/9)">16:9</button><button onclick="MediaFx.cropRatio(9/16)">9:16</button></div>';
      } else if (mode === 'color') {
        if (!media) {
          const fillOk = o.type !== 'line';
          h += '<div class="me-colors">' + (fillOk ? '<label>To\'ldirish<input type="color" value="' + hex(o.fill) + '" oninput="MediaFx.setProp(\'fill\',this.value)" onchange="MediaFx.commit()"></label>' : '') +
            '<label>Chiziq<input type="color" value="' + hex(o.stroke, '#1e293b') + '" oninput="MediaFx.setProp(\'stroke\',this.value)" onchange="MediaFx.commit()"></label></div>';
          h += row('Chiziq qalinligi', Math.round(o.strokeWidth || 0), 20, 'MediaFx.setProp(\'strokeWidth\',+this.value,this)', 'px');
        }
        h += row('Shaffoflik', op, 100, 'MediaFx.setProp(\'opacity\',this.value/100,this)', '%');
        h += '<div class="me-chips"><button onclick="MediaFx.shadow()">▣ Soya</button></div>';
      } else {
        h += '<div class="me-chips big">' +
          '<button onclick="MediaFx.act(\'front\')">⬆ Eng oldinga</button><button onclick="MediaFx.act(\'fwd\')">↑ Oldinga</button>' +
          '<button onclick="MediaFx.act(\'back\')">↓ Orqaga</button><button onclick="MediaFx.act(\'bottom\')">⬇ Eng orqaga</button>' +
          '<button onclick="MediaFx.act(\'flipx\')">⇆ Aylantirish</button><button onclick="MediaFx.act(\'flipy\')">⇅ Ag\'darish</button>' +
          '<button onclick="MediaFx.act(\'rot\')">⟳ 90°</button><button onclick="MediaFx.act(\'dup\')">⧉ Nusxa</button>' +
          '<button class="danger" onclick="MediaFx.act(\'del\')">🗑 O\'chirish</button></div>';
      }
      if (media) h += '<div class="me-btns"><button class="ghost" onclick="MediaFx.resetAll()">↺ Asl holatga qaytarish</button></div>';
      b.innerHTML = h;
      b.classList.add('open');
    }
    function liveRadius(v, el) {
      const o = current(); if (!o) return;
      setRadius(o, v);
      if (el && el.nextElementSibling) el.nextElementSibling.textContent = Math.round(v) + '%';
      canvas.requestRenderAll();
    }
    function liveCrop(i, v, el) {
      const o = current(); if (!o) return;
      const c = (o.mCrop || [0, 0, 0, 0]).slice();
      c[i] = (+v) / 100;
      setCrop(o, c);
      if (el && el.nextElementSibling) el.nextElementSibling.textContent = Math.round(v) + '%';
      canvas.requestRenderAll();
    }
    function cropRatio(ratio) {
      const o = current(); if (!o || !isMedia(o)) return;
      const b = ensureBase(o);
      const W = b.width, H = b.height;
      let cw = W, ch = W / ratio;
      if (ch > H) { ch = H; cw = H * ratio; }
      const mx = (W - cw) / 2 / W, my = (H - ch) / 2 / H;
      setCrop(o, [mx, my, mx, my]);
      commit(); render();
    }
    function setProp(k, v, el) {
      const o = current(); if (!o) return;
      o.set(k, v); o.dirty = true;
      if (el && el.nextElementSibling) el.nextElementSibling.textContent = (k === 'opacity' ? Math.round(v * 100) + '%' : v + 'px');
      try { if (typeof GifOverlay !== 'undefined') GifOverlay.scheduleSync(); } catch (e) {}
      canvas.requestRenderAll();
    }
    function shadow() {
      const o = current(); if (!o) return;
      o.set('shadow', o.shadow ? null : new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: 18, offsetX: 0, offsetY: 6 }));
      commit();
    }
    function act(a) {
      const o = current(); if (!o) return;
      if (a === 'front') canvas.bringToFront(o);
      else if (a === 'fwd') canvas.bringToFront(o);     // v36
      else if (a === 'back') canvas.sendToBack(o);      // v36
      else if (a === 'bottom') canvas.sendToBack(o);
      else if (a === 'flipx') o.set('flipX', !o.flipX);
      else if (a === 'flipy') o.set('flipY', !o.flipY);
      else if (a === 'rot') { o.rotate(((o.angle || 0) + 90) % 360); }
      else if (a === 'dup') { try { copyObject(); pasteObject(); } catch (e) {} return; }
      else if (a === 'del') { canvas.remove(o); canvas.discardActiveObject(); }
      o.setCoords && o.setCoords();
      try { if (typeof GifOverlay !== 'undefined') GifOverlay.scheduleSync(); } catch (e) {}
      commit(); render();
    }
    ['selection:created', 'selection:updated', 'selection:cleared'].forEach(function (ev) { canvas.on(ev, render); });
    canvas.on('object:modified', function () { if (bar && bar.classList.contains('open') && mode === 'crop') render(); });
    return {
      setRadius: setRadius, setCrop: setCrop, reset: reset, render: render, isMedia: isMedia,
      liveRadius: liveRadius, liveCrop: liveCrop, cropRatio: cropRatio, setProp: setProp, shadow: shadow, act: act,
      commit: function () { commit(); render(); },
      circle: function () { const o = current(); if (o) { setRadius(o, 50); commit(); render(); } },
      resetAll: function () { const o = current(); if (o) { reset(o, false); commit(); render(); } },
      setMode: function (m) { mode = m; render(); },
      hide: function () { if (bar) bar.classList.remove('open'); }
    };
  })();
  window.MediaFx = MediaFx;

  /** AI: {"action":"style_media","image_number":K | "id":ID,"slide":N,"radius":0-50,"circle":true,"crop":{"left":10,"top":0,"right":10,"bottom":0},"reset":true} */
  async function aiStyleMedia(cmd) {
    const dest = ((cmd.target_slide || cmd.slide) || (activeIndex + 1)) - 1;
    if (dest < 0 || dest >= slides.length) return false;
    if (dest === activeIndex) saveCurrentSlideState({ force: true });
    const parsed = JSON.parse(slides[dest].json || '{}');
    const objs = parsed.objects || [];
    let o = null;
    if (cmd.id != null) o = objs.filter(function (x) { return x._oid === cmd.id || x._oid === +cmd.id; })[0];
    else if (cmd.image_number != null) o = objs.filter(function (x) { return String(x.imageNumber) === String(cmd.image_number); })[0];
    if (!o) return false;
    // vaqtinchalik fabric obyekt orqali hisoblaymiz
    const fo = await new Promise(function (res) { fabric.util.enlivenObjects([o], function (arr) { res(arr && arr[0]); }); });
    if (!fo) return false;
    if (cmd.reset === true) MediaFx.reset(fo, false);
    const okR = !window.ssRoundingAllowed || window.ssRoundingAllowed();
    if (cmd.circle === true && okR) MediaFx.setRadius(fo, 50);
    else if (cmd.radius != null && okR) MediaFx.setRadius(fo, cmd.radius);
    if (cmd.crop && typeof cmd.crop === 'object') {
      const cr = cmd.crop;
      MediaFx.setCrop(fo, [(+cr.left || 0) / 100, (+cr.top || 0) / 100, (+cr.right || 0) / 100, (+cr.bottom || 0) / 100]);
    }
    const out = fo.toObject(SERIALIZE_PROPS);
    const idx = objs.indexOf(o);
    objs[idx] = Object.assign({}, o, out);
    parsed.objects = objs;
    slides[dest].json = JSON.stringify(parsed);
    if (dest === activeIndex) { try { await loadSlideCanvasAsync(dest); } catch (e) {} }
    try { await refreshSlideThumb(dest); } catch (e) {}
    return true;
  }
  window.aiStyleMedia = aiStyleMedia;

  // ---------------------------------------------------------------------
  // 10c. v29: tugma / havola — bitta bosishda tahrir paneli (matn, havola, rang)
  // ---------------------------------------------------------------------
  const ButtonFx = (function () {
    let bar = null;
    function ensureBar() {
      if (bar && bar.isConnected) return bar;
      bar = document.getElementById('buttonEditBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'buttonEditBar';
        bar.className = 'media-edit-bar';
        ['mousedown', 'click', 'touchstart', 'pointerdown'].forEach(function (ev) { bar.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
        document.body.appendChild(bar);
      }
      return bar;
    }
    function isLinkText(o) { return !!o && o.type === 'textbox' && !!o.linkUrl; }
    function current() {
      let o = null;
      try { o = canvas.getActiveObject(); } catch (e) {}
      return (isButtonObj(o) || isLinkText(o)) ? o : null;
    }
    function hex(c, fb) { return (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? c : fb; }
    function isTransparent(c) { return !(typeof c === 'string') || !c || (typeof window.isSolidBgColor === 'function' && !window.isSolidBgColor(c)); }
    function commit() {
      try { canvas.renderAll(); } catch (e) { try { canvas.requestRenderAll(); } catch (er) {} }
      const _i = activeIndex;
      const _after = function () { try { refreshSlideThumb(_i); } catch (e) {} };
      if (window.ssDeferSave) window.ssDeferSave(_after);   // v42
      else { try { saveCurrentSlideState(); recordGlobalState(); } catch (e) {} _after(); }
    }
    function render() {
      const o = current(), b = ensureBar();
      if (!o) { b.classList.remove('open'); return; }
      if (b.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && b.classList.contains('open') && b.dataset.oid === String(o._oid)) return;   // yozayotganda qayta chizmaymiz
      b.dataset.oid = String(o._oid);
      let h;
      if (isLinkText(o)) {
        h = '<div class="me-head"><b>Havola sozlamalari</b><button class="me-x" onclick="ButtonFx.hide()" aria-label="Yopish">&times;</button></div>' +
          '<label class="me-field"><span>Havola (URL)</span><input type="text" value="' + esc(o.linkUrl) + '" oninput="ButtonFx.set(\'linkUrl\',this.value)" onchange="ButtonFx.commit()"></label>' +
          '<div class="me-colors"><label>Matn rangi<input type="color" value="' + hex(o.fill, '#2563eb') + '" oninput="ButtonFx.set(\'fill\',this.value)" onchange="ButtonFx.commit()"></label></div>' +
          '<div class="me-chips"><button onclick="ButtonFx.toggle(\'underline\')">U̲ Tagiga chizish</button><button class="danger" onclick="ButtonFx.unlink()">Havolani olib tashlash</button></div>';
      } else {
        const link = !!o.btnUnderline || isTransparent(o.fill);
        const act = o.btnAction || 'next';
        const opts = Object.keys(BTN_ACTIONS).map(function (k) { return '<option value="' + k + '"' + (act === k ? ' selected' : '') + '>' + esc(BTN_ACTIONS[k]) + '</option>'; }).join('');
        const needT = (act === 'goto' || act === 'url' || act === 'popup');
        h = '<div class="me-head"><b>' + (link ? 'Havola' : 'Tugma') + ' sozlamalari</b><button class="me-x" onclick="ButtonFx.hide()" aria-label="Yopish">&times;</button></div>' +
          '<label class="me-field"><span>Yozuv</span><input type="text" maxlength="60" value="' + esc(o.btnLabel || '') + '" oninput="ButtonFx.set(\'btnLabel\',this.value)" onchange="ButtonFx.commit()"></label>' +
          '<label class="me-field"><span>Bosilganda</span><select onchange="ButtonFx.set(\'btnAction\',this.value);ButtonFx.commit();ButtonFx.render(true)">' + opts + '</select></label>' +
          (needT ? '<label class="me-field"><span>' + (act === 'url' ? 'Havola (URL)' : (act === 'goto' ? 'Slayd raqami' : 'Oyna matni')) + '</span><input type="text" value="' + esc(o.btnTarget || '') + '" oninput="ButtonFx.target(this.value)" onchange="ButtonFx.commit()"></label>' : '') +
          '<div class="me-colors"><label>Yozuv rangi<input type="color" value="' + hex(o.btnTextColor, '#ffffff') + '" oninput="ButtonFx.set(\'btnTextColor\',this.value)" onchange="ButtonFx.commit()"></label>' +
          (link ? '' : '<label>Tugma rangi<input type="color" value="' + hex(o.fill, '#4f46e5') + '" oninput="ButtonFx.set(\'fill\',this.value)" onchange="ButtonFx.commit()"></label>') + '</div>' +
          '<label class="me-row"><span>Shrift</span><input type="range" min="10" max="72" value="' + Math.round(o.btnFontSize || 22) + '" oninput="ButtonFx.set(\'btnFontSize\',+this.value);this.nextElementSibling.textContent=this.value" onchange="ButtonFx.commit()"><b>' + Math.round(o.btnFontSize || 22) + '</b></label>' +
          (link ? '' : '<label class="me-row"><span>Burchak</span><input type="range" min="0" max="40" value="' + Math.round(o.rx || 0) + '" oninput="ButtonFx.set(\'rx\',+this.value);ButtonFx.set(\'ry\',+this.value);this.nextElementSibling.textContent=this.value" onchange="ButtonFx.commit()"><b>' + Math.round(o.rx || 0) + '</b></label>') +
          '<div class="me-chips"><button onclick="ButtonFx.toggle(\'btnBold\')">B Qalin</button><button onclick="ButtonFx.toggle(\'btnUnderline\')">U̲ Tagiga chizish</button></div>';
      }
      b.innerHTML = h;
      b.classList.add('open');
    }
    function set(k, v) {
      const o = current(); if (!o) return;
      o.set(k, v); o.dirty = true;
      if (k === 'linkUrl' || k === 'fill') o.setCoords();
      canvas.requestRenderAll();
    }
    function target(v) { const o = current(); if (!o) return; o.btnTarget = v; }
    function toggle(k) {
      const o = current(); if (!o) return;
      const cur = k === 'btnBold' ? (o.btnBold !== false) : !!o[k];
      o.set(k, !cur); o.dirty = true;
      commit(); render();
    }
    function unlink() {
      const o = current(); if (!o) return;
      o.linkUrl = ''; o.set('underline', false);
      commit(); render();
    }
    ['selection:created', 'selection:updated', 'selection:cleared'].forEach(function (ev) { canvas.on(ev, function () { render(); }); });
    return {
      render: function (force) { if (force && bar) bar.dataset.oid = ''; render(); },
      set: set, target: target, toggle: toggle, unlink: unlink,
      commit: function () { commit(); },
      hide: function () { if (bar) bar.classList.remove('open'); }
    };
  })();
  window.ButtonFx = ButtonFx;

  // ---------------------------------------------------------------------
  // 11. Global kirish nuqtalari
  // ---------------------------------------------------------------------
  window.addVideoDialog = function () { try { document.querySelectorAll('.dropdown-menu').forEach(function (m) { m.style.display = 'none'; }); } catch (e) {} return openVideoDialog(null); };
  window.addButtonDialog = function () { try { document.querySelectorAll('.dropdown-menu').forEach(function (m) { m.style.display = 'none'; }); } catch (e) {} return openButtonDialog(null); };

  try { EmbedOverlay.schedule(); } catch (e) {}
})();
