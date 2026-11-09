    window.resolveGifDirectUrl = resolveGifDirectUrl;

    async function loadGifWithFallback(url) {
      url = sanitizeImageUrl(url);
      if (!url) return null;

      if (!/^https?:\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('/api/proxy-image') && !url.startsWith('blob:')) {
        return null;
      }
      const probe = (src) => withTimeout(new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve({ src, w: im.naturalWidth || 300, h: im.naturalHeight || 200 });
        im.onerror = () => resolve(null);
        im.src = src;
      }), 10000, null);
      if (url.startsWith('data:image/') || url.startsWith('/api/proxy-image') || url.startsWith('blob:')) {
        return await probe(url);
      }
      const raw = '/api/proxy-image?raw=1&url=' + encodeURIComponent(url);
      let r = null;
      if (/^https?:\/\/(media\d*\.tenor\.com|c\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com)\//i.test(url)) {
        r = await probe(url);
        if (r) return r;
      }
      r = await probe(raw);
      if (r) return r;
      r = await probe(raw + '&_r=' + Date.now());
      if (r) return r;
      try {
        const res = await fetch('/api/proxy-image?url=' + encodeURIComponent(url));
        const data = await res.json().catch(() => null);
        if (data && typeof data.data_url === 'string' && data.data_url.startsWith('data:image/')) {
          r = await probe(data.data_url);
          if (r) return r;
        }
      } catch (e) {  }
      // v36: server proksi (429 va h.k.) yordam bermasa — brauzer GIF ni to'g'ridan-to'g'ri o'zi oladi
      try {
        const dres = await withTimeout(fetch(url, { mode: 'cors' }), 15000, null);
        if (dres && dres.ok) {
          const blob = await dres.blob();
          const du = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(blob); });
          if (typeof du === 'string' && du.startsWith('data:image/')) { r = await probe(du); if (r) return r; }
        }
      } catch (e) {  }
      r = await probe(url);
      if (r) return r;
      return null;
    }
    window.loadGifWithFallback = loadGifWithFallback;

    function urlLooksLikeGif(u) {
      if (!u || typeof u !== 'string') return false;
      if (/^data:image\/gif/i.test(u)) return true;
      if (/\.gif(\?|#|$)/i.test(u)) return true;
      if (/media\.tenor\.com|c\.tenor\.com|media\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com|giphy\.com\/media/i.test(u)) return true;
      if (/\/api\/proxy-image/i.test(u) && /[?&]url=.*\.gif/i.test(u)) return true;
      return false;
    }
    window.urlLooksLikeGif = urlLooksLikeGif;

    const GIF_EMBEDDED_DATA =
      'data:image/gif;base64,R0lGODlhIAAgAPIFAAAAAP8AAP8A/wD/AP//AAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAFACwAAAAAIAAgAAADQVi63P4wykmrvTjrzbv/YCiOZGmeaKqubOu+cCxPdG3feK7vfO//wKBwSCwaj8ikcslsOp/QqHRKrVqv2Kz2y+1yhQAAOw==';

    const GIF_SAFE_POOL = [
      'https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif',
      'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
      'https://media.giphy.com/media/26BRv0ThxKQihlNO0/giphy.gif',
      'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
      'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif',
      'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
      'https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif',
      'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif',
    ];
    const GIF_PLACEHOLDER_URL = GIF_EMBEDDED_DATA;
    window.GIF_PLACEHOLDER_URL = GIF_PLACEHOLDER_URL;

    async function searchTenorGifs(query, limit) {
      const q = (query || 'animation').trim() || 'animation';
      const lim = limit || 8;
      try {
        const res = await fetch('/api/media-search?provider=tenor&q=' + encodeURIComponent(q) + '&limit=' + lim);
        if (!res.ok) return [];
        const data = await res.json();
        const results = (data && data.results) || [];
        return results
          .map((r) => r && r.url)
          .filter((u) => u && (/\.gif(\?|#|$)/i.test(u) || /media\.tenor\.com|c\.tenor\.com|giphy\.com/i.test(u)));
      } catch (e) {
        console.warn('searchTenorGifs:', e);
        return [];
      }
    }

    function beginMediaPlaceholder(cmd) {
      try {
        const a = cmd.action;
        const dest = (cmd.target_slide || cmd.slide || 1) - 1;
        if (dest !== activeIndex) return null;
        const url = String(cmd.url || cmd.src || '');
        if (a === 'add_gif') {
          return MediaSkeleton.show({ kind: 'gif', left: cmd.left, top: cmd.top, width: cmd.width, height: cmd.height });
        }
        if ((a === 'add_image' || a === 'place_image_url') && url && !/^(data|blob):/i.test(url)) {
          const isGifUrl = cmd.isGif === true || cmd.is_gif === true || /\.gif(\?|#|$)/i.test(url) ||
            /media\.tenor\.com|c\.tenor\.com|giphy\.com/i.test(url);
          return MediaSkeleton.show({ kind: isGifUrl ? 'gif' : 'image', left: cmd.left, top: cmd.top, width: cmd.width, height: cmd.height });
        }
        if ((a === 'set_background_url' || a === 'set_background') && /^https?:/i.test(url)) {
          return MediaSkeleton.show({ kind: 'bg' });
        }
      } catch (e) {  }
      return null;
    }

    function placeGifImmediate(dest, cmd, gifUrl, num, oid) {
      dest = parseInt(dest, 10);
      if (isNaN(dest) || dest < 0) dest = 0;

      while (slides.length <= dest) {
        slides.push({
          json: JSON.stringify({ objects: [], background: '#ffffff' }),
          thumb: '',
          imageNumbers: [],
        });
      }
      if (!slides[dest]) {
        console.warn('placeGifImmediate: slides[' + dest + '] still missing');
        return null;
      }
      const nw = 300, nh = 200;
      let w = cmd.width || 300;
      let h = cmd.height || Math.round(w * (nh / nw));

      const _rawGif = String(gifUrl || '').trim();
      const _isRealGif = /^(https?:|data:|blob:|\/api\/proxy-image)/i.test(_rawGif);
      const provisional = _isRealGif
        ? _rawGif
        : (typeof GIF_PLACEHOLDER_URL !== 'undefined' ? GIF_PLACEHOLDER_URL : '');
      const gifEl = {
        type: 'gifImage', src: provisional, gifUrl: provisional, isGif: true,
        left: cmd.left != null ? cmd.left : 60, top: cmd.top != null ? cmd.top : 60,
        width: nw, height: nh,
        scaleX: w / nw, scaleY: h / nh,
        imageNumber: num, imageHash: 'gif_' + num, _oid: oid,
        objectCaching: false,
        isFallback: false,
        _loading: true,
        _topicHint: (!_isRealGif && _rawGif) ? _rawGif : '',
      };
      try {
        const parsedG = JSON.parse(slides[dest].json || '{}');
        parsedG.objects = parsedG.objects || [];
        parsedG.objects.push(gifEl);
        slides[dest].json = JSON.stringify(parsedG);
        slides[dest].imageNumbers = slides[dest].imageNumbers || [];
        if (num != null && !slides[dest].imageNumbers.includes(num)) slides[dest].imageNumbers.push(num);
      } catch (e) { console.warn('placeGifImmediate json:', e); }

      try { refreshSlideThumb(dest); } catch (e) {}
      if (dest === activeIndex) {
        try {

          Promise.resolve(parseElementToFabric(gifEl)).then(function (el) {
            if (el) {
              try { canvas.add(el); canvas.requestRenderAll(); GifOverlay.scheduleSync(); } catch (e2) {}
            }
          }).catch(function () {});
        } catch (e) {}
      }

      const originalUrl = _isRealGif ? _rawGif : '';
      const topicHint = String(
        (cmd && (cmd.topic || cmd.query || cmd.q || cmd.description || cmd.alt || cmd.label))
        || (!_isRealGif ? _rawGif : '')
        || ''
      ).trim().replace(/[-_+/]/g, ' ').slice(0, 80);
      (async function () {
        let loaded = null;
        try { loaded = await ensureWorkingGif(originalUrl, topicHint); } catch (e) {}

        if (!loaded || !loaded.src) {
          try {
            const retry = await ensureWorkingGif('', topicHint || 'funny animation');
            if (retry && retry.src) loaded = retry;
          } catch (e2) {}
        }

        if (!loaded || !loaded.src) {
          try {
            for (const safe of (typeof GIF_SAFE_POOL !== 'undefined' ? GIF_SAFE_POOL : [])) {
              const r = await loadGifWithFallback(safe);
              if (r && r.src) { loaded = { src: r.src, w: r.w, h: r.h, isFallback: true }; break; }
            }
          } catch (e3) {}
        }
        if (!loaded || !loaded.src) {
          try { setMediaSearchStatus(null); } catch (e2) {}
          try {
            for (let si = 0; si < slides.length; si++) {
              const pj = JSON.parse(slides[si].json || '{}');
              const before = (pj.objects || []).length;
              pj.objects = (pj.objects || []).filter(function (o) { return !(o && o._oid === oid); });
              if (pj.objects.length !== before) {
                slides[si].json = JSON.stringify(pj);
                if (si === activeIndex) {
                  const co = canvas.getObjects().find(function (c) { return c && c._oid === oid; });
                  if (co) { canvas.remove(co); canvas.requestRenderAll(); }
                  try { GifOverlay.removeEntry(oid); } catch (e5) {}
                }
                try { refreshSlideThumb(si); } catch (e6) {}
              }
            }
            showToast('GIF yuklanmadi — olib tashlandi', 'error');
          } catch (e4) {}
          return;
        }
        try {
          let _d = dest;
          const _hasOid = function (si) {
            try {
              return slides[si] && (JSON.parse(slides[si].json || '{}').objects || []).some(function (o) { return o && o._oid === oid; });
            } catch (e) { return false; }
          };
          if (!_hasOid(_d)) {
            _d = -1;
            for (let si = 0; si < slides.length; si++) { if (_hasOid(si)) { _d = si; break; } }
          }
          if (_d < 0) return;
          dest = _d;
          const parsed = JSON.parse(slides[dest].json || '{}');
          const objs = parsed.objects || [];
          const idx = objs.findIndex(function (o) { return o && o._oid === oid; });
          if (idx < 0) return;
          const o = objs[idx];
          const realW = loaded.w || 300;
          const realH = loaded.h || 200;
          const dispW = cmd.width || (realW > 400 ? 400 : realW);
          const dispH = cmd.height || Math.round(dispW * (realH / realW));
          o.src = loaded.src;
          o.gifUrl = loaded.src;
          o.width = realW;
          o.height = realH;
          o.scaleX = dispW / realW;
          o.scaleY = dispH / realH;
          o.isFallback = !!loaded.isFallback;
          o._loading = false;
          slides[dest].json = JSON.stringify(parsed);
          try { refreshSlideThumb(dest); } catch (e) {}
          if (dest === activeIndex) {
            try {
              const canvasObj = canvas.getObjects().find(function (c) { return c && c._oid === oid; });
              if (canvasObj) {
                canvasObj.set({
                  gifUrl: loaded.src,
                  src: loaded.src,
                  width: realW,
                  height: realH,
                  scaleX: dispW / realW,
                  scaleY: dispH / realH,
                  isFallback: !!loaded.isFallback,
                });
                if (canvasObj._gifElement) {
                  const ds = (/^https?:\/\//i.test(loaded.src) && !String(loaded.src).startsWith(window.location.origin))
                    ? ('/api/proxy-image?raw=1&url=' + encodeURIComponent(loaded.src))
                    : loaded.src;
                  canvasObj._gifElement.src = ds;
                }
                canvas.requestRenderAll();
                try { GifOverlay.scheduleSync(); } catch (e3) {}
              } else {

                const el2 = await parseElementToFabric(o);
                if (el2) { canvas.add(el2); canvas.requestRenderAll(); try { GifOverlay.scheduleSync(); } catch (e4) {} }
              }
            } catch (e) {}
          }
        } catch (e) { console.warn('placeGifImmediate upgrade:', e); }
      })();
      return gifEl;
    }
    window.placeGifImmediate = placeGifImmediate;

    function setMediaSearchStatus(msg) {
      try {
        let el = document.getElementById('mediaSearchStatus');
        if (!msg) {
          if (el) { el.classList.remove('active'); el.textContent = ''; }
          return;
        }
        if (!el) {
          el = document.createElement('div');
          el.id = 'mediaSearchStatus';
          el.className = 'media-search-status';
          document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('active');
      } catch (_) {}
    }
    window.setMediaSearchStatus = setMediaSearchStatus;

    async function ensureWorkingGif(rawUrl, topicHint) {
      const tryLoad = async (u) => {
        if (!u) return null;
        if (/tenor\.com\/view\/|giphy\.com\/gifs\/|gph\.is\//i.test(u)) return null;
        try {
          const r = await loadGifWithFallback(u);
          if (r && r.src) return { src: r.src, w: r.w || 300, h: r.h || 200, isFallback: false };
        } catch (e) {}
        return null;
      };

      let url = '';
      let fromQueryText = '';
      try {
        const raw = String(rawUrl || '').trim();
        if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('/api/proxy-image') || raw.startsWith('blob:')) {
          url = sanitizeImageUrl(raw) || raw;
        } else if (raw) {

          fromQueryText = decodeURIComponent(raw.replace(/\+/g, ' '))
            .replace(/[-_]+/g, ' ')
            .replace(/\.\w{2,4}$/i, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
        }
      } catch (e) {
        url = sanitizeImageUrl(rawUrl) || '';
      }
      let got = null;
      setMediaSearchStatus('Internetdan media qidirilmoqda…');

      try {

      if (url && (/\.gif(\?|#|$)/i.test(url) || /media\.tenor\.com|c\.tenor\.com|media\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com/i.test(url))) {
        got = await tryLoad(url);
        if (got) { setMediaSearchStatus(null); return got; }
      }

      if (url && /^https?:\/\//i.test(url)) {
        try {
          setMediaSearchStatus('GIF havolasi aniqlanmoqda…');
          const resolved = await resolveGifDirectUrl(url);
          if (resolved) {
            got = await tryLoad(resolved);
            if (got) { setMediaSearchStatus(null); return got; }
          }
        } catch (e) {}
      }

      setMediaSearchStatus('Tenor/Giphy dan qidirilmoqda…');
      const queries = [];
      const hint = (topicHint || '').trim();
      if (fromQueryText) queries.push(fromQueryText);
      if (hint) queries.push(hint);
      if (url) {
        try {
          const m = url.match(/tenor\.com\/view\/([^/?#]+)/i) || url.match(/giphy\.com\/gifs\/([^/?#]+)/i);
          if (m) {
            const fromPath = decodeURIComponent(m[1]).replace(/-gif-\d+$/i, '').replace(/[-_]+/g, ' ').trim();
            if (fromPath) queries.push(fromPath);
          }
          const seg = url.match(/\/([^/?#]+)(?:\?|#|$)/);
          if (seg) {
            const s = decodeURIComponent(seg[1]).replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim();
            if (s && s.length > 2 && s.length < 60 && !/^https?:/i.test(s)) queries.push(s);
          }
        } catch (e) {}
      }

      if (fromQueryText) {
        const words = fromQueryText.split(/\s+/).filter(Boolean);
        if (words.length > 2) queries.push(words.slice(0, 2).join(' '));
        if (words.length > 1) queries.push(words[0]);
      }
      queries.push('funny animation', 'nature', 'happy', 'animation');
      const seenQ = new Set();
      const uniqQ = [];
      for (const q of queries) {
        const k = String(q || '').toLowerCase().trim();
        if (k && !seenQ.has(k)) { seenQ.add(k); uniqQ.push(q); }
      }

      for (const q of uniqQ.slice(0, 6)) {
        setMediaSearchStatus('Qidiruv: «' + String(q).slice(0, 28) + '»…');
        let urls = await searchTenorGifs(q, 8);
        if (!urls.length) {

          try {
            const res = await fetch('/api/media-search?provider=giphy&q=' + encodeURIComponent(q) + '&limit=8');
            if (res.ok) {
              const data = await res.json();
              urls = ((data && data.results) || []).map((r) => r && r.url).filter(Boolean);
            }
          } catch (e) {}
        }
        for (const u of urls.slice(0, 5)) {
          got = await tryLoad(u);
          if (got) {
            got.isFallback = false;
            setMediaSearchStatus(null);
            return got;
          }
        }
      }

      for (const safe of GIF_SAFE_POOL) {
        got = await tryLoad(safe);
        if (got) {
          got.isFallback = true;
          setMediaSearchStatus(null);
          return got;
        }
      }

      setMediaSearchStatus(null);
      return { src: GIF_EMBEDDED_DATA, w: 32, h: 32, isFallback: true };
      } catch (err) {
        setMediaSearchStatus(null);
        throw err;
      } finally {
        setMediaSearchStatus(null);
      }
    }
    window.ensureWorkingGif = ensureWorkingGif;

    async function rasterizeDataUrl(dataUrl) {
      return new Promise((resolve) => {
        try {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.onload = () => {
            try {
              const c = document.createElement('canvas');
              c.width = im.naturalWidth || im.width;
              c.height = im.naturalHeight || im.height;
              const ctx = c.getContext('2d');
              ctx.drawImage(im, 0, 0);
              resolve(c.toDataURL('image/png'));
            } catch (e) { resolve(dataUrl); }
          };
          im.onerror = () => resolve(dataUrl);
          im.src = dataUrl;
        } catch (e) { resolve(dataUrl); }
      });
    }
    async function buildImageElementFromUrl(url, oid, cmd) {
      url = sanitizeImageUrl(url);
      const safeUrl = await resolveRemoteToDataUrl(url);
      return withTimeout(new Promise((resolve) => {
        const onDone = (img) => {
          if (!img || !img.width) return resolve(null);
          const nw = img.width || 1;
          const nh = img.height || 1;
          let w = cmd.width || (nw > 400 ? 400 : nw);
          let h = cmd.height || Math.round(w * (nh / nw));
          const maxW = 900, maxH = 500;
          if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
          if (h > maxH) { w = Math.round(w * (maxH / h)); h = maxH; }
          resolve({
            type: 'image', src: safeUrl,
            left: cmd.left ?? 60, top: cmd.top ?? 60,
            width: nw, height: nh,
            scaleX: w / nw, scaleY: h / nh,
            _oid: oid,
          });
        };
        try {
          fabric.Image.fromURL(safeUrl, onDone, { crossOrigin: 'anonymous' });
        } catch (e) {
          console.warn("buildImageElementFromUrl xatoligi:", e);
          resolve(null);
        }
      }), 6000, null);
    }

    let _sidebarRenderTimer = null;
    function scheduleSidebarRender(delay) {
      if (_sidebarRenderTimer) clearTimeout(_sidebarRenderTimer);
      _sidebarRenderTimer = setTimeout(() => {
        _sidebarRenderTimer = null;
        try { renderSidebar(); } catch (e) {  }
      }, typeof delay === 'number' ? delay : 60);
    }
    window.scheduleSidebarRender = scheduleSidebarRender;

    function refreshSlideThumb(slideIndex) {
      return new Promise((resolve) => {
        const s = slides[slideIndex];
        if (!s) return resolve();
        let tCanvas = null;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          try { if (tCanvas) tCanvas.dispose(); } catch (e) {  }
          scheduleSidebarRender();
          resolve();
        };
        try {
          const tmp = document.createElement('canvas');
          tmp.width = 960; tmp.height = 540;
          let parsed = {};
          try { parsed = JSON.parse(s.json || '{}'); } catch (e) {}
          const hasBgGif = !!(parsed.backgroundGif && (parsed.backgroundGif.src || parsed.backgroundGif.url));
          const bgColor = parsed.background || parsed.backgroundColor || '#ffffff';

          tCanvas = new fabric.Canvas(tmp, {
            backgroundColor: hasBgGif ? 'rgba(0,0,0,0)' : bgColor,
            enableRetinaScaling: false
          });
          const finishRender = () => {
            if (finished) return;
            try {
              tCanvas.getObjects().forEach((o) => o.set({ objectCaching: false }));
              tCanvas.renderAll();

              s.thumb = safeToDataURL(tCanvas, { format: 'png', multiplier: 0.35 });
            } catch (e) {
              console.warn("refreshSlideThumb render xatoligi:", e);
            }
            done();
          };
          const toProxy = (url) => {
            if (!url || typeof url !== 'string') return url;
            if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) return url;
            if (/^https?:\/\//i.test(url)) return '/api/proxy-image?raw=1&url=' + encodeURIComponent(url);
            return url;
          };

          const loadGifFrame = (url, geom) => new Promise((res) => {
            if (!url) return res(null);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const to = setTimeout(() => res(null), 2000);
            img.onload = () => {
              clearTimeout(to);
              try {
                const f = new fabric.Image(img, {
                  left: geom.left || 0, top: geom.top || 0,
                  originX: geom.originX || 'left', originY: geom.originY || 'top',
                  scaleX: geom.scaleX != null ? geom.scaleX : (geom.width ? geom.width / (img.naturalWidth || 1) : 1),
                  scaleY: geom.scaleY != null ? geom.scaleY : (geom.height ? geom.height / (img.naturalHeight || 1) : 1),
                  angle: geom.angle || 0, opacity: geom.opacity != null ? geom.opacity : 1,
                  selectable: false, evented: false
                });
                res(f);
              } catch (e) { res(null); }
            };
            img.onerror = () => { clearTimeout(to); res(null); };
            img.src = toProxy(url);
          });
          tCanvas.loadFromJSON(s.json, async () => {
            applyBackgroundToCanvas(tCanvas, parsed, async () => {
              try {

                if (hasBgGif) {
                  try {
                    tCanvas.setBackgroundColor('rgba(0,0,0,0)', () => {});
                    tCanvas.setBackgroundImage(null, () => {});
                  } catch (e) {}
                  const bgUrl = parsed.backgroundGif.src || parsed.backgroundGif.url;
                  const bgF = await loadGifFrame(bgUrl, {
                    left: 0, top: 0, originX: 'left', originY: 'top'
                  });
                  if (bgF) {
                    const el = bgF.getElement && bgF.getElement();
                    const nw = (el && (el.naturalWidth || el.width)) || 960;
                    const nh = (el && (el.naturalHeight || el.height)) || 540;
                    bgF.set({ scaleX: 960 / nw, scaleY: 540 / nh });
                    tCanvas.add(bgF);
                    tCanvas.sendToBack(bgF);
                  }
                }

                if (!hasBgGif && parsed.backgroundVideo && parsed.backgroundVideo.url) {
                  try {
                    tCanvas.setBackgroundColor('#f1f5f9', () => {});
                    const purl = window.ssVideoPoster ? await window.ssVideoPoster(parsed.backgroundVideo.url) : null;
                    const pf = purl ? await loadGifFrame(purl, { left: 0, top: 0 }) : null;
                    if (pf) {
                      const pel = pf.getElement && pf.getElement();
                      const pw = (pel && (pel.naturalWidth || pel.width)) || 960;
                      const ph = (pel && (pel.naturalHeight || pel.height)) || 540;
                      const k = Math.max(960 / pw, 540 / ph);
                      pf.set({ scaleX: k, scaleY: k, left: (960 - pw * k) / 2, top: (540 - ph * k) / 2 });
                      tCanvas.add(pf);
                      tCanvas.sendToBack(pf);
                    }
                  } catch (e) { console.warn('thumb bg video:', e); }
                }

                const gifObjs = (parsed.objects || []).filter(o => o && (o.isGif || o.type === 'gifImage' || (o.gifUrl || '').endsWith('.gif')));
                for (const g of gifObjs) {
                  const url = g.gifUrl || g.src;
                  if (!url) continue;
                  const w = (g.width || 100) * (g.scaleX != null ? g.scaleX : 1);
                  const h = (g.height || 100) * (g.scaleY != null ? g.scaleY : 1);
                  const frame = await loadGifFrame(url, {
                    left: g.left || 0, top: g.top || 0,
                    originX: g.originX || 'left', originY: g.originY || 'top',
                    width: w, height: h, angle: g.angle || 0, opacity: g.opacity
                  });
                  if (frame) tCanvas.add(frame);
                }
              } catch (e) { console.warn('thumb gif frames:', e); }
              finishRender();
            });
          });

          setTimeout(() => { if (!finished) finishRender(); }, 3000);
        } catch (e) {
          console.warn("refreshSlideThumb xatoligi:", e);
          done();
        }
      });
    }
    function repairAndParseJson(rawStr) {
      if (rawStr == null) return null;
      let s = String(rawStr).trim();
      if (!s) return null;
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      try { return JSON.parse(s); } catch (e) {  }
      let fixed = s
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      try { return JSON.parse(fixed); } catch (e) {  }
      try {
        let inStr = false, esc = false;
        const stack = [];
        for (let i = 0; i < fixed.length; i++) {
          const ch = fixed[i];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') { inStr = true; continue; }
          if (ch === '{' || ch === '[') stack.push(ch);
          else if (ch === '}' || ch === ']') stack.pop();
        }
        let patched = fixed;
        if (inStr) patched += '"';
        patched = patched.replace(/,\s*$/, '');
        while (stack.length) {
          const open = stack.pop();
          patched += (open === '{') ? '}' : ']';
        }
        return JSON.parse(patched);
      } catch (e) {  }
      try {
        const arrKey = s.indexOf('"actions"');
        if (arrKey !== -1) {
          const bracketStart = s.indexOf('[', arrKey);
          if (bracketStart !== -1) {
            const objs = [];
            let depth = 0, objStart = -1, inStr = false, esc = false;
            for (let i = bracketStart + 1; i < s.length; i++) {
              const ch = s[i];
              if (inStr) {
                if (esc) esc = false;
                else if (ch === '\\') esc = true;
                else if (ch === '"') inStr = false;
                continue;
              }
              if (ch === '"') { inStr = true; continue; }
              if (ch === '{') { if (depth === 0) objStart = i; depth++; }
              else if (ch === '}') {
                depth--;
                if (depth === 0 && objStart !== -1) {
                  try { objs.push(JSON.parse(s.slice(objStart, i + 1))); } catch (e) {  }
                  objStart = -1;
                }
              } else if (ch === ']' && depth === 0) break;
            }
            if (objs.length) {
              let reply = '';
              const rtMatch = s.match(/"reply_text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
              if (rtMatch) { try { reply = JSON.parse('"' + rtMatch[1] + '"'); } catch (e) { reply = rtMatch[1]; } }
              console.warn(`[JSON repair] Buzilgan blokdan ${objs.length} ta action tiklandi.`);
              return { reply_text: reply, actions: objs };
            }
          }
        }
      } catch (e) {  }
      return null;
    }
    window.repairAndParseJson = repairAndParseJson;

    function stampActionOccurrences(list) {
      try {
        if (!Array.isArray(list)) return list;
        const seen = Object.create(null);
        list.forEach(function (a) {
          if (!a || typeof a !== 'object' || !a.action) return;
          const base = _baseActionSignature(a);
          const n = seen[base] || 0;
          seen[base] = n + 1;
          try { Object.defineProperty(a, '_occ', { value: n, enumerable: false, writable: true, configurable: true }); } catch (e) { a._occ = n; }
        });
      } catch (e) {}
      return list;
    }
    window.stampActionOccurrences = stampActionOccurrences;
    function stableActionSignature(cmd) {
      const base = _baseActionSignature(cmd);
      return (cmd && cmd._occ > 0) ? (base + '#' + cmd._occ) : base;
    }
    function _baseActionSignature(cmd) {
      try {
        if (!cmd || !cmd.action) return JSON.stringify(cmd || {});
        const a = String(cmd.action);

        if (a === 'reset_deck' || a === 'delete_extra_slides') {
          return 'RESET_DECK';
        }
        if (a === 'replace_slide') {

          const elems = Array.isArray(cmd.elements) ? cmd.elements : [];
          const fp = elems.length + ':' + elems.map(e => (e && (e.type || e.text || e.url || '')).toString().slice(0, 24)).join('|').slice(0, 80);
          const bg = String(cmd.background || '').slice(0, 40);
          return 'replace_slide:' + String(cmd.slide != null ? cmd.slide : '1') + ':e' + fp + ':b' + bg;
        }
        if (a === 'insert_slide') {
          const after = (cmd.after != null) ? cmd.after : (cmd.slide != null ? cmd.slide : 'end');
          const elems = Array.isArray(cmd.elements) ? cmd.elements : [];
          const fp = elems.length + ':' + elems.map(e => (e && (e.type || e.text || '')).toString().slice(0, 20)).join('|').slice(0, 60);
          return 'insert_slide:after=' + String(after) + ':e' + fp;
        }
        if (a === 'clear_slide') {
          return 'clear_slide:' + String(cmd.slide != null ? cmd.slide : 'current');
        }
        if (a === 'create_slides' || a === 'add_slide' || a === 'add_slides' || a === 'new_slide' || a === 'new_slides') {
          return 'create_slides:count=' + String(cmd.count != null ? cmd.count : 1);
        }
        if (a === 'add_gif' || a === 'place_image' || a === 'place_image_url' || a === 'set_background_url' || a === 'set_background') {
          const s = (cmd.slide != null ? cmd.slide : (cmd.target_slide != null ? cmd.target_slide : ''));
          const n = (cmd.image_number != null ? cmd.image_number : (cmd.image_index != null ? cmd.image_index : ''));
          const u = String(cmd.url || cmd.src || '').slice(0, 100);
          return a + ':s' + s + ':n' + n + ':u' + u;
        }
        if (a === 'add_element' || a === 'add_text' || a === 'create_element') {
          const s = (cmd.slide != null ? cmd.slide : (cmd.slide_index != null ? cmd.slide_index : ''));
          const t = (cmd.element && cmd.element.type) || cmd.type || '';
          const left = (cmd.element && cmd.element.left != null) ? cmd.element.left : (cmd.left != null ? cmd.left : '');
          const top = (cmd.element && cmd.element.top != null) ? cmd.element.top : (cmd.top != null ? cmd.top : '');
          return a + ':s' + s + ':' + t + '@' + left + ',' + top;
        }
        const keys = Object.keys(cmd).filter((k) => k.charAt(0) !== '_').sort();
        const ordered = {};
        keys.forEach((k) => { ordered[k] = cmd[k]; });
        return JSON.stringify(ordered);
      } catch (e) {
        return JSON.stringify(cmd);
      }
    }
    let lastActionReport = [];
    window.getLastActionReport = () => lastActionReport;

    function markSlideAsNew(slide) {
      try {
        if (!slide) return;
        if (!slide._uid) slide._uid = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        try { slide._aiTurn = window._aiTurnId || 0; } catch (e) {}
        if (!window._newlyCreatedSlideIds) window._newlyCreatedSlideIds = new Set();
        window._newlyCreatedSlideIds.add(slide._uid);
      } catch (e) {}
    }

    async function ensureSlideMediaLoaded(slideIndex) {
      if (slideIndex == null || slideIndex < 0 || !slides[slideIndex]) return;
      let parsed;
      try { parsed = JSON.parse(slides[slideIndex].json || '{}'); } catch (e) { return; }
      const objs = parsed.objects || [];
      let changed = false;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        if (!o) continue;
        const isGif = o.isGif || o.type === 'gifImage' || (o.gifUrl && /\.gif/i.test(String(o.gifUrl || '')));
        if (!isGif) continue;
        const url = o.gifUrl || o.src;
        if (!url || o.isFallback) continue;

        if (typeof url === 'string' && (url.startsWith('data:') || url.startsWith('/api/proxy-image'))) continue;
        try {
          const loaded = await ensureWorkingGif(url, '');
          if (loaded && loaded.src) {

            const prevDispW = (o.width || 300) * (o.scaleX != null ? o.scaleX : 1);
            const prevDispH = (o.height || 200) * (o.scaleY != null ? o.scaleY : 1);
            const realW = loaded.w || o.width || 300;
            const realH = loaded.h || o.height || 200;
            o.src = loaded.src;
            o.gifUrl = loaded.src;
            o.width = realW;
            o.height = realH;
            o.scaleX = prevDispW / realW;
            o.scaleY = prevDispH / realH;
            o._loading = false;
            o.isFallback = !!loaded.isFallback;
            changed = true;

            if (slideIndex === activeIndex && typeof canvas !== 'undefined' && canvas) {
              try {
                const canvasObj = canvas.getObjects().find(function (c) {
                  return c && (c._oid === o._oid || (o.imageNumber != null && c.imageNumber === o.imageNumber));
                });
                if (canvasObj) {
                  canvasObj.set({
                    gifUrl: loaded.src,
                    src: loaded.src,
                    width: realW,
                    height: realH,
                    scaleX: prevDispW / realW,
                    scaleY: prevDispH / realH,
                    isFallback: !!loaded.isFallback
                  });
                  if (canvasObj._gifElement) {
                    var disp = loaded.src;
                    if (typeof disp === 'string' && /^https?:/i.test(disp) && !disp.startsWith(window.location.origin)) {
                      disp = '/api/proxy-image?raw=1&url=' + encodeURIComponent(disp);
                    }
                    try { canvasObj._gifElement.src = disp; } catch (e2) {}
                  }
                  try { canvasObj.setCoords(); canvasObj.dirty = true; } catch (e2) {}
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
      if (changed) {
        try {
          slides[slideIndex].json = JSON.stringify(parsed);
          if (typeof refreshSlideThumb === 'function') refreshSlideThumb(slideIndex);
          if (slideIndex === activeIndex) {
            try { if (canvas) canvas.requestRenderAll(); } catch (e) {}
            try { if (typeof GifOverlay !== 'undefined' && GifOverlay.sync) GifOverlay.sync(); } catch (e) {}
          }
        } catch (e) {}
      }
    }
    window.ensureSlideMediaLoaded = ensureSlideMediaLoaded;


    // v24: KALITSIZ brauzer-tomon GIF qidiruv (Wikimedia Commons + Openverse; ikkalasi ham CORS ruxsat beradi)
    window.browserGifSearch = async function (q, page, limit) {
      const term = String(q || '').trim() || 'animation';
      const p = Math.max(1, parseInt(page, 10) || 1);
      const n = Math.max(6, Math.min(parseInt(limit, 10) || 24, 40));
      const wiki = async function () {
        const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
          encodeURIComponent(term + ' filetype:gif') + '&gsrnamespace=6&gsrlimit=' + n + '&gsroffset=' + ((p - 1) * n) +
          '&prop=imageinfo&iiprop=url|mime&iiurlwidth=400&format=json&origin=*';
        const d = await (await fetch(url)).json();
        return Object.values((d.query && d.query.pages) || {}).sort(function (a, b) { return (a.index || 0) - (b.index || 0); })
          .map(function (pg) {
            const i = pg.imageinfo && pg.imageinfo[0];
            return i && /gif/i.test(i.mime || '') ? { url: i.url, thumbnail: i.thumburl || i.url, is_gif: true, source: 'wikimedia' } : null;
          }).filter(Boolean);
      };
      const openverse = async function () {
        const url = 'https://api.openverse.org/v1/images/?q=' + encodeURIComponent(term) + '&extension=gif&page_size=20&page=' + p;
        const d = await (await fetch(url)).json();
        return (d.results || []).filter(function (r) { return /\.gif(\?|$)/i.test(r.url || ''); })
          .map(function (r) { return { url: r.url, thumbnail: r.thumbnail || r.url, is_gif: true, source: 'openverse' }; });
      };
      const res = await Promise.allSettled([wiki(), openverse()]);
      const lists = res.map(function (r) { return r.status === 'fulfilled' ? r.value : []; });
      const seen = new Set(), out = [];
      for (let i = 0; i < Math.max(lists[0].length, lists[1].length); i++) {
        lists.forEach(function (l) { if (l[i] && !seen.has(l[i].url)) { seen.add(l[i].url); out.push(l[i]); } });
      }
      return out;
    };
