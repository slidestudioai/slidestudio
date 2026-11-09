    const AiSearchUI = (function () {
      let chip = null, active = 0;

      const SEP_EVERY = 5;
      let searchCount = 0;
      function host() {
        const b = document.getElementById(typeof currentBotMsgId !== 'undefined' ? currentBotMsgId : '');
        return b || null;
      }
      function ensure() {
        const b = host();
        if (!b) return null;
        if (chip && chip.isConnected && chip.parentNode === b) return chip;
        chip = document.createElement('div');
        chip.className = 'ai-search-chip';
        // v29: qidiruv qatorlari matn ORQASIDA (pastida) chiqadi — matn o'chmaydi va tepaga surilmaydi
        const sp = b.querySelector('.msg-text');
        if (sp && sp.parentNode) sp.parentNode.insertBefore(chip, sp.nextSibling); else b.appendChild(chip);
        return chip;
      }
      function separator(c, n) {
        const sep = document.createElement('div');
        sep.className = 'ai-search-sep';
        sep.innerHTML = '<span class="asr-sep-line"></span>' +
          '<span class="asr-sep-label">' + n + ' ta qidiruv</span>' +
          '<span class="asr-sep-line"></span>';
        c.appendChild(sep);
      }
      function row(q, kind) {
        const c = ensure();
        if (!c) return null;

        if (searchCount > 0 && searchCount % SEP_EVERY === 0) {
          separator(c, searchCount);
        }
        searchCount++;
        const r = document.createElement('div');
        r.className = 'ai-search-row searching';
        r.dataset.q = q;
        r.innerHTML = '<span class="material-symbols-outlined spin">travel_explore</span><span class="asr-text"></span>';
        r.querySelector('.asr-text').textContent = (kind === 'gif' ? 'GIF qidirilmoqda: «' : 'Internetdan rasm qidirilmoqda: «') + q + '»…';
        c.appendChild(r);
        return r;
      }
      return {
        start: function (q, kind) {
          active++;
          // v36: qidiruvdan OLDIN yozilgan matn tepada qoladi, qidiruvdan KEYIN yozilgani qidiruv kartasi ostida davom etadi
          try { if (window._aiSearchBreakFor !== currentBotMsgId) { window._aiSearchBreakRaw = null; window._aiSearchBreakFor = currentBotMsgId; } } catch (e) {}
          try { if (window._aiSearchBreakRaw == null) window._aiSearchBreakRaw = (typeof currentAiStreamBuffer === 'string' ? currentAiStreamBuffer.length : 0); } catch (e) {}
          row(q, kind);
          try { setMediaSearchStatus('Internetdan qidirilmoqda: «' + String(q).slice(0, 32) + '»…'); } catch (e) {}
          const log = document.getElementById('aiChatBody');
          try { if (log) log.scrollTop = log.scrollHeight; } catch (e) {}
        },
        done: function (q, kind, count) {
          active = Math.max(0, active - 1);
          const c = chip;
          if (c) {
            const rows = c.querySelectorAll('.ai-search-row.searching');
            for (const r of rows) {
              if (r.dataset.q === q) {
                r.classList.remove('searching');
                r.classList.add(count > 0 ? 'ok' : 'none');
                r.querySelector('.material-symbols-outlined').textContent = count > 0 ? 'check_circle' : 'search_off';
                r.querySelector('.material-symbols-outlined').classList.remove('spin');
                r.querySelector('.asr-text').textContent = count > 0
                  ? ('«' + q + '» — ' + count + ' ta natija topildi, eng mosi tanlanmoqda')
                  : ('«' + q + '» — hech narsa topilmadi, boshqacha qidirilmoqda');
                break;
              }
            }
          }
          if (!active) { try { setMediaSearchStatus(null); } catch (e) {} }
        },
        reset: function () { chip = null; active = 0; searchCount = 0; window._aiSearchBreakRaw = null; },
        chipEl: function () { return chip && chip.isConnected ? chip : null; },
      };
    })();
    window.AiSearchUI = AiSearchUI;
    let _manualSocketClose = false;
    function initWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let wsUrl = `${protocol}//${window.location.host}/ws/chat`;
      try {
        if (supabaseToken && supabaseToken !== "dev-token") {
          wsUrl += `?token=${encodeURIComponent(supabaseToken)}`;
        }
      } catch (e) {  }
      socket = new WebSocket(wsUrl);
      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'error' &&
              (data.code === 'invalid_token' ||
               data.message.includes('token is expired') || data.message.includes('invalid JWT'))) {
            showToast("Sessiya muddati tugadi. Yangilanmoqda...", 'error');
            const ok = await refreshSupabaseToken();
            if (!ok) {
              updateAuthUI();
              showToast("Iltimos, qaytadan tizimga kiring.", 'error');
            } else {
              showToast("Sessiya yangilandi. Buyruqni qayta yuboring.");
            }
            try { markStreamInterrupted('auth'); } catch (e) {}
            finishAiStream();
            return;
          }
          if (data.type === 'error' && (data.code === 'LIMIT_EXCEEDED' || /limit tugadi/i.test(data.message || ''))) {
            try {
              if (typeof applyServerUsage === 'function') applyServerUsage(data);
              else if (window.Monitoring) window.Monitoring.applyServerUsage(data);
              if (window.Monitoring && window.Monitoring.showLimitModal) window.Monitoring.showLimitModal();
            } catch (_) {}
            showToast(data.message || 'Limit tugadi', 'error');
            try { finishAiStream(); } catch (e) {}
            return;
          }
          if (data.type === 'chunk') {
            try { if (typeof bumpAiWatchdog === 'function') bumpAiWatchdog(); } catch (e) {}
            handleAiResponseStream(data.text || data.content || '');
          } else if (data.type === 'reset') {
            // v29: matn ENDI O'CHIRILMAYDI (avval qidiruv boshlanganda javob yo'qolib, keyin qaytadan yozilardi).
            // Server bu xabarni yubormaydi; eski server yuborsa ham ko'rinib turgan matn va bufer saqlanadi.
            try { if (typeof bumpAiWatchdog === 'function') bumpAiWatchdog(); } catch (e) {}
          } else if (data.type === 'search_request') {
            try { if (typeof bumpAiWatchdog === 'function') bumpAiWatchdog(); } catch (e) {}
            clientAiSearch(data);
          } else if (data.type === 'search_start') {
            try { if (typeof bumpAiWatchdog === 'function') bumpAiWatchdog(); } catch (e) {}
            try { AiSearchUI.start(data.query, data.kind, data.n); } catch (e) {}
          } else if (data.type === 'search_done') {
            try { if (typeof bumpAiWatchdog === 'function') bumpAiWatchdog(); } catch (e) {}
            try { AiSearchUI.done(data.query, data.kind, data.count); } catch (e) {}
          } else if (data.type === 'gif_fix') {

            console.log("[gif_fix] etiborsiz — qayta bajarish ochirilgan");
          } else if (data.type === 'end') {
            try {
              if (typeof applyServerUsage === 'function') applyServerUsage(data);
              else if (window.Monitoring && typeof window.Monitoring.applyServerUsage === 'function') {
                window.Monitoring.applyServerUsage(data);
              }
            } catch (_) {}
            if (typeof data.user_total_tokens === 'number') {
              userStats.total_tokens = data.user_total_tokens;
              const st = document.getElementById('statTokens');
              if (st) st.innerText = data.user_total_tokens.toLocaleString();
              const bar = document.getElementById('tokenStatusBar');
              if (bar) bar.style.display = 'flex';
            }
            if (typeof data.slide_credits_left === 'number') {
              userStats.slide_credits = data.slide_credits_left;
            }
            currentChatId = data.chat_id || currentChatId;

            const _fr = data.finish_reason || 'stop';
            if (_fr !== 'stop') {
              try { markStreamInterrupted(_fr === 'length' ? 'length' : 'error'); } catch (e) {}
            } else if (_streamCtx) {
              try { clearInterrupted(_streamCtx.id); } catch (e) {}
              _streamCtx = null;
            }
            if (twoPassState && twoPassState.active && twoPassState.plan.length) {
              try { await aiProcessingQueue; } catch (e) {}
              isAiStreaming = false;
              clearAiWatchdog();
              sendNextTwoPassSlide();
            } else if (twoPassState && twoPassState.active) {
              twoPassState = null;
              finishAiStream();
            } else {
              finishAiStream();
            }
          } else if (data.type === 'error') {
            showToast("Xatolik: " + data.message, 'error');
            const botEl = document.getElementById(currentBotMsgId);
            if (botEl) {
              botEl.classList.add('error');
              const span = botEl.querySelector('.msg-text');
              if (span) span.innerText = "⚠️ " + data.message;
            }
            aiSessionActive = false;
            try { markStreamInterrupted(/limit|quota|rate|tugadi/i.test(String(data.message || '')) ? 'limit' : 'error'); } catch (e) {}
            finishAiStream();
          }
        } catch (e) { console.error("WS parsing:", e); }
      };
      socket.onclose = () => {
        if (isAiStreaming) {
          // Agar allaqachon actionlar qo'llangan bo'lsa — to'liq tugagan deb hisobla (dublikatdan saqlanish)
          const hadActions = (typeof lastActionReport !== 'undefined' && lastActionReport && lastActionReport.length > 0);
          const buf = (currentAiStreamBuffer || '').trim();
          const looksComplete = hadActions && (/```\s*$/.test(buf) || buf.length > 400);
          if (looksComplete) {
            try { finishAiStream(); } catch (e) {
              isAiStreaming = false;
              aiSessionActive = false;
              updateSendButtons(false);
            }
            showToast("Ulanish uzildi, lekin slaydlar qo'llangan. Kerak bo'lsa qayta ulang.", 'info');
          } else {
            try { markStreamInterrupted('connection_lost'); } catch (e) {}
            isAiStreaming = false;
            aiSessionActive = false;
            updateSendButtons(false);
            showToast("Ulanish uzildi. Qayta ulanmoqda. Kerak bo'lsa «Davom ettirish»ni bosing (avtomatik davom yo'q).", 'error');
          }
        }
        const _delay = _manualSocketClose ? 150 : 3000;
        _manualSocketClose = false;
        setTimeout(initWebSocket, _delay);
      };
    }
    function toggleImageUploadMode() {  }
    window.toggleImageUploadMode = toggleImageUploadMode;
    function updateImageModeBadges() {  }
    window.updateImageModeBadges = updateImageModeBadges;
    async function routeUploadedImage(base64Data) {
      await addImageToAiContext(base64Data);
    }
    function readFilesAsDataUrls(files) {
      return Promise.all(Array.from(files).map((file) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (evt) => resolve({ name: file.name, data: evt.target.result });
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      })));
    }
    function triggerDirectImageUpload() {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => { hideUploadOverlay(true); showToast("Faylni o'qib bo'lmadi", 'error'); };
        reader.onload = async (evt) => {
          try {
            await placeImageDirectlyOnSlide(evt.target.result);
          } catch (err) {
            showToast("Rasm yuklanmadi: " + (err && err.message ? err.message : 'xatolik'), 'error');
          } finally {
            hideUploadOverlay(true);
          }
        };
        showUploadOverlay('Rasm yuklanmoqda...', file.name || 'Iltimos kuting');
        reader.readAsDataURL(file);
      };
      fileInput.click();
    }
    function triggerBackgroundImageUpload() {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*,.gif,video/*,.mp4,.webm,.mov';
      fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (/^video\//.test(file.type || '') || /\.(mp4|webm|ogv|mov|m4v)$/i.test(file.name || '')) {   // v38: video fon
          const _sk = window.ssShowSkeleton ? window.ssShowSkeleton({ kind: 'bg' }) : null;
          Promise.resolve(fileToVideoUrlPublic(file))
            .then((vu) => vu ? VideoKit.setBackground(activeIndex, { url: vu, loop: true }) : null)
            .catch(() => showToast("Video fon o'rnatilmadi", 'error'))
            .finally(() => { if (_sk) _sk.remove(); });
          return;
        }
        const isGif = (file.type === 'image/gif') || /\.gif$/i.test(file.name || '');
        const reader = new FileReader();
        reader.onerror = () => { hideUploadOverlay(true); showToast("Faylni o'qib bo'lmadi", 'error'); };
        reader.onload = (evt) => {
          showUploadOverlay(isGif ? 'GIF fon yuklanmoqda...' : 'Fon rasmi yuklanmoqda...', file.name || 'Iltimos kuting');
          if (isGif) {
            try {
              const dataUrl = evt.target.result;
              slides[activeIndex].bgType = 'gif';
              const parsed = JSON.parse(slides[activeIndex].json || '{}');
              parsed.backgroundGif = { src: dataUrl, width: 960, height: 540 };
              delete parsed.backgroundImage;
              slides[activeIndex].json = JSON.stringify(parsed);
              canvas.setBackgroundImage(null, () => {
                canvas.setBackgroundColor('rgba(0,0,0,0)', () => {
                  try { canvas.requestRenderAll(); } catch (e) {}
                });
              });
              try { GifBackground.applyFromSlide(slides[activeIndex].json); } catch (err) {}
              requestAnimationFrame(() => {
                try { GifBackground.applyFromSlide(slides[activeIndex].json); } catch (e) {}
                try { canvas.requestRenderAll(); } catch (e) {}
              });
              setTimeout(() => {
                try { GifBackground.applyFromSlide(slides[activeIndex].json); } catch (e) {}
                try {
                  const p2 = JSON.parse(slides[activeIndex].json || '{}');
                  if (!p2.backgroundGif) {
                    p2.backgroundGif = { src: dataUrl, width: 960, height: 540 };
                    delete p2.backgroundImage;
                    slides[activeIndex].json = JSON.stringify(p2);
                  }
                } catch (e3) {}
                try { refreshSlideThumb(activeIndex); } catch (e) {}
                try { recordGlobalState(); } catch (e) {}
              }, 120);
              hideUploadOverlay(true);
              showToast("GIF fon o'rnatildi (animatsiyali)");
            } catch (err) {
              hideUploadOverlay(true);
              showToast("GIF fon o'rnatilmadi", 'error');
            }
            return;
          }
          fabric.Image.fromURL(evt.target.result, (img) => {
            if (!img) {
              hideUploadOverlay(true);
              showToast("Fon rasmi yuklanmadi", 'error');
              return;
            }
            const dataUrl = evt.target.result;
            try {
              const parsed = JSON.parse(slides[activeIndex].json || '{}');
              delete parsed.backgroundGif;
              delete parsed.backgroundVideo;
              slides[activeIndex].bgType = 'image';
              slides[activeIndex].json = JSON.stringify(parsed);
              try { GifBackground.clear(); } catch (e) {}
            } catch (e) {}
            img.set({
              scaleX: canvas.width / (img.width || 960),
              scaleY: canvas.height / (img.height || 540),
              originX: 'left', originY: 'top', left: 0, top: 0
            });
            canvas.setBackgroundImage(img, () => {
              canvas.renderAll();
              try {
                const parsed = JSON.parse(slides[activeIndex].json || '{}');
                parsed.backgroundImage = {
                  type: 'image', src: dataUrl, left: 0, top: 0,
                  scaleX: canvas.width / (img.width || 960),
                  scaleY: canvas.height / (img.height || 540),
                  originX: 'left', originY: 'top'
                };
                delete parsed.backgroundGif;
                delete parsed.backgroundVideo;
                slides[activeIndex].json = JSON.stringify(parsed);
              } catch (e) {}
              saveCurrentSlideState();
              recordGlobalState();
              try { refreshSlideThumb(activeIndex); } catch (e) {}
              hideUploadOverlay(true);
              showToast("Fon rasmi o'rnatildi");
            });
          }, { crossOrigin: 'anonymous' });
        };
        showUploadOverlay(isGif ? 'GIF fon yuklanmoqda...' : 'Fon rasmi yuklanmoqda...', file.name || 'Iltimos kuting');
        reader.readAsDataURL(file);
      };
      fileInput.click();
    }
    async function placeImageDirectlyOnSlide(base64Data, pos) {
      pos = pos || {};
      globalImageCounter++;
      const num = globalImageCounter;
      const hash = await computeImageHash(base64Data);
      const imgId = `img_s${activeIndex + 1}_n${num}_${Date.now()}`;
      const oid = nextObjectId();

      let pre = null;
      try {
        if (typeof preloadMedia === 'function') {
          pre = await preloadMedia(base64Data, { timeoutMs: 10000 });
        }
      } catch (e) {  }
      const dims = pre ? { width: pre.w, height: pre.h } : await getImageDimensions(base64Data).catch(() => ({ width: 400, height: 300 }));
      return new Promise((resolve) => {
        fabric.Image.fromURL(base64Data, (img) => {
          if (!img) { resolve(null); return; }
          const left = Number.isFinite(pos.left) ? pos.left : (60 + (num % 5) * 30);
          const top = Number.isFinite(pos.top) ? pos.top : (60 + (num % 3) * 30);
          img.set({
            left, top,
            id: imgId,
            imageNumber: num,
            imageHash: hash,
            _oid: oid,
            objectCaching: false
          });
          if (img.width > 400) img.scaleToWidth(400);
          try { img.setCoords(); } catch (e) {}
          img.dirty = true;
          canvas.add(img);
          canvas.setActiveObject(img);
          canvas.requestRenderAll();
          // Ba'zi brauzerlarda rasm birinchi renderda ko'rinmaydi — load tugagach qayta chizamiz
          const el = img._element || (img.getElement && img.getElement());
          const redraw = () => {
            try {
              img.dirty = true;
              if (typeof img.setCoords === 'function') img.setCoords();
              canvas.requestRenderAll();
            } catch (e) {}
          };
          if (el && !el.complete) {
            el.addEventListener('load', redraw, { once: true });
            setTimeout(redraw, 120);
            setTimeout(redraw, 400);
          } else {
            setTimeout(redraw, 50);
          }
          if (!slides[activeIndex].imageNumbers) slides[activeIndex].imageNumbers = [];
          if (!slides[activeIndex].imageNumbers.includes(num)) {
            slides[activeIndex].imageNumbers.push(num);
          }
          saveCurrentSlideState();
          try {
            const j = JSON.parse(slides[activeIndex].json || '{}');
            if (j.backgroundGif) GifBackground.applyFromSlide(slides[activeIndex].json);
          } catch (e) {}
          updateAllImageBadges();
          renderWorkspacePreviews();
          try { refreshSlideThumb(activeIndex); } catch (e) {}
          showToast(`#${num}-rasm varoqqa qo'yildi (${dims.width}×${dims.height})`);
          resolve(imgId);
        }, { crossOrigin: 'anonymous' });
      });
    }
    function triggerSidebarImageUpload() {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      fileInput.onchange = async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        showUploadOverlay('Rasmlar yuklanmoqda...', `${files.length} ta fayl`);
        try {
          const items = (await readFilesAsDataUrls(files)).filter(Boolean);
          if (items.length === 0) { showToast("Rasmlarni o'qib bo'lmadi", 'error'); return; }
          for (const it of items) await addPendingImage(it.data);
          if (items.length > 1) showToast(`${items.length} ta rasm yuklandi — AI joylashtiradi`);
        } catch (err) {
          showToast("Yuklashda xatolik: " + (err && err.message ? err.message : 'xatolik'), 'error');
        } finally {
          hideUploadOverlay();
        }
      };
      fileInput.click();
    }
    async function addImageForSlide(base64Data) {
      globalImageCounter++;
      const num = globalImageCounter;
      const hash = await computeImageHash(base64Data);
      const dims = await getImageDimensions(base64Data);
      uploadedImagesStore.push({
        id: `img_slide_${Date.now()}_${num}`,
        type: 'slide',
        base64: base64Data,
        globalNum: num,
        width: dims.width,
        height: dims.height,
        hash: hash,
      });
      renderWorkspacePreviews();
      updateAttachButtonsUI();
      showToast(`#${num}-rasm "Varoq uchun" (${dims.width}×${dims.height})`);
    }
    async function addImageToAiContext(base64Data) {
      const currentAiImages = uploadedImagesStore.filter(i => i.type === 'ai');
      if (currentAiImages.length >= 5) {
        showToast("AI uchun maksimal 5 ta rasm biriktirish mumkin!", 'error');
        return;
      }
      globalImageCounter++;
      const num = globalImageCounter;
      const hash = await computeImageHash(base64Data);
      const dims = await getImageDimensions(base64Data);
      uploadedImagesStore.push({
        id: `img_ai_${Date.now()}_${num}`,
        type: 'ai',
        base64: base64Data,
        globalNum: num,
        width: dims.width,
        height: dims.height,
        hash: hash,
      });
      renderChatPreviews();
      updateAttachButtonsUI();
      if (!document.getElementById('aiSidebar').classList.contains('open')) {
        toggleAISidebar();
      }
      showToast(`#${num}-rasm "AI uchun" (${dims.width}×${dims.height})`);
    }
    async function addPendingImage(base64Data) {
      globalImageCounter++;
      const num = globalImageCounter;
      const hash = await computeImageHash(base64Data);
      const dims = await getImageDimensions(base64Data);
      const ratio = (dims.width && dims.height)
        ? (dims.width / dims.height).toFixed(2) : '?';
      pendingImagesStore.push({
        id: `img_pending_${Date.now()}_${num}`,
        base64: base64Data,
        globalNum: num,
        width: dims.width,
        height: dims.height,
        ratio: ratio,
        hash: hash,
      });
      renderPendingImages();
      showToast(`#${num}-rasm yuklandi (${dims.width}×${dims.height}) — AI joylashtiradi`);
    }
    function renderPendingImages() {
      const bar = document.getElementById('pendingImagesBar');
      const cards = document.getElementById('pendingImagesCards');
      if (!bar || !cards) return;
      cards.innerHTML = '';
      if (pendingImagesStore.length === 0) {
        bar.classList.remove('active');
        bar.style.display = 'none';
        return;
      }
      bar.classList.add('active');
      bar.style.display = 'flex';
      pendingImagesStore.forEach((img) => {
        const card = document.createElement('div');
        card.className = 'pending-card';
        card.draggable = true;
        card.title = `#${img.globalNum} — ${img.width}×${img.height} (nisbat ${img.ratio}) — sudrab slaydga tashlang`;
        card.innerHTML = `
          <div class="pending-card-badge">#${img.globalNum}</div>
          <img src="${img.base64}" alt="#${img.globalNum}" draggable="false">
          <div class="pending-card-meta">${img.width}×${img.height}</div>
          <div class="pending-card-remove" onclick="event.stopPropagation(); removePendingImage('${img.id}')">×</div>
        `;
        card.ondragstart = (ev) => {
          try {
            ev.dataTransfer.setData('application/x-slide-studio-pending', img.id);
            ev.dataTransfer.setData('application/x-slide-studio-media', img.base64);
            ev.dataTransfer.setData('text/plain', 'pending:' + img.id);
            ev.dataTransfer.effectAllowed = 'copy';
            card.classList.add('dragging');
          } catch (_) {}
        };
        card.ondragend = () => card.classList.remove('dragging');
        card.onclick = (ev) => {
          if (ev.target && ev.target.classList && ev.target.classList.contains('pending-card-remove')) return;
          openFullImageViewer(img.base64);
        };
        cards.appendChild(card);
      });

      const scrollEl = bar;
      if (!scrollEl._dragScrollBound) {
        scrollEl._dragScrollBound = true;
        let isDown = false, startX = 0, scrollLeft = 0, moved = false;
        const start = (clientX) => { isDown = true; moved = false; startX = clientX; scrollLeft = scrollEl.scrollLeft; scrollEl.style.cursor = 'grabbing'; };
        const move = (clientX) => {
          if (!isDown) return;
          const dx = clientX - startX;
          if (Math.abs(dx) > 3) moved = true;
          scrollEl.scrollLeft = scrollLeft - dx;
        };
        const end = () => { isDown = false; scrollEl.style.cursor = 'grab'; };
        scrollEl.style.cursor = 'grab';
        scrollEl.addEventListener('mousedown', (e) => { if (e.button === 0) start(e.pageX); });
        scrollEl.addEventListener('mousemove', (e) => move(e.pageX));
        scrollEl.addEventListener('mouseleave', end);
        scrollEl.addEventListener('mouseup', end);
        scrollEl.addEventListener('wheel', (e) => {
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          if (delta !== 0) {
            e.preventDefault();
            scrollEl.scrollLeft += delta;
          }
        }, { passive: false });
        scrollEl.addEventListener('touchstart', (e) => { if (e.touches[0]) start(e.touches[0].pageX); }, { passive: true });
        scrollEl.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].pageX); }, { passive: true });
        scrollEl.addEventListener('touchend', end);
        scrollEl.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
      }
      try { scrollEl.scrollLeft = scrollEl.scrollWidth; } catch (e) {}
    }
    function removePendingImage(id) {
      pendingImagesStore = pendingImagesStore.filter(i => i.id !== id);
      renderPendingImages();
    }
    window.removePendingImage = removePendingImage;
    function consumePendingImageByNumber(num) {
      if (num == null) return;
      const before = pendingImagesStore.length;
      pendingImagesStore = pendingImagesStore.filter(
        (i) => String(i.globalNum) !== String(num)
      );
      if (pendingImagesStore.length !== before) renderPendingImages();
    }
    window.consumePendingImageByNumber = consumePendingImageByNumber;
    function getPendingImagesMeta() {
      return pendingImagesStore.map((i) => ({
        number: i.globalNum,
        tag: `#${i.globalNum}-rasm`,
        width: i.width,
        height: i.height,
        ratio: i.ratio,
        pending: true,
      }));
    }
    async function computeImageHash(base64) {
      if (!base64) return "";
      try {
        const enc = new TextEncoder().encode(base64.substring(0, 2000));
        const buf = await crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
      } catch (e) { return base64.substring(0, 32); }
    }
    function getImageDimensions(base64) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = base64;
      });
    }
    function renderChatPreviews() {
      const bar = document.getElementById('chatPreviewsBar');
      bar.innerHTML = '';
      const aiImages = uploadedImagesStore.filter(i => i.type === 'ai');
      if (aiImages.length === 0) { bar.style.display = 'none'; return; }
      bar.style.display = 'flex';
      aiImages.forEach((img) => {
        const card = document.createElement('div');
        card.className = 'chat-preview-card';
        card.innerHTML = `
          <div class="chat-preview-badge">#${img.globalNum}</div>
          <img src="${img.base64}" alt="#${img.globalNum}">
          <div class="chat-preview-tag">AI</div>
          <div class="chat-preview-remove" onclick="event.stopPropagation(); removePreviewImage('${img.id}')">×</div>
        `;
        card.onclick = () => openFullImageViewer(img.base64);
        bar.appendChild(card);
      });
    }
    function openFullImageViewer(ref) {
      let src = null;
      if (typeof ref === 'string' && (ref.startsWith('data:') || /^https?:\/\//i.test(ref))) {
        src = ref;
      } else if (typeof ref === 'string') {
        const found = uploadedImagesStore.find(i => i.id === ref) || bottomAiImages.find(i => i.id === ref);
        if (found) src = found.base64 || found.src;
      }
      if (!src) return;
      if (window.Swal) {
        Swal.fire({
          imageUrl: src,
          imageAlt: 'Rasm',
          showCloseButton: true,
          showConfirmButton: false,
          background: 'rgba(0,0,0,0.92)',
          width: 'auto',
          padding: '10px',
          customClass: { container: 'swal-image-popup-container', popup: 'swal-image-popup' },
        });
      } else {
        openLightbox(src);
      }
    }
    window.openFullImageViewer = openFullImageViewer;
    function bindHorizontalScroll(el) {
      if (!el || el._hScrollBound) return;
      el._hScrollBound = true;
      let isDown = false, startX = 0, scrollLeft = 0, moved = false;
      const start = (clientX) => { isDown = true; moved = false; startX = clientX - el.offsetLeft; scrollLeft = el.scrollLeft; el.style.cursor = 'grabbing'; };
      const move = (clientX) => {
        if (!isDown) return;
        const dx = clientX - el.offsetLeft - startX;
        if (Math.abs(dx) > 3) moved = true;
        el.scrollLeft = scrollLeft - dx;
      };
      const end = () => { isDown = false; el.style.cursor = 'grab'; };
      el.style.cursor = 'grab';
      el.addEventListener('mousedown', (e) => { if (e.button === 0) start(e.pageX); });
      el.addEventListener('mousemove', (e) => move(e.pageX));
      el.addEventListener('mouseleave', end);
      el.addEventListener('mouseup', end);
      el.addEventListener('wheel', (e) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta !== 0) { e.preventDefault(); el.scrollLeft += delta; }
      }, { passive: false });
      el.addEventListener('touchstart', (e) => { if (e.touches[0]) start(e.touches[0].pageX); }, { passive: true });
      el.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].pageX); }, { passive: true });
      el.addEventListener('touchend', end);
      el.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
    }
    function renderWorkspacePreviews() {
      const bar = document.getElementById('workspacePreviewsBar');
      const label = bar.querySelector('.label');
      bar.innerHTML = '';
      if (label) bar.appendChild(label);
      else {
        const l = document.createElement('span');
        l.className = 'label';
        l.innerText = '📄 Varoq uchun:';
        bar.appendChild(l);
      }
      const slideImages = uploadedImagesStore.filter(i => i.type === 'slide');
      if (slideImages.length === 0) { bar.style.display = 'none'; return; }
      bar.style.display = 'flex';
      slideImages.forEach((img) => {
        const card = document.createElement('div');
        card.className = 'workspace-preview-card';
        card.innerHTML = `
          <div class="workspace-preview-badge">#${img.globalNum}</div>
          <img src="${img.base64}" alt="#${img.globalNum}">
          <div class="workspace-preview-tag">Varoq uchun</div>
          <div class="chat-preview-remove" onclick="event.stopPropagation(); removePreviewImage('${img.id}')">×</div>
        `;
        card.onclick = () => openFullImageViewer(img.base64);
        bar.appendChild(card);
      });
      bindHorizontalScroll(bar);
    }
    function removePreviewImage(id) {
      uploadedImagesStore = uploadedImagesStore.filter(i => i.id !== id);
      renderChatPreviews();
      renderWorkspacePreviews();
      updateAttachButtonsUI();
    }
    function setupAttachButtons() {
      document.getElementById('attachBtnSidebar').addEventListener('click', (e) => {
        e.preventDefault();
        triggerSidebarImageUpload();
      });
      document.getElementById('attachBtnBottomModal').addEventListener('click', (e) => {
        e.preventDefault();
        triggerBottomModalImageUpload();
      });
    }
    function updateAttachButtonsUI() {
      const btnSidebar = document.getElementById('attachBtnSidebar');
      const hasAny = uploadedImagesStore.length > 0;
      if (btnSidebar) {
        if (hasAny) btnSidebar.classList.add('has-file');
        else btnSidebar.classList.remove('has-file');
      }
    }
    function openBottomAiModal() {
      document.getElementById('bottomAiSlideNum').innerText = activeIndex + 1;
      document.getElementById('bottomAiModal').classList.add('open');
      setTimeout(() => document.getElementById('bottomAiTextarea').focus(), 100);
    }
    function closeBottomAiModal() {
      document.getElementById('bottomAiModal').classList.remove('open');
    }
    function renderBottomAiPreviews() {
      const bar = document.getElementById('bottomAiPreviews');
      bar.innerHTML = '';
      if (bottomAiImages.length === 0) {
        bar.classList.remove('has-images');
        bar.style.display = 'none';
        return;
      }
      bar.classList.add('has-images');
      bar.style.display = 'flex';
      bottomAiImages.forEach((img) => {
        const card = document.createElement('div');
        card.className = 'workspace-preview-card';
        card.innerHTML = `
          <div class="workspace-preview-badge">#${img.globalNum}</div>
          <img src="${img.base64}" alt="#${img.globalNum}">
          <div class="workspace-preview-tag">Shu varoq</div>
          <div class="chat-preview-remove" onclick="event.stopPropagation(); removeBottomAiImage('${img.id}')">×</div>
        `;
        card.onclick = () => openFullImageViewer(img.base64);
        bar.appendChild(card);
      });
    }
    function removeBottomAiImage(id) {
      bottomAiImages = bottomAiImages.filter(i => i.id !== id);
      renderBottomAiPreviews();
    }
    function triggerBottomModalImageUpload() {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      fileInput.onchange = async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        showUploadOverlay('Rasmlar yuklanmoqda...', `${files.length} ta fayl`);
        try {
          const items = (await readFilesAsDataUrls(files)).filter(Boolean);
          if (items.length === 0) { showToast("Rasmlarni o'qib bo'lmadi", 'error'); return; }
          for (const it of items) await addToBottomAiContext(it.data);
          if (items.length > 1) showToast(`${items.length} ta rasm shu varoq uchun qo'shildi`);
        } catch (err) {
          showToast("Yuklashda xatolik", 'error');
        } finally {
          hideUploadOverlay();
        }
      };
      fileInput.click();
    }
    async function analyzeImageOnce(base64Data) {
      try {
        const res = await fetch('/api/analyze-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: [{ number: 1, src: base64Data }] }),
        });
        const data = await res.json();
        if (data && data.images && data.images[0]) return data.images[0].description || '';
      } catch (e) {  }
      return '';
    }
    async function addToBottomAiContext(base64Data) {
      globalImageCounter++;
      const num = globalImageCounter;
      const hash = await computeImageHash(base64Data);
      const dims = await getImageDimensions(base64Data);
      const obj = {
        id: `img_bottom_${Date.now()}_${num}`,
        base64: base64Data,
        globalNum: num,
        width: dims.width,
        height: dims.height,
        hash: hash,
        description: '',
      };
      bottomAiImages.push(obj);
      renderBottomAiPreviews();
      showToast(`#${num}-rasm shu varoq uchun qo'shildi`);
      analyzeImageOnce(base64Data).then((desc) => {
        obj.description = desc || '';
      });
    }
    function updateAllImageBadges() {
      const overlay = document.getElementById('imageBadgesOverlay');
      if (!overlay) return;
      overlay.innerHTML = '';
      canvas.forEachObject((obj) => {
        if (!obj) return;
        const isImg = obj.type === 'image' || obj.type === 'gifImage' || obj.type === 'videoImage' || obj.type === 'embedVideo' || obj.isGif || obj.isVideo || obj.isEmbed;
        if (!isImg) return;
        const num = obj.imageNumber;
        if (!num) return;
        const br = obj.getBoundingRect(true, true);
        const badge = document.createElement('div');
        badge.className = 'image-number-badge';
        const kind = (obj.isGif || obj.type === 'gifImage') ? 'GIF' : (obj.isVideo || obj.type === 'videoImage' || obj.type === 'embedVideo') ? 'VID' : '';
        badge.innerText = kind ? `#${num}-${kind}` : `#${num}`;
        badge.style.left = Math.max(0, br.left + br.width - 40) + 'px';
        badge.style.top = Math.max(0, br.top + br.height - 22) + 'px';
        overlay.appendChild(badge);
      });
    }
    function createHoverTooltip() {
      const tooltip = document.getElementById('imageHoverTooltip');
      canvas.on('mouse:move', (opt) => {
        const target = opt.target;
        const isMedia = target && (
          target.type === 'image' || target.type === 'gifImage' || target.type === 'videoImage' || target.type === 'embedVideo' ||
          target.isGif || target.isVideo || target.isEmbed
        );
        if (isMedia && target.imageNumber) {
          const w = Math.round((target.width || 0) * (target.scaleX || 1));
          const h = Math.round((target.height || 0) * (target.scaleY || 1));
          let slideNo = activeIndex + 1;
          slides.forEach((s, idx) => {
            if (s.imageNumbers && s.imageNumbers.includes(target.imageNumber)) slideNo = idx + 1;
          });
          const kind = (target.isGif || target.type === 'gifImage') ? 'GIF' :
                       (target.isVideo || target.type === 'videoImage' || target.type === 'embedVideo') ? 'Video' : 'rasm';
          tooltip.innerText = `#${target.imageNumber}-${kind} | ${w}×${h} | slide ${slideNo}`;
          tooltip.style.display = 'block';
          tooltip.style.left = (opt.e.clientX + 14) + 'px';
          tooltip.style.top = (opt.e.clientY + 14) + 'px';
        } else {
          tooltip.style.display = 'none';
        }
      });
      canvas.on('mouse:out', () => { tooltip.style.display = 'none'; });
    }
    // v36: matnni qidiruv kartasi atrofida bo'lib ko'rsatish: [qidiruvdan oldingi matn] [qidiruv kartasi] [qidiruvdan keyingi matn]
    function renderBotSegments(botEl, buf) {
      try {
        const br = window._aiSearchBreakRaw;
        if (br == null || !botEl || window._aiSearchBreakFor !== botEl.id) return false;
        const first = botEl.querySelector('.msg-text');
        const chip = (window.AiSearchUI && AiSearchUI.chipEl && AiSearchUI.chipEl()) || botEl.querySelector('.ai-search-chip');
        if (!first || !chip) return false;
        const norm = (t) => t.toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
        const before = _stripAiText((buf || '').slice(0, br));
        let after = _stripAiText((buf || '').slice(br));
        const seen = new Set(before.split(/\n{2,}/).map(norm).filter((k) => k.length >= 12));
        after = after.split(/\n{2,}/).filter((p) => !seen.has(norm(p))).join('\n\n').trim();
        let second = botEl.querySelector('.msg-text-after');
        if (!second) {
          second = document.createElement('div');
          second.className = first.className + ' msg-text-after';
          chip.insertAdjacentElement('afterend', second);
        }
        if (before) { first.style.display = ''; if (first.innerText !== before) first.innerText = before; }
        else { first.style.display = 'none'; }
        second.style.display = after ? '' : 'none';
        if (after && second.innerText !== after) second.innerText = after;
        return true;
      } catch (e) { return false; }
    }
    window.renderBotSegments = renderBotSegments;
    function handleAiResponseStream(chunk) {
      if (!isAiStreaming) return;
      currentAiStreamBuffer += chunk;
      try { persistStreamProgress(false); } catch (e) {}

      const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
      let match;
      while ((match = codeBlockRegex.exec(currentAiStreamBuffer)) !== null) {
        const jsonStr = match[1].trim();
        const blockHash = jsonStr.length + ':' + jsonStr.substring(0, 120) + ':' + jsonStr.substring(Math.max(0, jsonStr.length - 80));
        if (processedJsonBlocks.has(blockHash)) continue;
        try {
          const parsedData = repairAndParseJson(jsonStr);
          if (!parsedData) throw new Error('JSON tiklanmadi');
          processedJsonBlocks.add(blockHash);
          if (twoPassState && twoPassState.active &&
              parsedData && Array.isArray(parsedData.plan) && parsedData.plan.length) {
            const rtPlan = extractReplyText(parsedData);
            if (rtPlan) currentAiReplyText = rtPlan;
            handleTwoPassPlan(parsedData);
            continue;
          }
          const rt = extractReplyText(parsedData);
          if (rt) currentAiReplyText = rt;
          let acts = Array.isArray(parsedData) ? parsedData
            : (parsedData && Array.isArray(parsedData.actions)) ? parsedData.actions
            : [parsedData];
          try { stampActionOccurrences(acts); } catch (e) {}

          let isFinalFence = false;
          try {
            const fc = ((currentAiStreamBuffer || '').match(/```/g) || []).length;
            isFinalFence = (fc % 2 === 0 && fc > 0);
            if (isFinalFence) _partialConsumedLen = 999999;
          } catch (e) { isFinalFence = true; _partialConsumedLen = 999999; }

          function _expectedMinSlides(list) {
            let maxIdx = 0;
            let createExtra = 0;
            (list || []).forEach(function (a) {
              if (!a || !a.action) return;
              const name = String(a.action);
              if (/create_slides|add_slides|add_slide|new_slide/i.test(name)) {
                createExtra += Math.max(1, parseInt(a.count, 10) || 1);
              }
              if (/replace_slide|insert_slide|clear_slide/i.test(name)) {
                const s = parseInt(a.slide != null ? a.slide : a.after, 10);
                if (!isNaN(s) && s > maxIdx) maxIdx = s;
              }
            });
            return Math.max(maxIdx, createExtra > 0 ? createExtra : 0);
          }

          const STRUCT_RE = /create_slides|add_slide|add_slides|new_slide|new_slides|insert_slide|replace_slide|reset_deck|delete_extra|clear_slide|delete_slide/i;

          if (isFinalFence && acts && acts.length) {
            const expected = _expectedMinSlides(acts);
            const needRerun = expected > 0 && _aiQueuePending === 0 && !isAiApplyingCommands && (typeof slides === 'undefined' || !slides || slides.length < expected);
            if (needRerun) {
              console.warn('[AI] Final JSON: deck ' + (slides ? slides.length : 0) + '/' + expected + ' — structural qayta bajariladi');
              try {
                (acts || []).forEach(function (a) {
                  if (!a || !a.action) return;
                  if (STRUCT_RE.test(String(a.action))) {
                    try { executedActionSignatures.delete(stableActionSignature(a)); } catch (e) {}
                    if (/reset_deck|delete_extra/i.test(String(a.action))) {
                      try { executedActionSignatures.delete('RESET_DECK'); } catch (e) {}
                      try { _resetDeckAppliedThisStream = false; } catch (e) {}
                    }
                  }
                });
              } catch (e) {}
            }
          }

          let pending = (acts || []).filter((a) => {
            if (!a || !a.action) return false;
            try { return !executedActionSignatures.has(stableActionSignature(a)); } catch (e) { return true; }
          });

          if (isFinalFence && pending.length === 0 && acts.length) {
            const hasStruct = acts.some(function (a) {
              return a && STRUCT_RE.test(String(a.action || ''));
            });
            const deckSmall = !slides || slides.length <= 1;
            if (hasStruct && deckSmall && _aiQueuePending === 0 && !isAiApplyingCommands) {
              console.warn('[AI] Final: deck bo\'sh/1 ta — structural majburiy qayta ishlanadi');
              try {
                executedActionSignatures.clear();
                _resetDeckAppliedThisStream = false;
              } catch (e) {}
              pending = acts.filter(function (a) { return a && a.action; });
            }
          }

          if (pending.length) {
            enqueueAiCommands({ actions: pending });
          } else if (acts.length) {
            console.log('[AI] Yopilgan JSON: barcha actionlar allaqachon bajarilgan — qayta ishlanmadi');
            try {
              if (typeof renderSidebar === 'function') renderSidebar();
              if (typeof updateSlideCounterUI === 'function') updateSlideCounterUI();
              if (typeof loadSlideCanvasAsync === 'function' && slides && slides.length) {
                const idx = Math.min(Math.max(activeIndex || 0, 0), slides.length - 1);

                let same = false;
                try {
                  const want = (JSON.parse(slides[idx].json || '{}').objects || []).map(function (o) { return o && o._oid; }).filter(function (x) { return x != null; }).sort().join(',');
                  const have = canvas.getObjects().map(function (o) { return o._oid; }).filter(function (x) { return x != null; }).sort().join(',');
                  same = (want === have) && _lastRenderedSlideIndex === idx;
                } catch (e) { same = false; }
                if (!same) loadSlideCanvasAsync(idx).catch(function () {});
              }
            } catch (e) {}
          }
        } catch (e) {
        }
      }
      try { drainPartialActions(); } catch (e) {  }

      const partA = _stripAiText(currentAiStreamBuffer);
      const botMsgEl = document.getElementById(currentBotMsgId);
      const botTextSpan = botMsgEl?.querySelector('.msg-text');
      if (botTextSpan) {
        const buf = currentAiStreamBuffer || '';
        const hasToolOrJson = /DSML|search_images|"actions"|"action"|tool_call|function_call|invoke\s+name/i.test(buf)
          || (processedJsonBlocks && processedJsonBlocks.size > 0);

        if (partA && !partA.startsWith('{') && !partA.startsWith('[') && !/DSML|invoke\s+name|tool_call/i.test(partA)) {
          if (!renderBotSegments(botMsgEl, currentAiStreamBuffer)) { if (botTextSpan.innerText !== partA) botTextSpan.innerText = partA; }
        } else if (!hasToolOrJson && !processedJsonBlocks.size) {

          if (botTextSpan.innerText !== "💭 Fikrlanmoqda...") {
            botTextSpan.innerText = "💭 Fikrlanmoqda...";
          }
        } else {

          const searching = /search_images|DSML/i.test(buf);
          const hasSlideActs = /"replace_slide"|"insert_slide"|"clear_slide"|"reset_deck"|"add_gif"|"place_image"/i.test(buf);
          const slideMatches = buf.match(/"replace_slide"|"insert_slide"/gi) || [];
          const totalHint = (buf.match(/"slide"\s*:\s*(\d+)/g) || []).map(m => parseInt(m.replace(/\D/g, ''), 10)).filter(n => n > 0);
          const maxSlide = totalHint.length ? Math.max(...totalHint) : slideMatches.length;
          const doneCount = Math.min(slides.length, maxSlide || slideMatches.length);
          let statusText;
          if (searching && !hasSlideActs) {
            statusText = "🔍 Rasm qidirilmoqda...";
          } else if (hasSlideActs && maxSlide > 1) {
            statusText = `✨ Slayd yaratilmoqda ${doneCount}/${maxSlide}...`;
          } else if (hasSlideActs) {
            statusText = "✨ Slaydlar yangilanmoqda...";
          } else {
            statusText = "✨ O'zgartirishlar qo'llanilmoqda...";
          }
          if (botTextSpan.innerText !== statusText) botTextSpan.innerText = statusText;
          try { updateAiSlideProgressBadge(doneCount, maxSlide || 0, hasSlideActs); } catch (e) {}
        }
      }
    }
    function updateAiSlideProgressBadge(current, total, show) {
      let badge = document.getElementById('aiSlideProgressBadge');
      if (!show || !total || total < 1) {
        if (badge) badge.style.display = 'none';
        return;
      }
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'aiSlideProgressBadge';
        badge.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:40;background:rgba(11,87,208,.92);color:#fff;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.25);white-space:nowrap;';
        const wrap = document.getElementById('canvasWrapper') || document.getElementById('canvasCard') || document.body;
        wrap.style.position = wrap.style.position || 'relative';
        wrap.appendChild(badge);
      }
      badge.style.display = 'block';
      badge.textContent = `✨ Slayd ${Math.max(1, current)} / ${total} yaratilmoqda`;
    }
    function hideAiSlideProgressBadge() {
      const badge = document.getElementById('aiSlideProgressBadge');
      if (badge) badge.style.display = 'none';
    }
    window.hideAiSlideProgressBadge = hideAiSlideProgressBadge;
    function extractReplyText(data) {
      if (!data) return '';
      if (typeof data === 'string') return data.trim();
      if (Array.isArray(data)) {
        for (const it of data) {
          const t = extractReplyText(it);
          if (t) return t;
        }
        return '';
      }
      if (typeof data === 'object') {
        const keys = ['reply_text', 'replyText', 'reply', 'message', 'text', 'response'];
        for (const k of keys) {
          if (typeof data[k] === 'string' && data[k].trim()) return data[k].trim();
        }
      }
      return '';
    }
    let _aiQueuePending = 0;
    function enqueueAiCommands(parsedData) {
      _aiQueuePending++;
      aiProcessingQueue = aiProcessingQueue
        .then(() => executeAiCommands(parsedData))
        .catch(err => { console.error("AI command error:", err); try { isAiApplyingCommands = false; } catch (e) {} })
        .then(() => { _aiQueuePending = Math.max(0, _aiQueuePending - 1); });
      return aiProcessingQueue;
    }
    window.enqueueAiCommands = enqueueAiCommands;
    let _partialConsumedLen = 0;
    function _normAiGifQuery(q) {
      const t = String(q || '').trim();
      return t || 'funny';
    }
    async function _searchGifInBrowser(q) {
      // v22: Tenor yopilgan — server (/api/media-search: KLIPY + GIPHY) orqali qidiramiz
      let out = [];
      try {
        const r = await fetch('/api/media-search?provider=gif&limit=12&q=' + encodeURIComponent(_normAiGifQuery(q)));
        if (r.ok) {
          const d = await r.json();
          out = (d.results || []).filter(function (x) { return x && x.url; }).map(function (x) {
            return { url: x.url, thumb: x.thumbnail || x.url, title: q };
          });
        }
      } catch (e) {}
      if (out.length < 4 && typeof window.browserGifSearch === 'function') {  // v24: brauzerdan kalitsiz zaxira
        try {
          const extra = await window.browserGifSearch(_normAiGifQuery(q), 1, 12);
          out = out.concat(extra.map(function (x) { return { url: x.url, thumb: x.thumbnail || x.url, title: q }; }));
        } catch (e) {}
      }
      return out;
    }
    async function _searchPhotoInBrowser(q) {
      try {
        const r = await fetch('/api/media-search?provider=image&limit=12&q=' + encodeURIComponent(q));
        const d = await r.json();
        const out = (d.results || []).map(function (x) { return { url: x.url, thumb: x.thumbnail || x.url, title: q }; });
        if (out.length) return out;
      } catch (e) {}
      try {
        const w = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=' + encodeURIComponent(q) +
          '&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url&iiurlwidth=1200&format=json&origin=*';
        const r = await fetch(w);
        const d = await r.json();
        return Object.values((d.query && d.query.pages) || {}).map(function (p) {
          const i = p.imageinfo && p.imageinfo[0];
          const u = i && (i.thumburl || i.url);
          return (u && !/\.(svg|gif|tiff?|pdf)(\?|$)/i.test(u)) ? { url: u, thumb: u, title: p.title || q } : null;
        }).filter(Boolean);
      } catch (e) { return []; }
    }
    async function clientAiSearch(req) {
      let results = [];
      try {
        results = req.kind === 'gif' ? await _searchGifInBrowser(req.query) : await _searchPhotoInBrowser(req.query);
      } catch (e) { results = []; }
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'search_result', id: req.id, results: results.slice(0, 12) }));
        }
      } catch (e) {}
    }
    function drainPartialActions() {
      const buf = currentAiStreamBuffer;
      const fenceCount = (buf.match(/```/g) || []).length;
      let afterOpen;
      if (fenceCount % 2 === 1) {
        const openIdx = buf.lastIndexOf('```');
        afterOpen = buf.slice(openIdx + 3).replace(/^\s*(?:json)?\s*/i, '');
      } else if (fenceCount === 0) {
        const k = buf.indexOf('"actions"');
        if (k === -1) return;
        afterOpen = buf.slice(k);
      } else return;
      const arrKey = afterOpen.indexOf('"actions"');
      if (arrKey === -1) return;
      const bracketStart = afterOpen.indexOf('[', arrKey);
      if (bracketStart === -1) return;
      let depth = 0, objStart = -1, inStr = false, esc = false;
      const ready = [];
      for (let i = bracketStart + 1; i < afterOpen.length; i++) {
        const ch = afterOpen[i];
        if (inStr) {
          if (esc) { esc = false; }
          else if (ch === '\\') { esc = true; }
          else if (ch === '"') { inStr = false; }
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { if (depth === 0) objStart = i; depth++; }
        else if (ch === '}') {
          depth--;
          if (depth === 0 && objStart !== -1) {
            ready.push(afterOpen.slice(objStart, i + 1));
            objStart = -1;
          }
        } else if (ch === ']' && depth === 0) {
          break;
        }
      }
      if (ready.length <= _partialConsumedLen) return;

      const parsedAll = [];
      let parseOk = true;
      for (let i = 0; i < ready.length; i++) {
        try {
          const act = JSON.parse(ready[i]);
          parsedAll.push(act && act.action ? act : null);
        } catch (e) { parseOk = false; break; }
      }
      if (!parseOk && parsedAll.length <= _partialConsumedLen) return;

      try { stampActionOccurrences(parsedAll.filter(Boolean)); } catch (e) {}
      const liveOnes = parsedAll.slice(_partialConsumedLen).filter(Boolean);
      _partialConsumedLen = parsedAll.length;
      if (liveOnes.length) enqueueAiCommands({ actions: liveOnes });
    }
    function capturePreAiSnapshot() {
      try {
        window._preAiSlidesSnapshot = JSON.stringify({
          slides: (slides || []).map(s => ({
            json: s.json,
            thumb: s.thumb,
            imageNumbers: (s.imageNumbers || []).slice(),
          })),
          activeIndex: activeIndex,
        });
      } catch (e) {
        console.warn('capturePreAiSnapshot xatoligi:', e);
        window._preAiSlidesSnapshot = null;
      }
    }
    window.capturePreAiSnapshot = capturePreAiSnapshot;
    function undoAiChanges() {
      if (!window._preAiSlidesSnapshot) {
        showToast("Bekor qilish uchun oldingi holat topilmadi", 'error');
        return;
      }
      try {
        const backup = JSON.parse(window._preAiSlidesSnapshot);
        if (!backup || !Array.isArray(backup.slides) || backup.slides.length === 0) {
          showToast("Bekor qilish uchun oldingi holat topilmadi", 'error');
          return;
        }

        try { recordGlobalState(); } catch (e) {  }
        slides = backup.slides;
        activeIndex = Math.min(Math.max(backup.activeIndex || 0, 0), slides.length - 1);
        try { recalculateGlobalImageCounter(); } catch (e) {  }
        _lastRenderedSlideIndex = -1;
        loadSlideCanvas(activeIndex, () => {
          renderSidebar();
          updateSlideCounterUI();
          updateAllImageBadges();
          try { recordGlobalState(); } catch (e) {  }
          showToast("AI o'zgarishlari bekor qilindi (Ctrl+Y bilan qaytarish mumkin)");
        });

      } catch (e) {
        console.warn('undoAiChanges xatoligi:', e);
        showToast("Xatolik yuz berdi", 'error');
      }
    }
    window.undoAiChanges = undoAiChanges;

    const INTERRUPTED_KEY = 'slide_studio_interrupted_v1';
    const INTERRUPTED_MAX = 5;
    const INTERRUPTED_TTL = 24 * 3600 * 1000;
    const INTERRUPT_REASON_TEXT = {
      stopped: "siz to'xtatdingiz", length: "token chegarasiga yetdi", error: "xatolik yuz berdi",
      connection_lost: "ulanish uzildi", timeout: "vaqt tugadi", page_closed: "sahifa yopildi yoki yangilandi",
      limit: "limit tugadi", auth: "sessiya muddati tugadi"
    };

    const _TAB_SID = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);   // v38: faqat RAM
    let _streamCtx = null;
    let _continueOverride = null;
    let _persistLastTs = 0;
    let _interruptedMem = [];   // v38: localStorage o'rniga faqat RAM
    function _readInterrupted() {
      const now = Date.now();
      return _interruptedMem.filter((e) => e && e.id && (now - (e.ts || 0)) < INTERRUPTED_TTL);
    }
    function _writeInterrupted(list) {
      _interruptedMem = list.slice(-INTERRUPTED_MAX);
    }

    function _stripAiText(buf) {
      let s = String(buf || '');

      s = s.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
      s = s.replace(/<\/?think>/gi, '');

      s = s.replace(/```(?:json|xml|dsml|tool)?[\s\S]*?(?:```|$)/gi, '');

      s = s.replace(/\{[\s\S]*?"actions"[\s\S]*?\}/g, '');
      s = s.replace(/\{[\s\S]*?"action"[\s\S]*?\}/g, '');

      s = s.replace(/<\s*\|\s*\|\s*DSML\s*\|\s*\|[^>]*>/gi, '');
      s = s.replace(/<\/\s*\|\s*\|\s*DSML\s*\|\s*\|[^>]*>/gi, '');
      s = s.replace(/\|\s*\|\s*DSML\s*\|\s*\|/gi, '');

      s = s.replace(/<\s*(?:tool_call|function_call|function_calls|tool_calls|invoke|parameter|calls)\b[^>]*>[\s\S]*?(?:<\/\s*(?:tool_call|function_call|function_calls|tool_calls|invoke|parameter|calls)\s*>|$)/gi, '');
      s = s.replace(/<\/?\s*(?:tool_call|function_call|function_calls|tool_calls|invoke|parameter|calls)\b[^>]*>/gi, '');

      s = s.replace(/\binvoke\s+name\s*=\s*"[^"]*"/gi, '');
      s = s.replace(/\bparameter\s+name\s*=\s*"[^"]*"[^>]*>/gi, '');
      s = s.replace(/\bstring\s*=\s*"(?:true|false)"\s*>/gi, '');

      s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      // v29: bir xil abzats ikki marta chiqmasin (AI qidiruvdan keyin javobni qaytadan yozib yuborsa)
      try {
        const seen = new Set();
        const norm = (t) => t.toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
        s = s.split(/\n{2,}/).filter((para) => {
          const k = norm(para);
          if (k.length < 12) return true;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).join('\n\n');
      } catch (e) {}
      return s;
    }
    window._stripAiText = _stripAiText;
    function upsertInterrupted(reason) {
      if (!_streamCtx) return null;
      let partial = _stripAiText(currentAiStreamBuffer);
      if (_streamCtx.prevPartial) partial = (_streamCtx.prevPartial + (partial ? '\n' : '') + partial).trim();
      const entry = {
        id: _streamCtx.id,
        projectId: currentProjectId || null,
        sid: _TAB_SID,
        prompt: _streamCtx.prompt,
        partial: partial.slice(-3000),
        reason: reason || 'page_closed',
        ts: Date.now(),
      };
      const list = _readInterrupted();
      const i = list.findIndex((e) => e.id === entry.id);
      if (i >= 0) list[i] = entry; else list.push(entry);
      _writeInterrupted(list);
      return entry;
    }
    function clearInterrupted(id) {
      _writeInterrupted(_readInterrupted().filter((e) => e.id !== id));
      try {
        document.querySelectorAll('.ai-msg[data-interrupted-id="' + id + '"]').forEach((m) => {
          delete m.dataset.interruptedId;
          const n = m.querySelector('.ai-interrupted-note');
          if (n) n.remove();
          m.classList.remove('interrupted');
        });
        refreshChatMessageActions();
      } catch (e) {  }
    }
    function persistStreamProgress(force) {
      if (!_streamCtx || !isAiStreaming) return;
      const now = Date.now();
      if (!force && now - _persistLastTs < 1500) return;
      _persistLastTs = now;
      upsertInterrupted('page_closed');
    }
    function _setInterruptedNote(botEl, entry) {
      if (!botEl) return;
      botEl.classList.add('interrupted');
      let note = botEl.querySelector('.ai-interrupted-note');
      if (!note) {
        note = document.createElement('div');
        note.className = 'ai-interrupted-note';
        const span = botEl.querySelector('.msg-text');
        if (span) span.insertAdjacentElement('afterend', note); else botEl.appendChild(note);
      }
      note.textContent = "⚠️ Javob to'liq emas (" + (INTERRUPT_REASON_TEXT[entry.reason] || entry.reason || 'uzildi') + ")";
    }
    window._autoContCount = 0;
    function _scheduleAutoContinue(entry, reason) {
      // Faqat token limiti (length) da avtomatik davom — ulanish uzilishi / xato da faqat
      // «Davom ettirish» tugmasi (foydalanuvchi o'zi bosadi). Aks holda AI o'zi qayta ishlab
      // dublikat slayd / element qo'shib yuboradi.
      if (reason !== 'length') return;
      if (window._userStoppedAi) return;
      if (window._autoContCount >= 1) return;
      window._autoContCount++;
      let tries = 0;
      const tick = function () {
        tries++;
        if (tries > 15) return;
        if (window._userStoppedAi) return;
        const ready = !isAiStreaming && typeof isSocketReady === 'function' && isSocketReady();
        if (!ready) { setTimeout(tick, 800); return; }
        window._autoContinuing = true;
        showToast('Token limiti — avtomatik davom ettirilmoqda…');
        Promise.resolve(continueInterrupted(entry.id)).catch(function () { window._autoContinuing = false; });
      };
      setTimeout(tick, 2000);
    }
    function markStreamInterrupted(reason) {
      if (!_streamCtx) return;
      const entry = upsertInterrupted(reason);
      _streamCtx = null;
      if (!entry) return;
      try { _scheduleAutoContinue(entry, reason); } catch (e) {}
      const botEl = currentBotMsgId ? document.getElementById(currentBotMsgId) : null;
      if (!botEl) return;
      botEl.dataset.interruptedId = entry.id;
      const span = botEl.querySelector('.msg-text');
      if (span) {
        const cur = (span.innerText || '').trim();
        if (!cur || cur.startsWith('💭') || cur.startsWith('✨')) {
          span.innerText = entry.partial || "Javob boshlanmasdan uzildi.";
        }
      }
      _setInterruptedNote(botEl, entry);
      refreshChatMessageActions();
      try { document.getElementById('aiChatBody').scrollTop = 1e9; } catch (e) {}
    }
    function restoreInterruptedMessages() {
      const chatBody = document.getElementById('aiChatBody');
      if (!chatBody) return;
      const pid = currentProjectId || null;
      _readInterrupted().forEach((e) => {
        if ((e.projectId || null) !== pid) return;

        if (!pid && e.sid !== _TAB_SID) return;
        if (_streamCtx && _streamCtx.id === e.id) return;
        if (chatBody.querySelector('.ai-msg[data-interrupted-id="' + e.id + '"]')) return;
        appendAiChatMessage('user', e.prompt || '…');
        const botId = appendAiChatMessage('bot', e.partial || "Javob boshlanmasdan uzildi.");
        const el = document.getElementById(botId);
        if (el) { el.dataset.interruptedId = e.id; _setInterruptedNote(el, e); }
      });
      refreshChatMessageActions();
    }
    window.restoreInterruptedMessages = restoreInterruptedMessages;
    function purgeInterruptedForCurrentProject() {
      const pid = currentProjectId || null;
      _writeInterrupted(_readInterrupted().filter((e) => (e.projectId || null) !== pid));
    }
    window.purgeInterruptedForCurrentProject = purgeInterruptedForCurrentProject;
    async function continueInterrupted(id) {
      if (isAiStreaming) { showToast("AI hali javob bermoqda. Avval to'xtating.", 'error'); return; }
      if (!isUserLoggedIn()) { requireLoginToast(); return; }
      const entry = _readInterrupted().find((e) => e.id === id);
      if (!entry) return;
      const tokenOk = await ensureValidToken();
      if (!tokenOk) return;
      let h = collectChatHistory(10).slice();
      while (h.length && h[h.length - 1].role === 'user') h.pop();
      h.push({ role: 'user', text: entry.prompt });
      h.push({ role: 'model', text: entry.partial || '(javob endigina boshlangan edi)' });
      const why = INTERRUPT_REASON_TEXT[entry.reason] || 'uzildi';
      _continueOverride = {
        entry,
        origPrompt: entry.prompt,
        prevPartial: entry.partial || '',
        history: h,
        prompt: "[DAVOM ETTIRISH] Oldingi javobing to'liq tugamadi (" + why + "). " +
          "Foydalanuvchining asl buyrug'i: \"" + entry.prompt + "\". " +
          "Aynan to'xtagan joyingdan davom et.",
        hint: "DAVOM ETTIRISH REJIMI: oldingi javobing uzilib qoldi. Hozirgi slayd holati (deck_state) allaqachon " +
          "bajarilgan amallarni o'z ichiga oladi — ularni QAYTA yaratma, takrorlama, reset_deck ISHLATMA. " +
          "Faqat hali bajarilmagan qolgan ishni bajar (yetishmayotgan slaydlar/elementlar) va qisqa yakunla.",
      };
      await sendSidebarAiPrompt();
    }
    window.continueInterrupted = continueInterrupted;
    function addInterruptedButtons(actions, msgDiv) {
      const iid = msgDiv.dataset.interruptedId;
      if (!iid) return;
      const entry = _readInterrupted().find((e) => e.id === iid);
      if (!entry) {
        delete msgDiv.dataset.interruptedId;
        const n = msgDiv.querySelector('.ai-interrupted-note'); if (n) n.remove();
        msgDiv.classList.remove('interrupted');
        return;
      }
      const cont = document.createElement('button');
      cont.className = 'ai-action-btn continue-btn';
      cont.type = 'button';
      cont.dataset.role = 'continue';
      cont.innerHTML = '<span class="material-symbols-outlined">play_arrow</span> Davom ettirish';
      cont.onclick = (e) => { e.stopPropagation(); continueInterrupted(iid); };
      actions.insertBefore(cont, actions.firstChild);
      const dis = document.createElement('button');
      dis.className = 'ai-action-btn';
      dis.type = 'button';
      dis.dataset.role = 'dismiss-continue';
      dis.innerHTML = '<span class="material-symbols-outlined">close</span> Yopish';
      dis.onclick = (e) => { e.stopPropagation(); clearInterrupted(iid); };
      actions.appendChild(dis);
    }
    window.addEventListener('pagehide', () => {
      try { if (isAiStreaming && _streamCtx) upsertInterrupted('page_closed'); } catch (e) {  }
    });
    function startAiStream() {
      window._aiTurnId = (window._aiTurnId || 0) + 1;
      isAiStreaming = true;
      aiSessionActive = true;
      currentAiStreamBuffer = "";
      currentAiReplyText = "";
      processedJsonBlocks.clear();
      executedActionSignatures.clear();
      _resetDeckAppliedThisStream = false;
      _partialConsumedLen = 0;
      _lastRenderedSlideIndex = -1;
      try { lastActionReport = []; } catch (e) {}
      // Yangi so'rov — avtomatik davom hisoblagichini tiklash (auto-continue o'zi emas)
      if (!window._autoContinuing) window._autoContCount = 0;
      updateSendButtons(true);
      startAiWatchdog();
      try { persistStreamProgress(true); } catch (e) {}
    }
    window.startAiStream = startAiStream;

    function recoverPendingAiActions() {
      const buf = currentAiStreamBuffer || '';
      if (!buf.trim()) return;
      const STRUCT_RE = /create_slides|add_slide|add_slides|new_slide|new_slides|insert_slide|replace_slide|reset_deck|delete_extra|clear_slide|delete_slide/i;
      const collected = [];

      try {
        const re = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
        let m;
        while ((m = re.exec(buf)) !== null) {
          const jsonStr = (m[1] || '').trim();
          if (!jsonStr) continue;
          const blockHash = jsonStr.length + ':' + jsonStr.substring(0, 120) + ':' + jsonStr.substring(Math.max(0, jsonStr.length - 80));
          if (processedJsonBlocks.has(blockHash)) continue;
          try {
            const parsedData = typeof repairAndParseJson === 'function' ? repairAndParseJson(jsonStr) : JSON.parse(jsonStr);
            if (!parsedData) continue;
            processedJsonBlocks.add(blockHash);
            let acts = Array.isArray(parsedData) ? parsedData
              : (parsedData && Array.isArray(parsedData.actions)) ? parsedData.actions
              : (parsedData && parsedData.action) ? [parsedData] : [];
            acts.forEach(function (a) { if (a && a.action) collected.push(a); });
          } catch (e) {  }
        }
      } catch (e) {  }

      try { drainPartialActions(); } catch (e) {  }

      if (!collected.length) {
        try {
          const idx = buf.search(/\{\s*"actions"\s*:\s*\[/);
          if (idx >= 0) {
            let depth = 0, end = -1, inStr = false, esc = false;
            for (let i = idx; i < buf.length; i++) {
              const ch = buf[i];
              if (inStr) {
                if (esc) esc = false;
                else if (ch === '\\') esc = true;
                else if (ch === '"') inStr = false;
                continue;
              }
              if (ch === '"') { inStr = true; continue; }
              if (ch === '{') depth++;
              else if (ch === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
              }
            }
            if (end > idx) {
              const raw = buf.slice(idx, end + 1);
              const parsedData = typeof repairAndParseJson === 'function' ? repairAndParseJson(raw) : JSON.parse(raw);
              let acts = Array.isArray(parsedData) ? parsedData
                : (parsedData && Array.isArray(parsedData.actions)) ? parsedData.actions
                : [];
              acts.forEach(function (a) { if (a && a.action) collected.push(a); });
            }
          }
        } catch (e) {  }
      }
      if (!collected.length) return;
      try { stampActionOccurrences(collected); } catch (e) {}

      const deckSmall = !slides || slides.length <= 1;
      const hasStruct = collected.some(function (a) { return a && STRUCT_RE.test(String(a.action || '')); });
      if (deckSmall && hasStruct) {
        try {
          collected.forEach(function (a) {
            if (!a || !a.action) return;
            if (STRUCT_RE.test(String(a.action))) {
              try { executedActionSignatures.delete(stableActionSignature(a)); } catch (e2) {}
            }
          });
          try { executedActionSignatures.delete('RESET_DECK'); } catch (e2) {}
          try { _resetDeckAppliedThisStream = false; } catch (e2) {}
        } catch (e) {}
      }
      const pending = collected.filter(function (a) {
        if (!a || !a.action) return false;
        try { return !executedActionSignatures.has(stableActionSignature(a)); } catch (e) { return true; }
      });
      if (pending.length) {
        console.warn('[AI] recoverPendingAiActions: ' + pending.length + ' ta action qayta qo\'llanmoqda');
        enqueueAiCommands({ actions: pending });
      }
    }
    window.recoverPendingAiActions = recoverPendingAiActions;

    async function finishAiStream() {

      try { recoverPendingAiActions(); } catch (e) { console.warn('recoverPendingAiActions:', e); }
      try {
        if (aiProcessingQueue && typeof aiProcessingQueue.then === 'function') {
          await aiProcessingQueue;
        }
      } catch (e) { console.warn('AI queue await:', e); }
      isAiStreaming = false;
      clearAiWatchdog();
      updateSendButtons(false);
      aiSessionActive = false;
      try { hideAiSlideProgressBadge(); } catch (e) {}
      if (currentAiStreamBuffer && currentAiStreamBuffer.trim()) {

        let historyText = _stripAiText(currentAiStreamBuffer);
        if (!historyText || /DSML|invoke\s+name|tool_call|function_call/i.test(historyText)) {
          const didActs = (typeof lastActionReport !== 'undefined' && lastActionReport && lastActionReport.length > 0);
          historyText = didActs ? '✨ [Slayd yangilandi]' : '✨ [Bajarildi]';
        }
        saveMessageToLocal('model', historyText);

        if (currentBotMsgId) {
          const botEl = document.getElementById(currentBotMsgId);
          if (botEl) {
            try { botEl.dataset.fullResponse = currentAiStreamBuffer; } catch (e) {}
            const span = botEl.querySelector('.msg-text');
            if (span) { if (!renderBotSegments(botEl, currentAiStreamBuffer)) span.innerText = historyText; }
          }
        }
      }
      currentAiStreamBuffer = "";
      currentAiReplyText = "";
      processedJsonBlocks.clear();
      _partialConsumedLen = 0;
      try { cleanupStrayDuplicateSlides(); } catch (e) {  }

      const didApplyActions = (typeof lastActionReport !== 'undefined' && lastActionReport && lastActionReport.length > 0);

      if (typeof _sidebarRenderTimer !== 'undefined' && _sidebarRenderTimer) {
        clearTimeout(_sidebarRenderTimer); _sidebarRenderTimer = null;
      }
      if (didApplyActions) {

        const keepIdx = (typeof activeIndex === 'number' && activeIndex >= 0) ? activeIndex : 0;

        try { renderSidebar(); } catch (e) {}
        try { updateSlideCounterUI(); } catch (e) {}
        try { updateAllImageBadges(); } catch (e) {}
        try { recordGlobalState(); } catch (e) {}
        try { renderWorkspacePreviews(); } catch (e) {  }
        try { if (typeof refreshChatMessageActions === 'function') refreshChatMessageActions(); } catch (e) {}
        // AI tugagach bo'sh kanvas qolmasin — faol slaydni majburiy qayta yuklash
        try {
          let _needReload = true;
          try {   // v36: kanvasda allaqachon element bor bo'lsa qayta chizmaymiz (oz-ozdan qayta yuklanish ko'rinmasin)
            const _sj = JSON.parse(slides[keepIdx].json || '{}');
            if (canvas && canvas.getObjects().length > 0 && canvas.getObjects().length >= (_sj.objects || []).length) _needReload = false;
          } catch (e) {}
          if (_needReload && typeof loadSlideCanvasAsync === 'function' && Array.isArray(slides) && slides[keepIdx]) {
            _lastRenderedSlideIndex = -1;
            loadSlideCanvasAsync(keepIdx).then(function () {
              try { if (typeof GifOverlay !== 'undefined') GifOverlay.sync(); } catch (e) {}
              try { if (typeof GifBackground !== 'undefined') GifBackground.applyFromSlide(slides[keepIdx].json); } catch (e) {}
              try { canvas && canvas.requestRenderAll(); } catch (e) {}
            }).catch(function () {});
          }
        } catch (e) {}

        try {
          if (false && typeof ensureSlideMediaLoaded === 'function' && Array.isArray(slides) && slides[keepIdx]) {   // v36: ikkinchi qayta yuklash o'chirildi
            (async function () {
              try { await ensureSlideMediaLoaded(keepIdx); } catch (e) {}
              try {
                if (typeof activeIndex === 'number' && activeIndex !== keepIdx) activeIndex = keepIdx;
              } catch (e2) {}
              try {
                if (typeof GifOverlay !== 'undefined' && GifOverlay.sync) GifOverlay.sync();
              } catch (e) {}
              try {
                if (typeof GifBackground !== 'undefined' && slides[keepIdx] && keepIdx === activeIndex) GifBackground.applyFromSlide(slides[keepIdx].json);
              } catch (e) {}
            })();
          }
        } catch (e) {}
      }
      try { if (window.SlideGuard) window.SlideGuard.afterFinish(); } catch (e) {}

    }
    window.finishAiStream = finishAiStream;
    function normalizeSlideJsonForCompare(json) {
      try {
        const p = JSON.parse(json || '{}');
        (p.objects || []).forEach((o) => { if (o && typeof o === 'object') { delete o._oid; delete o.id; } });
        return JSON.stringify(p);
      } catch (e) { return json; }
    }
    function cleanupStrayDuplicateSlides() {

      if (!Array.isArray(slides) || slides.length <= 1) return;
      const isEffectivelyEmpty = (s) => {
        try {
          const p = JSON.parse(s.json || '{}');
          const objs = p.objects || [];
          if (objs.length === 0) return true;

          return objs.every((o) => {
            if (!o) return true;
            if ((o.type === 'textbox' || o.type === 'text' || o.type === 'i-text') && !(o.text || '').trim()) return true;
            return false;
          });
        } catch (e) { return false; }
      };
      const cleaned = [];
      let removed = 0;
      // v30: AI so'ragan yangi slaydlar (bo'sh bo'lsa ham) HECH QACHON o'chirilmaydi —
      // aks holda "4 ta varaq" so'ralganda 2 tasi qolardi. Bo'sh slaydlarni keyin AI to'ldiradi (slide guard).
      const _isProtected = (s) => {
        try { return !!(s && s._aiTurn != null && s._aiTurn === (window._aiTurnId || 0)); } catch (e) { return false; }
      };
      for (let i = 0; i < slides.length; i++) {
        const cur = slides[i];
        const prev = cleaned[cleaned.length - 1];
        if (prev && isEffectivelyEmpty(prev) && isEffectivelyEmpty(cur) && !_isProtected(cur) && !_isProtected(prev)) {
          removed++;
          continue;
        }
        cleaned.push(cur);
      }
      if (removed > 0 && cleaned.length >= 1) {
        slides = cleaned;
        if (activeIndex >= slides.length) activeIndex = slides.length - 1;
        if (activeIndex < 0) activeIndex = 0;
        console.warn(`[cleanup] ${removed} ta bo'sh nusxa slayd olib tashlandi.`);
      }
    }
    window.cleanupStrayDuplicateSlides = cleanupStrayDuplicateSlides;
    function updateSendButtons(isStreaming) {
      const sidebarBtn = document.getElementById('btnSidebarAi');
      const bottomBtn = document.getElementById('btnBottomAiSend');
      if (isStreaming) {
        if (sidebarBtn) {
          sidebarBtn.classList.add('stop-mode');
          sidebarBtn.innerHTML = `<span class="material-symbols-outlined">stop</span>`;
          sidebarBtn.onclick = stopAiStream;
        }
        if (bottomBtn) {
          bottomBtn.classList.add('stop-mode');
          bottomBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">stop</span> To'xtatish`;
          bottomBtn.onclick = stopAiStream;
        }
      } else {
        if (sidebarBtn) {
          sidebarBtn.classList.remove('stop-mode');
          sidebarBtn.innerHTML = `<span class="material-symbols-outlined">send</span>`;
          sidebarBtn.onclick = sendSidebarAiPrompt;
        }
        if (bottomBtn) {
          bottomBtn.classList.remove('stop-mode');
          bottomBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">send</span> Yuborish`;
          bottomBtn.onclick = sendBottomAiPrompt;
        }
      }
    }
    window.updateSendButtons = updateSendButtons;
    function stopAiStream() {
      // Foydalanuvchi aniq to'xtatdi — avtomatik davomni o'chirish
      window._autoContCount = 99;
      window._autoContinuing = false;
      window._userStoppedAi = true;
      if (isAiStreaming) {
        try { markStreamInterrupted('stopped'); } catch (e) {}
      }
      isAiStreaming = false;
      isAiApplyingCommands = false;
      if (twoPassState) twoPassState = null;
      _streamCtx = null;
      clearAiWatchdog();
      updateSendButtons(false);
      aiSessionActive = false;
      try { recordGlobalState(); } catch (e) {}
      try { _manualSocketClose = true; if (socket) socket.close(); } catch (e) {}
      // Socket qayta ochilishi mumkin — lekin yangi stream boshlanmasin
      setTimeout(() => { window._userStoppedAi = false; }, 3000);
      showToast("AI javobi to'xtatildi.");
    }
    window.stopAiStream = stopAiStream;
    async function sendBottomAiPrompt() {
      if (!isUserLoggedIn()) { requireLoginToast(); return; }
      const tokenOk = await ensureValidToken();
      if (!tokenOk) return;

      try { if (window.Monitoring && typeof window.Monitoring.guardSend === 'function' && !window.Monitoring.guardSend()) return; } catch (e) {  }
      if (isAiStreaming) {
        showToast("AI hali javob bermoqda. Tugaguncha kuting yoki To'xtatishni bosing.", 'error');
        return;
      }
      const promptText = document.getElementById('bottomAiTextarea').value.trim();
      if (!promptText && bottomAiImages.length === 0) {
        showToast("Buyruq yoki rasm kiriting!", 'error');
        return;
      }
      saveCurrentSlideState();
      capturePreAiSnapshot();
      const currentSlideData = slides[activeIndex] || {};
      const parsedCurrent = JSON.parse(currentSlideData.json || '{}');
      const aiImages = bottomAiImages
        .filter(i => !i.description)
        .map(i => i.base64)
        .filter(Boolean)
        .slice(0, 5);
      const pendingImagesContext = getPendingImagesMeta();
      const slideImagesContext = [
        ...pendingImagesContext,
        ...uploadedImagesStore
          .filter(i => i.type === 'slide')
          .map(i => ({ number: i.globalNum, tag: `#${i.globalNum}-rasm`, width: i.width, height: i.height })),
        ...bottomAiImages.map(i => ({
          number: i.globalNum,
          tag: `#${i.globalNum}-rasm`,
          width: i.width,
          height: i.height,
          description: i.description || '',
        })),
      ];
      appendAiChatMessage('user', `📄 [Varoq ${activeIndex + 1}] ${promptText || '[Rasm]'}`, []);
      saveMessageToLocal('user', `📄 [Varoq ${activeIndex + 1}] ${promptText || '[Rasm]'}`);
      currentBotMsgId = appendAiChatMessage('bot', '💭 ...');
            _streamCtx = {
              id: 'int_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              prompt: promptText || '[Rasm]',
              prevPartial: '',
            };
            startAiStream();
      let deckMapBottom = [];
      try { deckMapBottom = extractDeckStateMap(); } catch (e) { deckMapBottom = []; }
      const deckState = {
        scope: 'current_slide',
        active_slide: activeIndex + 1,
        total_slides: slides.length,
        presentation: deckMapBottom,
        slide_data: {
          background: parsedCurrent.background || '#ffffff',
          backgroundVideo: (parsedCurrent.backgroundVideo && parsedCurrent.backgroundVideo.url) ? { url: parsedCurrent.backgroundVideo.url } : null,
          backgroundGif: (parsedCurrent.backgroundGif && (parsedCurrent.backgroundGif.src || parsedCurrent.backgroundGif.url))
            ? { src: parsedCurrent.backgroundGif.src || parsedCurrent.backgroundGif.url,
                width: parsedCurrent.backgroundGif.width || null,
                height: parsedCurrent.backgroundGif.height || null }
            : null,
          elements: (parsedCurrent.objects || []).map(o => {
            const isGif = !!(o.isGif || o.type === 'gifImage' || o.gifUrl);
            const isImg = isGif || o.type === 'image' || o.type === 'videoImage' || o.type === 'embedVideo' || o.isVideo || o.isEmbed;
            const isText = o.type === 'textbox' || o.type === 'i-text' || o.type === 'text';
            return {
              type: isGif ? 'gif' : ((o.type === 'embedVideo' || o.isEmbed) ? 'video' : ((o.type === 'slideButton' || o.isButton) ? 'button' : o.type)),
              id: o._oid,
              text: (o.text || '').slice(0, 120),
              imageNumber: o.imageNumber || null,
              kind: isGif ? 'gif' : (isImg ? 'image' : (isText ? 'text' : 'shape')),
              left: Math.round(o.left || 0),
              top: Math.round(o.top || 0),
              width: Math.round((o.width || 0) * (o.scaleX || 1)),
              height: Math.round((o.height || 0) * (o.scaleY || 1)),
              angle: Math.round(o.angle || 0),
              scaleX: o.scaleX || 1,
              scaleY: o.scaleY || 1,
              fill: o.fill || null,
              stroke: o.stroke || null,
              fontSize: o.fontSize || null,
              fontFamily: o.fontFamily || null,
              opacity: o.opacity != null ? o.opacity : 1,
              animation: o.animName || undefined,
              url: (o.type === 'embedVideo' || o.isEmbed) ? (o.embedUrl || '') : undefined,
              buttonText: (o.type === 'slideButton' || o.isButton) ? (o.btnLabel || '') : undefined,
              click: (o.type === 'slideButton' || o.isButton) ? (o.btnAction || 'next') : undefined,
            };
          }),
          imageNumbers: currentSlideData.imageNumbers || [],
        },
        slide_images_pending: slideImagesContext.filter(x => x && x.number != null),
        next_global_image_number: globalImageCounter + 1,
        next_object_id: globalObjectIdCounter + 1,
      };
      const reportLines = (lastActionReport || []).slice(-20);
      const reportHint = reportLines.length
        ? `[OLDINGI AMALLAR HISOBOTI — HAQIQIY NATIJA]\n` + reportLines.join('\n') +
          `\nBu — oldingi javobingizdagi amallarning HAQIQIY natijasi. ❌ = bajarilmagan (yolg'on aytmang), ✅ = bajarilgan (qayta bajarmang).`
        : '';
      const payload = {
        token: supabaseToken,
        chat_id: currentChatId,
        scope: 'current_slide',
        prompt: promptText,
        system_hint: reportHint,
        deck_state: JSON.stringify(deckState),
        active_slide_index: activeIndex + 1,
        images_base64: [],
        images_meta: slideImagesContext,
        chat_history: collectChatHistory(10),
        model: document.getElementById('aiModelSelect').value,
      };
      if (!sendOverSocket(payload)) {
        const _failId2 = _streamCtx && _streamCtx.id;
        isAiStreaming = false;
        _streamCtx = null;
        if (_failId2) _writeInterrupted(_readInterrupted().filter((e) => e.id !== _failId2));
        clearAiWatchdog();
        updateSendButtons(false);
        return;
      }
      document.getElementById('bottomAiTextarea').value = '';
      closeBottomAiModal();
    }
    let twoPassState = null;
    function detectMultiSlideRequest(text) {
      if (!text) return 0;
      const t = String(text).toLowerCase();
      const m = t.match(/(\d{1,2})\s*(?:ta\s*)?(?:slayd|slide|varaq|bet)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 2 && n <= 30) return n;
      }
      if (/(taqdimot|prezentatsiya|presentation|deck)\b/.test(t) &&
          /(yasa|tuz|qil|create|make|generate|tayyorla)/.test(t)) {
        return 5;
      }
      return 0;
    }
    function startTwoPassGeneration(promptText, basePayload) {
      twoPassState = {
        active: true,
        plan: [],
        index: 0,
        basePayload: basePayload,
        prompt: promptText,
      };
      const planPayload = Object.assign({}, basePayload, {
        mode: 'plan',
        prompt: promptText,
      });
      startAiStream();
      if (!sendOverSocket(planPayload)) {
        twoPassState = null;
        isAiStreaming = false;
        clearAiWatchdog();
        updateSendButtons(false);
      }
    }
    function sendNextTwoPassSlide() {
      if (!twoPassState || !twoPassState.active) return;
      const st = twoPassState;
      if (st.index >= st.plan.length) {
        twoPassState = null;
        finishAiStream();
        return;
      }
      if (st.index === 0 && !st._resetDone) {
        st._resetDone = true;
        try {
          while (slides.length > 1) { slides.pop(); }
          slides[0] = {
            json: JSON.stringify({ objects: [], background: '#ffffff' }),
            thumb: '',
            imageNumbers: [],
          };
          activeIndex = 0;
          if (typeof loadSlideCanvasAsync === 'function') {
            loadSlideCanvasAsync(0);
          }
          if (typeof renderSidebar === 'function') renderSidebar();
          if (typeof updateSlideCounterUI === 'function') updateSlideCounterUI();
        } catch (e) { console.warn('Two-pass reset xatosi:', e); }
      }
      const genPayload = Object.assign({}, st.basePayload, {
        mode: 'generate',
        prompt: st.prompt,
        plan_slides: st.plan,
        plan_index: st.index,
      });
      st.index += 1;
      startAiStream();
      if (!sendOverSocket(genPayload)) {
        twoPassState = null;
        isAiStreaming = false;
        clearAiWatchdog();
        updateSendButtons(false);
      }
    }
    function handleTwoPassPlan(parsedData) {
      if (!twoPassState || !twoPassState.active) return false;
      const plan = parsedData && Array.isArray(parsedData.plan) ? parsedData.plan : null;
      if (!plan || !plan.length) return false;
      twoPassState.plan = plan;
      twoPassState.index = 0;
      const botEl = document.getElementById(currentBotMsgId);
      if (botEl) {
        const span = botEl.querySelector('.msg-text');
        if (span) span.innerText = `📋 Reja tayyor (${plan.length} slayd). Slaydlar ketma-ket yaratilmoqda...`;
      }
      return true;
    }
