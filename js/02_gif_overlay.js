    const GifOverlay = (function () {
      const items = new Map();
      let _layer = null;
      let _syncScheduled = false;
      function layer() {
        if (_layer && _layer.isConnected) return _layer;
        _layer = document.getElementById('gifOverlay');
        return _layer;
      }
      function applyTransform(entry) {
        const obj = entry.obj;
        if (!obj || !entry.el) return;
        const w = Math.max(1, (obj.width || 0) * (obj.scaleX || 1));
        const h = Math.max(1, (obj.height || 0) * (obj.scaleY || 1));

        let left = (typeof obj.left === 'number' && !isNaN(obj.left)) ? obj.left : 60;
        let top = (typeof obj.top === 'number' && !isNaN(obj.top)) ? obj.top : 60;
        const angle = obj.angle || 0;
        const flipX = obj.flipX ? -1 : 1;
        const flipY = obj.flipY ? -1 : 1;
        const originX = obj.originX || 'left';
        const originY = obj.originY || 'top';
        let ox = 0, oy = 0;
        if (originX === 'center') ox = 0.5;
        else if (originX === 'right') ox = 1;
        if (originY === 'center') oy = 0.5;
        else if (originY === 'bottom') oy = 1;
        entry.el.style.width = w + 'px';
        entry.el.style.height = h + 'px';
        entry.el.style.left = (left - w * ox) + 'px';
        entry.el.style.top = (top - h * oy) + 'px';
        entry.el.style.transformOrigin = (ox * 100) + '% ' + (oy * 100) + '%';
        entry.el.style.transform = 'rotate(' + angle + 'deg) scale(' + flipX + ',' + flipY + ')';
        entry.el.style.opacity = (obj.opacity != null ? obj.opacity : 1);
        entry.el.style.display = (obj.visible === false) ? 'none' : 'block';
        try {
          const rp = obj.mRadius || 0;
          entry.el.style.borderRadius = rp ? (rp + '% / ' + rp + '%') : '';
          entry.el.style.overflow = (rp || obj.mCrop) ? 'hidden' : '';
          if (typeof window.applyMediaInnerCrop === 'function') window.applyMediaInnerCrop(entry.img, obj);
        } catch (e) {}
        let _z = 1;
        try { const _ix = canvas.getObjects().indexOf(obj); _z = _ix >= 0 ? _ix + 1 : 1; } catch (e) {}
        entry.el.style.zIndex = String(obj.zIndex != null ? obj.zIndex : _z);
      }
      function isUsableGifUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const u = url.trim();
        if (!u) return false;
        if (u.startsWith('data:image/') || u.startsWith('blob:')) return true;
        if (u.startsWith('/api/proxy-image')) return true;
        if (/^https?:\/\//i.test(u)) return true;

        return false;
      }
      function toDisplayGifUrl(url) {
        if (!url || typeof url !== 'string') return '';
        const u = url.trim();
        if (!u) return '';
        if (u.startsWith('data:') || u.startsWith('blob:')) return u;
        if (u.startsWith('/api/proxy-image')) return u;
        // CDN lar CORS ruxsat beradi — proxy o'tkazmasdan to'g'ridan-to'g'ri (400 kamayadi)
        if (/^https?:\/\/(media\d*\.tenor\.com|c\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com|upload\.wikimedia\.org|[\w.-]*wikimedia\.org|[\w.-]*staticflickr\.com|i\.imgur\.com|cdn\.openverse\.org|api\.openverse\.org)\//i.test(u)) return u;
        if (/\.gif(\?|#|$)/i.test(u) && /^https?:\/\//i.test(u)) return u; // to'g'ridan GIF URL
        if (/^https?:\/\//i.test(u)) {
          return '/api/proxy-image?raw=1&url=' + encodeURIComponent(u);
        }
        return '';
      }
      function createEntry(obj, url) {
        const lyr = layer();
        if (!lyr || !obj) return null;
        const oid = obj._oid != null ? obj._oid : (obj._oid = nextObjectId());
        const rawUrl = url || obj.gifUrl || obj.src || '';
        let displayUrl = toDisplayGifUrl(rawUrl);

        if (!displayUrl) {
          displayUrl = (typeof GIF_PLACEHOLDER_URL !== 'undefined' ? GIF_PLACEHOLDER_URL : '');
        }
        let entry = items.get(oid);
        if (entry) {
          entry.obj = obj;
          if (displayUrl && entry.img && entry.img.getAttribute('data-raw-src') !== (rawUrl || '')) {
            entry.img.setAttribute('data-raw-src', rawUrl || '');
            try { if (entry.skel) entry.skel.reset(displayUrl); } catch (e) {}
            if (displayUrl) entry.img.src = displayUrl;
          }

          let badge = entry.el.querySelector('.gif-fallback-badge');
          if (obj.isFallback) {
            if (!badge) {
              badge = document.createElement('span');
              badge.className = 'gif-fallback-badge';
              badge.textContent = 'Zaxira';
              entry.el.appendChild(badge);
            }
          } else if (badge) {
            badge.remove();
          }
          applyTransform(entry);
          return entry;
        }
        const wrap = document.createElement('div');
        wrap.className = 'gif-overlay-item';
        wrap.dataset.oid = String(oid);
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.loading = 'eager';
        img.setAttribute('data-raw-src', rawUrl || '');
        wrap.appendChild(img);
        const skel = MediaSkeleton.attach(wrap, img, { kind: 'gif', src: displayUrl || '' });
        img.addEventListener('error', function () {
          // v24: to'g'ridan-to'g'ri yuklanmasa — proxy orqali BIR marta urinib ko'ramiz (retry-storm yo'q)
          if (img.dataset.proxied === '1') return;
          const raw = img.getAttribute('data-raw-src') || '';
          if (/^https?:\/\//i.test(raw) && img.src.indexOf('/api/proxy-image') < 0) {
            img.dataset.proxied = '1';
            img.src = '/api/proxy-image?raw=1&url=' + encodeURIComponent(raw);
          }
        });
        if (displayUrl) img.src = displayUrl;

        if (!isUsableGifUrl(rawUrl) && typeof ensureWorkingGif === 'function') {
          const topic = String(rawUrl || '').replace(/[-_+/]/g, ' ').trim().slice(0, 60) || 'animation';
          ensureWorkingGif('', topic).then(function (got) {
            if (!got || !got.src) return;
            const good = toDisplayGifUrl(got.src) || got.src;
            try {
              obj.gifUrl = got.src;
              obj.src = got.src;
              obj.isFallback = !!got.isFallback;
              obj._loading = false;
            } catch (e) {}
            try { if (skel) skel.reset(good); } catch (e) {}
            img.src = good;
            img.setAttribute('data-raw-src', got.src);
            if (got.isFallback) {
              let badge = wrap.querySelector('.gif-fallback-badge');
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'gif-fallback-badge';
                badge.textContent = 'Zaxira';
                wrap.appendChild(badge);
              }
            }
          }).catch(function () {});
        }
        if (obj.isFallback) {
          const badge = document.createElement('span');
          badge.className = 'gif-fallback-badge';
          badge.textContent = 'Zaxira';
          wrap.appendChild(badge);
        }
        lyr.appendChild(wrap);
        entry = { el: wrap, img: img, obj: obj, skel: skel };
        items.set(oid, entry);
        applyTransform(entry);
        return entry;
      }
      function removeEntry(oid) {
        const entry = items.get(oid);
        if (!entry) return;
        try { if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el); } catch (e) {}
        items.delete(oid);
      }
      function clear() {
        items.forEach((entry) => {
          try { if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el); } catch (e) {}
        });
        items.clear();
        const lyr = layer();
        if (lyr) {

          try { lyr.innerHTML = ''; } catch (e) {}
        }
      }
      function sync() {
        const lyr = layer();
        if (!lyr) return;
        if (window.GIF_NATIVE_RENDER !== false) {
          // v28: GIF kanvas ichida chiziladi — DOM qatlam kerak emas
          if (items.size || lyr.firstChild) { try { clear(); } catch (e) {} }
          return;
        }
        const seen = new Set();
        const liveOids = new Set();
        try {
          canvas.getObjects().forEach((o) => {
            if (!o) return;
            const isGif = o.isGif || o.type === 'gifImage';
            if (!isGif) return;

            if (o.visible === false) return;
            const oid = o._oid != null ? o._oid : (o._oid = nextObjectId());
            liveOids.add(oid);
            seen.add(oid);
            const url = o.gifUrl || o._gifUrl || o.src || '';
            if (!url) return;
            createEntry(o, url);
          });
        } catch (e) {}

        Array.from(items.keys()).forEach((oid) => {
          if (!seen.has(oid)) removeEntry(oid);
        });

        try {
          Array.from(lyr.querySelectorAll('.gif-overlay-item')).forEach((node) => {
            const oid = node.dataset && node.dataset.oid;
            if (!oid || !liveOids.has(Number(oid)) && !liveOids.has(oid)) {
              try { node.remove(); } catch (e) {}
            }
          });
        } catch (e) {}
      }
      function scheduleSync() {
        if (_syncScheduled) return;
        _syncScheduled = true;
        requestAnimationFrame(() => {
          _syncScheduled = false;
          sync();
        });
      }
      function updateObject(obj) {
        if (!obj) return;
        const oid = obj._oid;
        if (oid == null) return;
        const entry = items.get(oid);
        if (entry) applyTransform(entry);
      }
      function hasItems() { return window.GIF_NATIVE_RENDER === false && items.size > 0; }
      return { sync, scheduleSync, updateObject, removeEntry, clear, hasItems, layer };
    })();
    window.GifOverlay = GifOverlay;
    const GifBackground = (function () {
      let _img = null;
      let _currentUrl = '';
      function layer() {
        return document.getElementById('gifBgOverlay');
      }
      function applyFromSlide(slideJson) {
        const lyr = layer();
        if (!lyr) return;
        let parsed = {};
        try { parsed = JSON.parse(slideJson || '{}'); } catch (e) { parsed = {}; }
        const bgGif = parsed.backgroundGif;
        const url = (bgGif && (bgGif.src || bgGif.url)) || '';
        if (!url) {
          clear();
          return;
        }

        if (_currentUrl === url && _img && _img.parentNode === lyr && _img.getAttribute('src')) {
          lyr.style.display = 'block';
          lyr.style.opacity = '1';
          try {
            const card = document.getElementById('canvasCard');
            if (card) card.classList.add('has-gif-bg');
            if (canvas) {
              canvas.backgroundColor = 'rgba(0,0,0,0)';
              canvas.setBackgroundImage(null, function () { canvas.requestRenderAll(); });
            }
          } catch (e) {}
          return;
        }
        _currentUrl = url;
        lyr.innerHTML = '';
        lyr.style.display = 'block';
        lyr.style.opacity = '1';
        _img = document.createElement('img');
        _img.alt = '';
        _img.decoding = 'async';
        _img.onload = function () {
          try {
            const card = document.getElementById('canvasCard');
            if (card) card.classList.add('has-gif-bg');
          } catch (e) {}
          try {
            if (canvas) {
              canvas.backgroundColor = 'rgba(0,0,0,0)';
              canvas.setBackgroundImage(null, function () {
                canvas.requestRenderAll();
              });
            }
          } catch (e) {}
        };
        const _isHttp = /^https?:\/\//i.test(url);
        const _bgSrc = (_isHttp
          ? ('/api/proxy-image?raw=1&url=' + encodeURIComponent(url))
          : url);
        const _chain = _isHttp
          ? [_bgSrc + '&_r=' + Date.now(), url]
          : [];
        let _step = 0;
        _img.onerror = function () {
          if (_currentUrl !== url) return;
          if (_step < _chain.length) {
            const nxt = _chain[_step++];
            setTimeout(function () {
              if (_currentUrl === url && _img) _img.src = nxt;
            }, 350 * _step);
            return;
          }
          let solid = '#ffffff';
          try {
            if (parsed && typeof parsed.background === 'string' && parsed.background && parsed.background !== 'transparent') solid = parsed.background;
          } catch (e) {}
          try {
            const card = document.getElementById('canvasCard');
            if (card) card.classList.remove('has-gif-bg');
            lyr.innerHTML = '';
            lyr.style.display = 'none';
            _currentUrl = '';
            _img = null;
            if (canvas) {
              canvas.backgroundColor = (/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(solid)) ? '#ffffff' : solid;
              canvas.requestRenderAll();
            }
          } catch (e) {}
        };
        lyr.appendChild(_img);
        try { MediaSkeleton.attach(lyr, _img, { kind: 'gif', src: _bgSrc }); } catch (e) {}
        _img.src = _bgSrc;

        try {
          const card = document.getElementById('canvasCard');
          if (card) card.classList.add('has-gif-bg');
          if (canvas) {
            canvas.backgroundColor = 'rgba(0,0,0,0)';
            canvas.setBackgroundImage(null, function () {
              canvas.requestRenderAll();
            });
          }
        } catch (e) {}
      }
      function clear() {
        _currentUrl = '';
        _img = null;
        const lyr = layer();
        if (lyr) { lyr.innerHTML = ''; }
        try {
          const card = document.getElementById('canvasCard');
          if (card) card.classList.remove('has-gif-bg');
        } catch (e) {}
      }
      function hasGif() { return !!_currentUrl; }
      function currentUrl() { return _currentUrl || ''; }
      return { applyFromSlide, clear, hasGif, currentUrl, layer };
    })();
    window.GifBackground = GifBackground;
    const SNAP_MARGIN = 10;
    const guideV = document.getElementById('guideV');
    const guideH = document.getElementById('guideH');

    try {
      if (window.Swal && !window._swalDefaultsSet) {
        window._swalDefaultsSet = true;
        const _origFire = Swal.fire.bind(Swal);
        Swal.fire = function(opts) {
          if (opts && typeof opts === 'object') {
            if (opts.heightAuto === undefined) opts.heightAuto = false;
            if (opts.scrollbarPadding === undefined) opts.scrollbarPadding = false;
          }
          return _origFire(opts);
        };
      }
    } catch (e) {}

    let _loadingHidden = false;
    function hideLoading() {
      if (_loadingHidden) return;
      _loadingHidden = true;
      const overlay = document.getElementById('loadingOverlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      overlay.style.opacity = '0';
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => {
        if (overlay && overlay.parentNode) overlay.style.display = 'none';
      }, 420);
    }
    window.hideLoading = hideLoading;
