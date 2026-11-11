/* =====================================================================
 * 38_v46_fixes.js  (v46)
 *  1) Ctrl+Z: tarix boshiga DOIM "toza" boshlang'ich holat qo'shiladi (avval, loyiha tiklangan/import qilingan bo'lsa,
 *     tarixdagi birinchi yozuv birinchi rasm qo'yilgandan KEYINGI holat bo'lib qolardi -> Ctrl+Z shu rasmda to'xtardi).
 *  2) «Rasmni tozalash» (sidebar): butun loyihani birinchi holatga qaytaradi; Ctrl+Z bilan qaytarish mumkin.
 *  3) «Bot haqida» oynasi.
 *  4) Botdan kelgan fayl: ?tgfile=TOKEN  (botdagi «✏️ Redaktorda ochish») -> fayl muharrirga ochiladi.
 *  Avto-saqlash (IndexedDB) 30_v40_present_persist.js da o'chirilgan: sahifa har doim toza boshlanadi.
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssV46Init) return;
  window.__ssV46Init = true;

  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'success'); } catch (e) {} }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function waitFor(fn, ms, step) {
    var t0 = Date.now();
    while (Date.now() - t0 < ms) { try { var v = fn(); if (v) return v; } catch (e) {} await sleep(step || 300); }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // 1) Ctrl+Z: boshlang'ich (toza) holat har doim tarixning birinchi qadami bo'ladi
  // ---------------------------------------------------------------------------------------------
  var cur = null, prev = null, curSig = '';
  function sigNow() { return slides.map(function (s) { return s.json || ''; }).join('\u0001') + '|' + slides.length; }
  function snapNow() {
    return JSON.stringify({
      slides: slides.map(function (s) { return { json: s.json, thumb: s.thumb, imageNumbers: s.imageNumbers || [] }; }),
      activeIndex: activeIndex
    });
  }
  function sample() {
    try {
      if (typeof globalHistory === 'undefined' || globalHistory.length > 0) return;   // tarix bor — baza kerak emas
      if (!slides || !slides.length || isUndoRedoAction) return;
      var sg = sigNow();
      if (sg !== curSig) { prev = cur; cur = snapNow(); curSig = sg; }
    } catch (e) {}
  }
  setInterval(sample, 250);

  var origRecord = null;
  function installRecordWrapper() {
    if (typeof window.recordGlobalState !== 'function') return setTimeout(installRecordWrapper, 200);
    if (window.recordGlobalState.__v46) return;
    origRecord = window.recordGlobalState;
    var wrapped = function () {
      try {
        if (!isUndoRedoAction && globalHistory.length === 0 && slides && slides.length) {
          var base = (sigNow() === curSig) ? prev : cur;      // o'zgarishdan OLDINGI holat
          if (base) { globalHistory.push(base); historyStep = 0; }
        }
      } catch (e) { console.warn('[v46] baza:', e); }
      return origRecord.apply(this, arguments);
    };
    wrapped.__v46 = true;
    window.recordGlobalState = wrapped;
  }
  installRecordWrapper();

  // ---------------------------------------------------------------------------------------------
  // 2) «Rasmni tozalash» — hammasi birinchi holatga
  // ---------------------------------------------------------------------------------------------
  async function confirmReset() {
    var msg = "Hamma varaq, rasm va matnlar o'chib, hammasi 0 dan boshlanadi. Ctrl+Z bilan qaytarish mumkin.";
    if (window.Swal && Swal.fire) {
      var r = await Swal.fire({ title: 'Hamma varaq tozalansinmi?', text: msg, icon: 'warning', showCancelButton: true, confirmButtonText: 'Ha, tozalash', cancelButtonText: 'Bekor qilish', confirmButtonColor: '#d93025', reverseButtons: true });
      return !!(r && r.isConfirmed);
    }
    return window.confirm('Hamma varaq tozalansinmi?\n' + msg);
  }

  /* v49: «ish bormi?» — Google'ga kirishdan oldin ogohlantirish uchun */
  function workSig() { try { return (slides || []).map(function (s) { return s.json; }).join('|').length + ':' + (slides || []).length; } catch (e) { return ''; } }
  var baseSig = null;
  setTimeout(function () { try { saveCurrentSlideState(); } catch (e) {} baseSig = workSig(); }, 3500);
  window.ssHasWork = function () {
    try { if (slides && slides.length > 1) return true; try { saveCurrentSlideState(); } catch (e) {} return baseSig !== null && workSig() !== baseSig; } catch (e) { return false; }
  };
  var resetting = false;
  window.ssResetCanvas = async function () {
    if (resetting) return;
    if (window.isAiStreaming || window.isAiApplyingCommands) { toast('AI ishlayapti — tugagach qayta urinib ko\'ring.', 'error'); return; }
    if (!(await confirmReset())) return;
    resetting = true;
    try {
      try { saveCurrentSlideState({ force: true }); } catch (e) {}
      try { recordGlobalState(); } catch (e) {}               // hozirgi holat tarixda qoladi -> Ctrl+Z qaytaradi
      try { canvas.discardActiveObject(); } catch (e) {}
      slides = [];
      activeIndex = 0;
      try { globalImageCounter = 0; } catch (e) {}
      try { _lastRenderedSlideIndex = -1; } catch (e) {}
      try {
        projectTitle = 'Yangi Slayd Taqdimoti';
        var te = document.getElementById('presentationTitle'); if (te) te.innerText = projectTitle;
      } catch (e) {}
      addSlide('title');                                       // boshlang'ich holat (tarixga yoziladi)
      try { updateAllImageBadges(); } catch (e) {}
      try { hasUnsavedChanges = false; } catch (e) {}
      setTimeout(function () { try { saveCurrentSlideState(); baseSig = workSig(); } catch (e) {} }, 600);
      toast('Tozalandi — birinchi holatga qaytdi');
    } catch (e) {
      console.warn('[v46] tozalash:', e);
      toast('Tozalab bo\'lmadi', 'error');
    } finally { resetting = false; }
  };

  // ---------------------------------------------------------------------------------------------
  // 3) «Bot haqida»
  // ---------------------------------------------------------------------------------------------
  var ABOUT_HTML =
    '<div style="text-align:left;font-size:14px;line-height:1.55;max-height:60vh;overflow:auto">' +
    '<p><b>Slide Studio AI</b> — AI yordamida professional slayd va taqdimotlar yaratadigan xizmat. Bitta loyiha ikki joyda ishlaydi: <b>sayt</b> (to\'liq muharrir) va <b>Telegram bot</b>.</p>' +
    '<p><b>Qanday ishlaydi?</b><br>• Mavzuni yozing — AI slaydlarni yozadi, rasm/GIF tanlaydi.<br>• Slaydni qo\'lda tahrirlang yoki AI\'ga yozing: <i>«3-slaydni qisqartir»</i>.<br>• PPTX, PDF yoki HTML qilib yuklab oling.<br>• Rasm, GIF, video yoki faylni sichqoncha bilan sudrab tashlang. Ctrl+Z / Ctrl+Y — bekor qilish / qaytarish. «Rasmni tozalash» — hammasini birinchi holatga qaytaradi.</p>' +
    '<p><b>Akkaunt va balans.</b> Google bilan kirasiz. Telegram botni ulasangiz (Sozlamalar → «Telegram botni ulash») sayt va bot <b>bitta balans</b>dan foydalanadi: qaysi birida to\'lov qilsangiz, ikkalasida ham ko\'payadi. 1 Telegram = 1 Google akkaunt; uzish ham mumkin.</p>' +
    '<p><b>Telegram botda:</b> mavzuni yozing — PPTX·PDF·HTML keladi; rasm yoki fayl yuborsangiz «✏️ Redaktorda ochish» tugmasi chiqadi; to\'liq muharrir esa botdagi <b>🚀 Muharrir</b> tugmasi orqali (Mini App) — sayt bilan aynan bir xil.</p>' +
    '<p><b>Narx.</b> 1 slayd = 1 varaq (Chuqur AI — 3 baravar). Har kuni bepul varaqlar beriladi.</p>' +
    '<p><b>Maxfiylik.</b> Slayd va rasmlar serverda saqlanmaydi, brauzer xotirasiga ham yozilmaydi: sahifa yangilansa yangi, toza varaqdan boshlanadi — ishingizni yuklab olib saqlang.</p>' +
    '</div>';
  window.ssShowAbout = function () {
    if (window.Swal && Swal.fire) Swal.fire({ title: 'Bot haqida', html: ABOUT_HTML, confirmButtonText: 'Yopish', width: 560 });
    else alert('Slide Studio AI — AI yordamida slayd yaratish. Sayt va Telegram bot bitta akkaunt va balansdan foydalanadi.');
  };

  // ---------------------------------------------------------------------------------------------
  // 4) Botdan kelgan fayl -> muharrirda ochish
  // ---------------------------------------------------------------------------------------------
  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg', ogg: 'video/ogg',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf', html: 'text/html', htm: 'text/html' };
  var tgw = window.Telegram && window.Telegram.WebApp;
  var inTg = !!(tgw && tgw.initData);
  function logged() { try { var t = supabaseToken; return !!t && t !== 'dev-token'; } catch (e) { return false; } }

  var qs = new URLSearchParams(location.search);
  var fileTok = qs.get('tgfile') || '';
  if (fileTok) {
    try { qs.delete('tgfile'); qs.delete('src'); history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString() : '') + location.hash); } catch (e) {}
  }

  async function runTgFile() {
    var ready = await waitFor(function () {
      return window.ssPlaceFile && window.processImportFile && typeof slides !== 'undefined' && slides && slides.length && typeof canvas !== 'undefined' && canvas;
    }, 45000);
    if (!ready) { toast('Muharrir yuklanmadi — sahifani yangilang.', 'error'); return; }
    if (inTg) await waitFor(logged, 20000);
    await sleep(700);
    toast('Fayl muharrirga ochilmoqda…', 'info');
    for (var a = 0; a < 3; a++) {
      try {
        var r = await fetch('/api/telegram/file?t=' + encodeURIComponent(fileTok));
        if (r.status === 410 || r.status === 404) { toast('Havola eskirgan (fayl 15 daqiqa saqlanadi). Faylni botga qayta yuboring.', 'error'); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var name = 'fayl';
        try { name = decodeURIComponent(r.headers.get('X-File-Name') || 'fayl'); } catch (e) {}
        var ext = (name.split('.').pop() || '').toLowerCase();
        var blob = await r.blob();
        var f = new File([blob], name, { type: MIME[ext] || blob.type || '' });
        if (ext === 'pptx' && window.importPptxClient) await window.importPptxClient(f);
        else if (/^(pdf|html?)$/.test(ext)) await window.processImportFile(f);
        else await window.ssPlaceFile(f, { left: 220, top: 120 });
        return;
      } catch (e) { await sleep(2500 * (a + 1)); }                 // Render uyg'onguncha qayta urinadi
    }
    toast('Faylni ochib bo\'lmadi. Keyinroq urinib ko\'ring.', 'error');
  }
  if (fileTok) runTgFile();
})();
