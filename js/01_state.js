(function () {  // v24: fabric 5.3 'alphabetical' xatosi — har renderda ogohlantirish chiqarib UI ni sekinlashtirardi
  try {
    var d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'textBaseline');
    if (d && d.set && !d.set._ssPatched) {
      var st = function (v) { d.set.call(this, v === 'alphabetical' ? 'alphabetic' : v); };
      st._ssPatched = true;
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'textBaseline', { configurable: true, enumerable: d.enumerable, get: d.get, set: st });
    }
  } catch (e) {}
})();
    let slides = [];
    let activeIndex = 0;
    let presentationIndex = 0;
    let currentProjectId = null;
    let projectTitle = "Yangi Slayd Taqdimoti";
    let projectStatus = "draft";
    let supabaseClient = null;
    let supabaseToken = "dev-token";
    let currentUserEmail = "";
    let socket = null;
    let currentChatId = "new";
    let hasUnsavedChanges = false;
    let isSavingOrAuthenticating = false;
    let isAiStreaming = false;
    let aiSessionActive = false;
    let currentAiStreamBuffer = "";
    let currentAiReplyText = "";
    let currentBotMsgId = null;
    let processedJsonBlocks = new Set();
    let executedActionSignatures = new Set();

    let _resetDeckAppliedThisStream = false;
    let aiProcessingQueue = Promise.resolve();
    let isAiApplyingCommands = false;
    let aiWatchdogTimer = null;
    let _lastRenderedSlideIndex = -1;

    const AI_IDLE_TIMEOUT_MS = 90 * 60 * 1000;
    function startAiWatchdog() {
      clearAiWatchdog();
      aiWatchdogTimer = setTimeout(() => {
        if (isAiStreaming) {
          try {
            showToast("AI hali ishlayapti (rasm/GIF qidiruv uzoq davom etishi mumkin). Kutishda qoling — javob uzilmaydi.", 'info');
          } catch (e) {}
          try { startAiWatchdog(); } catch (e2) {}
        }
      }, AI_IDLE_TIMEOUT_MS);
    }

    function bumpAiWatchdog() {
      if (!isAiStreaming) return;
      startAiWatchdog();
    }
    window.bumpAiWatchdog = bumpAiWatchdog;
    function clearAiWatchdog() {
      if (aiWatchdogTimer) { clearTimeout(aiWatchdogTimer); aiWatchdogTimer = null; }
    }
    function isSocketReady() {
      return !!(socket && socket.readyState === WebSocket.OPEN);
    }
    function sendOverSocket(payload) {
      try { if (payload && typeof payload === 'object' && payload.type !== 'search_result') payload.client_search = true; } catch (e) {}
      if (isSocketReady()) {
        try { socket.send(JSON.stringify(payload)); return true; }
        catch (e) { console.warn("socket.send xatolik:", e); }
      }
      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        try { initWebSocket(); } catch (e) {}
      }
      showToast("Server bilan aloqa yo'q. Qayta ulanmoqda, birozdan so'ng urinib ko'ring.", 'error');
      return false;
    }
    let uploadedImagesStore = [];
    let bottomAiImages = [];
    let pendingImagesStore = [];
    let globalImageCounter = 0;
    let userStats = { total_tokens: 0, slide_credits: 0 };
      const CHAT_STORAGE_KEY = 'slide_studio_chat_history_v2';
      const CHAT_HISTORY_KEEP_LIMIT = 40;
      const CHAT_HISTORY_SEND_LIMIT = 20;
      const MAX_HISTORY_COUNT = 20;
      let inMemoryChatHistory = [];
      function getLocalChatHistory() {
        return Array.isArray(inMemoryChatHistory) ? inMemoryChatHistory : [];
      }
      function saveMessageToLocal(role, text) {
        if (!text || !String(text).trim()) return;
        let clean = String(text).trim();
        if (clean === '💭 ...' || clean === '✨ [Bajarildi]' || clean === '✨ [Amal bajarildi]') return;
        if (role === 'model') {
          const stripped = clean.replace(/```(?:json)?[\s\S]*?(?:```|$)/gi, '').trim();
          clean = stripped || '✨ [Slayd parametrlariga o\'zgartirish kiritildi]';
        }
        if (!Array.isArray(inMemoryChatHistory)) inMemoryChatHistory = [];
        inMemoryChatHistory.push({ role, text: clean });
        if (inMemoryChatHistory.length > CHAT_HISTORY_KEEP_LIMIT) {
          inMemoryChatHistory = inMemoryChatHistory.slice(-CHAT_HISTORY_KEEP_LIMIT);
        }
      }
      function getPayloadChatHistory() {
        return getLocalChatHistory().slice(-CHAT_HISTORY_SEND_LIMIT);
      }
      function clearLocalChatHistory() {
        inMemoryChatHistory = [];
      }
      window.clearLocalChatHistory = clearLocalChatHistory;
      function startNewChat() {
        if (isAiStreaming) { showToast("AI hali javob bermoqda. Avval to'xtating.", 'error'); return; }
        const ok = window.confirm("Suhbat tarixi o'chiriladi. Davom etilsinmi?");
        if (!ok) return;
        clearLocalChatHistory();
        const chatBody = document.getElementById('aiChatBody');
        if (chatBody) chatBody.innerHTML = '';
        currentChatId = "new";

        try { if (typeof purgeInterruptedForCurrentProject === 'function') purgeInterruptedForCurrentProject(); } catch (e) {  }
        appendAiChatMessage('bot', 'Salom! Yangi suhbat boshlandi. Menga istalgan mavzuda slayd yaratishni yoki tahrirlashni buyurishingiz mumkin.');
        showToast("Yangi suhbat boshlandi");
      }
      window.startNewChat = startNewChat;
      function trimLocalHistoryForRegenerate() {
        const history = getLocalChatHistory();
        while (history.length && history[history.length - 1].role === 'model') {
          history.pop();
        }
        if (history.length && history[history.length - 1].role === 'user') {
          history.pop();
        }
      }
      window.trimLocalHistoryForRegenerate = trimLocalHistoryForRegenerate;
          function restoreChatHistoryFromLocal() {
            const chatBody = document.getElementById('aiChatBody');
            if (!chatBody) return;
            const history = getLocalChatHistory();
            if (!history || history.length === 0) return;
            chatBody.innerHTML = '';
            history.forEach((h) => {
              try {
                appendAiChatMessage(h.role === 'model' ? 'bot' : 'user', h.text || '');
              } catch (e) { console.warn('Tarixni tiklashda xatolik:', e); }
            });
            refreshChatMessageActions();
            chatBody.scrollTop = chatBody.scrollHeight;
          }
          window.restoreChatHistoryFromLocal = restoreChatHistoryFromLocal;
    let globalHistory = [];
    let historyStep = -1;
    let isUndoRedoAction = false;
    const MAX_HISTORY_STEPS = 100;
    let _clipboardStack = null;
    let activeColorTarget = 'fill';
    let selectedColorHex = '#3b82f6';
    let currentHue = 0;
    let currentSat = 100;
    let currentVal = 100;
    let globalObjectIdCounter = 0;
    const SERIALIZE_PROPS = ['id', 'imageNumber', 'imageHash', '_oid', 'src', 'crossOrigin', 'isGif', 'gifUrl', 'isFallback', 'isVideo', 'videoUrl', 'videoLoop', 'videoMuted', 'videoAutoplay', 'ssKind', 'ssSpec'];
    function nextObjectId() { globalObjectIdCounter += 1; return globalObjectIdCounter; }
    function ensureObjectId(obj) {
      if (!obj) return null;
      if (obj._oid == null) obj._oid = nextObjectId();
      obj.set('_oid', obj._oid);
      return obj._oid;
    }
    function ensureCanvasObjectIds() { canvas.forEachObject((obj) => ensureObjectId(obj)); }
    function bumpObjectIdCounterFromSlides() {
      let maxId = globalObjectIdCounter;
      slides.forEach((s) => {
        try {
          const parsed = JSON.parse(s.json || '{}');
          (parsed.objects || []).forEach((o) => {
            if (o._oid != null && o._oid > maxId) maxId = o._oid;
          });
        } catch (e) {}
      });
      globalObjectIdCounter = maxId;
    }
    const canvas = new fabric.Canvas('mainCanvas', {
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
      enableRetinaScaling: true,
      imageSmoothingEnabled: true
    });
    try { window.canvas = canvas; } catch (e) {}
    try {
      const _ctx0 = canvas.getContext();
      if (_ctx0) {
        _ctx0.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in _ctx0) _ctx0.imageSmoothingQuality = 'high';
      }
      canvas.on('after:render', function () {
        try {
          const c = canvas.getContext();
          if (c) {
            c.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in c) c.imageSmoothingQuality = 'high';
          }
        } catch (e) {}
      });
    } catch (e) {}
    const AnimatedGifImage = fabric.util.createClass(fabric.Image, {
      type: 'gifImage',
      objectCaching: false,
      _gifElement: null,
      _gifUrl: '',
      initialize: function (element, options) {
        options = options || {};
        this.callSuper('initialize', element, options);
        this._gifElement = element || null;
        this._gifUrl = options.gifUrl || (element && element.src) || '';
        try {
          const _u = options.gifUrl || options.src;
          if (element && _u && !element.getAttribute('src')) {
            element.src = _u;                       // v28: kanvasda chizish uchun manba kerak
            if (window.GifLive) window.GifLive.keepAlive(element);
          } else if (element && window.GifLive) window.GifLive.keepAlive(element);
        } catch (e) {}
        this.isGif = true;
        this.objectCaching = false;
        const ew = (element && (element.naturalWidth || element.width)) || 0;
        const eh = (element && (element.naturalHeight || element.height)) || 0;
        if (options.width != null) this.width = options.width;
        else if (ew) this.width = ew;
        if (options.height != null) this.height = options.height;
        else if (eh) this.height = eh;
        if (options.scaleX != null) this.scaleX = options.scaleX;
        if (options.scaleY != null) this.scaleY = options.scaleY;
        this._gifSized = true;
        try { this.setCoords(); } catch (e) {}
      },
      _render: function (ctx) {

        try {
          if (typeof GifOverlay !== 'undefined' && GifOverlay.hasItems && GifOverlay.hasItems() &&
              this._oid != null && this.canvas === (typeof canvas !== 'undefined' ? canvas : null)) {

            ctx.save();
            ctx.globalAlpha = 0.02;
            ctx.fillStyle = '#000';
            ctx.fillRect(-this.width / 2, -this.height / 2, this.width || 1, this.height || 1);
            ctx.restore();
            return;
          }
        } catch (e) {}
        let el = this._gifElement || this._element;
        // v29: kadrlar o'zimizning dekoder/soat bo'yicha almashadi (brauzer <img> animatsiyasiga bog'liq emas)
        let frame = null;
        try {
          if (window.GifPlayer) frame = window.GifPlayer.frameFor(this.gifUrl || this._gifUrl || this.src);
        } catch (e) {}
        if (!el && !frame) return;
        if (el) { try { if (window.GifLive) window.GifLive.keepAlive(el); } catch (e) {} }
        const w = (frame ? frame.width : 0) || (el && (el.naturalWidth || el.width)) || this.width || 0;
        const h = (frame ? frame.height : 0) || (el && (el.naturalHeight || el.height)) || this.height || 0;
        if (frame) el = frame;
        if (!w || !h) return;
        if (!this._gifSized || !this.width || !this.height) {
          this.width = w;
          this.height = h;
          this._gifSized = true;
          try { this.setCoords(); } catch (e) {}
        }
        try {
          const W = this.width, H = this.height;
          const c = this.mCrop;                       // kesish: [chap, tepa, o'ng, past]
          const rp = this.mRadius || 0;               // burchak yumshatish (%)
          if (rp > 0) {
            const r = Math.min(rp / 100 * Math.min(W, H), W / 2, H / 2);
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(-W / 2 + r, -H / 2);
            ctx.arcTo(W / 2, -H / 2, W / 2, H / 2, r);
            ctx.arcTo(W / 2, H / 2, -W / 2, H / 2, r);
            ctx.arcTo(-W / 2, H / 2, -W / 2, -H / 2, r);
            ctx.arcTo(-W / 2, -H / 2, W / 2, -H / 2, r);
            ctx.closePath();
            ctx.clip();
          }
          if (c && (c[0] || c[1] || c[2] || c[3])) {
            ctx.drawImage(el, c[0] * w, c[1] * h, Math.max(1, (1 - c[0] - c[2]) * w), Math.max(1, (1 - c[1] - c[3]) * h), -W / 2, -H / 2, W, H);
          } else {
            ctx.drawImage(el, -W / 2, -H / 2, W, H);
          }
          if (rp > 0) ctx.restore();
        } catch (e) {  }
      },
      toObject: function (propertiesToInclude) {
        return fabric.util.object.extend(this.callSuper('toObject', propertiesToInclude), {
          gifUrl: this.gifUrl || this._gifUrl,
          isGif: true,
        });
      },
    });
    AnimatedGifImage.async = true;
    AnimatedGifImage.fromObject = function (object, callback) {
      const rawUrl = object.gifUrl || object.src;
      if (!rawUrl) { callback && callback(null); return; }

      function toLoadUrl(u) {
        if (!u || typeof u !== 'string') return u;
        if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('/')) return u;
        if (/^https?:\/\//i.test(u)) return '/api/proxy-image?raw=1&url=' + encodeURIComponent(u);
        return u;
      }
      function finish(el, finalUrl) {
        try {
          const img = new AnimatedGifImage(el, object);
          img._gifUrl = finalUrl || rawUrl;
          img.gifUrl = finalUrl || rawUrl;
          img.src = finalUrl || rawUrl;
          img.isGif = true;
          img.isFallback = !!object.isFallback;
          img.objectCaching = false;
          img.dirty = true;
          if (object._oid != null) { img._oid = object._oid; try { img.set('_oid', object._oid); } catch (e) {} }
          callback && callback(img);
          try { if (typeof GifOverlay !== 'undefined') GifOverlay.scheduleSync(); } catch (e) {}
        } catch (e) {
          callback && callback(null);
        }
      }
      // v22: obyekt DARHOL yaratiladi — proxy kutilmaydi va URL hech qachon placeholder bilan
      // almashtirilmaydi (avval proxy xato bersa GIF yo'qolib, faqat ramka qolardi).
      const el = document.createElement('img');
      el.width = object.width || 300;
      el.height = object.height || 200;
      try { el.src = toLoadUrl(rawUrl); } catch (e) {}
      finish(el, rawUrl);
    };
    fabric.AnimatedGifImage = AnimatedGifImage;
    fabric.gifImage = AnimatedGifImage;
    fabric.GifImage = AnimatedGifImage;
    fabric.util.createClass && (fabric.Image.gifImage = AnimatedGifImage);
    try {
      if (fabric.util && typeof fabric.util.registerClass === 'function') {
        fabric.util.registerClass('gifImage', AnimatedGifImage);
      }
    } catch (e) {}
    const VideoImage = fabric.util.createClass(fabric.Image, {
      type: 'videoImage',
      objectCaching: false,
      _videoElement: null,
      _videoUrl: '',
      _videoLoop: true,
      _videoMuted: true,
      _videoAutoplay: true,
      initialize: function (element, options) {
        options = options || {};
        this.callSuper('initialize', element, options);
        this._videoElement = element || null;
        this._videoUrl = options.videoUrl || (element && element.src) || '';
        this._videoLoop = options.videoLoop !== false;
        this._videoMuted = options.videoMuted !== false;
        this._videoAutoplay = options.videoAutoplay !== false;
        this.isVideo = true;
        this.objectCaching = false;
      },
      _render: function (ctx) {
        const v = this._videoElement || this._element;
        if (v && v.readyState >= 2) {
          try {
            ctx.drawImage(v, -this.width / 2, -this.height / 2, this.width, this.height);
          } catch (e) {  }
        }
      },
      toObject: function (propertiesToInclude) {
        return fabric.util.object.extend(this.callSuper('toObject', propertiesToInclude), {
          videoUrl: this._videoUrl,
          videoLoop: this._videoLoop,
          videoMuted: this._videoMuted,
          videoAutoplay: this._videoAutoplay,
          isVideo: true,
        });
      },
    });
    VideoImage.async = true;
    VideoImage.fromObject = function (object, callback) {
      const url = object.videoUrl || object.src;
      if (!url) { callback && callback(null); return; }
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.src = url;
      v.loop = object.videoLoop !== false;
      v.muted = object.videoMuted !== false;
      v.playsInline = true;
      v.autoplay = object.videoAutoplay !== false;
      const ready = function () {
        const img = new VideoImage(v, object);
        img._videoUrl = url;
        img.isVideo = true;
        img.objectCaching = false;
        try { if (object.videoAutoplay !== false) v.play().catch(function () {}); } catch (e) {}
        callback && callback(img);
      };
      v.onloadeddata = ready;
      v.onerror = function () { callback && callback(null); };
      setTimeout(function () { if (v.readyState >= 2) ready(); }, 1500);
    };
    fabric.VideoImage = VideoImage;
    fabric.videoImage = VideoImage;
    try {
      fabric.util.registerClass && fabric.util.registerClass('gifImage', AnimatedGifImage);
      fabric.util.registerClass && fabric.util.registerClass('videoImage', VideoImage);
    } catch (e) {  }
    let _mediaRenderLoopStarted = false;
    function ensureMediaRenderLoop() {
      if (_mediaRenderLoopStarted) return;
      _mediaRenderLoopStarted = true;
      const tick = function () {
        let hasVideo = false;
        try {
          canvas.getObjects().forEach(function (o) {
            if (o && (o.isVideo || o.type === 'videoImage')) {
              hasVideo = true;
              o.dirty = true;
              o.objectCaching = false;
            }
          });
        } catch (e) {}
        if (hasVideo) {
          try { canvas.requestRenderAll(); } catch (e) {}
        }
        fabric.util.requestAnimFrame(tick);
      };
      fabric.util.requestAnimFrame(tick);
    }
    window.ensureMediaRenderLoop = ensureMediaRenderLoop;

    const MediaSkeleton = (function () {
      const MAX_RETRIES = 3;
      function isInstant(src) { return !src || /^(data|blob):/i.test(src); }
      function build(kind) {
        const d = document.createElement('div');
        d.className = 'media-skeleton shimmer ' + (kind === 'image' ? 'image-loading' : 'gif-loading');
        d.dataset.kind = kind || 'gif';
        d.innerHTML = '<div class="skeleton-spinner"></div><span class="skeleton-tag">' +
          (kind === 'image' ? 'RASM' : 'GIF') + '</span>';
        return d;
      }

      function attach(wrap, img, opts) {
        opts = opts || {};
        const kind = opts.kind || 'gif';
        let base = opts.src || img.getAttribute('src') || '';
        let sk = null;
        let tries = 0;
        let timer = null;
        function show() {
          if (isInstant(base)) { img.style.opacity = '1'; return; }
          clearTimeout(_wd);
          _wd = setTimeout(function () {
            if (sk && !(img.complete && img.naturalWidth)) { try { img.dispatchEvent(new Event('error')); } catch (e) {} }
          }, 20000);
          img.style.opacity = '0';
          img.style.transition = 'opacity 0.35s ease';
          if (!sk) { sk = build(kind); sk.classList.add('in-wrap'); wrap.insertBefore(sk, wrap.firstChild); }
          else { sk.className = 'media-skeleton shimmer in-wrap ' + (kind === 'image' ? 'image-loading' : 'gif-loading'); sk.style.opacity = '1';
                 if (!sk.querySelector('.skeleton-spinner')) sk.innerHTML = '<div class="skeleton-spinner"></div><span class="skeleton-tag">' + (kind === 'image' ? 'RASM' : 'GIF') + '</span>'; }
        }
        function done() {
          clearTimeout(timer);
          img.style.opacity = '1';
          if (sk) {
            const el = sk; sk = null;
            el.classList.add('done');
            setTimeout(() => { try { el.remove(); } catch (e) {} }, 320);
          }
        }
        let _wd = null;
        const _origDone = done;
        img.addEventListener('load', function () { clearTimeout(_wd); });
        img.addEventListener('load', done);
        img.addEventListener('error', () => {
          if (isInstant(base)) return;
          if (/^https?:\/\//i.test(base) && !img.dataset.viaProxy) {
            img.dataset.viaProxy = '1';
            clearTimeout(timer);
            tries = 0;
            base = '/api/proxy-image?raw=1&url=' + encodeURIComponent(base);
            img.src = base;
            return;
          }

          const isReal = /^(https?:|data:|blob:)/i.test(base) || /^\/api\/proxy-image/i.test(base);
          if (!isReal) {

            clearTimeout(timer);
            tries = MAX_RETRIES;
            if (sk) {
              sk.classList.remove('shimmer');
              sk.classList.add('retrying');
              sk.innerHTML = '<div class="skeleton-spinner"></div><span class="skeleton-tag">GIF</span>';
            }
            img.style.opacity = '0';
            if (kind === 'gif' && typeof ensureWorkingGif === 'function' && !img.dataset.recovering) {
              img.dataset.recovering = '1';
              const topic = String(base || '').replace(/[-_+/.?=&%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
              ensureWorkingGif('', topic || 'animation').then(function (got) {
                if (got && got.src) {
                  base = got.src.startsWith('data:') || got.src.startsWith('/api/')
                    ? got.src
                    : ('/api/proxy-image?raw=1&url=' + encodeURIComponent(got.src));
                  tries = 0;
                  img.dataset.recovering = '';
                  img.src = base;
                  show();
                } else if (sk) {
                  sk.classList.remove('shimmer', 'retrying');
                  sk.classList.add('failed');
                  sk.innerHTML = '<span class="skeleton-fail">⚠️ Yuklanmadi</span>';
                }
              }).catch(function () {
                if (sk) {
                  sk.classList.remove('shimmer', 'retrying');
                  sk.classList.add('failed');
                  sk.innerHTML = '<span class="skeleton-fail">⚠️ Yuklanmadi</span>';
                }
              });
            }
            return;
          }
          if (tries < MAX_RETRIES) {
            tries++;
            if (sk) sk.classList.add('retrying');
            timer = setTimeout(() => {

              if (/\/api\/proxy-image/i.test(base) || base.startsWith('data:')) {
                img.src = base;
              } else {
                img.src = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'retry=' + Date.now();
              }
            }, 1200 * tries);
          } else if (sk) {
            sk.classList.remove('shimmer');
            sk.classList.add('failed');
            sk.innerHTML = '<span class="skeleton-fail">⚠️ Yuklanmadi</span>';
            img.style.opacity = '0';
            if (kind === 'gif' && typeof ensureWorkingGif === 'function' && !img.dataset.recovering) {
              img.dataset.recovering = '1';
              ensureWorkingGif('', 'funny animation').then(function (got) {
                if (got && got.src) {
                  base = got.src.startsWith('data:') || got.src.startsWith('/api/')
                    ? got.src
                    : ('/api/proxy-image?raw=1&url=' + encodeURIComponent(got.src));
                  tries = 0;
                  img.dataset.recovering = '';
                  img.src = base;
                  show();
                }
              }).catch(function () {});
            }
          }
        });
        show();

        if (img.complete && img.naturalWidth) done();
        return {
          reset(newSrc) {
            base = newSrc || base; tries = 0; clearTimeout(timer); delete img.dataset.viaProxy; show();
            try { if (img.complete && img.naturalWidth && img.getAttribute('src') === base) done(); } catch (e) {}
          },
          done,
        };
      }

      function show(o) {
        o = o || {};
        const lyr = document.getElementById('gifOverlay');
        if (!lyr) return null;
        const d = build(o.kind === 'image' ? 'image' : 'gif');
        if (o.kind === 'bg') {
          d.classList.add('bg-live');
          d.querySelector('.skeleton-tag').textContent = 'FON';
        } else {
          const w = Math.max(60, Number(o.width) || 320);
          const h = Math.max(60, Number(o.height) || 220);
          d.style.left = (Number.isFinite(Number(o.left)) ? Number(o.left) : 60) + 'px';
          d.style.top = (Number.isFinite(Number(o.top)) ? Number(o.top) : 60) + 'px';
          d.style.width = w + 'px';
          d.style.height = h + 'px';
        }
        lyr.appendChild(d);
        let gone = false;
        const remove = () => {
          if (gone) return; gone = true;
          d.classList.add('done');
          setTimeout(() => { try { d.remove(); } catch (e) {} }, 250);
        };
        setTimeout(remove, 25000);
        return { remove };
      }
      return { attach, show };
    })();
    window.MediaSkeleton = MediaSkeleton;

    function preloadMedia(src, opts) {
      opts = opts || {};
      const isVideo = !!opts.isVideo || /\.(mp4|webm|ogg|mov)(\?|$)/i.test(String(src || ''));
      return new Promise((resolve, reject) => {
        if (!src) { reject(new Error('empty src')); return; }
        const timeout = setTimeout(() => {
          try { resolve({ src, el: null, w: opts.fallbackW || 300, h: opts.fallbackH || 200, timedOut: true }); } catch (e) {}
        }, opts.timeoutMs || 12000);
        if (isVideo) {
          const v = document.createElement('video');
          v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
          v.crossOrigin = 'anonymous';
          v.onloadeddata = () => {
            clearTimeout(timeout);
            resolve({ src, el: v, w: v.videoWidth || 640, h: v.videoHeight || 360, isVideo: true });
          };
          v.onerror = () => { clearTimeout(timeout); reject(new Error('video load failed')); };
          v.src = src;
          try { v.load(); } catch (e) {}
        } else {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.decoding = 'async';
          im.onload = () => {
            clearTimeout(timeout);

            const finish = () => resolve({ src, el: im, w: im.naturalWidth || 300, h: im.naturalHeight || 200, isVideo: false });
            if (typeof im.decode === 'function') {
              im.decode().then(finish).catch(finish);
            } else {
              finish();
            }
          };
          im.onerror = () => { clearTimeout(timeout); reject(new Error('image load failed')); };
          im.src = src;
        }
      });
    }
    window.preloadMedia = preloadMedia;
