    function addSlide(layout = 'title_body') {
      try {
        if (slides.length > 0) {
          try { saveCurrentSlideState(); } catch (e) {}
        }
        try { GifOverlay.clear(); } catch (e) {}
        try { GifBackground.clear(); } catch (e) {}
        try { canvas.discardActiveObject(); } catch (e) {}
        try {
          canvas.clear();
          canvas.setBackgroundColor('#ffffff', function () {
            try { canvas.renderAll(); } catch (e2) {}
          });
        } catch (e) {}
        if (layout === 'blank') {

        } else if (layout === 'title') {
          const title = new fabric.Textbox('Sarlavha Kiriting', {
            left: 100, top: 180, width: 760, fontSize: 44,
            fontWeight: 'bold', textAlign: 'center', fill: '#1f1f1f', fontFamily: 'Montserrat',
            id: 'el_title_' + Date.now()
          });
          try { configureTextbox(title); } catch (e) {}
          try { ensureObjectId(title); } catch (e) {}
          canvas.add(title);
        } else {

          const title = new fabric.Textbox('Sarlavha', {
            left: 80, top: 50, width: 800, fontSize: 32,
            fontWeight: 'bold', fill: '#1f1f1f', fontFamily: 'Montserrat',
            id: 'el_title_' + Date.now()
          });
          const body = new fabric.Textbox('Matn kiriting...', {
            left: 80, top: 140, width: 800, fontSize: 20,
            fill: '#444746', fontFamily: 'Roboto',
            id: 'el_body_' + Date.now()
          });
          try { configureTextbox(title); configureTextbox(body); } catch (e) {}
          try { ensureObjectId(title); ensureObjectId(body); } catch (e) {}
          canvas.add(title, body);
        }
        try { canvas.renderAll(); } catch (e) {}
        let jsonStr = '{}';
        let thumb = '';
        try {
          jsonStr = JSON.stringify(canvas.toJSON(SERIALIZE_PROPS));
        } catch (e) {
          jsonStr = JSON.stringify({ objects: [], background: '#ffffff' });
        }
        try {
          thumb = safeToDataURL(canvas, { format: 'png', multiplier: 0.3 });
        } catch (e) { thumb = ''; }
        const slideObj = {
          json: jsonStr,
          thumb: thumb,
          imageNumbers: [],
        };
        slides.push(slideObj);
        activeIndex = slides.length - 1;
        try { renderSidebar(); } catch (e) {}
        try { updateSlideCounterUI(); } catch (e) {}
        try { updateAllImageBadges(); } catch (e) {}
        try { recordGlobalState(); } catch (e) {}
      } catch (err) {
        console.error('addSlide xato:', err);

        try {
          slides.push({
            json: JSON.stringify({ objects: [], background: '#ffffff' }),
            thumb: '',
            imageNumbers: [],
          });
          activeIndex = slides.length - 1;
          renderSidebar();
          updateSlideCounterUI();
        } catch (e2) {}
      }
    }
    try { window.addSlide = addSlide; } catch (e) {}
    function configureTextbox(textbox) {
      textbox.set({ splitByGrapheme: false, lockScalingY: false });   // v34: AI matni ham, qo'lda yozilgan matn ham bir xil (so'z bo'yicha) o'raladi — aks holda yuklanganda balandligi o'zgarib ramkadan chiqardi
      textbox.on('changed', () => saveCurrentSlideState());
    }

    const MAX_LIVE_THUMB_GIFS = 24;
    let _liveThumbGifCount = 0;
    function _thumbProxyUrl(url) {
      if (!url || typeof url !== 'string') return '';
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) return url;
      if (/^https?:\/\//i.test(url)) return '/api/proxy-image?raw=1&url=' + encodeURIComponent(url);
      return url;
    }
    function renderThumbGifOverlay(thumbEl, slide) {
      if (!thumbEl || !slide) return;
      if (_liveThumbGifCount >= MAX_LIVE_THUMB_GIFS) return;
      let parsed = {};
      try { parsed = JSON.parse(slide.json || '{}'); } catch (e) { return; }
      const CW = 960, CH = 540;

      const bgUrl = parsed.backgroundGif && (parsed.backgroundGif.src || parsed.backgroundGif.url);
      if (bgUrl && _liveThumbGifCount < MAX_LIVE_THUMB_GIFS) {
        _liveThumbGifCount++;
        const bgLayer = document.createElement('div');
        bgLayer.className = 'slide-thumb-bg-gif';
        bgLayer.style.cssText = 'position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;';
        const bgImg = document.createElement('img');
        bgImg.alt = '';
        bgImg.decoding = 'async';
        bgImg.loading = 'lazy';
        bgImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        bgLayer.appendChild(bgImg);
        thumbEl.insertBefore(bgLayer, thumbEl.firstChild);
        const proxied = _thumbProxyUrl(bgUrl);
        try { MediaSkeleton.attach(bgLayer, bgImg, { kind: 'gif', src: proxied }); } catch (e) {}
        bgImg.src = proxied;

        const staticImg = thumbEl.querySelector('img:not(.slide-thumb-bg-gif img)');
        if (staticImg) {
          staticImg.style.position = 'relative';
          staticImg.style.zIndex = '1';

          staticImg.style.background = 'transparent';
        }
      }

      // v33: video fon (YouTube/Vimeo/MP4) — chap paneldagi miniatyurada plakat ko'rinadi
      const bgVid = !bgUrl && parsed.backgroundVideo && parsed.backgroundVideo.url;
      if (bgVid) {
        const vLayer = document.createElement('div');
        vLayer.className = 'slide-thumb-bg-gif slide-thumb-bg-video';
        vLayer.style.cssText = 'position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:transparent;';
        thumbEl.insertBefore(vLayer, thumbEl.firstChild);
        const staticImg2 = thumbEl.querySelector(':scope > img');
        if (staticImg2) { staticImg2.style.position = 'relative'; staticImg2.style.zIndex = '1'; staticImg2.style.background = 'transparent'; }
        try {
          if (window.ssVideoPoster) window.ssVideoPoster(bgVid).then(function (u) {
            if (u && vLayer.isConnected) vLayer.style.background = 'center / cover no-repeat url("' + u + '")';
          });
        } catch (e) {}
      }

      const layer = document.createElement('div');
      layer.className = 'slide-thumb-gifs';
      const gifs = (parsed.objects || []).filter(o => o && (o.isGif || o.type === 'gifImage'));
      gifs.forEach((g) => {
        if (_liveThumbGifCount >= MAX_LIVE_THUMB_GIFS) return;
        const url = g.gifUrl || g.src;
        if (!url) return;
        _liveThumbGifCount++;
        const w = (g.width || 0) * (g.scaleX != null ? g.scaleX : 1);
        const h = (g.height || 0) * (g.scaleY != null ? g.scaleY : 1);
        if (!w || !h) return;
        const left = g.left || 0;
        const top = g.top || 0;
        const originX = g.originX || 'left';
        const originY = g.originY || 'top';
        let x = left, y = top;
        if (originX === 'center') x = left - w / 2;
        else if (originX === 'right') x = left - w;
        if (originY === 'center') y = top - h / 2;
        else if (originY === 'bottom') y = top - h;
        const item = document.createElement('div');
        item.className = 'thumb-gif-item';
        item.style.left = (x / CW * 100) + '%';
        item.style.top = (y / CH * 100) + '%';
        item.style.width = (w / CW * 100) + '%';
        item.style.height = (h / CH * 100) + '%';
        item.style.transform = 'rotate(' + (g.angle || 0) + 'deg)';
        item.style.opacity = (g.opacity != null ? g.opacity : 1);
        item.style.zIndex = '2';
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.loading = 'lazy';
        item.appendChild(img);
        layer.appendChild(item);
        const proxied = _thumbProxyUrl(url);
        try { MediaSkeleton.attach(item, img, { kind: 'gif', src: proxied }); } catch (e) {}
        img.src = proxied;
      });
      if (layer.childNodes.length) thumbEl.appendChild(layer);
    }
    function renderSidebar() {
      const sidebar = document.getElementById('sidebar');

      let savedScroll = 0;
      try {
        const prevScroll = sidebar && sidebar.querySelector('.sidebar-slides-scroll');
        if (prevScroll) savedScroll = prevScroll.scrollTop;
      } catch (e) {}
      sidebar.innerHTML = '';
      _liveThumbGifCount = 0;

      const scrollArea = document.createElement('div');
      scrollArea.className = 'sidebar-slides-scroll';
      slides.forEach((slide, idx) => {
        const item = document.createElement('div');
        const isNew = window._newlyCreatedSlideIds && slide && slide._uid && window._newlyCreatedSlideIds.has(slide._uid);
        item.className = `slide-item ${idx === activeIndex ? 'active' : ''}${isNew ? ' just-created' : ''}`;
        if (isNew) {

          setTimeout(() => {
            item.classList.remove('just-created');
            if (window._newlyCreatedSlideIds) window._newlyCreatedSlideIds.delete(slide._uid);
          }, 700);
        }
        item.draggable = true;
        item.dataset.idx = idx;
        item.onclick = (e) => { e.stopPropagation(); switchSlide(idx); };
        item.ondragstart = (e) => {
          e.dataTransfer.setData('text/plain', String(idx));
          e.dataTransfer.effectAllowed = 'move';
          item.classList.add('dragging');
        };
        item.ondragend = () => item.classList.remove('dragging');
        item.ondragover = (e) => { e.preventDefault(); item.classList.add('drag-over'); };
        item.ondragleave = () => item.classList.remove('drag-over');
        item.ondrop = (e) => {
          e.preventDefault();
          item.classList.remove('drag-over');
          const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
          const toIdx = idx;
          if (isNaN(fromIdx) || fromIdx === toIdx) return;
          saveCurrentSlideState();
          const [moved] = slides.splice(fromIdx, 1);
          slides.splice(toIdx, 0, moved);
          if (activeIndex === fromIdx) activeIndex = toIdx;
          else if (fromIdx < activeIndex && toIdx >= activeIndex) activeIndex--;
          else if (fromIdx > activeIndex && toIdx <= activeIndex) activeIndex++;
          renderSidebar();
          loadSlideCanvas(activeIndex, updateSlideCounterUI);
          recordGlobalState();
        };
        item.oncontextmenu = (e) => {
          e.preventDefault();
          window._rightClickedSlideIndex = idx;
          const menu = document.getElementById('slideContextMenu');
          menu.style.left = e.clientX + 'px';
          menu.style.top = e.clientY + 'px';
          menu.style.display = 'block';
        };
        let pressTimer;
        item.ontouchstart = (e) => {
          pressTimer = setTimeout(() => {
            window._rightClickedSlideIndex = idx;
            const menu = document.getElementById('slideContextMenu');
            menu.style.left = e.touches[0].clientX + 'px';
            menu.style.top = e.touches[0].clientY + 'px';
            menu.style.display = 'block';
          }, 600);
        };
        item.ontouchend = () => clearTimeout(pressTimer);
        item.ontouchmove = () => clearTimeout(pressTimer);
        const imgNums = slide.imageNumbers && slide.imageNumbers.length > 0
          ? `<div class="img-nums">#${slide.imageNumbers.join(',#')}</div>` : '';
        item.innerHTML = `
          <div class="slide-num">${idx + 1}</div>
          <div class="slide-thumb">
            <img src="${slide.thumb}" alt="Slayd ${idx + 1}">
            ${imgNums}
            <div class="slide-more-btn" onclick="event.stopPropagation(); showSlideContextMenu(event, ${idx})">
              <span class="material-symbols-outlined">more_vert</span>
            </div>
          </div>
        `;
        try {
          const thumbEl = item.querySelector('.slide-thumb');
          renderThumbGifOverlay(thumbEl, slide);
        } catch (e) {}
        scrollArea.appendChild(item);
      });
      const addBtn = document.createElement('div');
      addBtn.className = 'btn-add-slide-bottom';
      addBtn.onclick = (e) => { e.stopPropagation(); addSlide('title_body'); };
      addBtn.innerHTML = `<span class="material-symbols-outlined">add</span> Slayd Qo'shish`;
      scrollArea.appendChild(addBtn);
      // v46: «Rasmni tozalash» (hammasini birinchi holatga qaytaradi) va «Bot haqida»
      const resetBtn = document.createElement('div');
      resetBtn.className = 'btn-reset-canvas';
      resetBtn.onclick = (e) => { e.stopPropagation(); if (window.ssResetCanvas) window.ssResetCanvas(); };
      resetBtn.innerHTML = `<span class="material-symbols-outlined">delete_sweep</span> Hamma varaqni tozalash`;
      scrollArea.appendChild(resetBtn);
      const aboutBtn = document.createElement('div');
      aboutBtn.className = 'btn-about-bot';
      aboutBtn.onclick = (e) => { e.stopPropagation(); if (window.ssShowAbout) window.ssShowAbout(); };
      aboutBtn.innerHTML = `<span class="material-symbols-outlined">info</span> Bot haqida`;
      scrollArea.appendChild(aboutBtn);
      sidebar.appendChild(scrollArea);

      renderSidebarUserProfile(sidebar);

      try {
        if (savedScroll > 0) {
          scrollArea.scrollTop = savedScroll;
        } else if (activeIndex > 2) {

          const activeEl = scrollArea.querySelector('.slide-item.active');
          if (activeEl) { var _a = activeEl.offsetTop, _b = _a + activeEl.offsetHeight; if (_a < scrollArea.scrollTop) scrollArea.scrollTop = _a - 8; else if (_b > scrollArea.scrollTop + scrollArea.clientHeight) scrollArea.scrollTop = _b - scrollArea.clientHeight + 8; }
        }
      } catch (e) {}
    }
    function renderSidebarUserProfile(sidebar) {
      if (!sidebar) return;
      sidebar.querySelectorAll('.sidebar-user-section').forEach(el => el.remove());
      const section = document.createElement('div');
      section.className = 'sidebar-user-section';
      const isLoggedIn = !!(currentUserEmail && supabaseToken && supabaseToken !== 'dev-token');
      const email = currentUserEmail || 'Mehmon';
      const initial = (email[0] || 'U').toUpperCase();
      section.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="background:${isLoggedIn ? '#0b57d0' : '#9ca3af'};color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:600;flex-shrink:0;font-size:12px;">${initial}</span>
          <div style="min-width:0;flex:1;">
            <div style="font-size:11px;font-weight:600;color:#1f1f1f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${isLoggedIn ? email : 'Tizimga kirmagan'}</div>
            <div style="font-size:10px;color:#9ca3af;">${isLoggedIn ? 'Tizimda' : 'Mehmon rejim'}</div>
          </div>
          <button type="button" class="btn-settings" id="sidebarSettingsBtn" title="Sozlamalar"
            style="width:40px;height:40px;border-radius:10px;flex-shrink:0;position:relative;display:inline-flex;align-items:center;justify-content:center;border:none;background:#e8eaed;cursor:pointer;color:#3c4043;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>
            </svg>
          </button>
        </div>
      `;
      sidebar.appendChild(section);
      const gear = section.querySelector('#sidebarSettingsBtn');
      if (gear) {
        const openIt = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openSettingsPanel();
        };
        gear.onclick = openIt;
        gear.ontouchend = openIt;
        gear.style.touchAction = 'manipulation';
        gear.style.pointerEvents = 'auto';
        gear.style.zIndex = '20';
      }
    }

    function openSettingsPanel() {
      const sidebar = document.getElementById('sidebar');
      if (!sidebar) return;

      const dd = document.getElementById('settingsDropdown');
      if (dd) dd.classList.remove('open');

      const isLoggedIn = !!(currentUserEmail && supabaseToken && supabaseToken !== 'dev-token');
      const email = currentUserEmail || 'Mehmon';
      const initial = (email[0] || 'U').toUpperCase();
      sidebar.innerHTML = '';
      const panel = document.createElement('div');
      panel.className = 'settings-panel-inner';
      panel.innerHTML = `
        <div class="settings-panel-header">
          <button type="button" class="settings-back-btn" id="settingsBackBtn" title="Orqaga">
            <span class="material-symbols-outlined">arrow_back</span>
          </button>
          <span class="settings-panel-title">Sozlamalar</span>
        </div>
        <div class="settings-panel-body">
          <div class="settings-user-card">
            <span class="settings-avatar" style="background:${isLoggedIn ? '#0b57d0' : '#9ca3af'};">${initial}</span>
            <div class="settings-user-info">
              <div class="settings-user-email">${isLoggedIn ? email : 'Tizimga kirmagan'}</div>
              <div class="settings-user-status">${isLoggedIn ? 'Tizimda' : 'Mehmon rejim'}</div>
            </div>
          </div>
          <div class="settings-menu">
            ${isLoggedIn ? `
              <button type="button" class="settings-menu-item" id="settingsLogoutBtn">
                <span class="material-symbols-outlined" style="color:#ef4444;">logout</span>
                <span>Chiqish</span>
              </button>
            ` : `
              <button type="button" class="settings-menu-item" id="settingsLoginBtn">
                <span class="material-symbols-outlined" style="color:#0b57d0;">login</span>
                <span>Google bilan kirish</span>
              </button>
            `}
            <button type="button" class="settings-menu-item" id="settingsLegalBtn">
              <span class="material-symbols-outlined" style="color:#5f6368;">gavel</span>
              <span>Huquqiy (Terms / Privacy / Refund)</span>
            </button>
          </div>
        </div>
      `;
      sidebar.appendChild(panel);
      const bindTap = (el, fn) => {
        if (!el) return;
        el.onclick = fn;
        el.ontouchend = (e) => { e.preventDefault(); e.stopPropagation(); fn(e); };
        el.style.touchAction = 'manipulation';
      };
      const back = panel.querySelector('#settingsBackBtn');
      bindTap(back, () => { try { renderSidebar(); } catch(e){} });
      const logoutBtn = panel.querySelector('#settingsLogoutBtn');
      bindTap(logoutBtn, () => { try { handleLogout(); } catch(e){} try { renderSidebar(); } catch(e){} });
      const loginBtn = panel.querySelector('#settingsLoginBtn');
      bindTap(loginBtn, () => { try { handleGoogleLogin(); } catch(e){} });
      const legalBtn = panel.querySelector('#settingsLegalBtn');
      if (legalBtn) {
        bindTap(legalBtn, () => {
          try {
            if (window.Swal) {
              Swal.fire({
                title: 'Huquqiy hujjatlar',
                html: '<div style="display:flex;flex-direction:column;gap:10px;text-align:left;">' +
                  '<a href="/terms.html" target="_blank" rel="noopener" style="padding:12px 14px;background:#f1f3f4;border-radius:10px;text-decoration:none;color:#1f1f1f;font-weight:500;">Terms of Service</a>' +
                  '<a href="/privacy.html" target="_blank" rel="noopener" style="padding:12px 14px;background:#f1f3f4;border-radius:10px;text-decoration:none;color:#1f1f1f;font-weight:500;">Privacy Policy</a>' +
                  '<a href="/refund.html" target="_blank" rel="noopener" style="padding:12px 14px;background:#f1f3f4;border-radius:10px;text-decoration:none;color:#1f1f1f;font-weight:500;">Refund Policy</a>' +
                  '</div>',
                showConfirmButton: true,
                confirmButtonText: 'Yopish',
                heightAuto: false
              });
            } else {
              window.open('/terms.html', '_blank');
            }
          } catch (e) {}
        });
      }
    }
    window.openSettingsPanel = openSettingsPanel;

    function refreshUserProfileSection() {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) renderSidebarUserProfile(sidebar);
      updateAuthUI();
    }
    let _isLoggedIn = false;
    function updateAuthUI() {
      const isLoggedIn = isUserLoggedIn();
      _isLoggedIn = isLoggedIn;
      const headerLoginBtn = document.getElementById('googleLoginBtn');
      if (headerLoginBtn) {
        headerLoginBtn.style.display = isLoggedIn ? 'none' : 'flex';
      }
      const btnText = document.getElementById('loginBtnText');
      if (btnText) btnText.innerText = isLoggedIn ? (currentUserEmail.split('@')[0] || 'Profil') : 'Login';
      if (headerLoginBtn) {
        if (isLoggedIn) headerLoginBtn.classList.add('logged-in');
        else headerLoginBtn.classList.remove('logged-in');
      }
      ['aiSidebarInput', 'bottomAiTextarea', 'attachBtnSidebar', 'attachBtnBottomModal'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('ai-locked');
        if ('disabled' in el) el.disabled = false;
        if ('readOnly' in el) el.readOnly = false;
      });
      const sidebarInput = document.getElementById('aiSidebarInput');
      if (sidebarInput) {
        sidebarInput.placeholder = isLoggedIn
          ? 'Butun slayd uchun buyruq...'
          : 'Buyruq yozing (yuborish uchun tizimga kiring)...';
      }
      const bottomTa = document.getElementById('bottomAiTextarea');
      if (bottomTa) {
        bottomTa.placeholder = isLoggedIn
          ? 'Shu varoq haqida yozing...'
          : 'Buyruq yozing (yuborish uchun tizimga kiring)...';
      }
    }
    function showSlideContextMenu(e, idx) {
      const menu = document.getElementById('slideContextMenu');
      if (!menu) return;
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();

      try { closeContextMenus(); } catch (err) {}
      const x = (e && (e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX))) || 100;
      const y = (e && (e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY))) || 100;
      if (idx == null || idx < 0 || idx >= slides.length) return;
      window._rightClickedSlideIndex = idx;
      menu.dataset.slideIndex = String(idx);
      menu.style.left = Math.min(x, window.innerWidth - 210) + 'px';
      menu.style.top = Math.min(y, window.innerHeight - 100) + 'px';
      menu.style.display = 'block';
      menu.classList.add('show');
    }
    window.showSlideContextMenu = showSlideContextMenu;
    // v29: "to'liq (shaffof emas) rang" tekshiruvi — to'q ko'k fon yo'qolib oqqa aylanmasin
    function isSolidBgColor(c) {
      if (typeof c !== 'string') return false;
      const t = c.trim().toLowerCase();
      if (!t || t === 'transparent' || t === 'none' || t === 'null' || t === 'undefined') return false;
      const m = t.match(/^rgba\(([^)]*)\)$/);
      if (m) {
        const parts = m[1].split(',');
        if (parts.length >= 4) { const a = parseFloat(parts[3]); if (isNaN(a) || a <= 0) return false; }
      }
      return true;
    }
    window.isSolidBgColor = isSolidBgColor;
    let _canvasLoadGeneration = 0;
    let _canvasOwner = null;       // v49.5: kanvasda hozir QAYSI varaq obyekti ko'rsatilgan (noto'g'ri varaqqa saqlashni to'xtatadi)
    function _ownerMismatch() {
      if (!_canvasOwner) return false;
      const cur = slides[activeIndex];
      if (!cur || cur === _canvasOwner) return false;
      if (slides.indexOf(_canvasOwner) >= 0) return true;   // kanvas boshqa varaqniki — saqlamaymiz
      _canvasOwner = cur; return false;                      // varaq obyekti almashtirilgan — qabul qilamiz
    }
    let _canvasLoadDoneAt = 0;     // v50: oxirgi yuklash qachon tugadi
    let _canvasDoneGen = 0;        // v49.3: oxirgi YAKUNLANGAN yuklash
    let _canvasLoadingUntil = 0;   // v49.3: yuklash davomida saqlash taqiqlanadi (kanvas vaqtincha noto'g'ri bo'lishi mumkin)
    function loadSlideCanvas(index, callback) {
      const target = slides[index];
      if (!target) { if (callback) callback(); return; }
      const myGeneration = ++_canvasLoadGeneration;
      _canvasLoadingUntil = Date.now() + 25000;   // v50: yuklash tugamaguncha (rasm/media sekin bo'lsa ham) HECH QANDAY saqlash (force ham) kanvasni varaqqa yozmaydi

      let _preBg = '#f1f3f4';
      let _preHasMediaBg = false;
      try {
        const _pr = JSON.parse(target.json || '{}');
        if (_pr.backgroundGif || _pr.backgroundImage) {
          _preHasMediaBg = true;

          _preBg = isSolidBgColor(_pr.background) ? _pr.background
            : (isSolidBgColor(_pr.backgroundColor) ? _pr.backgroundColor : '#ffffff');
        } else if (isSolidBgColor(_pr.background)) {
          _preBg = _pr.background;
        } else if (isSolidBgColor(_pr.backgroundColor)) {
          _preBg = _pr.backgroundColor;
        }
      } catch (_) {}

      const _card = document.getElementById('canvasCard');
      const _wrap = document.getElementById('canvasWrapper');
      try {
        if (_card) {
          _card.style.background = _preBg;
          _card.style.transition = 'none';
        }
        if (_wrap) _wrap.style.background = '#f1f3f4';
        if (canvas && canvas.lowerCanvasEl) {
          canvas.lowerCanvasEl.style.background = _preBg;
          canvas.lowerCanvasEl.style.opacity = '0';
        }
        if (canvas && canvas.upperCanvasEl) {
          canvas.upperCanvasEl.style.background = 'transparent';
          canvas.upperCanvasEl.style.opacity = '0';
        }
        const gifLy = document.getElementById('gifOverlay');
        if (gifLy) gifLy.style.opacity = '0';
      } catch (e) {}

      try { GifOverlay.clear(); } catch (e) {}
      try { GifBackground.clear(); } catch (e) {}

      try {
        canvas.backgroundColor = _preBg;
        canvas.setBackgroundColor(_preBg, () => {});
      } catch (_) {}
      canvas.clear();
      try {

        canvas.backgroundColor = _preBg;
        try { canvas.setBackgroundColor(_preBg, () => {}); } catch (_) {}
        let parsed = {};
        try { parsed = JSON.parse(target.json || '{}'); } catch (e) {}
        canvas.loadFromJSON(target.json, () => {
          if (myGeneration !== _canvasLoadGeneration) {
            _canvasOwner = target;   // fabric kanvasga aynan shu varaqni qo'ydi (garchi eskirgan bo'lsa ham)
            // v49.3: fabric loadFromJSON o'z kanvasini oxirida tozalab eskirgan obyektlarni qo'yadi.
            // Yangi yuklash undan OLDIN tugagan bo'lsa — kanvas buzilgan: oxirgi varaqni qayta yuklaymiz.
            if (_canvasDoneGen > myGeneration) { try { setTimeout(() => loadSlideCanvas(activeIndex), 0); } catch (e) {} }
            if (callback) callback(); return;
          }
          applyBackgroundToCanvas(canvas, parsed, () => {
            if (myGeneration !== _canvasLoadGeneration) { if (callback) callback(); return; }
            _canvasDoneGen = myGeneration; _canvasLoadingUntil = 0; _canvasLoadDoneAt = Date.now(); _canvasOwner = target;
            canvas.forEachObject((obj) => {
              obj.set({ objectCaching: false, dirty: true });
              if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text') configureTextbox(obj);

              try {
                const src = String((obj.gifUrl || obj.src || obj._gifUrl || '')).toLowerCase();
                const looksGif = !!(obj.isGif || obj.type === 'gifImage'
                  || /\.gif(\?|#|$)/i.test(src)
                  || /giphy\.com|tenor\.com/i.test(src)
                  || /^data:image\/gif/i.test(src));
                if (looksGif) {
                  obj.isGif = true;
                  if (!obj.gifUrl && (obj.src || obj._gifUrl)) obj.gifUrl = obj.src || obj._gifUrl;
                  if (obj.type !== 'gifImage') {
                    try { obj.type = 'gifImage'; } catch (e) {}
                  }
                }
              } catch (e) {}
              const oid = obj._oid;
              if (oid != null) {
                if (oid > globalObjectIdCounter) globalObjectIdCounter = oid;
              } else {
                ensureObjectId(obj);
              }
            });
            canvas.requestRenderAll();
            try { ensureMediaRenderLoop(); } catch (e) {}

            try { GifOverlay.sync(); } catch (e) {}
            try { GifBackground.applyFromSlide(target.json); } catch (e) {}

            let _hasGif = false;
            try {
              const _p = parsed || {};
              if (_p.backgroundGif) _hasGif = true;
              if (!_hasGif && Array.isArray(_p.objects)) {
                _hasGif = _p.objects.some(o => o && (o.isGif || o.type === 'gifImage' || (o.gifUrl || '').endsWith('.gif')));
              }
            } catch (_) {}
            if (_hasGif) {

              setTimeout(() => {
                if (myGeneration !== _canvasLoadGeneration) return;
                canvas.requestRenderAll(); updateAllImageBadges();
                try { GifOverlay.sync(); } catch (e) {}
              }, 40);
              setTimeout(() => {
                if (myGeneration !== _canvasLoadGeneration) return;
                try { GifOverlay.sync(); canvas.requestRenderAll(); } catch (e) {}
              }, 200);
              setTimeout(() => {
                if (myGeneration !== _canvasLoadGeneration) return;
                try { GifOverlay.sync(); canvas.requestRenderAll(); } catch (e) {}
              }, 600);
            } else {

              setTimeout(() => {
                if (myGeneration !== _canvasLoadGeneration) return;
                canvas.requestRenderAll();
                try { updateAllImageBadges(); } catch (e) {}
              }, 30);
            }
            try { makeCanvasTextCrisp(); } catch (e) {}
            try { canvas.calcOffset(); fitCanvasToScreen(); } catch (e) {}
            try {
              const card = document.getElementById('canvasCard');
              if (card) {
                let bg = _preBg || '#ffffff';
                try {
                  const pr = JSON.parse(target.json || '{}');
                  if (isSolidBgColor(pr.background) && !pr.backgroundGif) {
                    bg = pr.background;
                  } else if (pr.backgroundGif || pr.backgroundImage) {
                    bg = isSolidBgColor(pr.background) ? pr.background : (isSolidBgColor(pr.backgroundColor) ? pr.backgroundColor : '#ffffff');
                  }
                } catch (_) {}
                card.style.background = bg;
              }
              const wrap = document.getElementById('canvasWrapper');
              if (wrap) wrap.style.background = '#f1f3f4';
            } catch (e) {}

            try {
              if (canvas && canvas.lowerCanvasEl) {
                canvas.lowerCanvasEl.style.transition = 'opacity 0.12s ease';
                canvas.lowerCanvasEl.style.opacity = '1';
              }
              if (canvas && canvas.upperCanvasEl) {
                canvas.upperCanvasEl.style.transition = 'opacity 0.12s ease';
                canvas.upperCanvasEl.style.opacity = '1';
              }
              const gifLy = document.getElementById('gifOverlay');
              if (gifLy) {
                gifLy.style.transition = 'opacity 0.15s ease';
                gifLy.style.opacity = '1';
              }
            } catch (_) {}
            if (callback) callback();
          });
        });
      } catch (e) {
        console.error("loadSlideCanvas xatolik:", e);
        if (callback) callback();
      }
    }
    function loadSlideCanvasAsync(index) {
      return new Promise((resolve) => loadSlideCanvas(index, resolve));
    }
    function saveCurrentSlideState(opts) {
      const force = !!(opts && opts.force);
      const allowEmpty = !!(opts && opts.allowEmpty);
      if (!slides[activeIndex]) return;
      // v50: yuklash davomida kanvas bo'sh/yarim bo'ladi — force bo'lsa ham saqlab bo'lmaydi (rasmli varaq mazmuni yo'qolishining sababi shu edi)
      if (Date.now() < _canvasLoadingUntil) return;
      if (_ownerMismatch()) { console.warn('[v49.5] kanvas boshqa varaqniki — saqlash o\'tkazib yuborildi'); return; }   // v49.3: yuklash tugamaguncha saqlamaymiz
      if (window.isAiApplyingCommands || isAiApplyingCommands ||
          window.isAiStreaming || isAiStreaming ||
          isUndoRedoAction || window.isRedoUndoAction) {
        return;
      }
      try {
        const jsonState = canvas.toJSON(SERIALIZE_PROPS);
        const currentObjs = jsonState.objects || [];

        let prevBgGif = null;
        let prevBgImage = null;
        let prevBgColor = null;
        let prevBgVideo = null;
        let skipFullSave = false;
        try {
          const prevParsed = JSON.parse(slides[activeIndex].json || '{}');
          const prevObjs = prevParsed.objects || [];
          if (prevParsed.backgroundGif && (prevParsed.backgroundGif.src || prevParsed.backgroundGif.url)) {
            prevBgGif = prevParsed.backgroundGif;
          }
          if (prevParsed.backgroundImage && prevParsed.backgroundImage.src) {
            prevBgImage = prevParsed.backgroundImage;
          }
          if (isSolidBgColor(prevParsed.background)) prevBgColor = prevParsed.background;
          else if (isSolidBgColor(prevParsed.backgroundColor)) prevBgColor = prevParsed.backgroundColor;
          if (prevParsed.backgroundVideo && prevParsed.backgroundVideo.url) prevBgVideo = prevParsed.backgroundVideo;
          if (prevObjs.length > 0 && currentObjs.length === 0 && (!force || (!allowEmpty && Date.now() - _canvasLoadDoneAt < 6000))) {
            console.warn("Kutilmagan bo'sh canvas saqlanishi to'xtatildi (race).");
            skipFullSave = true;
          }
          const prevImgCount = prevObjs.filter(o => o && (o.type === 'image' || o.type === 'gifImage' || o.isGif)).length;
          const currImgCount = currentObjs.filter(o => o && (o.type === 'image' || o.type === 'gifImage' || o.isGif)).length;
          if (!force && prevImgCount > 0 && currImgCount < prevImgCount) {
            console.warn("Rasmlar hali yuklanmagan — to'liq saqlash kechiktirildi (race).");
            skipFullSave = true;
          }
        } catch (_) {}
        if (skipFullSave) {
          return;     // v50: yarim yuklangan kanvasdan miniatyura OLINMAYDI (chap paneldagi varaq faqat fon bo'lib qolardi)
        }

        const _userChoseColor = (slides[activeIndex].bgType === 'color');
        const _liveBgGif = (!_userChoseColor && typeof GifBackground !== 'undefined' &&
                            GifBackground.hasGif && GifBackground.hasGif());
        if (_userChoseColor) {

          delete jsonState.backgroundGif;
          delete jsonState.backgroundImage;
          // v29: haqiqat — kanvasdagi hozirgi to'liq rang. Eski bgVal faqat zaxira
          // (avval AI yaratgan to'q ko'k fon eski "oq" bgVal bilan ustidan bosilib yo'qolardi).
          const _solid = isSolidBgColor(jsonState.background) ? jsonState.background
            : (isSolidBgColor(slides[activeIndex].bgVal) ? slides[activeIndex].bgVal
              : (prevBgColor || '#ffffff'));
          jsonState.background = _solid;
          jsonState.backgroundColor = _solid;
          slides[activeIndex].bgVal = _solid;
        } else if (prevBgGif) {
          jsonState.backgroundGif = prevBgGif;
          delete jsonState.backgroundImage;

          if (!jsonState.background || typeof jsonState.background !== 'string') {
            jsonState.background = prevBgColor || '#ffffff';
          }
          jsonState.backgroundColor = jsonState.background;
        } else if (prevBgImage) {

          if (!jsonState.backgroundImage) jsonState.backgroundImage = prevBgImage;
          // Undo/Redo da siljishni oldini olish: origin va scale ni to'liq kanvasga normallashtirish
          try {
            const bi = jsonState.backgroundImage;
            if (bi && typeof bi === 'object') {
              bi.originX = 'left';
              bi.originY = 'top';
              bi.left = 0;
              bi.top = 0;
              const iw = bi.width || 960;
              const ih = bi.height || 540;
              if (!bi.scaleX || bi.scaleX === 1) bi.scaleX = 960 / (iw || 960);
              if (!bi.scaleY || bi.scaleY === 1) bi.scaleY = 540 / (ih || 540);
            }
          } catch (e) {}
          delete jsonState.backgroundGif;
        } else if (_liveBgGif) {

          try {
            const _cur = GifBackground.currentUrl && GifBackground.currentUrl();
            if (_cur) {
              jsonState.backgroundGif = { src: _cur, width: 960, height: 540 };
              delete jsonState.backgroundImage;
            }
          } catch (_) {}
        } else {
          delete jsonState.backgroundGif;
        }

        if (jsonState.background && typeof jsonState.background === 'object') {
          jsonState.background = jsonState.backgroundColor || '#ffffff';
        }
        if (!jsonState.background && jsonState.backgroundColor) {
          jsonState.background = jsonState.backgroundColor;
        }
        // v29: rasm/GIF/video fon vaqtida kanvas rangi shaffof (rgba(0,0,0,0)) bo'ladi — uni slayd rangi
        // sifatida saqlab yubormaymiz, aks holda fon olib tashlanganda asl rang (masalan to'q ko'k) yo'qolardi.
        if (!isSolidBgColor(jsonState.background)) {
          const _fallbackBg = prevBgColor
            || (isSolidBgColor(slides[activeIndex].bgVal) ? slides[activeIndex].bgVal : null)
            || '#ffffff';
          jsonState.background = _fallbackBg;
        }
        if (!isSolidBgColor(jsonState.backgroundColor)) jsonState.backgroundColor = jsonState.background;
        // v27: orqa fon VIDEO ni saqlab qolamiz (canvas.toJSON uni bilmaydi)
        if (prevBgVideo && !_userChoseColor && !jsonState.backgroundGif && !jsonState.backgroundImage) {
          jsonState.backgroundVideo = prevBgVideo;
          const _tr = /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$|^transparent$/i;
          if (typeof jsonState.background !== 'string' || !jsonState.background || _tr.test(jsonState.background)) {
            const _keep = (prevBgColor && !_tr.test(prevBgColor)) ? prevBgColor : '#ffffff';
            jsonState.background = _keep;
            jsonState.backgroundColor = _keep;
          }
        } else {
          delete jsonState.backgroundVideo;
        }
        slides[activeIndex].json = JSON.stringify(jsonState);
        slides[activeIndex].thumb = safeToDataURL(canvas, { format: 'png', multiplier: 0.3 });
        hasUnsavedChanges = true;
      } catch (e) { console.warn("saveCurrentSlideState:", e); }
    }
    let _switchBusy = false, _switchPending = null;
    async function switchSlide(index) {
      if (!slides || slides.length === 0) return;
      if (index < 0 || index >= slides.length) return;
      if (index === activeIndex) {

        try { renderSidebar(); } catch (e) {}
        try { updateSlideCounterUI(); } catch (e) {}
        return;
      }
      if (_switchBusy) { _switchPending = index; return; }  // v22: yuklanish tugamay yangi almashtirish boshlanmaydi
      _switchBusy = true;
      try {
        try { saveCurrentSlideState(); } catch (e) {}
        activeIndex = index;
        await Promise.race([loadSlideCanvasAsync(activeIndex), new Promise((r) => setTimeout(r, 5000))]);
        renderSidebar();
        updateSlideCounterUI();
        updateAllImageBadges();
      } finally {
        _switchBusy = false;
        const nxt = _switchPending; _switchPending = null;
        if (nxt != null && nxt !== activeIndex) switchSlide(nxt);
      }
    }
    window.switchSlide = switchSlide;
    function deleteSelected() {
      closeContextMenus();
      const activeObjects = canvas.getActiveObjects();
      if (!activeObjects || !activeObjects.length) return;
      activeObjects.forEach((obj) => {
        if (!obj) return;
        if (isImageLike(obj) && obj.imageNumber) {
          const num = obj.imageNumber;
          if (slides[activeIndex].imageNumbers) {
            slides[activeIndex].imageNumbers = slides[activeIndex].imageNumbers.filter(n => n !== num);
          }
        }
        try {
          if (obj._oid != null && typeof GifOverlay !== 'undefined') {
            GifOverlay.removeEntry(obj._oid);
          }
        } catch (e) {}
        try { canvas.remove(obj); } catch (e) {}
      });
      try { canvas.discardActiveObject(); } catch (e) {}
      try { canvas._activeObject = null; } catch (e) {}
      try { if (typeof GifOverlay !== 'undefined') GifOverlay.sync(); } catch (e) {}
      try { canvas.requestRenderAll(); } catch (e) {}
      requestAnimationFrame(() => {
        try {
          if (typeof GifOverlay !== 'undefined') GifOverlay.scheduleSync();
          canvas.requestRenderAll();
        } catch (e) {}
      });
      saveCurrentSlideState({ force: true, allowEmpty: true });
      updateAllImageBadges();
      recordGlobalState();
      try {
        clearTimeout(window._thumbRefreshTimer);
        const _ti = activeIndex;
        window._thumbRefreshTimer = setTimeout(() => {
          try { refreshSlideThumb(_ti); } catch (e) {}
        }, 200);
      } catch (e) {}
    }
    function duplicateSlide() {
      const idx = window._rightClickedSlideIndex;
      if (idx === undefined || idx === null) return;
      const source = slides[idx];
      slides.splice(idx + 1, 0, {
        json: source.json,
        thumb: source.thumb,
        imageNumbers: [...(source.imageNumbers || [])],
      });
      activeIndex = idx + 1;
      renderSidebar();
      loadSlideCanvas(activeIndex, updateSlideCounterUI);
      closeContextMenus();
      recordGlobalState();
    }
    function deleteSlide() {
      const idx = window._rightClickedSlideIndex;
      if (idx === undefined || idx === null) return;
      if (slides.length <= 1) { showToast("Kamida bitta slayd kerak!", 'error'); return; }
      slides.splice(idx, 1);
      if (activeIndex >= slides.length) activeIndex = slides.length - 1;
      renderSidebar();
      loadSlideCanvas(activeIndex, updateSlideCounterUI);
      closeContextMenus();
      recordGlobalState();
    }
    function closeContextMenus() {
      document.querySelectorAll('.context-menu').forEach(m => {
        m.style.display = 'none';
        m.classList.remove('show');
      });
    }
    function addTextBox() {
      const textbox = new fabric.Textbox('Yangi Matn', {
        left: 200, top: 200, width: 400, fontSize: 28, fill: '#1f1f1f',
        fontFamily: 'Arial',
        id: 'el_text_' + Date.now()
      });
      configureTextbox(textbox);
      textbox._boxH = 120; textbox._baseFont = 28;   // v36: aniq (qat'iy) o'lchamli quti — matn sig'maganda shrift kichrayadi
      try { textbox.initDimensions(); } catch (e) {}
      ensureObjectId(textbox);
      canvas.add(textbox);
      canvas.setActiveObject(textbox);
      canvas.renderAll();
      saveCurrentSlideState();
      recordGlobalState();
    }
    function addShape(type) {
      let shape;
      const id = 'el_shape_' + Date.now();
      const fill = selectedColorHex || '#3b82f6';
      if (type === 'rect') shape = new fabric.Rect({ left: 320, top: 180, width: 150, height: 100, fill, id });
      else if (type === 'circle') shape = new fabric.Circle({ left: 320, top: 180, radius: 60, fill, id });
      else if (type === 'triangle') shape = new fabric.Triangle({ left: 320, top: 180, width: 120, height: 100, fill, id });
      else if (type === 'line') shape = new fabric.Line([50, 100, 250, 100], { left: 320, top: 180, stroke: fill, strokeWidth: 4, id });
      else if (type === 'arrow_right') shape = new fabric.Path('M 0 20 L 30 20 L 30 0 L 60 30 L 30 60 L 30 40 L 0 40 Z', { left: 320, top: 180, fill, id });
      else if (type === 'arrow_up') shape = new fabric.Path('M 20 60 L 20 30 L 0 30 L 30 0 L 60 30 L 40 30 L 40 60 Z', { left: 320, top: 180, fill, id });
      else if (type === 'arrow_down') shape = new fabric.Path('M 20 0 L 20 30 L 0 30 L 30 60 L 60 30 L 40 30 L 40 0 Z', { left: 320, top: 180, fill, id });
      else if (type === 'star') shape = new fabric.Path('M 10 0 L 13 7 L 20 7 L 15 11 L 17 18 L 10 13 L 3 18 L 5 11 L 0 7 L 7 7 Z', { left: 320, top: 180, fill, scaleX: 4, scaleY: 4, id });
      else if (type === 'pentagon') shape = new fabric.Polygon([{x: 50, y: 0}, {x: 100, y: 38}, {x: 82, y: 100}, {x: 18, y: 100}, {x: 0, y: 38}], { left: 320, top: 180, fill, id });
      else if (type === 'hexagon') shape = new fabric.Polygon([{x: 30, y: 0}, {x: 90, y: 0}, {x: 120, y: 50}, {x: 90, y: 100}, {x: 30, y: 100}, {x: 0, y: 50}], { left: 320, top: 180, fill, id });
      else if (type === 'heart') shape = new fabric.Path('M 272.70141,238.71731 C 240.07341,218.57231 220.65141,183.08831 220.65141,143.12531 C 220.65141,83.921312 268.65041,35.921312 327.85441,35.921312 C 361.68441,35.921312 391.80241,51.611312 411.23341,76.321312 C 430.66541,51.611312 460.78341,35.921312 494.61341,35.921312 C 553.81741,35.921312 601.81641,83.921312 601.81641,143.12531 C 601.81641,183.08831 582.39441,218.57231 549.76641,238.71731 L 411.23341,380.00031 L 272.70141,238.71731 Z', { left: 320, top: 180, fill, scaleX: 0.2, scaleY: 0.2, id });
      else if (type === 'chat_bubble') shape = new fabric.Path('M 20 0 L 180 0 C 191 0 200 9 200 20 L 200 120 C 200 131 191 140 180 140 L 60 140 L 20 170 L 20 140 C 9 140 0 131 0 120 L 0 20 C 0 9 9 0 20 0 Z', { left: 320, top: 180, fill, scaleX: 0.8, scaleY: 0.8, id });
      if (shape) {
        ensureObjectId(shape);
        canvas.add(shape);
        canvas.bringToFront(shape);
        canvas.setActiveObject(shape);
        canvas.renderAll();
        saveCurrentSlideState();
        recordGlobalState();
      }
      document.getElementById('shapesMenu').style.display = 'none';
    }
    function applyTextStyle(prop, value) {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      const isText = (o) => {
        if (!o) return false;
        try {
          return (o.isType && (o.isType('textbox') || o.isType('i-text') || o.isType('text'))) ||
            o.type === 'textbox' || o.type === 'i-text' || o.type === 'text';
        } catch (e) { return false; }
      };
      const applyOne = (obj) => {
        if (!isText(obj)) return;
        try {
          // Tahrirlash rejimida bo'lsa — avval chiqib, keyin stil qo'llash (aks holda ko'rinmaydi)
          // v36: faqat tahrirlash paytida VA haqiqiy belgilash bo'lsa — belgilangan qismga; aks holda butun matn qutisiga.
          // (Avval eskirgan belgilash qolib ketib, 1-2 harf boshqa o'lchamda chiqardi.)
          const hadRange = !!obj.isEditing && obj.selectionStart != null && obj.selectionEnd != null && obj.selectionStart !== obj.selectionEnd;
          const rs = hadRange ? obj.selectionStart : 0, re = hadRange ? obj.selectionEnd : 0;
          if (obj.isEditing) {
            try { obj.exitEditing(); } catch (e) {}
          }
          if (hadRange && prop !== 'fontSize') {
            obj.setSelectionStyles({ [prop]: value }, rs, re);
          } else {
            window.__ssNoFit = (window.__ssNoFit || 0) + 1;
            try { obj.set(prop, value); } finally { window.__ssNoFit--; }
            if (prop === 'fontSize') obj._baseFont = value;
            // v36.2: eski harf-stillari (fill/qalin/o'lcham...) butun matn o'zgarishini bekor qilmasin
            try { if (obj.styles) { Object.keys(obj.styles).forEach(function (ln) { Object.keys(obj.styles[ln]).forEach(function (ch) { if (obj.styles[ln][ch] && obj.styles[ln][ch][prop] !== undefined) delete obj.styles[ln][ch][prop]; }); }); } } catch (e) {}
            // foydalanuvchi aniq o'lcham/uslub tanlagan: quti kerak bo'lsa kengayadi (matn orqaga kichraymaydi)
            if (/^(fontSize|fontWeight|fontStyle|fontFamily|charSpacing|lineHeight)$/.test(prop) && typeof window.SSTextFit === 'function') window.SSTextFit(obj, true);
            else { try { obj.initDimensions(); } catch (e) {} }
          }
          obj.dirty = true;
          if (typeof obj.setCoords === 'function') obj.setCoords();
        } catch (e) {}
      };
      if (activeObj.type === 'activeSelection') {
        (activeObj.getObjects ? activeObj.getObjects() : []).forEach(applyOne);
        if (activeObj.setCoords) activeObj.setCoords();
        activeObj.dirty = true;
      } else {
        applyOne(activeObj);
      }
      try { canvas.requestRenderAll(); } catch (e) {}
      // Ba'zi hollarda birinchi render e'tiborsiz qoladi — keyingi frame da qayta
      requestAnimationFrame(() => {
        try {
          const ao = canvas.getActiveObject();
          if (ao) { ao.dirty = true; if (ao.setCoords) ao.setCoords(); }
          canvas.requestRenderAll();
        } catch (e) {}
      });
      // v42: avval kadr chiziladi, og'ir saqlash keyin (katta GIF/video bo'lsa ham o'zgarish darhol ko'rinadi)
      try { canvas.renderAll(); } catch (e) {}
      if (window.ssDeferSave) window.ssDeferSave();
      else { saveCurrentSlideState(); recordGlobalState(); }
    }
    function changeFontSize(delta) {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      let current = 28;
      if (activeObj.type === 'activeSelection') {
        const texts = (activeObj.getObjects ? activeObj.getObjects() : []).filter(o => o && (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text'));
        if (!texts.length) return;
        current = texts[0].get('fontSize') || 28;
      } else if ((activeObj.isType && (activeObj.isType('textbox') || activeObj.isType('i-text'))) || activeObj.type === 'textbox' || activeObj.type === 'i-text') {
        current = activeObj._baseFont || activeObj.get('fontSize') || 28;
      } else return;
      const updated = Math.max(8, Math.min(120, current + delta));
      applyTextStyle('fontSize', updated);
      const fsEl = document.getElementById('fontSize');
      if (fsEl) fsEl.value = updated;
    }
    function toggleBold() {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      let current = 'normal';
      if (activeObj.type === 'activeSelection') {
        const texts = (activeObj.getObjects ? activeObj.getObjects() : []).filter(o => o && (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text'));
        if (!texts.length) return;
        current = texts[0].fontWeight || 'normal';
      } else if ((activeObj.isType && (activeObj.isType('textbox') || activeObj.isType('i-text'))) || activeObj.type === 'textbox' || activeObj.type === 'i-text') {
        current = activeObj.fontWeight || 'normal';
      } else return;
      applyTextStyle('fontWeight', current === 'bold' ? 'normal' : 'bold');
    }
    function toggleItalic() {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      let current = 'normal';
      if (activeObj.type === 'activeSelection') {
        const texts = (activeObj.getObjects ? activeObj.getObjects() : []).filter(o => o && (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text'));
        if (!texts.length) return;
        current = texts[0].fontStyle || 'normal';
      } else if ((activeObj.isType && (activeObj.isType('textbox') || activeObj.isType('i-text'))) || activeObj.type === 'textbox' || activeObj.type === 'i-text') {
        current = activeObj.fontStyle || 'normal';
      } else return;
      applyTextStyle('fontStyle', current === 'italic' ? 'normal' : 'italic');
    }
    function toggleUnderline() {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      let current = false;
      if (activeObj.type === 'activeSelection') {
        const texts = (activeObj.getObjects ? activeObj.getObjects() : []).filter(o => o && (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text'));
        if (!texts.length) return;
        current = !!texts[0].underline;
      } else if ((activeObj.isType && (activeObj.isType('textbox') || activeObj.isType('i-text'))) || activeObj.type === 'textbox' || activeObj.type === 'i-text') {
        current = !!activeObj.underline;
      } else return;
      applyTextStyle('underline', !current);
    }
    function setTextAlignment(align) { applyTextStyle('textAlign', align); }
    function bringForward() {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      if (activeObj.type === 'activeSelection') {

        const objs = activeObj.getObjects ? activeObj.getObjects() : [];
        objs.forEach((o) => { try { canvas.bringForward(o); } catch (e) {} });
      } else {
        canvas.bringForward(activeObj);
      }
      canvas.requestRenderAll();
      try { GifOverlay.sync(); } catch (e) {}
      saveCurrentSlideState();
      recordGlobalState();
    }
    function sendBackward() {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      if (activeObj.type === 'activeSelection') {
        const objs = activeObj.getObjects ? activeObj.getObjects() : [];
        objs.forEach((o) => { try { canvas.sendBackwards(o); } catch (e) {} });
      } else {
        canvas.sendBackwards(activeObj);
      }
      canvas.requestRenderAll();
      try { GifOverlay.sync(); } catch (e) {}
      saveCurrentSlideState();
      recordGlobalState();
    }
    function bringToFront() {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      if (activeObj.type === 'activeSelection') {
        const objs = activeObj.getObjects ? activeObj.getObjects() : [];
        objs.forEach((o) => { try { canvas.bringToFront(o); } catch (e) {} });
      } else {
        canvas.bringToFront(activeObj);
      }
      canvas.requestRenderAll();
      try { GifOverlay.sync(); } catch (e) {}
      saveCurrentSlideState();
      recordGlobalState();
    }
    function sendToBack() {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      if (activeObj.type === 'activeSelection') {
        const objs = activeObj.getObjects ? activeObj.getObjects() : [];
        objs.forEach((o) => { try { canvas.sendToBack(o); } catch (e) {} });
      } else {
        canvas.sendToBack(activeObj);
      }
      canvas.requestRenderAll();
      try { GifOverlay.sync(); } catch (e) {}
      saveCurrentSlideState();
      recordGlobalState();
    }
    window.bringToFront = bringToFront;
    window.sendToBack = sendToBack;
    function copyObject() {
      closeContextMenus();
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      activeObj.clone((cloned) => { _clipboardStack = cloned; }, SERIALIZE_PROPS);
    }
    function pasteObject() {
      closeContextMenus();
      if (!_clipboardStack) return;
      const src = _clipboardStack;

      const restoreGifProps = (from, to) => {
        if (!from || !to) return;
        if (from.isGif || from.type === 'gifImage' || from.gifUrl || from._gifUrl) {
          to.set({
            isGif: true,
            type: 'gifImage',
            gifUrl: from.gifUrl || from._gifUrl || from.src || '',
            _gifUrl: from.gifUrl || from._gifUrl || from.src || '',
            src: from.gifUrl || from._gifUrl || from.src || to.src
          });
          try { to.isGif = true; to.gifUrl = from.gifUrl || from._gifUrl || from.src; } catch (e) {}
        }
      };
      _clipboardStack.clone((clonedObj) => {
        canvas.discardActiveObject();
        try { if (src._boxH) { clonedObj._boxH = src._boxH; clonedObj._baseFont = src._baseFont; } } catch (e) {}
        const preserveGeom = (from, to) => {
          if (!from || !to) return;
          const keys = ['scaleX', 'scaleY', 'width', 'height', 'angle', 'opacity', 'flipX', 'flipY', 'originX', 'originY'];
          keys.forEach((k) => {
            if (from[k] != null && to[k] !== from[k]) to.set(k, from[k]);
          });
        };
        preserveGeom(src, clonedObj);
        restoreGifProps(src, clonedObj);
        clonedObj.set({
          left: (clonedObj.left || 0) + 24,
          top: (clonedObj.top || 0) + 24,
          evented: true,
          selectable: true
        });

        try { delete clonedObj._oid; } catch (e) {}
        const assignImageNum = (obj) => {
          if (obj && isImageLike(obj)) {
            const num = assignNextImageNumber();
            obj.set({ imageNumber: num });
            if (!slides[activeIndex].imageNumbers) slides[activeIndex].imageNumbers = [];
            if (!slides[activeIndex].imageNumbers.includes(num)) slides[activeIndex].imageNumbers.push(num);
          }
        };
        if (clonedObj.type === 'activeSelection') {
          clonedObj.canvas = canvas;
          clonedObj.forEachObject((obj) => {
            if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text') configureTextbox(obj);
            try { delete obj._oid; } catch (e) {}
            ensureObjectId(obj);
            assignImageNum(obj);
            obj.set({ dirty: true, objectCaching: false, visible: true, opacity: obj.opacity != null ? obj.opacity : 1 });
            try { obj.setCoords(); } catch (e) {}
            canvas.add(obj);
          });
          clonedObj.setCoordinates();
        } else {
          if (clonedObj.type === 'textbox' || clonedObj.type === 'i-text' || clonedObj.type === 'text') {
            configureTextbox(clonedObj);
          }
          ensureObjectId(clonedObj);
          assignImageNum(clonedObj);
          clonedObj.set({ dirty: true, objectCaching: false, visible: true, opacity: clonedObj.opacity != null ? clonedObj.opacity : 1 });
          try { clonedObj.setCoords(); } catch (e) {}
          canvas.add(clonedObj);
        }
        _clipboardStack.top = (_clipboardStack.top || 0) + 24;
        _clipboardStack.left = (_clipboardStack.left || 0) + 24;
        canvas.setActiveObject(clonedObj);

        try { canvas.calcOffset(); } catch (e) {}
        canvas.requestRenderAll();
        try { canvas.renderAll(); } catch (e) {}
        try { GifOverlay.scheduleSync(); } catch (e) {}
        try { GifOverlay.sync && GifOverlay.sync(); } catch (e) {}
        setTimeout(() => {
          try { canvas.requestRenderAll(); } catch (e) {}
          try { GifOverlay.sync && GifOverlay.sync(); } catch (e) {}
        }, 30);
        setTimeout(() => {
          try { canvas.requestRenderAll(); GifOverlay.sync && GifOverlay.sync(); } catch (e) {}
        }, 120);

        try {
          if (clonedObj.type === 'activeSelection' && Array.isArray(clonedObj._objects)) {

            const added = clonedObj._objects.slice();
            added.forEach(o => { try { canvas.bringToFront(o); } catch(e){} });
          }
        } catch (e) {}
        saveCurrentSlideState();
        recordGlobalState();

        try {
          if (typeof refreshSlideThumb === 'function') refreshSlideThumb(activeIndex);
          else if (typeof renderSidebar === 'function') setTimeout(() => renderSidebar(), 50);
        } catch (e) {}
        setTimeout(() => {
          try {
            if (typeof refreshSlideThumb === 'function') refreshSlideThumb(activeIndex);
            if (typeof GifOverlay !== 'undefined' && GifOverlay.sync) GifOverlay.sync();
            canvas.requestRenderAll();
          } catch (e) {}
        }, 200);
      });
    }
    function selectAll() {
      canvas.discardActiveObject();

      const objs = canvas.getObjects().filter((o) => {
        if (!o || o.selectable === false || o.evented === false) return false;
        if (o.isBackground || o._isBackground) return false;
        try {
          const w = (o.width || 0) * (o.scaleX || 1);
          const h = (o.height || 0) * (o.scaleY || 1);
          if (w >= 900 && h >= 500 && o.type === 'image') return false;
        } catch (e) {}
        return true;
      });
      if (!objs.length) {

        const gifs = canvas.getObjects().filter((o) => o && (o.isGif || o.type === 'gifImage') && o.selectable !== false);
        if (gifs.length) {
          canvas.setActiveObject(gifs[0]);
          canvas.requestRenderAll();
        }
        return;
      }
      if (objs.length === 1) {
        canvas.setActiveObject(objs[0]);
      } else {
        const sel = new fabric.ActiveSelection(objs, { canvas: canvas });
        sel.setControlsVisibility({
          mt: true, mb: true, ml: true, mr: true,
          tl: true, tr: true, bl: true, br: true, mtr: true
        });
        canvas.setActiveObject(sel);
      }
      canvas.requestRenderAll();
      try { GifOverlay.scheduleSync(); } catch (e) {}
    }
    function recordGlobalState() {
      if (isUndoRedoAction) return;
      if (isAiStreaming || isAiApplyingCommands || aiSessionActive ||
          window.isAiStreaming || window.isAiApplyingCommands || window.aiSessionActive) {
        return;
      }
      const slidesSnapshot = slides.map(s => ({
        json: s.json, thumb: s.thumb,
        imageNumbers: s.imageNumbers || []
      }));
      const snapshotStr = JSON.stringify({ slides: slidesSnapshot, activeIndex });
      if (globalHistory[historyStep] === snapshotStr) return;
      historyStep++;
      globalHistory = globalHistory.slice(0, historyStep);
      globalHistory.push(snapshotStr);
      if (globalHistory.length > MAX_HISTORY_STEPS) {
        globalHistory.shift();
        historyStep--;
      }
    }
    function saveCurrentSlideStateDirectly() {
      if (!slides[activeIndex]) return;
      if (Date.now() < _canvasLoadingUntil || _ownerMismatch()) return;
      try {
        slides[activeIndex].json = JSON.stringify(canvas.toJSON(SERIALIZE_PROPS));
        slides[activeIndex].thumb = safeToDataURL(canvas, { format: 'png', multiplier: 0.3 });
        hasUnsavedChanges = true;
      } catch (e) { console.warn("saveCurrentSlideStateDirectly:", e); }
    }
    window.saveCurrentSlideStateDirectly = saveCurrentSlideStateDirectly;
    // v23: Undo/Redo o'zgarish bo'lgan varaqda qoladi (avval snapshotdagi eski varaq raqamiga sakrardi)
    function _pickUndoIndex(prevSlides, nextSlides, fallback) {
      try {
        if (!prevSlides || prevSlides.length !== nextSlides.length) return fallback;
        const diff = [];
        for (let i = 0; i < nextSlides.length; i++) {
          if ((prevSlides[i].json || '') !== (nextSlides[i].json || '')) diff.push(i);
        }
        if (!diff.length) return activeIndex;
        return diff.indexOf(activeIndex) >= 0 ? activeIndex : diff[0];
      } catch (e) { return fallback; }
    }
    async function undo() {
      if (historyStep <= 0) {
        showToast("Bekor qilish uchun oldingi holat yo'q", 'error');
        return;
      }
      try { saveCurrentSlideStateDirectly(); } catch (e) {}
      isUndoRedoAction = true;
      window.isRedoUndoAction = true;
      historyStep--;
      try {
        const state = JSON.parse(globalHistory[historyStep]);
        const _prevSlides = slides;
        slides = state.slides;
        activeIndex = Math.min(Math.max(_pickUndoIndex(_prevSlides, slides, state.activeIndex || 0), 0), slides.length - 1);
        try { recalculateGlobalImageCounter(); } catch (e) {  }
        _lastRenderedSlideIndex = -1;
        await loadSlideCanvasAsync(activeIndex);
        renderSidebar();
        updateSlideCounterUI();
        updateAllImageBadges();
        showToast("Bekor qilindi (Undo)");
      } catch (e) {
        console.warn('undo xato:', e);
      } finally {
        isUndoRedoAction = false;
        window.isRedoUndoAction = false;
      }
    }
    async function redo() {
      if (historyStep >= globalHistory.length - 1) {
        showToast("Qaytarish uchun keyingi holat yo'q", 'error');
        return;
      }
      try { saveCurrentSlideStateDirectly(); } catch (e) {}
      isUndoRedoAction = true;
      window.isRedoUndoAction = true;
      historyStep++;
      try {
        const state = JSON.parse(globalHistory[historyStep]);
        const _prevSlides = slides;
        slides = state.slides;
        activeIndex = Math.min(Math.max(_pickUndoIndex(_prevSlides, slides, state.activeIndex || 0), 0), slides.length - 1);
        try { recalculateGlobalImageCounter(); } catch (e) {  }
        _lastRenderedSlideIndex = -1;
        await loadSlideCanvasAsync(activeIndex);
        renderSidebar();
        updateSlideCounterUI();
        updateAllImageBadges();
        showToast("Qaytarildi (Redo)");
      } catch (e) {
        console.warn('redo xato:', e);
      } finally {
        isUndoRedoAction = false;
        window.isRedoUndoAction = false;
      }
    }
    const paletteColors = [
      '#93c5fd', '#86efac', '#fde047', '#fdba74', '#fca5a5', '#c084fc', '#d97706', '#9ca3af', '#4b5563',
      '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#b45309', '#6b7280', '#374151',
      '#2563eb', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#9333ea', '#92400e', '#4b5563', '#1f2937',
      '#1d4ed8', '#15803d', '#a16207', '#c2410c', '#b91c1c', '#7e22ce', '#78350f', '#374151', '#111827',
      '#1e40af', '#166534', '#854d0e', '#9a3412', '#991b1b', '#6b21a8', '#451a03', '#1f2937', '#030712'
    ];
    function initColorPalette() {
      const paletteView = document.getElementById('paletteView');
      paletteView.innerHTML = '';
      paletteColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'palette-swatch';
        swatch.style.backgroundColor = color;
        swatch.onclick = () => {
          document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
          swatch.classList.add('selected');
          selectedColorHex = color;
        };
        paletteView.appendChild(swatch);
      });
    }
    function openColorPicker(target) {
      activeColorTarget = target;
      document.getElementById('colorModal').style.display = 'flex';
    }
    function closeColorPicker() {
      document.getElementById('colorModal').style.display = 'none';
    }
    function switchColorTab(tab) {
      document.getElementById('tabPalette').classList.toggle('active', tab === 'palette');
      document.getElementById('tabCustom').classList.toggle('active', tab === 'custom');
      document.getElementById('paletteView').style.display = tab === 'palette' ? 'grid' : 'none';
      document.getElementById('customView').style.display = tab === 'custom' ? 'flex' : 'none';
    }
    function updateHue(val) {
      currentHue = val;
      document.getElementById('spectrumBox').style.background = `hsl(${currentHue}, 100%, 50%)`;
      updateColorFromHSV();
    }
    function handleSpectrumDrag(e) {
      const box = document.getElementById('spectrumBox');
      const rect = box.getBoundingClientRect();
      const updatePosition = (evt) => {
        let x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
        let y = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
        currentSat = Math.round((x / rect.width) * 100);
        currentVal = Math.round((1 - y / rect.height) * 100);
        const handle = document.getElementById('spectrumHandle');
        handle.style.left = x + 'px';
        handle.style.top = y + 'px';
        updateColorFromHSV();
      };
      updatePosition(e);
      const onMouseMove = (evt) => updatePosition(evt);
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    function updateColorFromHSV() {
      const rgb = hsvToRgb(currentHue, currentSat, currentVal);
      document.getElementById('rgbR').value = rgb.r;
      document.getElementById('rgbG').value = rgb.g;
      document.getElementById('rgbB').value = rgb.b;
      selectedColorHex = rgbToHex(rgb.r, rgb.g, rgb.b);
    }
    function updateFromRGBInputs() {
      let r = parseInt(document.getElementById('rgbR').value) || 0;
      let g = parseInt(document.getElementById('rgbG').value) || 0;
      let b = parseInt(document.getElementById('rgbB').value) || 0;
      selectedColorHex = rgbToHex(r, g, b);
    }
    function confirmColorSelection() {
      if (activeColorTarget === 'text') applyTextStyle('fill', selectedColorHex);
      else if (activeColorTarget === 'fill') updateObjectColor(selectedColorHex);
      else if (activeColorTarget === 'bg') setSlideBackground(selectedColorHex);
      closeColorPicker();
    }
    function hsvToRgb(h, s, v) {
      s /= 100; v /= 100;
      let c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
      let r = 0, g = 0, b = 0;
      if (0 <= h && h < 60) { r = c; g = x; b = 0; }
      else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
      else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
      else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
      else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
      else if (300 <= h && h < 360) { r = c; g = 0; b = x; }
      return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
    }
    function rgbToHex(r, g, b) {
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    function updateObjectColor(color) {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      const applyOne = (obj) => {
        if (!obj) return;
        if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text') return;
        if (obj.type === 'line' || (obj.type === 'path' && (obj.fill == null || obj.fill === ''))) {
          obj.set('stroke', color);
        } else {
          obj.set('fill', color);
        }
        obj.dirty = true;
        if (typeof obj.setCoords === 'function') obj.setCoords();
      };
      if (activeObj.type === 'activeSelection') {
        (activeObj.getObjects ? activeObj.getObjects() : []).forEach(applyOne);
        if (activeObj.setCoords) activeObj.setCoords();
        activeObj.dirty = true;
      } else {
        applyOne(activeObj);
      }
      try { canvas.requestRenderAll(); } catch (e) {}
      requestAnimationFrame(() => {
        try {
          const ao = canvas.getActiveObject();
          if (ao) { ao.dirty = true; if (ao.setCoords) ao.setCoords(); }
          canvas.requestRenderAll();
        } catch (e) {}
      });
      saveCurrentSlideState();
      recordGlobalState();
    }
    function setSlideBackground(color) {
      if (!slides[activeIndex]) return;

      try { GifBackground.clear(); } catch (e) {}
      try {
        const card = document.getElementById('canvasCard');
        if (card) card.classList.remove('has-gif-bg');
      } catch (e) {}
      canvas.setBackgroundImage(null, () => {
        canvas.setBackgroundColor(color || '#ffffff', () => {
          canvas.requestRenderAll();

          let parsed = {};
          try { parsed = JSON.parse(slides[activeIndex].json || '{}'); } catch (e) { parsed = {}; }
          parsed.background = color || '#ffffff';
          parsed.backgroundColor = color || '#ffffff';
          delete parsed.backgroundGif;
          delete parsed.backgroundVideo;
          delete parsed.backgroundImage;

          slides[activeIndex].json = JSON.stringify(parsed);
          slides[activeIndex].bgType = 'color';
          slides[activeIndex].bgVal = color;
          try {
            slides[activeIndex].thumb = safeToDataURL(canvas, { format: 'png', multiplier: 0.3 });
          } catch (e) {}
          hasUnsavedChanges = true;
          try { recordGlobalState(); } catch (e) {}
          try { scheduleSidebarRender && scheduleSidebarRender(40); } catch (e) {
            try { renderSidebar(); } catch (e2) {}
          }
        });
      });
    }
    function toggleAISidebar(forceState) {
      const el = document.getElementById('aiSidebar');
      const willOpen = typeof forceState === 'boolean' ? forceState : !el.classList.contains('open');
      el.classList.toggle('open', willOpen);
      let backdrop = document.getElementById('aiBackdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'aiBackdrop';
        backdrop.className = 'ai-backdrop';
        backdrop.onclick = () => toggleAISidebar(false);
        document.body.appendChild(backdrop);
      }
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        backdrop.classList.toggle('active', willOpen);
        document.body.classList.toggle('ai-panel-open', willOpen);
      } else {
        backdrop.classList.remove('active');
        document.body.classList.remove('ai-panel-open');
      }
      if (!willOpen) el.classList.remove('keyboard-open');
      scheduleFitCanvas();
      if (willOpen) {
        setTimeout(() => {
          const inp = document.getElementById('aiSidebarInput');
          if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) {} }
        }, 360);
      }
    }
    window.toggleAISidebar = toggleAISidebar;
    function initAISidebarDefault() {
      if (window.innerWidth > 768) {
        document.getElementById('aiSidebar').classList.add('open');
      } else {
        document.getElementById('aiSidebar').classList.remove('open');
      }
    }
    function toggleSidebarMenu() {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      if (window.innerWidth <= 768) {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
      } else {
        sidebar.classList.toggle('collapsed');
        setTimeout(fitCanvasToScreen, 300);
      }
    }
    function toggleRibbonToolbar(forceState) {
      const ribbon = document.getElementById('ribbonToolbar');
      if (!ribbon) return;
      const icon = document.getElementById('ribbonToggleIcon');
      if (typeof forceState === 'boolean') {
        if (forceState) ribbon.classList.remove('collapsed');
        else ribbon.classList.add('collapsed');
      } else {
        ribbon.classList.toggle('collapsed');
      }
      const isCollapsed = ribbon.classList.contains('collapsed');
      if (icon) icon.innerText = isCollapsed ? 'tune' : 'expand_less';
      setTimeout(fitCanvasToScreen, 260);
    }
    function toggleFitFullScreen(forceState) {
      const container = document.getElementById('editorContainer');
      const exitBtn = document.getElementById('fullScreenExitBtn');
      let isFit;
      if (typeof forceState === 'boolean') isFit = forceState;
      else isFit = !container.classList.contains('fullscreen-fit-mode');
      if (isFit) {
        container.classList.add('fullscreen-fit-mode');
        exitBtn.style.display = 'flex';
      } else {
        container.classList.remove('fullscreen-fit-mode');
        exitBtn.style.display = 'none';
      }
      fitCanvasToScreen();
    }
    window.toggleDropdown = function toggleDropdown(e, menuId) {
      e.stopPropagation();
      const menu = document.getElementById(menuId);
      if (!menu) return;
      const isVisible = menu.style.display === 'block';
      document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
      menu.style.display = isVisible ? 'none' : 'block';
    }
    function toggleShapesMenu(e) {
      e.stopPropagation();
      const menu = document.getElementById('shapesMenu');
      const rect = e.currentTarget.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      let left = rect.left;
      let top = rect.bottom + 6;
      if (left + 220 > windowWidth) left = windowWidth - 230;
      if (top + 140 > windowHeight) top = rect.top - 150;
      menu.style.left = Math.max(10, left) + 'px';
      menu.style.top = Math.max(10, top) + 'px';
      menu.style.display = menu.style.display === 'grid' ? 'none' : 'grid';
    }
    function showToast(msg, type = 'success') {
      const toast = document.getElementById('toastNotification');
      const msgEl = document.getElementById('toastMessage');
      if (msgEl) msgEl.innerText = msg;
      toast.classList.add('show');
      if (type === 'error') toast.classList.add('error');
      else toast.classList.remove('error');

      setTimeout(() => toast.classList.remove('show'), type === 'error' ? 5000 : 3000);

      if (type === 'error') {
        try { showErrorPopup(msg); } catch (e) {  }
      }
    }

    let _errorPopupTimer = null;
