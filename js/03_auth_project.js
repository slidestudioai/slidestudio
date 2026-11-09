    // Faqat HAQIQIY popup oynani aniqlaydi. To'liq sahifa redirect (?code=) popup EMAS —
    // aks holda appInit erta return qilib UI yangilanmasdi va draft tiklanmasdi.
    window.ssIsOauthPopup = function () {
      if (window.__ssIsPopupWindow) return true;
      return false;
    };
    async function appInit() {
      globalImageCounter = 0;
      uploadedImagesStore = [];
      bottomAiImages = [];
      try { await initSupabaseAuth(); } catch (e) { console.error("initSupabaseAuth:", e); }
      if (window.ssIsOauthPopup()) return;   // v36: popup — faqat sessiyani almashtirish
      try { if (typeof WebSocket !== 'undefined') initWebSocket(); } catch (e) { console.error("initWebSocket:", e); }
      try { await fetchAvailableModels(); } catch (e) { console.error("fetchAvailableModels:", e); }
      try { await initProjectFromUrl(); } catch (e) { console.error("initProjectFromUrl:", e); }

      hideLoading();
      if (slides.length === 0) {
        initDefaultProject();
      }
      if (window.innerWidth <= 768) {
        toggleRibbonToolbar(false);
      }
      initAISidebarDefault();
      setupEventListeners();
      fitCanvasToScreen();

      setTimeout(fitCanvasToScreen, 50);
      setTimeout(fitCanvasToScreen, 200);
      setTimeout(fitCanvasToScreen, 500);
      setTimeout(fitCanvasToScreen, 1000);
      setupAttachButtons();
      createHoverTooltip();
      initColorPalette();
      setupScrollEvents();
      setupChatStorageSync();
      restoreChatHistoryFromLocal();
      try { restoreInterruptedMessages(); } catch (e) { console.warn('restoreInterruptedMessages:', e); }
      setupToolbarSelectionSync();
      let _wasDesktop = window.innerWidth > 768;
      const handleViewportResize = () => {
        clearTimeout(window._resizeTimer);
        window._resizeTimer = setTimeout(() => {
          fitCanvasToScreen();
          const isDesktop = window.innerWidth > 768;
          if (isDesktop !== _wasDesktop) {
            _wasDesktop = isDesktop;
            const ai = document.getElementById('aiSidebar');
            ai.classList.toggle('open', isDesktop);
            if (!isDesktop) ai.classList.remove('keyboard-open');
          }
        }, 80);
      };
      window.addEventListener('resize', handleViewportResize);
      window.addEventListener('orientationchange', () => {
        scheduleFitCanvas();
      });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          clearTimeout(window._vvResizeTimer);
          window._vvResizeTimer = scheduleFitCanvas();
        });
      }
      updateAllImageBadges();
      renderWorkspacePreviews();
      renderChatPreviews();
      renderBottomAiPreviews();
      renderPendingImages();
      updateImageModeBadges();

      setInterval(async () => {
        if (supabaseClient && supabaseToken !== "dev-token") {
          await refreshSupabaseToken();
        }
      }, 50 * 60 * 1000);
    }

    function ensureSettingsDropdown() {
      if (document.getElementById('settingsDropdown')) return;
      const dd = document.createElement('div');
      dd.id = 'settingsDropdown';
      dd.className = 'settings-dropdown';
      document.body.appendChild(dd);
    }
    function refreshSettingsDropdown() {
      ensureSettingsDropdown();
      const dd = document.getElementById('settingsDropdown');
      if (!dd) return;
      const logged = isUserLoggedIn();
      dd.innerHTML = '';
      if (logged) {
        const em = document.createElement('div');
        em.className = 'sd-email';
        em.textContent = currentUserEmail || '';
        dd.appendChild(em);
      }
      const item = document.createElement('div');
      item.className = 'sd-item';
      if (logged) {
        item.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;color:#ef4444;">logout</span> Chiqish';
        item.onclick = () => { dd.classList.remove('open'); handleLogout(); };
      } else {
        item.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;color:#0b57d0;">login</span> Google bilan kirish';
        item.onclick = () => { dd.classList.remove('open'); handleGoogleLogin(); };
      }
      dd.appendChild(item);
    }
    window.refreshSettingsDropdown = refreshSettingsDropdown;
    window.ensureSettingsDropdown = ensureSettingsDropdown;
    async function bootApp() {
      const safety = setTimeout(() => {
        console.warn("Safety timeout: loading overlay majburiy yopildi.");
        hideLoading();
      }, 3000);
      try {
        if (document.fonts && document.fonts.ready) {
          try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))]); } catch (e) {}
        }
        await appInit();
      } catch (err) {
        console.error("Initsializatsiyada halokatli xatolik:", err);
        try { showToast("Yuklashda xatolik yuz berdi, lekin interfeys ochildi.", 'error'); } catch (e) {}
        try { if (!slides || slides.length === 0) initDefaultProject(); } catch (e) {}
        try { setupEventListeners(); fitCanvasToScreen(); } catch (e) {}
      } finally {
        clearTimeout(safety);
        hideLoading();
        try { updateAuthUI(); } catch (e) {}
        try {
          setTimeout(fitCanvasToScreen, 80);
          setTimeout(fitCanvasToScreen, 300);
          setTimeout(fitCanvasToScreen, 700);
        } catch (e) {}
        scheduleCrispRerender();
      }
    }
    function makeCanvasTextCrisp() {
      try {
        if (!canvas) return;
        canvas.getObjects().forEach(o => {
          if (o.type && String(o.type).includes('text')) {
            o.set({ dirty: true, objectCaching: false });
          }
        });
        canvas.requestRenderAll();
      } catch (e) {  }
    }
    window.makeCanvasTextCrisp = makeCanvasTextCrisp;
    let _crispScheduled = false;
    function scheduleCrispRerender() {
      if (_crispScheduled) return;
      _crispScheduled = true;
      const run = () => { makeCanvasTextCrisp(); };
      run();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => { run(); setTimeout(run, 60); }).catch(() => {});
      }
      if (document.fonts && document.fonts.addEventListener) {
        try {
          document.fonts.addEventListener('loadingdone', () => { run(); setTimeout(run, 60); });
        } catch (e) {  }
      }
      [120, 400, 900, 1600].forEach(ms => setTimeout(run, ms));
    }
    window.scheduleCrispRerender = scheduleCrispRerender;
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', bootApp);
    } else {
      setTimeout(bootApp, 0);
    }
    window.addEventListener('load', () => { hideLoading(); });
    async function initSupabaseAuth() {
      try {
        const res = await fetch('/api/config/public');
        if (!res.ok) return;
        const cfg = await res.json();
        if (cfg.supabase_url && cfg.supabase_publishable_key) {
          // v39: faqat AUTH sessiyasi (token) alohida kalit 'ss-auth-v39' ostida localStorage'da saqlanadi — sahifa yangilanganda akkaunt chiqib ketmaydi. Slayd/media hamon faqat RAM'da.
          const _ssHash = ssParseOauthHash();
          if (_ssHash && _ssHash.tokens) {
            // Google popup oynasi bo'lsa — tokenlarni asosiy oynaga uzatib, o'zini yopadi
            const handed = await ssHandOffToOpener(_ssHash.tokens);
            if (handed) {
              window.__ssIsPopupWindow = true;
              try { window.close(); } catch (e) {}
              return;
            }
          }
          supabaseClient = supabase.createClient(cfg.supabase_url, cfg.supabase_publishable_key, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit', storageKey: 'ss-auth-v39', storage: (window.__ssAuthStorage || undefined) }
          });
          if (_ssHash) {
            if (_ssHash.error) showToast("Google login rad etildi: " + _ssHash.error, 'error');
            else if (_ssHash.tokens) {
              try {
                const r = await supabaseClient.auth.setSession(_ssHash.tokens);
                if (r && r.error) showToast("Sessiyani tiklashda xatolik: " + r.error.message, 'error');
                else showToast("✅ Google orqali kirdingiz: " + ((r.data && r.data.session && r.data.session.user && r.data.session.user.email) || ''));
              } catch (ex) { console.warn('setSession:', ex); }
            }
          }
          // To'liq sahifa qaytishi: sessiyani UI ga qo'llash
          const { data: { session } } = await supabaseClient.auth.getSession();
          if (session) {
            supabaseToken = session.access_token;
            currentUserEmail = session.user?.email || "";
            window._ssAuthUid = session.user?.id || "";
            const btnText = document.getElementById('loginBtnText');
            if (btnText) btnText.innerText = currentUserEmail ? currentUserEmail.split('@')[0] : "Chiqish";
            const loginBtn = document.getElementById('googleLoginBtn');
            if (loginBtn) loginBtn.classList.add('logged-in');
            const tokenBar = document.getElementById('tokenStatusBar');
            if (tokenBar) tokenBar.style.display = 'flex';
            try { await loadUserStats(); } catch (e) {}
            try { refreshUserProfileSection(); } catch (e) {}
            try { if (typeof updateAuthUI === 'function') updateAuthUI(); } catch (e) {}
          }

          supabaseClient.auth.onAuthStateChange((_event, _session) => {
            const prevEmail = (currentUserEmail || "").toLowerCase();
            const nextEmail = (_session && _session.user && _session.user.email)
              ? String(_session.user.email).toLowerCase()
              : "";
            const prevUid = window._ssAuthUid || "";
            const nextUid = (_session && _session.user && _session.user.id)
              ? String(_session.user.id)
              : "";

            if (_session) {
              supabaseToken = _session.access_token;
              currentUserEmail = _session.user?.email || "";
              window._ssAuthUid = nextUid;
            } else if (_event === "SIGNED_OUT" && !window.__ssUserLogout) {
              // v39: tiklashga urinib ko'riladi — shu vaqtgacha UI "kirgan" holatida qoladi
            } else {
              supabaseToken = "dev-token";
              currentUserEmail = "";
              window._ssAuthUid = "";
            }

            const guestToUser = (!prevEmail && _session && (_event === "SIGNED_IN" || _event === "USER_UPDATED"));
            // v36: mehmon → foydalanuvchi holatida sahifa QAYTA YUKLANMAYDI (slaydlar yo'qolmasin); faqat boshqa akkauntga o'tish / chiqishda.
            // v39: foydalanuvchi o'zi "Chiqish" bosmagan bo'lsa, tasodifiy SIGNED_OUT (tarmoq/token xatosi) akkauntdan chiqarmaydi va sahifani qayta yuklamaydi
            const _spuriousOut = !_session && _event === "SIGNED_OUT" && !window.__ssUserLogout;
            if (_spuriousOut) {
              try { if (typeof window.ssRecoverSession === 'function') window.ssRecoverSession(prevEmail); } catch (e) {}
              return;
            }
            const userSwitched =
              (prevUid && nextUid && prevUid !== nextUid) ||
              (prevEmail && nextEmail && prevEmail !== nextEmail) ||
              (prevEmail && !_session);
            if (guestToUser) {
              setTimeout(function () {
                try { ssApplyLoginInPlace(); } catch (e) {}
                try {
                  const btnText = document.getElementById('loginBtnText');
                  if (btnText && currentUserEmail) btnText.innerText = currentUserEmail.split('@')[0];
                  const loginBtn = document.getElementById('googleLoginBtn');
                  if (loginBtn) loginBtn.classList.add('logged-in');
                  const tokenBar = document.getElementById('tokenStatusBar');
                  if (tokenBar) tokenBar.style.display = 'flex';
                  refreshUserProfileSection();
                } catch (e2) {}
              }, 0);
            }

            if (userSwitched && _event !== "TOKEN_REFRESHED" && _event !== "INITIAL_SESSION") {
              try {

                if (!window._ssAuthReloadScheduled) {
                  window._ssAuthReloadScheduled = true;
                  setTimeout(function () { location.reload(); }, 80);
                }
                return;
              } catch (e) {}
            }
            refreshUserProfileSection();
            try {
              if (typeof loadUserStats === "function" && _session) loadUserStats();
            } catch (e) {}
          });
          refreshUserProfileSection();
        }
      } catch (err) {
        console.warn("Supabase auth init xatolik:", err);
      }
    }
    // v36: mehmon → foydalanuvchi: sahifa qayta yuklanmaydi, faqat kerakli joylar (tugma, balans, profil) yangilanadi
    async function ssApplyLoginInPlace(silentIfNone) {
      if (!supabaseClient) return;
      let session = null;
      try { const r = await supabaseClient.auth.getSession(); session = r && r.data ? r.data.session : null; } catch (e) {}
      if (!session) { return; }
      const uid = session.user && session.user.id ? String(session.user.id) : '';
      if (window._ssLoginAppliedUid === uid && isUserLoggedIn()) return;
      window._ssLoginAppliedUid = uid;
      window._ssAuthUid = uid;
      supabaseToken = session.access_token;
      currentUserEmail = (session.user && session.user.email) || '';
      const btnText = document.getElementById('loginBtnText');
      if (btnText) btnText.innerText = currentUserEmail ? currentUserEmail.split('@')[0] : "Chiqish";
      const loginBtn = document.getElementById('googleLoginBtn');
      if (loginBtn) loginBtn.classList.add('logged-in');
      const tokenBar = document.getElementById('tokenStatusBar');
      if (tokenBar) tokenBar.style.display = 'flex';
      try { await loadUserStats(); } catch (e) {}
      try { refreshUserProfileSection(); } catch (e) {}
      try { if (window.Monitoring && Monitoring.renderUI) Monitoring.renderUI(); } catch (e) {}
      try { if (typeof updateAuthUI === 'function') updateAuthUI(); } catch (e) {}
      showToast("✅ Google orqali kirdingiz: " + currentUserEmail);
      try { window.dispatchEvent(new CustomEvent('ss-logged-in')); } catch (e) {}
    }
    window.ssApplyLoginInPlace = ssApplyLoginInPlace;
    // ---- v38: Google kirish (popup) — tokenlar asosiy oynaga BroadcastChannel orqali (xotirasiz) uzatiladi ----
    function ssParseOauthHash() {
      try {
        const h = (window.location.hash || '').replace(/^#/, '');
        const q = new URLSearchParams(window.location.search);
        if (!h && !q.get('error')) return null;
        const hp = new URLSearchParams(h);
        const out = {};
        const err = hp.get('error_description') || hp.get('error') || q.get('error_description') || q.get('error');
        if (err) out.error = err;
        if (hp.get('access_token') && hp.get('refresh_token')) out.tokens = { access_token: hp.get('access_token'), refresh_token: hp.get('refresh_token') };
        if (!out.error && !out.tokens) return null;
        window.history.replaceState({}, '', window.location.pathname + (window.location.search && !q.get('error') ? window.location.search : ''));
        return out;
      } catch (e) { return null; }
    }
    function ssHandOffToOpener(tokens) {
      return new Promise(function (resolve) {
        let bc = null;
        try { bc = new BroadcastChannel('ss_auth'); } catch (e) { resolve(false); return; }
        const t = setTimeout(function () { try { bc.close(); } catch (e) {} resolve(false); }, 900);
        bc.onmessage = function (ev) {
          if (ev.data && ev.data.type === 'ss-oauth-ack') { clearTimeout(t); try { bc.close(); } catch (e) {} resolve(true); }
        };
        bc.postMessage({ type: 'ss-oauth-tokens', access_token: tokens.access_token, refresh_token: tokens.refresh_token });
      });
    }
    try {
      const _bc = new BroadcastChannel('ss_auth');
      _bc.onmessage = async function (ev) {
        const d = ev && ev.data;
        if (!d || d.type !== 'ss-oauth-tokens' || !window.__ssLoginPending || !supabaseClient) return;   // faqat o'zimiz boshlagan kirish
        window.__ssLoginPending = false;
        _bc.postMessage({ type: 'ss-oauth-ack' });
        try {
          const r = await supabaseClient.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token });
          if (r && r.error) { showToast('Sessiyani tiklashda xatolik: ' + r.error.message, 'error'); return; }
          ssApplyLoginInPlace();
        } catch (e) { console.warn('setSession:', e); }
      };
    } catch (e) {}
    async function refreshSupabaseToken() {
      if (!supabaseClient) return false;
      try {
        const { data: { session }, error } = await supabaseClient.auth.refreshSession();
        if (error || !session) {
          const btnText = document.getElementById('loginBtnText');
          const loginBtn = document.getElementById('googleLoginBtn');
          if (btnText) btnText.innerText = "Kirish";
          if (loginBtn) loginBtn.classList.remove('logged-in');
          supabaseToken = "dev-token";
          currentUserEmail = "";
          refreshUserProfileSection();
          return false;
        }
        supabaseToken = session.access_token;
        currentUserEmail = session.user?.email || currentUserEmail;
        return true;
      } catch (e) { return false; }
    }
    function isUserLoggedIn() {
      return !!(supabaseToken && supabaseToken !== "dev-token" && currentUserEmail);
    }
    function requireLoginToast() {
      const btn = document.getElementById('googleLoginBtn');
      if (btn) {
        btn.style.display = 'flex';
        btn.classList.remove('logged-in');
        try {
          btn.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
            { duration: 400 }
          );
        } catch (e) {  }
      }
      try {
        Swal.fire({
          title: 'Tizimga kiring',
          html: '<div style="font-size:13px;line-height:1.6">AI bilan ishlash uchun bepul akkaunt yarating.<br>Buyruq matni saqlanib qoladi.</div>',
          icon: 'info',
          showCancelButton: true,
          confirmButtonText: '🔐 Google bilan kirish',
          cancelButtonText: 'Keyinroq'
        }).then((r) => { if (r.isConfirmed) handleGoogleLogin(); });
      } catch (e) {
        showToast("AI bilan yozishish uchun avval tizimga kiring!", 'error');
      }
    }
    async function ensureValidToken() {
      if (!isUserLoggedIn()) {
        requireLoginToast();
        return false;
      }
      if (!supabaseClient) return false;
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
          showToast("Sessiya tugadi. Iltimos, qaytadan kiring.", 'error');
          supabaseToken = "dev-token";
          currentUserEmail = "";
          updateAuthUI();
          return false;
        }
        supabaseToken = session.access_token;
        currentUserEmail = session.user?.email || currentUserEmail;
        return true;
      } catch (e) { return false; }
    }
    async function handleGoogleLogin() {
      // v36.9: eski ishonchli usul — to'liq sahifa redirect (popup sessiya yangilanmasligi muammosini berardi)
      if (window._ssLoginBusy && Date.now() - window._ssLoginBusy < 4000) return;
      window._ssLoginBusy = Date.now();
      try {
        if (!supabaseClient) {
          showToast("Supabase konfiguratsiyasi topilmadi (/api/config/public).", 'error');
          console.warn("handleGoogleLogin: supabaseClient null");
          return;
        }
        let session = null;
        try {
          const res = await supabaseClient.auth.getSession();
          session = res && res.data ? res.data.session : null;
        } catch (e) { console.warn("getSession:", e); }

        if (session) {
          await handleLogout();
          return;
        }

        const redirectBase = window.location.origin + window.location.pathname;
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: redirectBase, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } }
        });
        if (error || !data || !data.url) {
          showToast("Google Login xatolik: " + ((error && error.message) || 'URL olinmadi'), 'error');
          return;
        }
        // v49: kirgandan keyin hammasi 0 dan boshlanadi — ish bo'lsa avval ogohlantiramiz
        try {
          if (window.ssHasWork && window.ssHasWork()) {
            let ok = true;
            if (window.Swal && Swal.fire) {
              const r = await Swal.fire({ title: 'Google bilan kirasizmi?', text: "Kirganingizda hozirgi barcha varaqlar o'chib, hammasi 0 dan boshlanadi. Avval PPTX/PDF qilib yuklab oling.", icon: 'warning', showCancelButton: true, confirmButtonText: 'Baribir kirish', cancelButtonText: 'Bekor qilish', confirmButtonColor: '#d93025', reverseButtons: true });
              ok = !!(r && r.isConfirmed);
            } else ok = window.confirm("Kirganingizda hozirgi barcha varaqlar o'chadi. Davom etasizmi?");
            if (!ok) return;
          }
        } catch (e) {}
        window.name = '';
        window.location.href = data.url;
      } catch (e) {
        isSavingOrAuthenticating = false;
        console.error('Google login:', e);
        showToast("Google kirish xatosi: " + (e && e.message || e), 'error');
      } finally {
        setTimeout(function () { window._ssLoginBusy = 0; }, 2000);
      }
    }
    window.handleGoogleLogin = handleGoogleLogin;
    async function handleLogout() {
      window.__ssUserLogout = true;
      try { if (window.__ssAuthStorage) { window.__ssAuthStorage.removeItem('ss-auth-v39'); window.__ssAuthStorage.removeItem('ss-auth-v39-backup'); } } catch (e) {}
      try {
        if (supabaseClient) await supabaseClient.auth.signOut();
      } catch (e) { console.warn("Logout xatolik:", e); }
      supabaseToken = "dev-token";
      currentUserEmail = "";

      const btnText = document.getElementById('loginBtnText');
      if (btnText) btnText.innerText = "Kirish";
      const loginBtn = document.getElementById('googleLoginBtn');
      if (loginBtn) loginBtn.classList.remove('logged-in');
      const tokenBar = document.getElementById('tokenStatusBar');
      if (tokenBar) tokenBar.style.display = 'none';
      refreshUserProfileSection();
      showToast("Tizimdan chiqdingiz");
    }
    window.handleLogout = handleLogout;
    async function loadUserStats() {
      if (!supabaseToken || supabaseToken === "dev-token") return;
      try {
        const res = await fetch(`/api/user/usage?token=${encodeURIComponent(supabaseToken)}`);
        const data = await res.json();
        if (data.error) return;
        try {
          if (typeof applyServerUsage === 'function') applyServerUsage(data);
          else if (window.Monitoring) window.Monitoring.applyServerUsage(data);
        } catch (_) {}
        if (data.total_tokens !== undefined) {
          userStats.total_tokens = data.total_tokens;
          const st = document.getElementById('statTokens');
          if (st) st.innerText = (data.total_tokens || 0).toLocaleString();
        }
      } catch (e) { console.warn("loadUserStats:", e); }
    }
    async function initProjectFromUrl() {
      // Google'dan qaytgach: kirishdan oldingi slaydlarni tiklash (window.name darhol tozalanadi)
      try {
        window.name = '';
        if (false) {
          const d = JSON.parse(window.name.slice(8)); window.name = '';
          if (d && Array.isArray(d.slides) && d.slides.length) {
            currentProjectId = d.id || generateUUID();
            
            projectTitle = d.title || projectTitle;
            const te = document.getElementById('presentationTitle'); if (te) te.innerText = projectTitle;
            slides = d.slides.map(function (s) { return { json: s.json || '{}', thumb: '', imageNumbers: s.imageNumbers || [], transition: s.transition || '' }; });
            activeIndex = 0;
            bumpObjectIdCounterFromSlides();
            renderSidebar();
            await loadSlideCanvasAsync(0);
            updateSlideCounterUI();
            setTimeout(function () { try { slides.forEach(function (_, i) { refreshSlideThumb(i); }); } catch (e) {} hasUnsavedChanges = true; }, 400);
            return;
          }
        }
      } catch (e) { window.name = ''; console.warn('draft restore:', e); }
      // v40: brauzer yopilib qayta ochilganda oxirgi loyiha IndexedDB'dan tiklanadi
      try {
        const sv = window.ssLoadSavedProject ? await window.ssLoadSavedProject() : null;
        if (sv && Array.isArray(sv.slides) && sv.slides.length) {
          currentProjectId = generateUUID();
          projectTitle = sv.title || projectTitle;
          const te2 = document.getElementById('presentationTitle'); if (te2) te2.innerText = projectTitle;
          slides = sv.slides.map(function (s) { return { json: s.json || '{}', thumb: s.thumb || '', imageNumbers: s.imageNumbers || [], transition: s.transition || '' }; });
          activeIndex = Math.max(0, Math.min(slides.length - 1, sv.activeIndex || 0));
          bumpObjectIdCounterFromSlides();
          renderSidebar();
          await loadSlideCanvasAsync(activeIndex);
          updateSlideCounterUI();
          setTimeout(function () { try { slides.forEach(function (s, i) { if (!s.thumb) refreshSlideThumb(i); }); } catch (e) {} }, 400);
          return;
        }
      } catch (e) { console.warn('saqlangan loyiha:', e); }
      const urlParams = new URLSearchParams(window.location.search);
      // v38: ?id= bo'yicha bulutdan yuklash yo'q — har safar yangi, RAM dagi loyiha
      currentProjectId = generateUUID();
      if (urlParams.get('id')) window.history.replaceState(null, '', window.location.pathname);
      initDefaultProject();
    }
    function generateUUID() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    function initDefaultProject() {
      slides = [];
      addSlide('title');
    }
    // v38: slaydlar Supabase'da SAQLANMAYDI (faqat akkaunt va balans). Moslik uchun bo'sh funksiyalar.
    async function loadProjectFromSupabase() { return false; }
    async function saveProjectToSupabase() {
      showToast("Slaydlar bulutda saqlanmaydi — HTML/PPTX/PDF qilib yuklab oling.", 'info');
      try { openExportModal(); } catch (e) {}
    }
    window.saveProjectToSupabase = saveProjectToSupabase;
    function onTitleChange() {
      const el = document.getElementById('presentationTitle');
      projectTitle = el.innerText.trim() || "Yangi Slayd Taqdimoti";
      saveCurrentSlideState();
    }
