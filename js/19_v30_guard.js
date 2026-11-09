/* v30 — Slayd soni qo'riqchisi (SlideGuard)
 * Muammo: "4 ta varaq yasa" desangiz AI 2 ta yasardi, "faqat 2 ta bor" desangiz 1 ta qo'shardi.
 * Yechim:
 *  1) So'rovdan aniq son ajratiladi (4 ta / to'rtta / 4 slides ...) va AI ga qat'iy hisob beriladi.
 *  2) AI tugagach slaydlar soni va bo'shlari tekshiriladi; yetishmasa 2 martagacha avtomatik to'ldiriladi.
 */
(function () {
  'use strict';
  var WORDS = { bir: 1, bitta: 1, ikki: 2, ikkita: 2, uch: 3, uchta: 3, "to'rt": 4, "to'rtta": 4, besh: 5, beshta: 5,
    olti: 6, oltita: 6, yetti: 7, yettita: 7, sakkiz: 8, sakkizta: 8, "to'qqiz": 9, "to'qqizta": 9, "o'n": 10, "o'nta": 10, on: 10, onta: 10 };

  function norm(t) { return String(t || '').toLowerCase().replace(/[’‘`ʻʼ´]/g, "'"); }

  function parseCount(text) {
    var t = norm(text);
    var re = /(\d{1,2}|bitta|ikkita|uchta|to'rtta|beshta|oltita|yettita|sakkizta|to'qqizta|o'nta|onta|bir|ikki|uch|to'rt|besh|olti|yetti|sakkiz|to'qqiz|o'n|on)\s*(?:-?\s*ta|dona)?\s*(?:ta\s+)?(?:yangi\s+|boshqa\s+|qo'shimcha\s+)?(?:varaq|varoq|varaqa|slayd|slaid|slide|slides|sahifa|page|pages|bet)/i;
    var m = t.match(re);
    if (!m) return 0;
    var v = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : (WORDS[m[1]] || 0);
    return (v >= 1 && v <= 50) ? v : 0;
  }
  function isAddIntent(text) { return /qo'sh|qosh|\badd\b|yana|ko'paytir|more|insert|oxiriga|keyingi/.test(norm(text)); }
  function isComplaint(text) { return /faqat|only|\bkam\b|yetm|yetarli emas|qani|ta bor|hali|to'liq emas|tugallan|bajarma|qolgan|qo'shmading|qoshmading|yana/.test(norm(text)); }

  function slideIsEmpty(s) {
    try {
      var p = JSON.parse(s.json || '{}'); var o = p.objects || [];
      if (!o.length) return true;
      return o.every(function (x) { return !x || ((x.type === 'textbox' || x.type === 'text' || x.type === 'i-text') && !String(x.text || '').trim()); });
    } catch (e) { return false; }
  }
  function isBlankDeck() {
    try { return !slides || slides.length === 0 || (slides.length === 1 && slideIsEmpty(slides[0])); } catch (e) { return false; }
  }
  function emptyIndexes() {
    var r = [];
    try { slides.forEach(function (s, i) { if (slideIsEmpty(s)) r.push(i + 1); }); } catch (e) {}
    return r;
  }

  var guard = null;

  /** v31: haqiqiy balans (faqat tizimdan). Kirmagan foydalanuvchi uchun null. */
  function balanceLeft() {
    try {
      var tok = (typeof supabaseToken !== 'undefined') ? supabaseToken : null;
      if (!tok || tok === 'dev-token') return null;
      if (window.Monitoring && Monitoring.totalCredits) return Monitoring.totalCredits();
    } catch (e) {}
    return null;
  }
  function balanceHint(asked, n, left) {
    if (left === null) return '';
    if (n <= 0) return "BALANS 0: hech qanday action yozma. PART A da qisqa ayt: \"Balansingizda 0 ta varaq qoldi, shuning uchun yangi slayd yarata olmayman.\"";
    if (asked > n) return "BALANS CHEKLOVI (MAJBURIY): foydalanuvchi " + asked + " ta so'radi, lekin balansda faqat " + left + " varaq bor. FAQAT " + n + " ta slayd yarat. PART A ni aynan shunday boshla: \"Balansingizda " + left + " ta varaq qoldi, shuning uchun " + n + " ta slayd yaratdim.\" — keyin qolganini keyinroq davom ettirishni taklif qil. Actionlarni uzib qo'yma: " + n + " ta slaydni TO'LIQ yakunla.";
    return '';
  }

  function buildHint() {
    var cur = slides.length, miss = Math.max(0, guard.target - cur), empt = emptyIndexes();
    var h = "SLAYD SONI QOIDASI (MAJBURIY): Foydalanuvchi JAMI " + guard.target + " ta slayd xohlaydi. Hozir deckda " + cur + " ta slayd bor.";
    if (miss > 0) {
      h += " Yetishmayotgan " + miss + " ta slaydni ALBATTA yarat: " + miss + " ta ALOHIDA insert_slide, har birida after = " +
        Array.apply(null, Array(Math.min(miss, 12))).map(function (_, i) { return cur + i; }).join(', ') +
        (miss > 12 ? ', ...' : '') + ", HAR BIRI o'z noyob kontenti (sarlavha + kartalar) va deck bilan bir xil fon/palitra bilan.";
    }
    if (empt.length) h += " Bo'sh slaydlar: " + empt.join(', ') + " — ularni replace_slide bilan TO'LDIR (bo'sh qoldirma).";
    if (guard.limited) h += ' ' + balanceHint(guard.asked, guard.n, guard.left);
    h += " Javob oxirida deck aynan " + guard.target + " ta bo'lishi shart. \"Qo'shdim\" deb faqat actionlar JSON da bor bo'lsa ayt.";
    return h;
  }

  window.SlideGuard = {
    parseCount: parseCount,
    beforeSend: function (prompt, isCont) {
      try {
        if (isCont) return guard ? buildHint() : '';
        var n = parseCount(prompt);
        if (n) {
          var before = slides.length;
          var asked = n, left = balanceLeft();
          if (left !== null && n > left) n = Math.max(0, left);
          if (n === 0) { guard = null; return balanceHint(asked, 0, left); }
          var target = (isAddIntent(prompt) || !isBlankDeck()) ? before + n : n;
          guard = { target: target, before: before, tries: 0, asked: asked, n: n, left: left, limited: asked > n };
          return buildHint();
        }
        if (guard && slides.length < guard.target && isComplaint(prompt)) { guard.tries = 0; return buildHint(); }
        guard = null;
      } catch (e) { console.warn('SlideGuard.beforeSend:', e); }
      return '';
    },
    afterFinish: function () {
      try {
        // v36: AI javobi tugagach o'zi qayta prompt yubormaydi va slaydni qayta yasamaydi.
        if (guard) {
          var _cur = slides.length, _t = guard.target;
          guard = null;
          if (_cur < _t && !window._userStoppedAi) { try { showToast(_cur + ' ta slayd yaratildi (so\'ralgan: ' + _t + '). Davom ettirish uchun AI ga yozing.', 'info'); } catch (e) {} }
          return;
        }
        if (!guard) return;
        if (window._userStoppedAi || isAiStreaming) { guard = null; return; }
        var cur = slides.length, empt = emptyIndexes();
        if (cur >= guard.target && !empt.length) { guard = null; return; }
        if (cur >= guard.target && empt.length && guard.tries >= 1) { guard = null; return; }
        if (guard.tries >= 2) {
          // Yakuniy kafolat: AI ikki marta ham yetkazmasa, qolgan slaydlarni o'zimiz yaratamiz (son aniq chiqadi)
          var need = Math.max(0, guard.target - cur);
          guard = null;
          if (need > 0) {
            try {
              Promise.resolve(executeAiCommands({ actions: [{ action: 'create_slides', count: need }] })).then(function () {
                try { showToast('Slaydlar soni ' + slides.length + ' taga yetkazildi. Bo\'sh slaydlarni to\'ldirishni AI dan so\'rang.'); } catch (e) {}
              });
            } catch (e) { console.warn('SlideGuard fallback:', e); }
          }
          return;
        }
        guard.tries++;
        var miss = Math.max(0, guard.target - cur);
        var h = collectChatHistory(10).slice();
        while (h.length && h[h.length - 1].role === 'user') h.pop();
        var orig = 'jami ' + guard.target + ' ta slayd';
        h.push({ role: 'user', text: orig });
        h.push({ role: 'model', text: 'Qisman bajarildi.' });
        _continueOverride = {
          entry: null, origPrompt: orig, prevPartial: '', history: h,
          prompt: "[AVTOMATIK TEKSHIRUV] Deckda " + cur + " ta slayd bor, kerak: " + guard.target + " ta" +
            (miss ? " (yetishmaydi: " + miss + " ta)." : ".") + (empt.length ? " Bo'sh slaydlar: " + empt.join(', ') + "." : '') +
            " Faqat yetishmayotganini bajar.",
          hint: buildHint() + " Mavjud slaydlarni QAYTA yaratma, reset_deck ISHLATMA."
        };
        window._autoContinuing = true;
        try { showToast('Slaydlar yetishmadi (' + cur + '/' + guard.target + ') — avtomatik to\'ldirilmoqda...'); } catch (e) {}
        setTimeout(function () { try { sendSidebarAiPrompt(); } catch (e) { console.warn(e); } }, 400);
      } catch (e) { console.warn('SlideGuard.afterFinish:', e); }
    }
  };
})();
