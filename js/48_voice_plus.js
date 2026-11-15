/* js/48_voice_plus.js (v66) — ovozli yozish, ovozli o'qish va slayd ustidagi «+» (rasm qo'shish)
 *
 *  1) 🎤 Ovozli yozish (AI chat): brauzerning BEPUL SpeechRecognition'i. Gapirgan sari matn maydonga yozilib boradi.
 *     Chrome / Edge / Safari'da ishlaydi. Firefox va ba'zi Telegram WebView'larida yo'q — u yerda tugma ko'rinmaydi.
 *     Til: UZ (odatiy) · RU · EN — tugmani uzoq bosib (yoki o'ng tugma) almashtiriladi.
 *  2) 🔊 Ovozli o'qish (AI xabari): brauzerning BEPUL speechSynthesis'i. O'zbek ovozi bo'lmasa — eng yaqini
 *     (turk) ishlatiladi; kirill matn — rus ovozi.
 *  3) «+» slaydning chap-yuqori burchagida: qurilmadan rasm qo'shish (triggerDirectImageUpload).
 */
(function () {
  'use strict';
  if (window.__ssVoicePlus) return;
  window.__ssVoicePlus = true;

  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'success'); } catch (e) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var css = document.createElement('style');
  css.textContent = [
    // v54.css .attach-btn ga display:inline-flex !important beradi — yashirish ham !important bo'lishi kerak
    '#attachBtnSidebar{display:none!important}',
    '.ss-mic-btn.ss-mic-off{display:none!important}',
    '.ss-mic-btn{position:relative}',
    '.ss-mic-btn .ss-mic-lang{position:absolute;right:-2px;bottom:-2px;font:700 8px/1 system-ui,sans-serif;font-style:normal;',
    ' background:#ede9fe;color:#6d28d9;border-radius:4px;padding:2px 3px;pointer-events:none}',
    '.ss-mic-btn.ss-listening{color:#fff!important;background:#dc2626!important;border-radius:50%;animation:ssMicPulse 1.2s ease-in-out infinite}',
    '.ss-mic-btn.ss-listening .ss-mic-lang{background:#fff;color:#dc2626}',
    '@keyframes ssMicPulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.45)}50%{box-shadow:0 0 0 7px rgba(220,38,38,0)}}',
    '.ai-action-btn.ss-speak-btn{padding:4px 8px;min-width:0}',
    '.ai-action-btn.ss-speak-btn.ss-speaking{color:#6d28d9;background:#ede9fe}',
    '#ssSlidePlus{position:absolute;z-index:30;width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;',
    ' display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#7c3aed,#2563eb);',
    ' box-shadow:0 4px 14px rgba(37,99,235,.35);transition:transform .15s ease,box-shadow .2s ease;padding:0}',
    '#ssSlidePlus:hover{transform:scale(1.08);box-shadow:0 6px 18px rgba(37,99,235,.45)}',
    '#ssSlidePlus:focus-visible{outline:2px solid #1d4ed8;outline-offset:2px}',
    '#ssSlidePlus .material-symbols-outlined{font-size:22px}',
    '@media (prefers-reduced-motion:reduce){.ss-mic-btn.ss-listening{animation:none}}'
  ].join('');
  document.head.appendChild(css);

  /* =====================================================================
   * 1) OVOZLI YOZISH
   * ===================================================================== */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var LANGS = [['uz-UZ', 'UZ'], ['ru-RU', 'RU'], ['en-US', 'EN']];
  var langIdx = Math.max(0, LANGS.map(function (l) { return l[0]; }).indexOf(lsGet('ss-mic-lang') || 'uz-UZ'));
  var rec = null, listening = false, baseText = '', finalText = '';

  function micBtn() { return document.getElementById('micBtnSidebar'); }
  function input() { return document.getElementById('aiSidebarInput'); }

  function setLangBadge() {
    var b = micBtn(); if (!b) return;
    var i = b.querySelector('.ss-mic-lang'); if (i) i.textContent = LANGS[langIdx][1];
    b.title = 'Ovozli yozish (' + LANGS[langIdx][1] + ') — bosing va gapiring. Tilni almashtirish: uzoq bosing';
  }

  function writeToInput(text) {
    var el = input(); if (!el) return;
    el.value = text;
    try { if (typeof window.autoGrowSidebarInput === 'function') window.autoGrowSidebarInput(el); } catch (e) {}
    try { el.scrollTop = el.scrollHeight; } catch (e) {}
  }

  function stopListening() {
    listening = false;
    var b = micBtn(); if (b) b.classList.remove('ss-listening');
    try { if (rec) rec.stop(); } catch (e) {}
  }

  function startListening() {
    if (!SR) return;
    var el = input(); if (!el) return;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}   // o'qiyotgan bo'lsa to'xtatamiz
    rec = new SR();
    rec.lang = LANGS[langIdx][0];
    rec.continuous = true;          // gapirib turguncha yozib boradi
    rec.interimResults = true;      // gap tugashini kutmasdan, aytilgan sari ko'rsatadi
    rec.maxAlternatives = 1;
    baseText = el.value ? el.value.replace(/\s+$/, '') + ' ' : '';
    finalText = '';
    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t.replace(/^\s+/, '') + ' ';
        else interim += t;
      }
      writeToInput(baseText + finalText + interim);
    };
    rec.onerror = function (ev) {
      var e = ev && ev.error;
      if (e === 'not-allowed' || e === 'service-not-allowed') toast("Mikrofonga ruxsat bering (brauzer manzil satridagi 🔒 belgisi).", 'error');
      else if (e === 'network') toast("Ovozni matnga aylantirish uchun internet kerak.", 'error');
      else if (e === 'language-not-supported') toast("Bu brauzer " + LANGS[langIdx][1] + " tilini tanimaydi. Tilni uzoq bosib almashtiring.", 'error');
      // 'no-speech' / 'aborted' — jim to'xtaymiz
    };
    rec.onend = function () {
      if (listening) { try { rec.start(); return; } catch (e) {} }   // brauzer o'zi to'xtatsa — davom etamiz
      listening = false;
      var b = micBtn(); if (b) b.classList.remove('ss-listening');
      writeToInput((baseText + finalText).replace(/\s+$/, ''));
      try { el.focus(); } catch (e) {}
    };
    try {
      rec.start();
      listening = true;
      micBtn().classList.add('ss-listening');
    } catch (e) {
      toast("Mikrofonni yoqib bo'lmadi.", 'error');
    }
  }

  function initMic() {
    var b = micBtn(); if (!b) return;
    if (!SR) { b.classList.add('ss-mic-off'); return; }      // qo'llab-quvvatlanmaydi — tugma ko'rsatilmaydi
    b.style.display = '';
    b.classList.remove('ss-mic-off');
    setLangBadge();
    var pressT = null, longPressed = false;
    function cycleLang() {
      langIdx = (langIdx + 1) % LANGS.length;
      lsSet('ss-mic-lang', LANGS[langIdx][0]);
      setLangBadge();
      toast('Ovozli yozish tili: ' + LANGS[langIdx][1]);
      if (listening) { stopListening(); setTimeout(startListening, 300); }
    }
    b.addEventListener('pointerdown', function () {
      longPressed = false;
      clearTimeout(pressT);
      pressT = setTimeout(function () { longPressed = true; cycleLang(); }, 600);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { b.addEventListener(t, function () { clearTimeout(pressT); }); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); clearTimeout(pressT); if (!longPressed) cycleLang(); longPressed = true; });
    b.addEventListener('click', function (e) {
      e.preventDefault();
      if (longPressed) { longPressed = false; return; }
      if (listening) stopListening(); else startListening();
    });
    // xabar yuborilsa — yozishni to'xtatamiz (keyingi xabarga eski matn qo'shilmasin)
    var send = document.getElementById('btnSidebarAi');
    if (send) send.addEventListener('click', function () { if (listening) { listening = false; try { rec.abort(); } catch (e) {} micBtn().classList.remove('ss-listening'); } }, true);
    var el = input();
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && listening) { listening = false; try { rec.abort(); } catch (x) {} micBtn().classList.remove('ss-listening'); } }, true);
  }

  /* =====================================================================
   * 2) OVOZLI O'QISH
   * ===================================================================== */
  var synth = window.speechSynthesis;
  var speakingBtn = null;

  function cleanForSpeech(t) {
    return String(t || '')
      .replace(/```[\s\S]*?```/g, ' ')                 // kod bloklari (JSON) o'qilmaydi
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[*_#>`~|]/g, ' ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function detectLang(t) {
    if (/[а-яё]/i.test(t)) return /[ўқғҳ]/i.test(t) ? 'uz' : 'ru';
    if (/[oO]['ʻ‘’`]|[gG]['ʻ‘’`]|\b(va|bu|uchun|bilan|ham|emas|qiling|slayd|yoki|men|siz)\b/i.test(t)) return 'uz';
    return 'en';
  }

  function pickVoice(lang) {
    var vs = synth ? synth.getVoices() : [];
    var pref = lang === 'uz' ? ['uz', 'tr', 'kk', 'az'] : lang === 'ru' ? ['ru'] : ['en'];
    for (var i = 0; i < pref.length; i++) {
      var v = vs.filter(function (x) { return (x.lang || '').toLowerCase().indexOf(pref[i]) === 0; });
      if (v.length) return v.sort(function (a, b) { return (b.localService ? 0 : 1) - (a.localService ? 0 : 1); })[0];
    }
    return null;
  }

  function stopSpeaking() {
    try { if (synth) synth.cancel(); } catch (e) {}
    if (speakingBtn) { speakingBtn.classList.remove('ss-speaking'); setIcon(speakingBtn, false); }
    speakingBtn = null;
  }
  function setIcon(btn, on) {
    var i = btn.querySelector('.material-symbols-outlined');
    if (i) i.textContent = on ? 'stop_circle' : 'volume_up';
    btn.title = on ? "To'xtatish" : "Ovozli o'qish";
  }

  function speak(msgDiv, btn) {
    if (!synth) { toast("Bu brauzer ovozli o'qishni qo'llab-quvvatlamaydi.", 'error'); return; }
    if (speakingBtn === btn) { stopSpeaking(); return; }
    stopSpeaking();
    var node = msgDiv.querySelector('.msg-text') || msgDiv;
    var text = cleanForSpeech(node.innerText || node.textContent);
    if (!text) return;
    var lang = detectLang(text);
    // uzun matn bo'laklarga bo'linadi (ba'zi brauzerlar ~200 belgidan keyin to'xtab qoladi)
    var parts = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    var chunks = [], cur = '';
    parts.forEach(function (p) { if ((cur + p).length > 180 && cur) { chunks.push(cur); cur = ''; } cur += p; });
    if (cur.trim()) chunks.push(cur);
    var voice = pickVoice(lang);
    speakingBtn = btn; btn.classList.add('ss-speaking'); setIcon(btn, true);
    chunks.forEach(function (c, idx) {
      var u = new SpeechSynthesisUtterance(c);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = lang === 'uz' ? 'tr-TR' : lang === 'ru' ? 'ru-RU' : 'en-US';
      u.rate = 1;
      if (idx === chunks.length - 1) u.onend = u.onerror = function () { if (speakingBtn === btn) stopSpeaking(); };
      synth.speak(u);
    });
  }

  window.ssMakeSpeakButton = function (msgDiv) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ai-action-btn ss-speak-btn';
    b.dataset.role = 'speak';
    b.innerHTML = '<span class="material-symbols-outlined">volume_up</span>';
    b.title = "Ovozli o'qish";
    b.setAttribute('aria-label', "Ovozli o'qish");
    b.onclick = function (e) { e.stopPropagation(); speak(msgDiv, b); };
    return b;
  };
  if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = function () {};   // ovozlar ro'yxatini yuklatadi
  window.addEventListener('pagehide', stopSpeaking);

  /* =====================================================================
   * 3) «+» — slaydning chap-yuqori burchagida rasm qo'shish
   * ===================================================================== */
  function initPlus() {
    var wrap = document.getElementById('canvasWrapper');
    var card = document.getElementById('canvasCard');
    if (!wrap || !card || document.getElementById('ssSlidePlus')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'ssSlidePlus';
    b.title = "Rasm qo'shish";
    b.setAttribute('aria-label', "Slaydga rasm qo'shish");
    b.innerHTML = '<span class="material-symbols-outlined">add</span>';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (typeof window.triggerDirectImageUpload === 'function') window.triggerDirectImageUpload();
      else toast("Rasm yuklash hozircha tayyor emas.", 'error');
    });
    wrap.appendChild(b);

    var raf = 0;
    function place() {
      raf = 0;
      var wr = wrap.getBoundingClientRect(), cr = card.getBoundingClientRect();
      if (!cr.width || !wr.width) { b.style.display = 'none'; return; }
      b.style.display = '';
      // slayd burchagidan biroz chapga va tepaga (joy bo'lmasa — burchak ustiga), wrapper ichida qoladi
      var x = cr.left - wr.left + wrap.scrollLeft - 17;
      var y = cr.top - wr.top + wrap.scrollTop - 17;
      b.style.left = Math.max(4, x) + 'px';
      b.style.top = Math.max(4, y) + 'px';
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(place); }
    window.addEventListener('resize', schedule);
    wrap.addEventListener('scroll', schedule, { passive: true });
    try { new ResizeObserver(schedule).observe(wrap); } catch (e) {}
    try { new MutationObserver(schedule).observe(card, { attributes: true, attributeFilter: ['style', 'class'] }); } catch (e) {}
    setInterval(schedule, 1500);                        // zaxira: boshqa modullar o'lchamni o'zgartirsa ham
    schedule();
  }

  function init() {
    initMic(); initPlus();
    // modul yuklanguncha chizilgan xabarlarga ham 🔊 tugmasi qo'shilsin
    try { if (typeof window.refreshChatMessageActions === 'function') window.refreshChatMessageActions(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
