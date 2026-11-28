/* =====================================================================
 * 59_smalltalk.js  (v83) — salom / rahmat / xayr / «nima qila olasan?» AI TOKENISIZ, darhol (~0.05 ms).
 * Words and replies: js/data/smalltalk.json — the SAME file the Telegram bot uses (backend/services/smalltalk.py).
 * classify() here must stay in step with the Python one.
 *  - Only a message made ONLY of such phrases is answered here. Any topic word («haqida», «slayd», «презентация»,
 *    «about»...) or any other word -> it goes to the AI as before («Salom, kosmos haqida slayd» -> AI).
 *  - Repeated greetings (5 min): 1st — greeting, 2nd — a lively answer, 3rd+ — a joke + «write a topic».
 *    The text changes every time; nothing is deleted. Works for guests too (no sign-in needed to say hello).
 * ===================================================================== */
(function () {
  'use strict';
  if (window.SSSmallTalk) return;
  var D = null, loading = null;
  var WAVE = /[👋🙋🤝✋🖐]/u;

  function norm(t) {
    t = String(t || '').toLowerCase().replace(/[ʻ’‘`]/g, "'").replace(/ё/g, 'е');
    t = t.replace(/[^\p{L}\p{N}_\s']+/gu, ' ');
    t = t.replace(/(\p{L}|\p{N})\1+/gu, '$1');
    return t.replace(/_/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  }
  function load() {
    if (D) return Promise.resolve(D);
    if (loading) return loading;
    loading = fetch('js/data/smalltalk.json?v=1').then(function (r) { return r.json(); }).then(function (raw) {
      var phrases = {}, single = {}, maxLen = 1;
      Object.keys(raw.intents).forEach(function (intent) {
        Object.keys(raw.intents[intent]).forEach(function (lang) {
          raw.intents[intent][lang].forEach(function (p) {
            var k = norm(p);
            if (!k || phrases[k]) return;
            phrases[k] = [intent, lang];
            maxLen = Math.max(maxLen, k.split(' ').length);
            if (k.indexOf(' ') < 0 && intent !== 'about' && k.length >= 4) single[k] = [intent, lang];
          });
        });
      });
      D = { phrases: phrases, single: single, maxLen: maxLen, replies: raw.replies,
            filler: new Set(raw.filler.map(norm)), topic: raw.topic_stems.map(norm), block: new Set(raw.fuzzy_block.map(norm)) };
      return D;
    }).catch(function (e) { loading = null; console.warn('[smalltalk]', e); return null; });
    return loading;
  }
  function lev(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i], mn = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < mn) mn = cur[j];
      }
      if (mn > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  function fuzzy(w) {
    if (w.length < 4 || D.block.has(w) || !/^\p{L}+$/u.test(w)) return null;
    var cap = w.length <= 6 ? 1 : 2, best = null;
    Object.keys(D.single).forEach(function (k) {
      if (w.length <= 6 && k[0] !== w[0]) return;
      var d = lev(w, k, cap);
      if (d <= cap && (!best || d < best[0])) best = [d, D.single[k]];
    });
    return best ? best[1] : null;
  }
  function isTopic(words) {
    return words.some(function (w) {
      return D.topic.some(function (st) { return (st.length >= 4 && w.indexOf(st) === 0) || w === st; });
    });
  }
  /** -> {intent, lang} | null   (needs load() first; returns null until the data is there) */
  function classify(text) {
    var raw = String(text || '').trim();
    if (!raw || raw.length > 120 || !D) return null;
    var t = norm(raw);
    if (!t) return WAVE.test(raw) ? { intent: 'greet', lang: '' } : null;
    var words = t.split(' ');
    if (words.length > 9 || isTopic(words)) return null;
    var first = null, i = 0;
    while (i < words.length) {
      var hit = null;
      for (var n = Math.min(D.maxLen, words.length - i); n >= 1; n--) {
        var k = words.slice(i, i + n).join(' ');
        if (D.phrases[k]) { hit = [n, D.phrases[k]]; break; }
      }
      if (!hit && D.filler.has(words[i])) { i++; continue; }
      if (!hit) { var fz = fuzzy(words[i]); if (!fz) return null; hit = [1, fz]; }
      if (!first || (first[0] === 'greet' && hit[1][0] === 'about')) first = hit[1];
      i += hit[0];
    }
    return first ? { intent: first[0], lang: first[1] } : null;
  }

  var greets = [], last = '';
  function uiLang() { try { return (window.SSI18n && SSI18n.lang) || 'uz'; } catch (e) { return 'uz'; } }
  function userName() { return ''; }          // the site knows only the email — no name in the greeting
  function pick(key, lang) {
    var o = D.replies[key] || {}, items = o[lang] || o.uz || [''];
    var pool = items.filter(function (x) { return x !== last; });
    if (!pool.length) pool = items;
    var name = userName();
    var r = pool[Math.floor(Math.random() * pool.length)].replace('{name}', name ? ', ' + name : '');
    last = r;
    return r;
  }
  /** -> reply text, or '' when the message should go to the AI */
  function answer(text) {
    var c = classify(text);
    if (!c) { greets = []; return ''; }
    var lang = c.lang || uiLang(), key = c.intent;
    if (key === 'greet') {
      var now = Date.now();
      greets = greets.filter(function (t) { return now - t < 300000; });
      greets.push(now);
      key = greets.length <= 1 ? 'greet1' : (greets.length === 2 ? 'greet2' : 'greet3');
    } else greets = [];
    return pick(key, lang);
  }

  // the two AI fields: right sidebar chat and the bottom field. A small-talk message is answered here (no AI call,
  // no balance spent, no sign-in needed); anything else goes on to the AI exactly as before.
  function busy() { try { return !!isAiStreaming; } catch (e) { return false; } }
  function hasImages() {
    try { return (uploadedImagesStore || []).some(function (i) { return i.type === 'ai'; }) || (pendingImagesStore || []).length > 0; } catch (e) { return false; }
  }
  function local(inputId, clear) {
    var cont = false;
    try { cont = (typeof _continueOverride !== 'undefined') && !!_continueOverride; } catch (e) {}
    if (!D || busy() || hasImages() || cont) return false;
    var el = document.getElementById(inputId);
    var text = el ? String(el.value || '').trim() : '';
    if (!text) return false;
    var r = answer(text);
    if (!r) return false;
    if (clear) clear(el);
    try {
      appendAiChatMessage('user', text);
      appendAiChatMessage('bot', r);
      saveMessageToLocal('user', text);
      saveMessageToLocal('model', r);
    } catch (e) { console.warn('[smalltalk]', e); }
    try { if (window.ssPref) ssPref.del('draft'); } catch (e) {}
    try { if (typeof toggleAISidebar === 'function' && inputId !== 'aiSidebarInput') toggleAISidebar(true); } catch (e) {}
    return true;
  }
  function wrap(name, inputId, clear) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__ssTalk) return;
    var w = async function () {
      if (local(inputId, clear)) return;
      return orig.apply(this, arguments);
    };
    w.__ssTalk = true;
    window[name] = w;
  }
  function install() {
    wrap('sendSidebarAiPrompt', 'aiSidebarInput', function (el) { el.value = ''; try { autoGrowSidebarInput(el); } catch (e) {} });
    wrap('sendBottomAiPrompt', 'bottomAiTextarea', function (el) { el.value = ''; });
  }
  window.SSSmallTalk = { load: load, classify: classify, answer: answer, norm: norm };
  load();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  setTimeout(install, 1500);
})();
