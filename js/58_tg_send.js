/* =====================================================================
 * 58_tg_send.js  (v75) — Mini App: tayyor fayl Telegram chatga keladi
 *
 *  Telegram ichida «PPTX / PDF / HTML» bosilganda fayl telefonga yuklanmaydi (WebView'da ko'pincha ishlamaydi),
 *  balki serverga (/api/telegram/send-file, initData bilan) yuboriladi va BOTNING O'ZI uni shu chatga tashlaydi.
 *  Foydalanuvchi botni tark etmasdan ishini tugatadi. Xato bo'lsa — oddiy yuklab olishga qaytadi.
 *  Oddiy brauzerda bu modul hech narsa qilmaydi.
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ssTgSend) return;
  window.__ssTgSend = true;

  var tg = window.Telegram && window.Telegram.WebApp;
  if (!tg || !tg.initData) return;
  window.__ssTgSendOn = true;                  // «PDF yuklab olindi» kabi toastlar Telegram'da chiqmaydi

  var SEND_EXT = { pptx: 1, pdf: 1, html: 1 };
  var MAX = 25 * 1024 * 1024;

  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'info'); } catch (e) {} }
  function haptic(kind) { try { tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(kind); } catch (e) {} }

  async function sendToChat(blob, filename) {
    var r = await fetch('/api/telegram/send-file?name=' + encodeURIComponent(filename), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Tg-Init-Data': tg.initData },
      body: blob
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  }

  function wrap(orig) {
    if (typeof orig !== 'function' || orig.__ssTg) return orig;
    var fn = function (blob, filename) {
      var name = String(filename || '');
      var ext = (name.split('.').pop() || '').toLowerCase();
      if (!SEND_EXT[ext] || !blob || blob.size > MAX) return orig.apply(this, arguments);
      var self = this, args = arguments;
      toast('📩 Fayl Telegram chatga yuborilmoqda…', 'info');
      sendToChat(blob, name).then(function () {
        haptic('success');
        toast('✅ Fayl Telegram chatga yuborildi', 'success');
      }).catch(function () {
        haptic('error');
        toast('Chatga yuborib bo‘lmadi — fayl yuklab olinmoqda.', 'error');
        try { orig.apply(self, args); } catch (e) {}
      });
    };
    fn.__ssTg = true;
    return fn;
  }

  /* 14_pptx_io.js window.downloadBlob ni e'lon qiladi; keyin kim qayta yozsa ham — o'ramiz */
  var cur = wrap(window.downloadBlob);
  try {
    Object.defineProperty(window, 'downloadBlob', {
      configurable: true,
      get: function () { return cur; },
      set: function (v) { cur = wrap(v); }
    });
  } catch (e) { window.downloadBlob = cur; }
})();
