    async function sendSidebarAiPrompt() {
      if (!isUserLoggedIn()) { requireLoginToast(); return; }
      const tokenOk = await ensureValidToken();
      if (!tokenOk) return;
      const _cont = _continueOverride; _continueOverride = null;
      if (window._autoContinuing) { window._autoContinuing = false; } else { window._autoContCount = 0; }

      try { if (window.Monitoring && typeof window.Monitoring.guardSend === 'function' && !window.Monitoring.guardSend()) return; } catch (e) {  }

      if (isAiStreaming && !_cont) {
        showToast("AI hali javob bermoqda. Tugaguncha kuting yoki To'xtatishni bosing.", 'error');
        return;
      }
      if (isAiStreaming && _cont) {

        try { stopAiStream(); } catch (e) {}
      }
      const inputEl = document.getElementById('aiSidebarInput');
      const promptText = _cont ? _cont.prompt : (inputEl.value || '').trim();
      const aiImagesCount = uploadedImagesStore.filter(i => i.type === 'ai').length;
      const pendingCount = pendingImagesStore.length;
      if (!promptText && aiImagesCount === 0 && pendingCount === 0) {
        showToast("Buyruq yozing yoki rasm biriktiring!", 'error');
        return;
      }
      if (!_cont) { inputEl.value = ''; autoGrowSidebarInput(inputEl); }
      const attachedImagesList = _cont ? [] : uploadedImagesStore.filter(i => i.type === 'ai');

      if (!_cont) {
        const _shownPrompt = promptText || '[Rasm]';
        appendAiChatMessage('user', _shownPrompt, attachedImagesList);
        saveMessageToLocal('user', _shownPrompt);
      }
      currentBotMsgId = appendAiChatMessage('bot', '💭 ...');
      // v34: bu tur uchun balans snapshoti — AI balansdan ko'p yangi slayd yaratib yuborsa, ortiqchasi bajarilmaydi
      try {
        window.__ssTurnSlides = 0; window.__ssTurnWarned = false;
        window.__ssTurnBal = (typeof Monitoring !== 'undefined' && Monitoring.totalCredits) ? Monitoring.totalCredits() : 0;
      } catch (e) { window.__ssTurnBal = 0; }
      saveCurrentSlideState();
      capturePreAiSnapshot();
      const aiImages = uploadedImagesStore.filter(i => i.type === 'ai').map(i => i.base64);
      const slideImagesContext = uploadedImagesStore
        .filter(i => i.type === 'slide')
        .map(i => ({ number: i.globalNum, tag: `#${i.globalNum}-rasm`, width: i.width, height: i.height }));
      const aiImagesContext = attachedImagesList.map(i => ({
        number: i.globalNum, tag: `#${i.globalNum}-rasm`, width: i.width, height: i.height
      }));
      const pendingImagesContext = getPendingImagesMeta();
      const deckMap = extractDeckStateMap();
      const visual = collectVisualContext();
      const deckState = {
        scope: 'all_slides',
        presentation: deckMap,
        slide_images_pending: [...pendingImagesContext, ...slideImagesContext, ...aiImagesContext],
        placed_images: visual.meta.filter(m => m.placed),
        next_object_id: globalObjectIdCounter + 1,
        next_global_image_number: globalImageCounter + 1,
        active_slide_index: activeIndex + 1,
      };
      const allImageObjects = attachedImagesList
        .map(i => i.base64)
        .filter(Boolean)
        .slice(0, 5);
      const fullImagesMeta = [
        ...pendingImagesContext,
        ...aiImagesContext,
        ...slideImagesContext,
        ...visual.meta.filter(m => m.placed).map(m => ({
          number: m.number, slide: m.slide, placed: true,
          width: m.width, height: m.height,
          kind: m.kind || 'image',
          tag: m.kind === 'gif' ? `#${m.number}-GIF` : `#${m.number}-rasm`,
        })),
      ];
      const gifCount = visual.meta.filter(m => m.placed && m.kind === 'gif').length;
      const reportLines = (lastActionReport || []).slice(-20);
      const reportHint = reportLines.length
        ? `\n[OLDINGI AMALLAR HISOBOTI — HAQIQIY NATIJA]\n` + reportLines.join('\n') +
          `\nBu — sizning oldingi javobingizdagi amallarning HAQIQIY bajarilish natijasi. ` +
          `Agar biror amal ❌ bilan belgilangan bo'lsa, u BAJARILMAGAN — foydalanuvchiga yolg'on aytmang, ` +
          `kerak bo'lsa qayta urinib ko'ring yoki xatoni tushuntiring. ` +
          `Agar hammasi ✅ bo'lsa, ish TUGALLANGAN — xuddi shu amalni QAYTA bajarmang.`
        : '';
      const _balLeft = (function () {
        try {
          if (window.Monitoring && typeof Monitoring.totalCredits === 'function') return Monitoring.totalCredits();
        } catch (e) {}
        return null;
      })();
      const dynamicHint = [
        `Faol slayd: ${activeIndex + 1}/${slides.length}.`,
        `Keyingi rasm #: ${globalImageCounter + 1}.`,
        gifCount > 0 ? `Slaydlarda ${gifCount} ta jonli GIF bor (ular #raqam-GIF bilan belgilangan).` : '',
        (_balLeft !== null) ? (`FOYDALANUVCHI BALANSI: ${_balLeft} ta varaq qoldi.` + (_balLeft <= 0 ? ' Balans 0 — yangi slayd yarata olmaydi, faqat mavjudlarini tahrirlashi mumkin. Foydalanuvchiga xushmuomalalik bilan ayt.' : (_balLeft <= 3 ? ' Balans kam — ko\'p slayd so\'rasa ogohlantir.' : ''))) : '',
      ].filter(Boolean).join(' ') + reportHint;
      const payload = {
        token: supabaseToken,
        chat_id: currentChatId,
        scope: 'all_slides',
        prompt: promptText,
        system_hint: dynamicHint + (_cont ? '\n' + _cont.hint : '') + (function () { try { var g = window.SlideGuard ? window.SlideGuard.beforeSend(promptText, !!_cont) : ''; return (g && !(_cont && _cont.hint && _cont.hint.indexOf('SLAYD SONI QOIDASI') >= 0)) ? '\n' + g : ''; } catch (e) { return ''; } })(),
        deck_state: JSON.stringify(deckState),
        active_slide_index: activeIndex + 1,
        images_base64: [],
        images_meta: fullImagesMeta,
        chat_history: _cont ? _cont.history : collectChatHistory(10),
        model: document.getElementById('aiModelSelect').value,
      };

      _streamCtx = {
        id: 'int_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        prompt: _cont ? _cont.origPrompt : promptText,
        prevPartial: _cont ? _cont.prevPartial : '',
      };
      startAiStream();
      if (!sendOverSocket(payload)) {
        const _failId = _streamCtx && _streamCtx.id;
        isAiStreaming = false;
        _streamCtx = null;
        if (_failId) _writeInterrupted(_readInterrupted().filter((e) => e.id !== _failId));
        clearAiWatchdog();
        updateSendButtons(false);
      } else if (_cont && _cont.entry) {

        clearInterrupted(_cont.entry.id);
      }
    }
    function collectVisualContext() {
      const seenNumbers = new Set();
      const images = [];
      const meta = [];
      const pendingSources = [
        ...uploadedImagesStore.filter(i => i.type === 'slide'),
        ...bottomAiImages,
      ];
      pendingSources.forEach((img) => {
        if (!img || !img.base64 || !img.base64.startsWith('data:image')) return;
        if (seenNumbers.has(img.globalNum)) return;
        seenNumbers.add(img.globalNum);
        meta.push({
          number: img.globalNum,
          slide: null,
          placed: false,
          width: img.width,
          height: img.height,
          description: img.description || '',
        });
      });
      slides.forEach((s, idx) => {
        let parsed = {};
        try { parsed = JSON.parse(s.json || '{}'); } catch (e) { return; }
        (parsed.objects || []).forEach((o) => {
          if (o.type !== 'image' || !o.imageNumber) return;
          if (seenNumbers.has(o.imageNumber)) return;
          const isGif = !!(o.isGif || o.type === 'gifImage' || o.gifUrl);
          if (isGif) {
            seenNumbers.add(o.imageNumber);
            meta.push({
              number: o.imageNumber,
              slide: idx + 1,
              placed: true,
              kind: 'gif',
              width: Math.round((o.width || 0) * (o.scaleX || 1)),
              height: Math.round((o.height || 0) * (o.scaleY || 1)),
              url: o.gifUrl || o.src || '',
            });
            return;
          }
          if (!o.src || typeof o.src !== 'string' || !o.src.startsWith('data:image')) return;
          seenNumbers.add(o.imageNumber);
          images.push({ number: o.imageNumber, b64: o.src });
          meta.push({
            number: o.imageNumber,
            slide: idx + 1,
            placed: true,
            kind: 'image',
            width: o.width,
            height: o.height,
          });
        });
      });
      return { images, meta };
    }
    function extractDeckStateMap() {
      saveCurrentSlideState();
      return slides.map((s, idx) => {
        let parsed = {};
        try { parsed = JSON.parse(s.json || '{}'); } catch (e) {}
        const objects = (parsed.objects || []).map((o, zIdx) => {
          const isGif = !!(o.isGif || o.type === 'gifImage' || o.gifUrl);
          const isImg = isGif || o.type === 'image' || o.type === 'videoImage' || o.type === 'embedVideo' || o.isVideo || o.isEmbed;
          const isText = o.type === 'textbox' || o.type === 'i-text' || o.type === 'text';
          const entry = {
            id: o._oid != null ? o._oid : null,
            type: isGif ? 'gif' : (isText ? 'text' : o.type),
            kind: isGif ? 'gif' : (isImg ? 'image' : (isText ? 'text' : 'shape')),
            left: Math.round(o.left || 0),
            top: Math.round(o.top || 0),
            width: Math.round((o.width || 0) * (o.scaleX || 1)),
            height: Math.round((o.height || 0) * (o.scaleY || 1)),
            angle: Math.round(o.angle || 0),
            z: zIdx,
            fill: o.fill || null,
            stroke: o.stroke || null,
            opacity: o.opacity != null ? o.opacity : 1,
          };
          if (isText) {
            entry.text = (o.text || '').substring(0, 120);
            entry.fontSize = o.fontSize || null;
            entry.fontFamily = o.fontFamily || null;
          }
          if (isImg && o.imageNumber != null) entry.imageNumber = o.imageNumber;
          if (o.type === 'embedVideo' || o.isEmbed) { entry.type = 'video'; entry.url = o.embedUrl || ''; }
          if (o.type === 'slideButton' || o.isButton) { entry.type = 'button'; entry.kind = 'button'; entry.text = o.btnLabel || ''; entry.click = o.btnAction || 'next'; entry.target = o.btnTarget || ''; }
          if (o.animName) entry.animation = o.animName;
          return entry;
        });
        const slideEntry = {
          slide: idx + 1, slide_index: idx + 1,
          background: parsed.background || '#ffffff',
          imageNumbers: s.imageNumbers || [],
          objects: objects,
        };
        if (parsed.backgroundGif && (parsed.backgroundGif.src || parsed.backgroundGif.url)) {
          slideEntry.backgroundGif = {
            src: parsed.backgroundGif.src || parsed.backgroundGif.url,
            width: parsed.backgroundGif.width || null,
            height: parsed.backgroundGif.height || null,
          };
        }
        if (parsed.backgroundVideo && parsed.backgroundVideo.url) {
          slideEntry.backgroundVideo = { url: parsed.backgroundVideo.url };
        }
        return slideEntry;
      });
    }
    function findObjectByGlobalId(id) {
      for (let i = 0; i < slides.length; i++) {
        let parsed = {};
        try { parsed = JSON.parse(slides[i].json || '{}'); } catch (e) {}
        const obj = (parsed.objects || []).find((o) => o._oid === id);
        if (obj) return { slideIndex: i, obj };
      }
      return null;
    }
    function assignNextImageNumber() {
      let maxNum = globalImageCounter || 0;
      slides.forEach((s) => {
        try {
          const parsed = JSON.parse(s.json || '{}');
          (parsed.objects || []).forEach((o) => {
            if (isImageLike(o) && typeof o.imageNumber === 'number' && o.imageNumber > maxNum) {
              maxNum = o.imageNumber;
            }
          });
        } catch (e) {}
      });
      (uploadedImagesStore || []).forEach((i) => {
        const n = i.globalNum ?? i.number;
        if (typeof n === 'number' && n > maxNum) maxNum = n;
      });
      (bottomAiImages || []).forEach((i) => {
        const n = i.globalNum ?? i.number;
        if (typeof n === 'number' && n > maxNum) maxNum = n;
      });
      globalImageCounter = maxNum + 1;
      return globalImageCounter;
    }
    function recalculateGlobalImageCounter() {
      let maxNum = 0;
      (slides || []).forEach((s) => {
        try {
          const parsed = JSON.parse(s.json || '{}');
          (parsed.objects || []).forEach((o) => {
            if (isImageLike(o) && typeof o.imageNumber === 'number' && o.imageNumber > maxNum) {
              maxNum = o.imageNumber;
            }
          });
        } catch (e) {  }
      });
      (uploadedImagesStore || []).forEach((img) => {
        const num = img.globalNum ?? img.number;
        if (typeof num === 'number' && num > maxNum) maxNum = num;
      });
      (bottomAiImages || []).forEach((img) => {
        const num = img.globalNum ?? img.number;
        if (typeof num === 'number' && num > maxNum) maxNum = num;
      });
      globalImageCounter = maxNum;
      return globalImageCounter;
    }
    window.recalculateGlobalImageCounter = recalculateGlobalImageCounter;
    function isImageLike(o) {
      if (!o) return false;
      return o.type === 'image' || o.type === 'gifImage' || o.type === 'videoImage' || o.type === 'embedVideo' || o.type === 'video' || o.isGif === true || o.isVideo === true || o.isEmbed === true;
    }
    window.isImageLike = isImageLike;
    function findObjectByImageNumber(num, preferSlideIndex) {
      if (num == null || num === '') return null;
      const target = String(num);
      const order = [];
      const push = (i) => {
        if (typeof i === 'number' && i >= 0 && i < slides.length && !order.includes(i)) order.push(i);
      };
      if (typeof preferSlideIndex === 'number') push(preferSlideIndex);
      push(activeIndex);
      for (let i = 0; i < slides.length; i++) push(i);
      for (const i of order) {
        let parsed = {};
        try { parsed = JSON.parse(slides[i].json || '{}'); } catch (e) { continue; }
        const obj = (parsed.objects || []).find(
          (o) => isImageLike(o) && String(o.imageNumber) === target
        );
        if (obj) return { slideIndex: i, obj };
      }
      return null;
    }
    const FALLBACK_THUMB_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="288" height="162">' +
      '<rect width="100%" height="100%" fill="#f1f5f9"/>' +
      '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ' +
      'fill="#94a3b8" font-size="14" font-family="Arial">Preview N/A</text></svg>'
    );
    function safeToDataURL(canvasObj, opts) {
      if (!canvasObj) return '';
      try {
        return canvasObj.toDataURL(opts || { format: 'png', multiplier: 0.3 });
      } catch (e) {
        console.warn("Canvas export xatoligi (CORS/tainted canvas bo'lishi mumkin):", e);
        return FALLBACK_THUMB_SVG;
      }
    }
    function withTimeout(promise, ms, fallback) {
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          console.warn(`Rasm yuklash ${ms}ms ichida tugamadi (CORS/bloklangan bo'lishi mumkin) — o'tkazib yuborildi.`);
          resolve(fallback);
        }, ms);
        Promise.resolve(promise).then((val) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }).catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        });
      });
    }
    const _proxyCache = new Map();
    const _proxyFail = new Map(); // v24: xato URLlar 5 daqiqa qayta so'ralmaydi
    function sanitizeImageUrl(url) {
      if (!url || typeof url !== 'string') return url;
      let u = url.trim();
      const md = u.match(/^\[[^\]]*\]\(\s*([^)\s]+)\s*\)$/);
      if (md) u = md[1].trim();
      if (!/^(data:|https?:\/\/)/i.test(u)) {
        const m = u.match(/https?:\/\/[^\s"'\)\]]+/i);
        if (m) u = m[0];
      }
      u = u.replace(/[),.;]+$/, '');
      return u;
    }
    window.sanitizeImageUrl = sanitizeImageUrl;
    async function resolveRemoteToDataUrl(url) {
      url = sanitizeImageUrl(url);
      if (!url || typeof url !== 'string') return url;
      if (url.startsWith('data:')) return url;
      if (url.startsWith('/api/proxy-image')) return url;
      if (!/^https?:\/\//i.test(url)) return url;
      if (_proxyCache.has(url)) return _proxyCache.get(url);
      if (_proxyFail.has(url) && Date.now() - _proxyFail.get(url) < 300000) return url;
      try {
        const res = await fetch('/api/proxy-image?url=' + encodeURIComponent(url));
        if (!res.ok) throw new Error('proxy HTTP ' + res.status);
        const data = await res.json();
        if (data && data.error) throw new Error('proxy: ' + data.error);
        if (data && data.data_url) {
          _proxyCache.set(url, data.data_url);
          return data.data_url;
        }
      } catch (e) {
        console.warn("Proxy orqali rasm olinmadi:", e);
        // v36: proksi (masalan 429) o'tmasa — brauzer o'zi to'g'ridan-to'g'ri oladi
        try {
          const dres = await fetch(url, { mode: 'cors' });
          if (dres && dres.ok) {
            const blob = await dres.blob();
            const du = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(blob); });
            if (typeof du === 'string' && du.startsWith('data:image/')) { _proxyCache.set(url, du); return du; }
          }
        } catch (e2) {}
        _proxyFail.set(url, Date.now());
      }
      return url;
    }
    async function resolveGifToDataUrl(url) {
      url = sanitizeImageUrl(url);
      if (!url) return null;
      if (url.startsWith('data:image/gif')) return url;
      if (url.startsWith('/api/proxy-image') && url.includes('raw=1')) {
        return url;
      }
      if (/^https?:\/\//i.test(url)) {
        return '/api/proxy-image?raw=1&url=' + encodeURIComponent(url);
      }
      return url;
    }
    window.resolveGifToDataUrl = resolveGifToDataUrl;
    async function resolveGifDirectUrl(rawUrl) {
      let url = sanitizeImageUrl(rawUrl);
      if (!url || typeof url !== 'string') return null;
      if (/^data:image\/gif/i.test(url)) return url;
      if (/\.gif(\?|#|$)/i.test(url)) return url;
      if (/media\.tenor\.com|c\.tenor\.com|media\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com/i.test(url) && /\.gif/i.test(url)) return url;
      const isTenorPage = /tenor\.com\/view\//i.test(url);
      const isGiphyPage = /giphy\.com\/gifs\//i.test(url) || /gph\.is\//i.test(url);

      let q = '';
      try {
        if (isTenorPage) {
          const m = url.match(/tenor\.com\/view\/([^/?#]+)/i);
          if (m) q = decodeURIComponent(m[1]).replace(/-gif-\d+$/i, '').replace(/-/g, ' ').trim();
        } else if (isGiphyPage) {
          const m = url.match(/giphy\.com\/gifs\/([^/?#]+)/i) || url.match(/gph\.is\/([^/?#]+)/i);
          if (m) q = decodeURIComponent(m[1]).replace(/-/g, ' ').trim();
        } else {

          const m = url.match(/\/([^/?#]+)(?:\?|#|$)/);
          if (m) q = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim();
        }
      } catch (e) { q = ''; }
      if (!q || q.length < 2) q = 'funny animation';

      for (const provider of ['tenor', 'giphy']) {
        try {
          const res = await fetch('/api/media-search?provider=' + provider + '&q=' + encodeURIComponent(q) + '&limit=8');
          if (res.ok) {
            const data = await res.json();
            const results = (data && data.results) || [];
            const gifResults = results.filter(r => r && r.url && /\.gif(\?|#|$)/i.test(r.url));
            if (gifResults.length > 0) return gifResults[0].url;
          }
        } catch (e) { console.warn('resolveGifDirectUrl ' + provider + ' xatosi:', e); }
      }
      return null;
    }
