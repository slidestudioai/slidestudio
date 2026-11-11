    function showErrorPopup(msg) {
      let popup = document.getElementById('errorPopup');
      if (!popup) {
        popup = document.createElement('div');
        popup.id = 'errorPopup';
        popup.className = 'error-popup';
        popup.innerHTML = '<span class="error-popup-text"></span>' +
          '<button class="error-popup-close" title="Yopish">×</button>';
        document.body.appendChild(popup);
        popup.querySelector('.error-popup-close').addEventListener('click', () => {
          popup.classList.remove('show');
        });
      }
      const txtEl = popup.querySelector('.error-popup-text');
      if (txtEl) txtEl.innerText = msg;

      popup.classList.remove('show');
      void popup.offsetWidth;
      popup.classList.add('show');
      if (_errorPopupTimer) clearTimeout(_errorPopupTimer);
      _errorPopupTimer = setTimeout(() => popup.classList.remove('show'), 8000);
    }
    window.showErrorPopup = showErrorPopup;
    let _uploadOverlayCount = 0;
    function showUploadOverlay(text, subtext) {

      _uploadOverlayCount++;
      startTopProgress();
    }
    function hideUploadOverlay(force) {
      if (force) {
        _uploadOverlayCount = 0;
      } else {
        _uploadOverlayCount = Math.max(0, _uploadOverlayCount - 1);
        if (_uploadOverlayCount > 0) return;
      }
      const ov = document.getElementById('uploadOverlay');
      if (ov) ov.classList.remove('show');
      stopTopProgress();
    }
    window.showUploadOverlay = showUploadOverlay;
    window.hideUploadOverlay = hideUploadOverlay;

    let _topProgressTimer = null;
    function ensureTopProgressEl() {
      let el = document.getElementById('topProgressBar');
      if (!el) {
        el = document.createElement('div');
        el.id = 'topProgressBar';
        document.body.appendChild(el);
      }
      return el;
    }
    function startTopProgress() {
      const el = ensureTopProgressEl();
      el.classList.add('active');
      el.style.width = '15%';
      clearInterval(_topProgressTimer);
      let w = 15;
      _topProgressTimer = setInterval(() => {
        w = Math.min(w + Math.random() * 8, 90);
        el.style.width = w + '%';
      }, 400);
    }
    function stopTopProgress() {
      clearInterval(_topProgressTimer);
      _topProgressTimer = null;
      const el = document.getElementById('topProgressBar');
      if (!el) return;
      el.style.width = '100%';
      setTimeout(() => {
        el.classList.remove('active');
        el.style.width = '0%';
      }, 280);
    }
    window.startTopProgress = startTopProgress;
    window.stopTopProgress = stopTopProgress;
    function updateSlideCounterUI() {
      document.getElementById('slideCounterText').innerText = `${activeIndex + 1} / ${slides.length}`;
    }
    let userZoomMultiplier = 1;
    let userPanX = 0, userPanY = 0;
    function _canvasBase() {
      const wrapper = document.getElementById('canvasWrapper');
      if (!wrapper) return null;
      const isFitMode = document.getElementById('editorContainer') &&
        document.getElementById('editorContainer').classList.contains('fullscreen-fit-mode');
      const padding = isFitMode ? 8 : 12;
      const cw = wrapper.clientWidth, ch = wrapper.clientHeight;
      const w = Math.max(0, cw - padding * 2), h = Math.max(0, ch - padding * 2);
      if (w <= 0 || h <= 0) return null;
      const baseScale = Math.min(w / 960, h / 540);
      return { cw, ch, baseScale };
    }
    function _clampPan(b, scale) {

      const sw = 960 * scale, sh = 540 * scale, keep = 80;
      const cx = (b.cw - sw) / 2, cy = (b.ch - sh) / 2;
      const minX = keep - sw - cx, maxX = b.cw - keep - cx;
      const minY = keep - sh - cy, maxY = b.ch - keep - cy;
      userPanX = Math.min(Math.max(userPanX, minX), maxX);
      userPanY = Math.min(Math.max(userPanY, minY), maxY);
    }
    function getCanvasZoom() { return userZoomMultiplier; }
    function zoomCanvasAt(mul, px, py) {
      const b = _canvasBase(); if (!b) return;
      const s0 = Math.min(Math.max(b.baseScale * userZoomMultiplier, 0.05), b.baseScale * 4);
      const ox0 = (b.cw - 960 * s0) / 2 + userPanX, oy0 = (b.ch - 540 * s0) / 2 + userPanY;
      const cx = (px - ox0) / s0, cy = (py - oy0) / s0;
      userZoomMultiplier = Math.min(Math.max(mul, 0.4), 4);
      const s1 = Math.min(Math.max(b.baseScale * userZoomMultiplier, 0.05), b.baseScale * 4);
      userPanX = px - cx * s1 - (b.cw - 960 * s1) / 2;
      userPanY = py - cy * s1 - (b.ch - 540 * s1) / 2;
      if (Math.abs(userZoomMultiplier - 1) < 0.02) { userZoomMultiplier = 1; userPanX = 0; userPanY = 0; }
      fitCanvasToScreen();
    }
    function panCanvasBy(dx, dy) { userPanX += dx; userPanY += dy; fitCanvasToScreen(); }
    window.getCanvasZoom = getCanvasZoom;
    window.zoomCanvasAt = zoomCanvasAt;
    window.panCanvasBy = panCanvasBy;
    function fitCanvasToScreen() {
      const wrapper = document.getElementById('canvasWrapper');
      const card = document.getElementById('canvasCard');
      if (!wrapper || !card) return;
      void wrapper.offsetWidth;
      const b = _canvasBase();
      if (!b) return;
      const cw = b.cw, ch = b.ch;
      const scale = Math.min(Math.max(b.baseScale * userZoomMultiplier, 0.05), b.baseScale * 4);
      _clampPan(b, scale);
      const scaledW = 960 * scale;
      const scaledH = 540 * scale;
      const offsetX = Math.round((cw - scaledW) / 2 + userPanX);
      const offsetY = Math.round((ch - scaledH) / 2 + userPanY);
      card.style.transformOrigin = '0 0';
      card.style.webkitTransformOrigin = '0 0';
      card.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      card.style.webkitTransform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      card.style.willChange = 'transform';
      card.style.backfaceVisibility = 'hidden';
      try {
        if (canvas) {
          canvas.calcOffset();
          canvas.requestRenderAll();
        }
      } catch (e) {}
      try { GifOverlay.scheduleSync(); } catch (e) {}
    }

    let _fitRaf = 0;
    let _fitSecondTimer = null;
    function scheduleFitCanvas() {
      cancelAnimationFrame(_fitRaf);
      if (_fitSecondTimer) { clearTimeout(_fitSecondTimer); _fitSecondTimer = null; }
      _fitRaf = requestAnimationFrame(() => {
        fitCanvasToScreen();

        _fitSecondTimer = setTimeout(() => {
          _fitSecondTimer = null;
          fitCanvasToScreen();
        }, 320);
      });
    }
    window.scheduleFitCanvas = scheduleFitCanvas;
    function zoomCanvasIn() { const w=document.getElementById('canvasWrapper'); zoomCanvasAt(userZoomMultiplier * 1.25, w.clientWidth/2, w.clientHeight/2); }
    function zoomCanvasOut() { const w=document.getElementById('canvasWrapper'); zoomCanvasAt(userZoomMultiplier / 1.25, w.clientWidth/2, w.clientHeight/2); }
    function resetCanvasZoom() { userZoomMultiplier = 1; userPanX = 0; userPanY = 0; fitCanvasToScreen(); showToast('Masshtab tiklandi'); }
    window.zoomCanvasIn = zoomCanvasIn;
    window.zoomCanvasOut = zoomCanvasOut;
    window.resetCanvasZoom = resetCanvasZoom;
    function setupToolbarSelectionSync() {
      const updateToolbarFromObject = (obj) => {
        if (!obj) return;
        let target = obj;
        if (obj.type === 'activeSelection' && obj._objects && obj._objects.length > 0) {
          target = obj._objects[0];
        }
        if (target.type === 'textbox' || target.type === 'i-text') {
          if (target.fontSize) document.getElementById('fontSize').value = Math.round(target.fontSize);
          if (target.fontFamily) document.getElementById('fontFamily').value = target.fontFamily;
        }
      };
      canvas.on('selection:created', (e) => {
        const obj = e.selected && e.selected[0];
        if (obj) {
          try {
            const isGif = obj.isGif || obj.type === 'gifImage';

            if (isGif) {
              obj.set({
                cornerSize: 10,
                touchCornerSize: 18,
                padding: 0,
                borderScaleFactor: 1.5,
                transparentCorners: false,
              });
            }
          } catch (err) {}
          updateToolbarFromObject(obj);
        }
      });
      canvas.on('selection:updated', (e) => {
        const obj = e.selected && e.selected[0];
        if (obj) {
          try {
            const isGif = obj.isGif || obj.type === 'gifImage';
            if (isGif) {
              obj.set({
                cornerSize: 10,
                touchCornerSize: 18,
                padding: 0,
                borderScaleFactor: 1.5,
                transparentCorners: false,
              });
            }
          } catch (err) {}
          updateToolbarFromObject(obj);
        }
      });
    }
    function setupChatStorageSync() {
      window.addEventListener('storage', (e) => {
        if (e.key === CHAT_STORAGE_KEY) {
          try { restoreChatHistoryFromLocal(); } catch (err) {}
        }
      });
    }
    function setupScrollEvents() {
      let isScrolling = false;
      const handleDebouncedScroll = (deltaY) => {
        if (isScrolling) return;
        isScrolling = true;
        if (deltaY > 0) switchSlide(activeIndex + 1);
        else if (deltaY < 0) switchSlide(activeIndex - 1);
        setTimeout(() => { isScrolling = false; }, 250);
      };
      const editor = document.getElementById('editorContainer');
      editor.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        handleDebouncedScroll(e.deltaY);
      }, { passive: false });
      const wrapper = document.getElementById('canvasWrapper');
      if (wrapper) {
        wrapper.addEventListener('wheel', (e) => {
          e.preventDefault();
          if (!e.altKey || e.ctrlKey || e.metaKey) return;
          handleDebouncedScroll(e.deltaY);
        }, { passive: false });
      }
      const presentationOverlay = document.getElementById('presentationOverlay');
      // v29: skroll bilan o'tish — bitta "silkitish" = bitta slayd (trackpad o'nlab hodisa yuboradi)
      let _presWheelAt = 0;
      presentationOverlay.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (Math.abs(e.deltaY) < 8) return;
        const now = Date.now();
        if (now - _presWheelAt < 520) return;
        _presWheelAt = now;
        if (e.deltaY > 0) nextPresentationSlide();
        else if (e.deltaY < 0) prevPresentationSlide();
      }, { passive: false });
    }
    function handleSnapping(target) {
      if (!target) return;
      const snapThreshold = SNAP_MARGIN;
      const canvasWidth = canvas.getWidth() || 960;
      const canvasHeight = canvas.getHeight() || 540;

      target.setCoords();
      const br = target.getBoundingRect(true);

      const left = br.left;
      const top = br.top;
      const width = br.width;
      const height = br.height;
      const cx = left + width / 2;
      const cy = top + height / 2;
      guideV.style.display = 'none';
      guideH.style.display = 'none';
      let snapped = false;

      if (Math.abs(cx - canvasWidth / 2) < snapThreshold) {
        const dx = (canvasWidth / 2) - cx;
        target.set({ left: (target.left || 0) + dx });
        guideV.style.left = (canvasWidth / 2) + 'px';
        guideV.style.display = 'block';
        snapped = true;
      }

      if (Math.abs(cy - canvasHeight / 2) < snapThreshold) {
        const dy = (canvasHeight / 2) - cy;
        target.set({ top: (target.top || 0) + dy });
        guideH.style.top = (canvasHeight / 2) + 'px';
        guideH.style.display = 'block';
        snapped = true;
      }

      if (Math.abs(left) < snapThreshold) {
        target.set({ left: (target.left || 0) - left });
        guideV.style.left = '0px';
        guideV.style.display = 'block';
        snapped = true;
      } else if (Math.abs(left + width - canvasWidth) < snapThreshold) {
        const dx = canvasWidth - (left + width);
        target.set({ left: (target.left || 0) + dx });
        guideV.style.left = canvasWidth + 'px';
        guideV.style.display = 'block';
        snapped = true;
      }

      if (Math.abs(top) < snapThreshold) {
        target.set({ top: (target.top || 0) - top });
        guideH.style.top = '0px';
        guideH.style.display = 'block';
        snapped = true;
      } else if (Math.abs(top + height - canvasHeight) < snapThreshold) {
        const dy = canvasHeight - (top + height);
        target.set({ top: (target.top || 0) + dy });
        guideH.style.top = canvasHeight + 'px';
        guideH.style.display = 'block';
        snapped = true;
      }
      if (snapped) target.setCoords();
    }
    const ANGLE_SNAP_STEP = 45;
    const ANGLE_SNAP_THRESHOLD = 6;
    function handleRotationSnap(target) {
      if (!target) return;
      let a = target.angle || 0;
      a = ((a % 360) + 360) % 360;
      if (a > 180) a -= 360;
      const nearest = Math.round(a / ANGLE_SNAP_STEP) * ANGLE_SNAP_STEP;
      if (Math.abs(a - nearest) <= ANGLE_SNAP_THRESHOLD) {

        const center = target.getCenterPoint();
        target.set('angle', nearest);
        target.setPositionByOrigin(center, 'center', 'center');
        target.setCoords();
        try { GifOverlay.updateObject(target); } catch (e) {}
      }
    }
    let _eventListenersBound = false;
    function setupEventListeners() {
      if (_eventListenersBound) return;
      canvas.on('object:moving', (e) => {
        handleSnapping(e.target);
        try { GifOverlay.updateObject(e.target); } catch (err) {}
      });
      canvas.on('object:rotating', (e) => {
        handleRotationSnap(e.target);
        try { GifOverlay.updateObject(e.target); } catch (err) {}
      });
      canvas.on('object:scaling', (e) => {
        try { GifOverlay.updateObject(e.target); } catch (err) {}
      });
      canvas.on('mouse:up', () => {
        guideV.style.display = 'none';
        guideH.style.display = 'none';
        try { GifOverlay.scheduleSync(); } catch (err) {}
      });
      canvas.on('object:modified', () => {
        if (!isAiApplyingCommands && !isAiStreaming && !isUndoRedoAction) {
          if (window.ssDeferSave) window.ssDeferSave();   // v42: chizish bloklanmasin
          else { saveCurrentSlideState(); recordGlobalState(); }

          clearTimeout(window._thumbRefreshTimer);
          const _ti = activeIndex;
        window._thumbRefreshTimer = setTimeout(() => {
            try { refreshSlideThumb(_ti); } catch (e) {}
          }, 500);
        }
        try { updateAllImageBadges(); } catch (err) {}

        try { GifOverlay.scheduleSync(); } catch (err) {}
      });

      canvas.on('object:added', (e) => {
        try { if (e && e.target) ensureObjectId(e.target); } catch (err) {}
        try { updateAllImageBadges(); } catch (err) {}
        try { if (e && e.target && (e.target.isGif || e.target.type === 'gifImage')) GifOverlay.scheduleSync(); } catch (err) {}
      });
      canvas.on('object:removed', (e) => {
        try {
          if (e && e.target && e.target._oid != null) GifOverlay.removeEntry(e.target._oid);
          GifOverlay.scheduleSync();
        } catch (err) {}
        try { updateAllImageBadges(); } catch (err) {}
      });
      if (window.visualViewport) {
        const adjustAiForKeyboard = () => {
          const ai = document.getElementById('aiSidebar');
          if (!ai || !ai.classList.contains('open')) return;
          const vv = window.visualViewport;
          if (!vv) return;
          const full = window.innerHeight || document.documentElement.clientHeight;
          const kbOpen = vv.height < full * 0.85;
          if (kbOpen) {
            if (!document.body.classList.contains('ai-keyboard-lock')) {
              document.body.dataset.prevScrollY = String(window.scrollY || 0);
              document.body.classList.add('ai-keyboard-lock');
              document.body.style.top = `-${window.scrollY || 0}px`;
            }
            const h = Math.max(220, Math.floor(vv.height));
            document.documentElement.style.setProperty('--ai-panel-h', h + 'px');
            ai.classList.add('keyboard-open');
          } else {
            if (document.body.classList.contains('ai-keyboard-lock')) {
              const prevY = parseInt(document.body.dataset.prevScrollY || '0', 10) || 0;
              document.body.classList.remove('ai-keyboard-lock');
              document.body.style.top = '';
              window.scrollTo(0, prevY);
            }
            ai.classList.remove('keyboard-open');
            document.documentElement.style.removeProperty('--ai-panel-h');
          }
        };
        window.visualViewport.addEventListener('resize', adjustAiForKeyboard);
        window.visualViewport.addEventListener('scroll', adjustAiForKeyboard);
      }
      const bottomAiModalEl = document.getElementById('bottomAiModal');
      if (bottomAiModalEl) {
        bottomAiModalEl.addEventListener('mousedown', (e) => {
          if (e.target === e.currentTarget) closeBottomAiModal();
        });
      }
      (function setupPresentationSwipe() {
        const overlay = document.getElementById('presentationOverlay');
        if (!overlay) return;
        let startX = 0, startY = 0;
        overlay.addEventListener('touchstart', (e) => {
          startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        }, { passive: true });
        overlay.addEventListener('touchend', (e) => {
          const dx = e.changedTouches[0].clientX - startX;
          const dy = e.changedTouches[0].clientY - startY;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) nextPresentationSlide(); else prevPresentationSlide();
          }
        }, { passive: true });
      })();
      document.getElementById('editorContainer').addEventListener('mousedown', (e) => {
        if (e.target.id === 'editorContainer' || e.target.id === 'canvasWrapper') {
          canvas.discardActiveObject();
          canvas.renderAll();
        }
      });

      ['aiSidebarInput', 'bottomAiTextarea'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('focus', () => {

          const y = window.scrollY || window.pageYOffset || 0;
          setTimeout(() => { try { window.scrollTo(0, y); } catch (e) {} }, 50);
          setTimeout(() => { try { window.scrollTo(0, y); } catch (e) {} }, 300);
        }, { passive: true });
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) closeContextMenus();
        if (!e.target.closest('#shapesMenu') && !e.target.closest('.tb-btn')) {
          document.getElementById('shapesMenu').style.display = 'none';
        }
        if (!e.target.closest('.top-menu-item') && !e.target.closest('.dropdown-menu')) {
          document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
        }
      });
      canvas.upperCanvasEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const target = canvas.findTarget(e, false);
        if (target) {
          canvas.setActiveObject(target);
          canvas.renderAll();
        }
        const menu = document.getElementById('objectContextMenu');
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.style.display = 'block';
      });

      const kIs = (e, ch) => (e.code === 'Key' + ch.toUpperCase()) || ((e.key || '').toLowerCase() === ch);
      const modalReallyOpen = () => {
        const list = document.querySelectorAll('.modal-overlay, .color-modal-overlay, #bottomAiModal.open, .swal2-container, .cm-overlay.open');
        for (const m of list) {
          const cs = getComputedStyle(m);
          if (cs.display !== 'none' && cs.visibility !== 'hidden' && m.offsetParent !== null || cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return true;
        }
        return false;
      };
      window.addEventListener('keydown', (e) => {
        const pres = document.getElementById('presentationOverlay');
        if (pres && pres.style.display === 'flex') {
          if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
            e.preventDefault(); nextPresentationSlide();
          } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault(); prevPresentationSlide();
          } else if (e.key === 'Escape' || e.key === 'F5') {
            e.preventDefault(); closePresentation();
          }
          return;
        }
        if (e.key === 'Escape' && window.innerWidth <= 768) {
          const ai = document.getElementById('aiSidebar');
          if (ai && ai.classList.contains('open')) {
            e.preventDefault();
            toggleAISidebar(false);
            return;
          }
        }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        const ao = canvas.getActiveObject();
        if (ao && ao.isEditing) return;
        if ((e.metaKey || e.ctrlKey) && kIs(e, 'z')) {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && kIs(e, 'y')) {
          e.preventDefault();
          redo();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && kIs(e, 's')) {
          e.preventDefault();
          try { openExportModal(); } catch (_) {}   // v38: bulutga saqlash yo'q — qurilmaga yuklab olish
          return;
        }
        // v38: Ctrl+C / Ctrl+V / Ctrl+X brauzerning haqiqiy copy/paste/cut hodisalari orqali ishlaydi (26_v38_input.js)
        if ((e.metaKey || e.ctrlKey) && (kIs(e, 'c') || kIs(e, 'v') || kIs(e, 'x'))) return;
        if ((e.metaKey || e.ctrlKey) && kIs(e, 'a')) { e.preventDefault(); selectAll(); }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (!modalReallyOpen()) {
            const sel = canvas.getActiveObject();
            if (sel) {
              e.preventDefault();
              deleteSelected();
            }
          }
        }
        if (e.key === 'Escape') { closeBottomAiModal(); closeColorPicker(); closeExportModal(); closeImportModal(); }
      });
      const bottomTa = document.getElementById('bottomAiTextarea');
      if (bottomTa) {
        bottomTa.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBottomAiPrompt();
          }
        });
      }

      // v38: paste — 26_v38_input.js
      try { setupGlobalDragDrop(); } catch (e) {}
      _eventListenersBound = true;
    }
    function setupGlobalDragDrop() {
      if (window.SSInput) { window.SSInput.bindDragDrop(); return; }
      if (window._globalDragDropBound) return;
      window._globalDragDropBound = true;
      let overlay = document.getElementById('globalDropOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'globalDropOverlay';
        overlay.className = 'drop-overlay';
        overlay.innerHTML = '<div class="drop-overlay-card">📁 Fayl yoki rasmni shu yerga tashlang</div>';
        document.body.appendChild(overlay);
      }
      let dragDepth = 0;

      const isExternalFileDrag = (dt) => {
        if (!dt) return false;
        try {
          const types = Array.from(dt.types || []);

          if (types.includes('Files') || types.includes('application/x-moz-file')) return true;

          if (dt.items && dt.items.length) {
            for (let i = 0; i < dt.items.length; i++) {
              if (dt.items[i].kind === 'file') return true;
            }
          }
        } catch (_) {}
        return false;
      };
      const show = () => { overlay.classList.add('active'); };
      const hide = () => { overlay.classList.remove('active'); dragDepth = 0; };
      window.addEventListener('dragenter', (e) => {
        if (!isExternalFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth++;
        show();
      });
      window.addEventListener('dragleave', (e) => {
        if (!isExternalFileDrag(e.dataTransfer) && dragDepth === 0) return;
        e.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) hide();
      });
      window.addEventListener('dragover', (e) => {
        if (isExternalFileDrag(e.dataTransfer)) e.preventDefault();
      });
      window.addEventListener('drop', async (e) => {
        const files = e.dataTransfer && e.dataTransfer.files;

        hide();

        let dropLeft = 120, dropTop = 100;
        try {
          const card = document.getElementById('canvasCard') || document.getElementById('canvasWrapper');
          if (card && canvas) {
            const rect = card.getBoundingClientRect();
            const scaleX = (canvas.width || 960) / Math.max(1, rect.width);
            const scaleY = (canvas.height || 540) / Math.max(1, rect.height);
            dropLeft = Math.max(20, Math.min(700, (e.clientX - rect.left) * scaleX));
            dropTop = Math.max(20, Math.min(400, (e.clientY - rect.top) * scaleY));
          }
        } catch (_) {}

        try {
          const pendingId = e.dataTransfer && e.dataTransfer.getData('application/x-slide-studio-pending');
          if (pendingId && (!files || !files.length)) {
            e.preventDefault();
            const pending = (typeof pendingImagesStore !== 'undefined' ? pendingImagesStore : []).find((i) => i.id === pendingId);
            if (pending && pending.base64) {
              const isGif = /^data:image\/gif/i.test(pending.base64);
              if (isGif && typeof placeGifImmediate === 'function') {
                const num = pending.globalNum || (typeof assignNextImageNumber === 'function' ? assignNextImageNumber() : (++globalImageCounter));
                const oid = typeof nextObjectId === 'function' ? nextObjectId() : Date.now();
                placeGifImmediate(activeIndex, { left: dropLeft, top: dropTop, width: 360, height: 240 }, pending.base64, num, oid);
                if (typeof consumePendingImageByNumber === 'function') consumePendingImageByNumber(num);
                showToast('#' + num + '-GIF joylashtirildi');
              } else if (typeof placeImageDirectlyOnSlide === 'function') {
                await placeImageDirectlyOnSlide(pending.base64, { left: dropLeft, top: dropTop });
                if (typeof consumePendingImageByNumber === 'function') consumePendingImageByNumber(pending.globalNum);
                showToast('#' + pending.globalNum + '-rasm joylashtirildi');
              }
              return;
            }
          }
          const mediaUrl = e.dataTransfer && (
            e.dataTransfer.getData('application/x-slide-studio-media') ||
            e.dataTransfer.getData('text/uri-list') ||
            e.dataTransfer.getData('text/plain')
          );
          if (mediaUrl && (/^https?:\/\//i.test(mediaUrl.trim()) || /^data:image\//i.test(mediaUrl.trim())) && (!files || !files.length)) {
            e.preventDefault();
            const url = mediaUrl.trim().split('\n')[0].trim();
            if (/^data:image\//i.test(url)) {
              if (/^data:image\/gif/i.test(url) && typeof placeGifImmediate === 'function') {
                const num = typeof assignNextImageNumber === 'function' ? assignNextImageNumber() : (++globalImageCounter);
                const oid = typeof nextObjectId === 'function' ? nextObjectId() : Date.now();
                placeGifImmediate(activeIndex, { left: dropLeft, top: dropTop, width: 360, height: 240 }, url, num, oid);
                showToast('GIF joylashtirildi');
              } else if (typeof placeImageDirectlyOnSlide === 'function') {
                await placeImageDirectlyOnSlide(url, { left: dropLeft, top: dropTop });
                showToast('Rasm joylashtirildi');
              }
              return;
            }
            const isGif = /\.gif(\?|#|$)/i.test(url) || /tenor\.com|giphy\.com/i.test(url);
            if (isGif && typeof placeGifImmediate === 'function') {
              const num = typeof assignNextImageNumber === 'function' ? assignNextImageNumber() : (++globalImageCounter);
              const oid = typeof nextObjectId === 'function' ? nextObjectId() : Date.now();
              placeGifImmediate(activeIndex, { left: dropLeft, top: dropTop, width: 360, height: 240 }, url, num, oid);
              showToast('GIF joylashtirildi');
            } else if (typeof mediaPlaceUrl === 'function') {
              await mediaPlaceUrl(url, isGif);
            } else if (typeof placeImageDirectlyOnSlide === 'function') {
              await placeImageDirectlyOnSlide(url, { left: dropLeft, top: dropTop });
              showToast('Rasm joylashtirildi');
            }
            return;
          }
        } catch (_) {}
        if (!files || !files.length) return;
        e.preventDefault();
        for (const file of files) {
          const name = (file.name || '').toLowerCase();
          const type = file.type || '';

          if (name.endsWith('.pptx') || name.endsWith('.pdf') || name.endsWith('.html') || name.endsWith('.htm')) {
            if (typeof processImportFile === 'function') await processImportFile(file);
            continue;
          }

          if (type.startsWith('video/') || /\.(mp4|webm|ogg|mov)$/i.test(name)) {
            try {
              const _vu = await fileToVideoUrlPublic(file);
              if (_vu) await VideoKit.addToActive({ url: _vu, left: dropLeft, top: dropTop });
            } catch (err) { showToast('Video yuklanmadi', 'error'); }
            continue;
          }
          if (false) {
            try {
              const url = URL.createObjectURL(file);
              let pre = null;
              try { pre = await preloadMedia(url, { isVideo: true, timeoutMs: 8000 }); } catch (_) {}
              const videoEl = (pre && pre.el) || (() => {
                const v = document.createElement('video');
                v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = 'anonymous';
                return v;
              })();
              const vW = (pre && pre.w) || videoEl.videoWidth || 640;
              const maxW = 420;
              const scale = vW > maxW ? maxW / vW : 1;
              const fabVideo = new fabric.Image(videoEl, {
                left: dropLeft,
                top: dropTop,
                scaleX: scale,
                scaleY: scale,
                objectCaching: false,
                _isVideo: true,
                _videoSrc: url
              });
              canvas.add(fabVideo);
              canvas.setActiveObject(fabVideo);
              canvas.requestRenderAll();
              try { videoEl.play && videoEl.play().catch(() => {}); } catch (_) {}
              saveCurrentSlideState();
              showToast('Video qo\'shildi');
            } catch (err) {
              showToast('Video yuklanmadi', 'error');
            }
            continue;
          }

          if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) {
            await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = async (ev) => {
                try {
                  const base64 = ev.target.result;
                  const isGif = type === 'image/gif' || /\.gif$/i.test(name);
                  if (isGif && typeof placeGifImmediate === 'function') {
                    const num = typeof assignNextImageNumber === 'function' ? assignNextImageNumber() : (++globalImageCounter);
                    const oid = typeof nextObjectId === 'function' ? nextObjectId() : Date.now();
                    placeGifImmediate(activeIndex, { left: dropLeft, top: dropTop, width: 360, height: 240 }, base64, num, oid);
                  } else if (typeof placeImageDirectlyOnSlide === 'function') {
                    await placeImageDirectlyOnSlide(base64, { left: dropLeft, top: dropTop });
                  } else {
                    fabric.Image.fromURL(base64, (img) => {
                      if (!img) return;
                      img.set({ left: dropLeft, top: dropTop, objectCaching: false });
                      if (img.width > 420) img.scaleToWidth(420);
                      try { img.setCoords(); } catch (e) {}
                      img.dirty = true;
                      canvas.add(img);
                      canvas.setActiveObject(img);
                      canvas.requestRenderAll();
                      const el = img._element || (img.getElement && img.getElement());
                      const redraw = () => { try { img.dirty = true; canvas.requestRenderAll(); } catch (e) {} };
                      if (el && !el.complete) {
                        el.addEventListener('load', redraw, { once: true });
                        setTimeout(redraw, 150);
                      } else setTimeout(redraw, 40);
                      saveCurrentSlideState();
                    });
                  }
                  showToast('Rasm qo\'shildi');
                } catch (err) { showToast('Rasm yuklanmadi', 'error'); }
                resolve();
              };
              reader.readAsDataURL(file);
            });
          }
        }
      });
    }

    let _mediaSelectedUrl = null;
    let _mediaSelectedIsGif = false;
    let _mediaSelectedIsVideo = false;
    let _mediaActiveTab = 'images';
    let _mediaQuery = '';
    let _mediaPagerBound = null;
    let _mediaObserver = null;
    let _mediaRenderedKey = '';
    let _mediaSearchDebounce = null;
    const _mediaStore = {};
    const MEDIA_CHIPS = {
      images: [['Tabiat', 'nature'], ['Biznes', 'business'], ['Texnologiya', 'technology'], ['Shahar', 'city'], ['Mashina', 'car'], ['Oziq-ovqat', 'food'], ['Sport', 'sport'], ['Ta\'lim', 'education'], ['Sayohat', 'travel'], ['Kosmos', 'space']],
      videos: [['Tabiat', 'nature'], ['Shahar', 'city'], ['Texnologiya', 'technology'], ['Biznes', 'business'], ['Dengiz', 'ocean'], ['Kosmos', 'space'], ['Odamlar', 'people'], ['Sport', 'sport'], ['Oziq-ovqat', 'food'], ['Fon (loop)', 'abstract background']],
      gifs: [['Xursand', 'happy'], ['Rahmat', 'thank you'], ['Tabrik', 'congratulations'], ['Kulgi', 'funny'], ['Ish', 'working'], ['Pul', 'money'], ['Salom', 'hello'], ['Ha', 'yes'], ['O\'ylash', 'thinking'], ['Raqs', 'dance']]
    };
    const MEDIA_UZ_EN = {
      mashina: 'car', avtomobil: 'car', tabiat: 'nature', shahar: 'city', odam: 'people', odamlar: 'people', bola: 'child', bolalar: 'children',
      hayvon: 'animal', it: 'dog', mushuk: 'cat', gul: 'flower', daryo: 'river', tog: 'mountain', dengiz: 'sea', osmon: 'sky', quyosh: 'sun',
      oy: 'moon', yulduz: 'star', pul: 'money', biznes: 'business', ish: 'work', talim: 'education', maktab: 'school', kitob: 'book',
      sport: 'sport', futbol: 'football', kompyuter: 'computer', telefon: 'phone', texnologiya: 'technology', ovqat: 'food', non: 'bread',
      salom: 'hello', rahmat: 'thank you', tabrik: 'congratulations', kulgi: 'funny', xursand: 'happy', sevgi: 'love', oila: 'family',
      sayohat: 'travel', kosmos: 'space', robot: 'robot', tibbiyot: 'medicine', ekologiya: 'ecology', energiya: 'energy', uy: 'house'
    };
    function mediaTranslateQuery(q) {
      const s = (q || '').trim();
      if (!s) return '';
      return s.split(/\s+/).map(function (w) {
        const k = w.toLowerCase().replace(/[’'`‘]/g, '');
        return MEDIA_UZ_EN[k] || w;
      }).join(' ');
    }
    function mediaKey() { return _mediaActiveTab + '|' + _mediaQuery.toLowerCase(); }
    function mediaGetStore(key) {
      if (!_mediaStore[key]) _mediaStore[key] = { items: [], seen: new Set(), page: 0, hasMore: true, loading: false, error: false, scroll: 0, retried: false };
      return _mediaStore[key];
    }
    function mediaEls() {
      return {
        grid: document.getElementById('mediaSearchResults'),
        input: document.getElementById('mediaSearchInput'),
        clear: document.getElementById('mediaClearBtn'),
        chips: document.getElementById('mediaChips'),
        selInfo: document.getElementById('mediaSelInfo'),
        selThumb: document.getElementById('mediaSelThumb'),
        placeBtn: document.getElementById('mediaPlaceBtn'),
        bgBtn: document.getElementById('mediaBgBtn')
      };
    }
    function mediaRenderChips() {
      const el = mediaEls();
      if (!el.chips) return;
      el.chips.innerHTML = '';
      (MEDIA_CHIPS[_mediaActiveTab] || []).forEach(function (c) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mb-chip' + (_mediaQuery.toLowerCase() === c[1] ? ' active' : '');
        b.textContent = c[0];
        b.onclick = function () {
          const input = mediaEls().input;
          if (input) input.value = (_mediaQuery.toLowerCase() === c[1]) ? '' : c[1];
          mediaApplyQuery();
        };
        el.chips.appendChild(b);
      });
    }
    function mediaUpdateSelection() {
      const el = mediaEls();
      const has = !!_mediaSelectedUrl;
      if (el.placeBtn) el.placeBtn.disabled = !has;
      if (el.selInfo) el.selInfo.textContent = has ? (_mediaSelectedIsVideo ? 'Video tanlandi' : (_mediaSelectedIsGif ? 'GIF tanlandi' : 'Rasm tanlandi')) : 'Tanlash uchun bosing';
      if (el.selThumb) {
        if (has) {
          el.selThumb.style.backgroundImage = 'url("' + String(_mediaSelectedThumb || _mediaSelectedUrl).replace(/"/g, '%22') + '")';
          el.selThumb.classList.add('on');
        } else {
          el.selThumb.style.backgroundImage = '';
          el.selThumb.classList.remove('on');
        }
      }
    }
    let _mediaSelectedThumb = '';
    function mediaSelect(card, full, thumb, isGif, isVideo) {
      _mediaSelectedIsVideo = !!isVideo;
      const grid = mediaEls().grid;
      if (grid) grid.querySelectorAll('.media-result-card.selected').forEach(function (d) { d.classList.remove('selected'); });
      if (card) card.classList.add('selected');
      _mediaSelectedUrl = full;
      _mediaSelectedThumb = thumb;
      _mediaSelectedIsGif = !!isGif;
      mediaUpdateSelection();
    }
    function mediaThumbSrc(url) {
      if (!url) return '';
      return url;
    }
    function mediaBuildCard(item, isGifTab) {
      const full = item.url;
      const thumb = item.thumbnail || item.url;
      const itemIsVideo = item.is_video === true || _mediaActiveTab === 'videos';
      const itemIsGif = !itemIsVideo && (isGifTab || item.is_gif === true || /\.gif(\?|#|$)/i.test(full));
      const card = document.createElement('div');
      card.className = 'media-result-card loading';
      card.setAttribute('data-url', full);
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      const srcs = [];
      const isHttp = (u) => /^https?:\/\//i.test(u || '');
      const viaProxy = (u) => '/api/proxy-image?raw=1&url=' + encodeURIComponent(u);
      if (itemIsVideo) {
        // video: faqat kichik rasm (thumbnail) yuklanadi, to'liq video URL <img> ga berilmaydi
        srcs.length = 0;
        if (isHttp(thumb) && thumb !== full) { srcs.push(thumb); srcs.push(viaProxy(thumb)); }
      }
      // To'g'ridan-to'g'ri URL birinchi (CORS ruxsat beradigan CDN lar); proxy oxirgi zaxira
      // Wikimedia / Openverse / Tenor / Giphy odatda direct ishlaydi — proxy 400 bersa ham kartochka qoladi
      if (!itemIsVideo && isHttp(thumb)) {
        srcs.push(thumb);
        if (thumb !== full) srcs.push(viaProxy(thumb));
      } else if (!itemIsVideo && thumb) {
        srcs.push(thumb);
      }
      if (!itemIsVideo && isHttp(full) && full !== thumb) {
        srcs.push(full);
        srcs.push(viaProxy(full));
      }
      let si = 0;
      let wd = null;
      let finished = false;
      function giveUp() {
        if (finished) return;
        finished = true;
        clearTimeout(wd);
        card.classList.remove('loading');
        card.classList.add('broken');
        // Buzilgan kartani o'chirmaymiz — foydalanuvchi URL ni tanlab qo'yishi mumkin
        if (_mediaSelectedUrl === full) { _mediaSelectedUrl = null; mediaUpdateSelection(); }
      }
      function tryNext() {
        if (finished) return;
        clearTimeout(wd);
        if (si >= srcs.length) { giveUp(); return; }
        const cur = srcs[si++];
        wd = setTimeout(tryNext, si === 1 ? 5000 : 8000);
        try {
          img.crossOrigin = (cur.indexOf('/api/proxy-image') === 0) ? null : 'anonymous';
        } catch (e) {}
        img.src = cur;
      }
      if (itemIsVideo && !srcs.length) {
        card.classList.remove('loading'); card.classList.add('ready');
        card.style.background = 'linear-gradient(135deg,#1e293b,#0f172a)';
        finished = true;
      }
      img.onload = function () {
        if (finished) return;
        finished = true;
        clearTimeout(wd);
        card.classList.remove('loading');
        card.classList.add('ready');
      };
      img.onerror = function () { tryNext(); };
      card.appendChild(img);
      tryNext();
      if (itemIsVideo) {
        const pl = document.createElement('span');
        pl.className = 'media-vid-play';
        pl.innerHTML = '<span class="material-symbols-outlined">play_arrow</span>';
        card.appendChild(pl);
        if (item.duration) {
          const vt = document.createElement('span');
          vt.className = 'media-vid-tag';
          const d = Math.round(item.duration);
          vt.textContent = Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0');
          card.appendChild(vt);
        }
      }
      if (itemIsGif) {
        const tag = document.createElement('span');
        tag.className = 'media-gif-tag';
        tag.textContent = 'GIF';
        card.appendChild(tag);
      }
      const check = document.createElement('span');
      check.className = 'media-check material-symbols-outlined';
      check.textContent = 'check';
      card.appendChild(check);
      card.draggable = true;
      card.ondragstart = function (ev) {
        try {
          ev.dataTransfer.setData('application/x-slide-studio-media', full);
          ev.dataTransfer.setData('text/uri-list', full);
          ev.dataTransfer.setData('text/plain', full);
          ev.dataTransfer.effectAllowed = 'copy';
          card.classList.add('dragging');
        } catch (_) {}
      };
      card.ondragend = function () { card.classList.remove('dragging'); };
      card.onclick = function () { mediaSelect(card, full, thumb, itemIsGif, itemIsVideo); };
      card.ondblclick = function () { mediaSelect(card, full, thumb, itemIsGif, itemIsVideo); mediaPlaceUrl(full, itemIsGif); };
      return card;
    }
    function mediaClearGridNodes(grid) {
      while (grid.firstChild) grid.removeChild(grid.firstChild);
    }
    function mediaSkeleton(n) {
      const f = document.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        const s = document.createElement('div');
        s.className = 'media-result-card skeleton';
        f.appendChild(s);
      }
      return f;
    }
    function mediaFooterNode(st) {
      const d = document.createElement('div');
      d.className = 'mb-foot';
      d.id = 'mediaFoot';
      if (st.loading && st.items.length) {
        d.innerHTML = '<span class="mb-spinner"></span> Yana yuklanmoqda...';
      } else if (st.error && st.items.length) {
        d.innerHTML = '<button type="button" class="mb-btn ghost" onclick="mediaRetry()">Qayta urinish</button>';
      } else if (!st.hasMore && st.items.length) {
        d.textContent = 'Hammasi shu';
        d.classList.add('end');
      }
      if (st.hint) d.insertAdjacentHTML('beforeend', '<small style="display:block;opacity:.7;margin-top:6px"></small>'), d.lastChild.textContent = st.hint;
      return d;
    }
    function mediaRenderFull() {
      const el = mediaEls();
      const grid = el.grid;
      if (!grid) return;
      const key = mediaKey();
      const st = mediaGetStore(key);
      const isGifTab = _mediaActiveTab === 'gifs';
      mediaClearGridNodes(grid);
      _mediaRenderedKey = key;
      grid.dataset.rendered = '0';
      if (!st.items.length) {
        if (st.loading || (st.page === 0 && !st.error)) {
          grid.appendChild(mediaSkeleton(12));
        } else if (st.error) {
          const d = document.createElement('div');
          d.className = 'media-empty-hint err';
          d.innerHTML = '<span class="material-symbols-outlined">cloud_off</span><b>Qidiruv ishlamadi</b><small>Internet yoki server kalitlarini tekshiring</small><button type="button" class="mb-btn ghost" onclick="mediaRetry()">Qayta urinish</button>';
          grid.appendChild(d);
        } else {
          const d = document.createElement('div');
          d.className = 'media-empty-hint';
          d.innerHTML = '<span class="material-symbols-outlined">search_off</span><b>Natija topilmadi</b><small>Boshqa so\'z bilan urinib ko\'ring</small>';
          grid.appendChild(d);
        }
        return;
      }
      const frag = document.createDocumentFragment();
      st.items.forEach(function (it) { frag.appendChild(mediaBuildCard(it, isGifTab)); });
      grid.appendChild(frag);
      grid.dataset.rendered = String(st.items.length);
      grid.appendChild(mediaFooterNode(st));
      if (_mediaSelectedUrl) {
        const sel = grid.querySelector('.media-result-card[data-url="' + String(_mediaSelectedUrl).replace(/"/g, '\\"') + '"]');
        if (sel) sel.classList.add('selected');
      }
      mediaWatchSentinel();
    }
    function mediaAppendNew(startIndex) {
      const grid = mediaEls().grid;
      if (!grid) return;
      const key = mediaKey();
      const st = mediaGetStore(key);
      const isGifTab = _mediaActiveTab === 'gifs';
      const old = document.getElementById('mediaFoot');
      if (old) old.remove();
      const frag = document.createDocumentFragment();
      for (let i = startIndex; i < st.items.length; i++) frag.appendChild(mediaBuildCard(st.items[i], isGifTab));
      grid.appendChild(frag);
      grid.dataset.rendered = String(st.items.length);
      grid.appendChild(mediaFooterNode(st));
      mediaWatchSentinel();
    }
    function mediaUpdateFooter() {
      const grid = mediaEls().grid;
      if (!grid) return;
      const old = document.getElementById('mediaFoot');
      if (old) old.remove();
      const st = mediaGetStore(mediaKey());
      if (st.items.length) grid.appendChild(mediaFooterNode(st));
      mediaWatchSentinel();
    }
    function mediaWatchSentinel() {
      const grid = mediaEls().grid;
      if (!grid) return;
      if (typeof IntersectionObserver === 'undefined') return;
      if (!_mediaObserver) {
        _mediaObserver = new IntersectionObserver(function (entries) {
          if (entries.some(function (e) { return e.isIntersecting; })) mediaLoadMore();
        }, { root: grid, rootMargin: '0px 0px 320px 0px', threshold: 0 });
      }
      _mediaObserver.disconnect();
      const foot = document.getElementById('mediaFoot');
      if (foot) _mediaObserver.observe(foot);
    }
    function mediaBindScrollFallback() {
      const grid = mediaEls().grid;
      if (!grid || _mediaPagerBound === grid) return;
      _mediaPagerBound = grid;
      grid.addEventListener('scroll', function () {
        const st = mediaGetStore(mediaKey());
        if (grid.offsetParent !== null) st.scroll = grid.scrollTop;
        if (typeof IntersectionObserver === 'undefined' && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200) mediaLoadMore();
      }, { passive: true });
    }
    async function mediaFetchRaw(kind, q, page) {
      let r = await mediaFetchRawServer(kind, q, page);
      // GIF: server kam yoki bo'sh bo'lsa — brauzer Wikimedia + Openverse (kalit kerak emas)
      if (kind === 'gif' && typeof window.browserGifSearch === 'function') {
        const needExtra = !r || !r.results || r.results.length < 12;
        if (needExtra) {
          try {
            const extra = await window.browserGifSearch(q, page, 24);
            if (extra && extra.length) {
              const base = (r && r.results) || [];
              const seen = new Set(base.map(function (x) { return x.url; }));
              const merged = base.concat(extra.filter(function (x) { return x && x.url && !seen.has(x.url); }));
              r = { results: merged, hasMore: true, hint: (r && r.hint) || '' };
            }
          } catch (e) { console.warn('browserGifSearch:', e); }
        }
      }
      return r;
    }
    async function mediaFetchRawServer(kind, q, page) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 22000) : null;
      try {
        const res = await fetch('/api/media-search?provider=' + kind + '&q=' + encodeURIComponent(q || '') + '&limit=24&page=' + page,
          ctrl ? { signal: ctrl.signal } : undefined);
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.errors && Object.keys(data.errors).length) console.warn('media-search provider xatolari:', data.errors);
        if (data && data.error) return null;
        return { results: (data && data.results) || [], hasMore: data && typeof data.has_more === 'boolean' ? data.has_more : null, hint: (data && data.setup_needed && data.hint) || '' };
      } catch (e) {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    async function mediaLoadMore(force) {
      const key = mediaKey();
      const st = mediaGetStore(key);
      if (st.loading || (!st.hasMore && !force)) return;
      const tab = _mediaActiveTab;
      const kind = tab === 'gifs' ? 'gif' : (tab === 'videos' ? 'video' : 'image');
      const q = mediaTranslateQuery(_mediaQuery);
      const page = st.page + 1;
      st.loading = true;
      st.error = false;
      if (!st.items.length) mediaRenderFull(); else mediaUpdateFooter();
      let r = await mediaFetchRaw(kind, q, page);
      if (!r) {
        await new Promise(function (res) { setTimeout(res, 700); });
        r = await mediaFetchRaw(kind, q, page);
      }
      st.loading = false;
      const before = st.items.length;
      if (!r) {
        st.error = true;
      } else {
        st.page = page;
        st.hint = r.hint || '';
        let added = 0;
        r.results.forEach(function (it) {
          if (!it || !it.url) return;
          if (kind === 'video' && !it.is_video) return;
          if (kind !== 'video' && it.is_video) return;
          if (kind === 'gif' && it.is_gif === false) return;
          if (kind === 'image' && (it.is_gif === true || /\.gif(\?|#|$)/i.test(it.url))) return;
          if (st.seen.has(it.url)) return;
          st.seen.add(it.url);
          st.items.push(it);
          added++;
        });
        st.hasMore = added > 0 && (r.hasMore !== null ? r.hasMore : r.results.length >= 12);
      }
      if (key !== mediaKey() || document.getElementById('mediaBrowserModal').style.display === 'none') return;
      if (!before || _mediaRenderedKey !== key) mediaRenderFull();
      else if (st.items.length > before) mediaAppendNew(before);
      else mediaUpdateFooter();
      if (st.hasMore && !st.error) {
        const grid = mediaEls().grid;
        if (grid && grid.scrollHeight <= grid.clientHeight + 60) setTimeout(function () { mediaLoadMore(); }, 50);
      }
    }
    function mediaRetry() {
      const st = mediaGetStore(mediaKey());
      st.error = false;
      mediaLoadMore(true);
    }
    window.mediaRetry = mediaRetry;
    function mediaShowCurrent() {
      mediaRenderChips();
      const el = mediaEls();
      if (el.clear) el.clear.style.display = (el.input && el.input.value) ? 'flex' : 'none';
      const key = mediaKey();
      const st = mediaGetStore(key);
      mediaRenderFull();
      if (!st.items.length && !st.loading) mediaLoadMore(true);
      else if (st.items.length && el.grid) {
        el.grid.scrollTop = st.scroll || 0;
        if (st.error) mediaUpdateFooter();
      }
      mediaUpdateSelection();
    }
    function mediaApplyQuery() {
      clearTimeout(_mediaSearchDebounce);
      const el = mediaEls();
      _mediaQuery = ((el.input && el.input.value) || '').trim();
      mediaShowCurrent();
    }
    function openMediaBrowser(tab) {
      const m = document.getElementById('mediaBrowserModal');
      if (!m) return;
      if (tab === 'gifs' || tab === 'images' || tab === 'videos') _mediaActiveTab = tab;
      m.style.display = 'flex';
      document.body.classList.add('media-open');
      mediaBindScrollFallback();
      const imgTab = document.getElementById('mediaTabImages');
      const gifTab = document.getElementById('mediaTabGifs');
      if (imgTab) imgTab.classList.toggle('active', _mediaActiveTab === 'images');
      if (gifTab) gifTab.classList.toggle('active', _mediaActiveTab === 'gifs');
      const vidTab = document.getElementById('mediaTabVideos');
      if (vidTab) vidTab.classList.toggle('active', _mediaActiveTab === 'videos');
      const input = mediaEls().input;
      if (input) input.value = _mediaQuery;
      mediaShowCurrent();
    }
    function closeMediaBrowser() {
      const m = document.getElementById('mediaBrowserModal');
      const st = mediaGetStore(mediaKey());
      const grid = mediaEls().grid;
      if (grid && m && m.style.display !== 'none') st.scroll = grid.scrollTop;
      if (m) m.style.display = 'none';
      document.body.classList.remove('media-open');
      _mediaSelectedUrl = null;
      _mediaSelectedThumb = '';
      _mediaSelectedIsGif = false;
      _mediaSelectedIsVideo = false;
      mediaUpdateSelection();
    }
    window.openMediaBrowser = openMediaBrowser;
    window.closeMediaBrowser = closeMediaBrowser;
    function switchMediaTab(tab) {
      const next = tab === 'gifs' ? 'gifs' : (tab === 'videos' ? 'videos' : 'images');
      const grid = mediaEls().grid;
      if (grid) mediaGetStore(mediaKey()).scroll = grid.scrollTop;
      _mediaActiveTab = next;
      _mediaSelectedUrl = null;
      _mediaSelectedThumb = '';
      _mediaSelectedIsGif = false;
      const imgTab = document.getElementById('mediaTabImages');
      const gifTab = document.getElementById('mediaTabGifs');
      if (imgTab) imgTab.classList.toggle('active', next === 'images');
      if (gifTab) gifTab.classList.toggle('active', next === 'gifs');
      const vidTab2 = document.getElementById('mediaTabVideos');
      if (vidTab2) vidTab2.classList.toggle('active', next === 'videos');
      _mediaSelectedIsVideo = false;
      mediaShowCurrent();
    }
    window.switchMediaTab = switchMediaTab;
    function mediaSearchOnline() { mediaApplyQuery(); }
    window.mediaSearchOnline = mediaSearchOnline;
    function mediaSearchDebounced() {
      clearTimeout(_mediaSearchDebounce);
      const el = mediaEls();
      if (el.clear) el.clear.style.display = (el.input && el.input.value) ? 'flex' : 'none';
      _mediaSearchDebounce = setTimeout(mediaApplyQuery, 450);
    }
    window.mediaSearchDebounced = mediaSearchDebounced;
    function mediaClearSearch() {
      const input = mediaEls().input;
      if (input) { input.value = ''; input.focus(); }
      mediaApplyQuery();
    }
    window.mediaClearSearch = mediaClearSearch;
    function mediaRefresh() {
      const key = mediaKey();
      delete _mediaStore[key];
      const grid = mediaEls().grid;
      if (grid) grid.scrollTop = 0;
      mediaShowCurrent();
    }
    window.mediaRefresh = mediaRefresh;
    async function mediaPlaceUrl(url, forceGif) {
      if (!url) return;
      if (_mediaSelectedIsVideo || (typeof VideoKit !== 'undefined' && !/\.gif(\?|#|$)/i.test(url) && VideoKit.isVideoUrl(url))) {
        const thumb = _mediaSelectedThumb || '';
        try { closeMediaBrowser(); } catch (e) {}
        showToast('Video qo\'yilmoqda...');
        await VideoKit.placeFromUrl(url, { thumb: thumb });
        return;
      }
      const isGif = forceGif || _mediaSelectedIsGif || /\.gif(\?|#|$)/i.test(url);

      try { closeMediaBrowser(); } catch (e) {}
      showToast(isGif ? 'GIF qo\'yilmoqda...' : 'Rasm qo\'yilmoqda...');
      try {
        if (isGif) {
          await placeGifOnSlide(url);
        } else {
          let dataUrl = url;
          if (/^https?:\/\//i.test(url)) {
            try {
              dataUrl = await Promise.race([
                resolveRemoteToDataUrl(url),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
              ]);
            } catch (e) {

              dataUrl = url;
            }
          }
          try {
            await placeImageDirectlyOnSlide(dataUrl);
          } catch (e2) {

            const oid = nextObjectId();
            globalImageCounter++;
            const num = globalImageCounter;
            const rect = new fabric.Rect({
              left: 60, top: 100, width: 320, height: 200,
              fill: '#e2e8f0', rx: 8, ry: 8, _oid: oid, imageNumber: num
            });
            canvas.add(rect);
            canvas.renderAll();
            if (!slides[activeIndex].imageNumbers) slides[activeIndex].imageNumbers = [];
            slides[activeIndex].imageNumbers.push(num);
            saveCurrentSlideState();
            showToast('Rasm yuklanmadi — zaxira blok qo\'yildi', 'error');
          }
        }
      } catch (e) {
        showToast("Rasm qo'shib bo'lmadi", 'error');
        try { hideUploadOverlay(true); } catch (e3) {}
      }
    }
    window.mediaPlaceUrl = mediaPlaceUrl;
    function mediaPlaceSelected() {
      if (!_mediaSelectedUrl) {
        showToast('Avval rasm, GIF yoki video tanlang (bir marta bosing)', 'error');
        return;
      }
      mediaPlaceUrl(_mediaSelectedUrl, _mediaSelectedIsGif);
    }
    window.mediaPlaceSelected = mediaPlaceSelected;
    async function placeGifOnSlide(url) {
      url = sanitizeImageUrl(url);
      if (!url) { showToast('GIF manzili noto\'g\'ri', 'error'); return; }
      showUploadOverlay('GIF yuklanmoqda...', 'Iltimos kuting');
      let loaded = null;
      try { loaded = await ensureWorkingGif(url, ''); } catch (e) { loaded = null; }
      if (!loaded || !loaded.src) {
        loaded = { src: GIF_PLACEHOLDER_URL, w: 32, h: 32, isFallback: true };
      }
      const src = loaded.src;
      globalImageCounter++;
      const num = globalImageCounter;
      const oid = nextObjectId();
      const nw = loaded.w || 300;
      const nh = loaded.h || 200;
      const imgEl = document.createElement('img');
      imgEl.width = nw;
      imgEl.height = nh;
      const fImg = new AnimatedGifImage(imgEl, {
        left: 100 + (num % 5) * 20,
        top: 100 + (num % 3) * 20,
        id: 'img_gif_n' + num + '_' + Date.now(),
        imageNumber: num,
        imageHash: 'gif_' + num,
        _oid: oid,
        gifUrl: src,
        src: src,
        isGif: true,
        isFallback: !!loaded.isFallback,
        objectCaching: false,
        width: nw,
        height: nh,
      });
      fImg.isFallback = !!loaded.isFallback;
      if (fImg.width > 400) fImg.scaleToWidth(400);
      canvas.add(fImg);
      canvas.setActiveObject(fImg);
      canvas.requestRenderAll();
      try { GifOverlay.scheduleSync(); } catch (e) {}
      if (!slides[activeIndex].imageNumbers) slides[activeIndex].imageNumbers = [];
      if (!slides[activeIndex].imageNumbers.includes(num)) {
        slides[activeIndex].imageNumbers.push(num);
      }
      try {

        let prevBgGif = null;
        try {
          const prev = JSON.parse(slides[activeIndex].json || '{}');
          if (prev.backgroundGif) prevBgGif = prev.backgroundGif;
        } catch (e) {}
        const jsonState = canvas.toJSON(SERIALIZE_PROPS);
        if (prevBgGif) jsonState.backgroundGif = prevBgGif;
        slides[activeIndex].json = JSON.stringify(jsonState);
        hasUnsavedChanges = true;
      } catch (e) { saveCurrentSlideState(); }

      try {
        const j = JSON.parse(slides[activeIndex].json || '{}');
        if (j.backgroundGif) GifBackground.applyFromSlide(slides[activeIndex].json);
      } catch (e) {}
      updateAllImageBadges();
      hideUploadOverlay(true);
      try { refreshSlideThumb(activeIndex); } catch (e) {}
      showToast('#' + num + '-GIF varoqda harakatlanmoqda!');
    }
    window.placeGifOnSlide = placeGifOnSlide;
    async function placeVideoOnSlide(url, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        globalImageCounter++;
        const num = globalImageCounter;
        const oid = nextObjectId();
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.src = url;
        v.loop = opts.loop !== false;
        v.muted = opts.muted !== false;
        v.playsInline = true;
        v.autoplay = opts.autoplay !== false;
        const finish = () => {
          const fImg = new VideoImage(v, {
            left: opts.left != null ? opts.left : 60 + (num % 5) * 30,
            top: opts.top != null ? opts.top : 60 + (num % 3) * 30,
            id: `img_video_n${num}_${Date.now()}`,
            imageNumber: num,
            imageHash: 'video_' + num,
            _oid: oid,
            videoUrl: url,
            videoLoop: v.loop,
            videoMuted: v.muted,
            videoAutoplay: v.autoplay,
            objectCaching: false,
          });
          const targetW = opts.width || 480;
          if (fImg.width > targetW) fImg.scaleToWidth(targetW);
          if (opts.fullscreen) {
            fImg.scaleX = canvas.width / (fImg.width || 1);
            fImg.scaleY = canvas.height / (fImg.height || 1);
            fImg.set({ left: 0, top: 0 });
          }
          canvas.add(fImg);
          if (opts.fullscreen) canvas.sendToBack(fImg);
          canvas.setActiveObject(fImg);
          canvas.renderAll();
          ensureMediaRenderLoop();
          try { if (v.autoplay) v.play().catch(function () {}); } catch (e) {}
          if (!slides[activeIndex].imageNumbers) slides[activeIndex].imageNumbers = [];
          if (!slides[activeIndex].imageNumbers.includes(num)) slides[activeIndex].imageNumbers.push(num);
          saveCurrentSlideState();
          updateAllImageBadges();
          showToast(`#${num}-Video varoqqa qo'yildi`);
          resolve();
        };
        v.onloadeddata = finish;
        v.onerror = () => { showToast('Video yuklanmadi', 'error'); resolve(); };
        setTimeout(() => { if (v.readyState >= 2) finish(); }, 2000);
      });
    }
    window.placeVideoOnSlide = placeVideoOnSlide;
    function mediaAddFromUrl() {
      const u = (document.getElementById('mediaUrlInput')?.value || '').trim();
      if (!u) { showToast('URL kiriting', 'error'); return; }
      _mediaSelectedIsVideo = false;
      const isGif = /\.gif(\?|#|$)/i.test(u) || /media\.tenor\.com|c\.tenor\.com|giphy\.com/i.test(u);
      mediaPlaceUrl(u, isGif);
    }
    window.mediaAddFromUrl = mediaAddFromUrl;
    async function mediaHandleFiles(event) {
      const files = event.target.files;
      if (!files || !files.length) return;
      showUploadOverlay('Rasmlar yuklanmoqda...', `${files.length} ta fayl`);
      try {
        for (const f of files) {
          if (/^video\//i.test(f.type || '') || /\.(mp4|webm|ogv|mov|m4v)$/i.test(f.name || '')) {
            try {
              const vu = await fileToVideoUrlPublic(f);
              if (vu) await VideoKit.addToActive({ url: vu });
            } catch (err) { showToast('Video yuklanmadi', 'error'); }
            continue;
          }
          await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onerror = () => { showToast("Faylni o'qib bo'lmadi", 'error'); resolve(); };
            reader.onload = async (ev) => {
              try {
                const isGifFile = (f.type === 'image/gif') || /\.gif$/i.test(f.name || '') || /^data:image\/gif/i.test(String(ev.target.result || ''));
                if (isGifFile && typeof placeGifOnSlide === 'function') await placeGifOnSlide(ev.target.result);   // v36: GIF animatsiyasi saqlanadi
                else await placeImageDirectlyOnSlide(ev.target.result);
              }
              catch (err) { showToast("Rasm yuklanmadi", 'error'); }
              resolve();
            };
            reader.readAsDataURL(f);
          });
        }
      } finally {
        hideUploadOverlay();
      }
      closeMediaBrowser();
      event.target.value = '';
    }
    window.mediaHandleFiles = mediaHandleFiles;
    async function mediaSetAsBackground() {
      const u = _mediaSelectedUrl || (document.getElementById('mediaUrlInput')?.value || '').trim();
      if (!u) { showToast('Avval rasm tanlang yoki URL kiriting', 'error'); return; }
      if (_mediaSelectedIsVideo || (typeof VideoKit !== 'undefined' && !/\.gif(\?|#|$)/i.test(u) && VideoKit.isVideoUrl(u))) {
        const th = _mediaSelectedThumb || '';
        try { closeMediaBrowser(); } catch (e) {}
        await VideoKit.setBackground(activeIndex, { url: u, thumb: th });
        return;
      }
      const isGif = _mediaSelectedIsGif || /\.gif(\?|#|$)/i.test(u) || /media\.tenor\.com|c\.tenor\.com|giphy\.com/i.test(u);
      showUploadOverlay(isGif ? 'GIF fon yuklanmoqda...' : 'Fon rasmi yuklanmoqda...', 'Iltimos kuting');
      try {
        if (isGif) {

          try {
            slides[activeIndex].bgType = 'gif';
            const parsed = JSON.parse(slides[activeIndex].json || '{}');
            parsed.backgroundGif = { src: u, width: 960, height: 540 };
            delete parsed.backgroundImage;
            slides[activeIndex].json = JSON.stringify(parsed);
            canvas.setBackgroundImage(null, () => {
              canvas.setBackgroundColor('rgba(0,0,0,0)', () => {
                try { canvas.requestRenderAll(); } catch (e) {}
              });
            });
            try { GifBackground.applyFromSlide(slides[activeIndex].json); } catch (e) {}
            requestAnimationFrame(() => {
              try { GifBackground.applyFromSlide(slides[activeIndex].json); } catch (e2) {}
              try { canvas.requestRenderAll(); } catch (e2) {}
            });
            setTimeout(() => {
              try { GifBackground.applyFromSlide(slides[activeIndex].json); } catch (e2) {}

              try {
                const p2 = JSON.parse(slides[activeIndex].json || '{}');
                if (!p2.backgroundGif) {
                  p2.backgroundGif = { src: u, width: 960, height: 540 };
                  delete p2.backgroundImage;
                  slides[activeIndex].json = JSON.stringify(p2);
                }
              } catch (e3) {}
              try { refreshSlideThumb(activeIndex); } catch (e) {}
              try { recordGlobalState(); } catch (e) {}
            }, 120);
            hideUploadOverlay(true);
            showToast('GIF fon o\'rnatildi (animatsiyali)');
            closeMediaBrowser();
          } catch (e) {
            hideUploadOverlay(true);
            showToast("GIF fon o'rnatilmadi", 'error');
          }
          return;
        }
        let dataUrl = u;
        if (/^https?:\/\//i.test(u)) {
          try { dataUrl = await resolveRemoteToDataUrl(u); } catch (e) {}
        }
        fabric.Image.fromURL(dataUrl, (img) => {
          if (!img) {
            hideUploadOverlay(true);
            showToast("Fon rasmi yuklanmadi", 'error');
            return;
          }
          img.set({
            scaleX: canvas.width / (img.width || 960),
            scaleY: canvas.height / (img.height || 540),
            originX: 'left', originY: 'top', left: 0, top: 0
          });

          try {
            const parsed = JSON.parse(slides[activeIndex].json || '{}');
            delete parsed.backgroundGif;
            delete parsed.backgroundVideo;
            slides[activeIndex].bgType = 'image';
            slides[activeIndex].json = JSON.stringify(parsed);
            try { GifBackground.clear(); } catch (e) {}
          } catch (e) {}
          canvas.setBackgroundImage(img, () => {
            canvas.renderAll();

            try {
              const parsed = JSON.parse(slides[activeIndex].json || '{}');
              parsed.backgroundImage = {
                type: 'image',
                src: dataUrl,
                left: 0, top: 0,
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
            closeMediaBrowser();
          });
        }, { crossOrigin: 'anonymous' });
      } catch (e) {
        hideUploadOverlay(true);
        showToast("Fon o'rnatilmadi", 'error');
      }
    }
    window.mediaSetAsBackground = mediaSetAsBackground;
    function startPresentation() {
        saveCurrentSlideState();
        presentationIndex = 0;
        const overlay = document.getElementById('presentationOverlay');
        overlay.style.display = 'flex';
        overlay.style.background = '#000';
        renderPresentationSlide();
      }
    function closePresentation() {
      document.getElementById('presentationOverlay').style.display = 'none';
      const gifLayer = document.getElementById('presentationGifOverlay');
      if (gifLayer) gifLayer.innerHTML = '';
      const gifBg = document.getElementById('presentationGifBg');
      if (gifBg) gifBg.innerHTML = '';
    }
