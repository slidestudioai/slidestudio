/* =====================================================================
 * 24_v37_upgrade.js  (v37)
 *  1) Yuklanish qatlamlari (spinner/skeleton) abadiy qolib ketmasligi uchun xavfsizlik tozalagichi
 *  2) Tugmalarda ripple effekti
 *  3) Birinchi kirishda Google akkaunt ochishni taklif qilish (uz / ru / en)
 *  4) Internet uzilsa / qaytsa ogohlantirish
 *  5) GIF larni oldindan (fonda) yuklab, doimiy keshga saqlash
 * ===================================================================== */
(function () {
  'use strict';

  // ---------- 1) qotib qolgan loading qatlamlarini tozalash ----------
  const seen = new WeakMap();
  function sweepLoaders() {
    const now = Date.now();
    document.querySelectorAll('.ss-spin, .media-skeleton:not(.failed)').forEach(function (el) {
      const t0 = seen.get(el);
      if (!t0) { seen.set(el, now); return; }
      if (now - t0 > 30000 && !el.classList.contains('done')) {
        el.classList.add('done');
        setTimeout(function () { try { el.remove(); } catch (e) {} }, 450);
        try { const p = el.parentNode; if (p && p.classList) p.classList.remove('ss-loading'); } catch (e) {}
      }
    });
  }
  setInterval(sweepLoaders, 5000);

  // ---------- 2) ripple ----------
  document.addEventListener('pointerdown', function (ev) {
    const b = ev.target && ev.target.closest ? ev.target.closest('.tb-btn, .modal-btn, .ss-gp-btn') : null;
    if (!b || b.disabled) return;
    try {
      b.classList.add('ss-ripple-host');
      const r = b.getBoundingClientRect();
      const d = Math.max(r.width, r.height);
      const s = document.createElement('span');
      s.className = 'ss-ripple';
      s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (ev.clientX - r.left - d / 2) + 'px;top:' + (ev.clientY - r.top - d / 2) + 'px';
      b.appendChild(s);
      setTimeout(function () { try { s.remove(); } catch (e) {} }, 600);
    } catch (e) {}
  }, { passive: true });

  // ---------- 3) Google taklifi (faqat bir marta, birinchi kirishda) ----------
  const TXT = {
    uz: { t: 'Google akkaunt bilan kiring', p: "Bitta bosish bilan kiring — AI varaqlaringiz (limit) akkauntingizda saqlanadi.",
          l: ['Har kuni bepul AI varaqlari', 'Balans va to\'lovlar akkauntingizda', 'Slaydlar faqat qurilmangizda qoladi'], b: 'Google bilan davom etish', s: 'Keyinroq' },
    ru: { t: 'Войдите через аккаунт Google', p: 'Один клик — ваш баланс AI-листов сохраняется в аккаунте.',
          l: ['Бесплатные AI-листы каждый день', 'Баланс и платежи в аккаунте', 'Слайды остаются только на вашем устройстве'], b: 'Продолжить с Google', s: 'Позже' },
    en: { t: 'Sign in with your Google account', p: 'One click — your AI page balance is kept in your account.',
          l: ['Free AI pages every day', 'Balance and payments in your account', 'Slides stay only on your device'], b: 'Continue with Google', s: 'Maybe later' }
  };
  function lang() {
    const l = String(navigator.language || 'uz').slice(0, 2).toLowerCase();
    return TXT[l] ? l : (l === 'tr' || l === 'kk' || l === 'ky' ? 'uz' : 'en');
  }
  // v38: hech narsa qurilmada saqlanmaydi — "ko'rildi" belgisi faqat shu sahifa umri uchun (RAM). Yangilansa — yana taklif qilinadi.
  let _gpSeen = false;
  function markSeen() { _gpSeen = true; }
  function alreadySeen() { return _gpSeen; }

  function renderGooglePrompt() {
    if (document.querySelector('.ss-gp-back')) return;
    const T = TXT[lang()];
    const back = document.createElement('div');
    back.className = 'ss-gp-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.innerHTML =
      '<div class="ss-gp">' +
      '<svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' +
      '<h3></h3><p></p><ul></ul>' +
      '<button type="button" class="ss-gp-btn" data-act="go"></button>' +
      '<button type="button" class="ss-gp-skip" data-act="skip"></button></div>';
    back.querySelector('h3').textContent = T.t;
    back.querySelector('p').textContent = T.p;
    const ul = back.querySelector('ul');
    T.l.forEach(function (x) { const li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
    back.querySelector('[data-act="go"]').textContent = T.b;
    back.querySelector('[data-act="skip"]').textContent = T.s;
    function close() { markSeen(); back.style.opacity = '0'; back.style.transition = 'opacity .2s'; setTimeout(function () { try { back.remove(); } catch (e) {} }, 220); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) {
      if (e.target === back) { close(); return; }
      const act = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!act) return;
      if (act.dataset.act === 'skip') { close(); return; }
      close();
      try { if (typeof handleGoogleLogin === 'function') handleGoogleLogin(); } catch (err) { console.warn(err); }
    });
    document.body.appendChild(back);
    const go = back.querySelector('[data-act="go"]'); try { go.focus({ preventScroll: true }); } catch (e) {}
  }

  async function maybeOfferGoogle() {
    if (alreadySeen()) return;
    if (/[?&](code|error|error_description)=|access_token=/.test(location.search + location.hash)) return;   // OAuth qaytishi
    let session = null;
    try { const r = await supabaseClient.auth.getSession(); session = r && r.data ? r.data.session : null; } catch (e) {}
    if (session) { markSeen(); return; }
    renderGooglePrompt();
  }

  (function waitForAuth() {
    if (alreadySeen()) return;
    let tries = 0;
    const iv = setInterval(function () {
      tries++;
      let ready = false;
      try { ready = typeof supabaseClient !== 'undefined' && !!supabaseClient; } catch (e) {}
      if (ready) { clearInterval(iv); setTimeout(maybeOfferGoogle, 1800); }
      else if (tries > 40) clearInterval(iv);     // ~20 soniya
    }, 500);
  })();

  // ---------- 4) tarmoq holati ----------
  function toast(msg, kind) { try { if (typeof showToast === 'function') showToast(msg, kind || 'info'); } catch (e) {} }
  window.addEventListener('offline', function () { toast({ uz: 'Internet uzildi', ru: 'Нет интернета', en: 'You are offline' }[lang()] || 'Offline', 'error'); });
  window.addEventListener('online', function () { toast({ uz: 'Internet qaytdi', ru: 'Интернет восстановлен', en: 'Back online' }[lang()] || 'Online', 'success'); });

  // ---------- 5) GIF/rasm/video oldindan yuklash — MediaRAM (00a_media_ram.js) va 25_v38_media_fx.js bajaradi ----------
  window.ssPreloadGifs = function (urls) { try { (urls || []).forEach(function (u) { if (window.MediaRAM) window.MediaRAM.warm(u); }); } catch (e) {} };
})();
