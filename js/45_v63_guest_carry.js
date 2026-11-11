/* =====================================================================
 * 45_v63_guest_carry.js (v63) — mehmon slaydlari Google bilan kirishda YO'QOLMAYDI
 *
 *  1) «Google bilan kirish» bosilganda (to'liq sahifa redirect'dan oldin) hozirgi slaydlar vaqtincha saqlanadi.
 *     Brauzer xotirasi qulfi (index.html) faqat 'ss-auth-v39*' kalitlarini qo'yadi — shuning uchun kalit shu prefiks bilan.
 *  2) Sahifa qaytib ochilgach (kirish muvaffaqiyatli bo'lsa ham, bekor qilinsa ham) muharrir tayyor bo'lishi bilan:
 *     o'qiladi → DARHOL o'chiriladi (xotirada axlat qolmaydi) → slaydlar muharrirga qaytariladi.
 *     Muddati o'tgan (30 daqiqa), buzilgan yoki boshqa ish ochilgan bo'lsa (bot slaydi, loyiha fayli) — tegilmaydi, faqat o'chiriladi.
 *  3) Chiqishda (Logout) vaqtincha nusxa ham, kanvas ham tozalanadi — keyingi odamga hech narsa qolmaydi.
 *  Slaydlar serverga yozilmaydi: loyiha avvalgidek faqat shu brauzer oynasida (RAM) yashaydi.
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssGuestCarry) return;
  window.__ssGuestCarry = true;

  var KEY = 'ss-auth-v39-guest';
  var MAX_AGE = 30 * 60 * 1000;
  var MAX_CHARS = 4500000;          // localStorage ~5 MB chegarasi (UTF-16) — undan katta bo'lsa saqlanmaydi
  function store() { return window.__ssAuthStorage || null; }
  function toast(m, k) { try { showToast(m, k); } catch (e) {} }

  /** Redirect'dan oldin. true — saqlandi (yoki saqlanadigan ish yo'q), false — sig'madi. */
  window.ssStashGuestDeck = function () {
    var st = store();
    if (!st) return false;
    try { saveCurrentSlideState({ force: true }); } catch (e) {}
    try {
      if (!Array.isArray(slides) || !slides.length) return true;
      var data = {
        v: 1, at: Date.now(),
        title: (typeof projectTitle === 'string') ? projectTitle : '',
        activeIndex: Math.max(0, Math.min(activeIndex || 0, slides.length - 1)),
        slides: slides.map(function (s) {
          return { json: s.json || '{}', imageNumbers: (s.imageNumbers || []).slice(), transition: s.transition || '',
                   transDur: s.transDur || 0, transAuto: s.transAuto || 0, bgType: s.bgType, bgVal: s.bgVal };
        }),
      };
      var str = JSON.stringify(data);
      if (str.length > MAX_CHARS) return false;
      st.setItem(KEY, str);
      return st.getItem(KEY) === str;           // haqiqatan yozildimi (kvota / maxfiy rejim)
    } catch (e) {
      try { st.removeItem(KEY); } catch (e2) {}
      return false;
    }
  };

  window.ssDropGuestDeck = function () { try { var st = store(); if (st) st.removeItem(KEY); } catch (e) {} };

  function editorReady() {
    try { return typeof canvas !== 'undefined' && canvas && Array.isArray(slides) && slides.length > 0 && typeof loadSlideCanvas === 'function'; }
    catch (e) { return false; }
  }
  function editorIsBlank() {
    try {
      if (slides.length > 1) return false;
      var p = JSON.parse(slides[0].json || '{}');
      var objs = (p.objects || []).filter(function (o) { return o && !(o.type === 'textbox' && /^(Sarlavha Kiriting|)$/.test(String(o.text || '').trim())); });
      return !objs.length && !p.backgroundImage && !p.backgroundGif;
    } catch (e) { return false; }
  }

  var restored = false;
  async function restore() {
    if (restored) return;
    var st = store();
    if (!st) return;
    var raw = null;
    try { raw = st.getItem(KEY); } catch (e) {}
    if (!raw) { restored = true; return; }
    if (!editorReady()) return;                     // keyingi tekshiruvda
    restored = true;
    try { st.removeItem(KEY); } catch (e) {}        // o'qildi — DARHOL o'chiriladi
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || data.v !== 1 || !Array.isArray(data.slides) || !data.slides.length) return;
    if (Date.now() - (data.at || 0) > MAX_AGE) return;
    if (!editorIsBlank()) return;                   // boshqa ish ochilgan (bot slaydi, fayl) — ustidan yozmaymiz
    try {
      slides = data.slides.map(function (s) {
        var o = { json: s.json || '{}', thumb: '', imageNumbers: s.imageNumbers || [] };
        if (s.transition) o.transition = s.transition;
        if (s.transDur) o.transDur = s.transDur;
        if (s.transAuto) o.transAuto = s.transAuto;
        if (s.bgType) { o.bgType = s.bgType; o.bgVal = s.bgVal; }
        return o;
      });
      activeIndex = Math.max(0, Math.min(data.activeIndex || 0, slides.length - 1));
      try { if (data.title && typeof projectTitle !== 'undefined') { projectTitle = data.title; var te = document.getElementById('presentationTitle'); if (te) te.innerText = data.title; } } catch (e) {}
      try { recalculateGlobalImageCounter(); } catch (e) {}
      try { _lastRenderedSlideIndex = -1; } catch (e) {}
      await new Promise(function (res) { loadSlideCanvas(activeIndex, res); });
      try { renderSidebar(); } catch (e) {}
      try { updateSlideCounterUI(); } catch (e) {}
      for (var i = 0; i < slides.length; i++) { try { await refreshSlideThumb(i); } catch (e) {} }
      try { renderSidebar(); } catch (e) {}
      try { recordGlobalState(); } catch (e) {}
      try { hasUnsavedChanges = true; } catch (e) {}
      toast('Mehmon sifatida yaratgan ' + slides.length + ' ta slaydingiz saqlab qolindi ✅');
    } catch (e) { console.warn('[v63] mehmon slaydlari tiklanmadi:', e); }
  }
  window.ssRestoreGuestDeck = restore;

  // Muharrir tayyor bo'lishini kutib, 60 soniya davomida tekshiramiz (redirect'dan qaytish sekin bo'lishi mumkin)
  var t0 = Date.now();
  (function loop() {
    if (restored || Date.now() - t0 > 60000) return;
    restore().then(function () { if (!restored) setTimeout(loop, 500); }, function () { setTimeout(loop, 500); });
  })();
})();
