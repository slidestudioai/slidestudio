/* js/i18n.js — Slide Studio ko'p tillilik (uz / ru / en)
 *
 * Qanday ishlaydi
 *   • Lug'at: js/translations.js (window.SS_I18N). Kalit = o'zbekcha matn.
 *   • Sahifadagi matn tugunlari, title / placeholder / aria-label atributlari lug'at bo'yicha almashtiriladi.
 *     MutationObserver keyin JS qo'shgan tugma, toast, oyna (SweetAlert) matnlarini ham avtomatik tarjima qiladi —
 *     shuning uchun eski modullarni bittalab o'zgartirish shart emas.
 *   • Tarjima QILINMAYDI: AI/foydalanuvchi xabarlari (.msg-text), slayd (canvas) va miniatyuralar, input/textarea
 *     qiymatlari, contenteditable, [data-no-i18n].
 *   • Til tanlash tartibi: URL ?lang= (Telegram botdan) → localStorage (foydalanuvchi tanlagan) → ASOSIY til: en.
 *
 * API: SSI18n.lang · SSI18n.set(lang) · SSI18n.t(uzText) · hodisa: document 'ss:lang' {detail:{lang}}
 */
(function () {
  'use strict';
  if (window.SSI18n) return;

  var D = window.SS_I18N || { text: {}, patterns: [], names: { uz: 'O‘zbekcha', ru: 'Русский', en: 'English' }, short: { uz: 'UZ', ru: 'RU', en: 'EN' } };
  var LANGS = ['uz', 'ru', 'en'];
  var DEFAULT_LANG = 'en';                                          // asosiy (birinchi ochilishdagi) til
  var IDX = { ru: 0, en: 1 };

  /* ---------------- lug'at (apostroflar bir xillashtiriladi) ---------------- */
  function norm(s) { return String(s).replace(/[‘’ʻʼ`´]/g, "'").replace(/\s+/g, ' ').trim(); }
  var DICT = Object.create(null);
  Object.keys(D.text || {}).forEach(function (k) { DICT[norm(k)] = D.text[k]; });
  var PATS = (D.patterns || []).map(function (p) { try { return [new RegExp(p[0]), p[1], p[2]]; } catch (e) { return null; } }).filter(Boolean);

  /* ---------------- joriy til ---------------- */
  function fromCode(c) {
    c = String(c || '').toLowerCase();
    if (/^(uz)/.test(c)) return 'uz';
    if (/^(ru|be|uk|kk|ky|tg)/.test(c)) return 'ru';
    if (/^en/.test(c)) return 'en';
    return null;
  }
  function lsGet() { try { return localStorage.getItem('ss-lang'); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem('ss-lang', v); } catch (e) {} }
  function detect() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    if (LANGS.indexOf(q) >= 0) { lsSet(q); return q; }              // botda tanlangan til Mini App'ga shu yo'l bilan keladi
    var s = lsGet(); if (LANGS.indexOf(s) >= 0) return s;
    return DEFAULT_LANG;                                            // v66: birinchi ochilishda — ingliz tili
  }
  var lang = detect();

  /* ---------------- tarjima ---------------- */
  function lookup(text, ctx) {
    if (lang === 'uz' || !text) return null;
    var k = norm(text);
    if (!k) return null;
    var hit = (ctx && DICT[ctx + '|' + k]) || DICT[k];
    if (hit) return hit[IDX[lang]] || null;
    for (var i = 0; i < PATS.length; i++) {
      if (PATS[i][0].test(k)) return k.replace(PATS[i][0], lang === 'ru' ? PATS[i][1] : PATS[i][2]);
    }
    return null;
  }
  function t(text, ctx) { return lookup(text, ctx) || text; }

  var SKIP_SEL = '.msg-text, [data-no-i18n], #mainCanvas, .canvas-card, .slide-thumb, .slide-item canvas, textarea, input, select option[value=""], [contenteditable="true"], script, style, noscript, code, pre';
  function skipped(el) {
    try { return !el || (el.closest && el.closest(SKIP_SEL)); } catch (e) { return false; }
  }
  function ctxOf(el) { try { var c = el.closest && el.closest('[data-i18n-ctx]'); return c ? c.getAttribute('data-i18n-ctx') : ''; } catch (e) { return ''; } }

  // asl (o'zbekcha) matnni eslab qolamiz — tilni qaytarsa yoki almashtirsa shundan tarjima qilinadi
  var ORIG = new WeakMap();      // Text node -> {src, out}
  var AORIG = new WeakMap();     // Element -> {attr: {src, out}}
  var ATTRS = ['title', 'placeholder', 'aria-label'];
  var writing = false;

  function doText(node) {
    var parent = node.parentNode;
    if (!parent || parent.nodeType !== 1 || skipped(parent)) return;
    var cur = node.nodeValue;
    var rec = ORIG.get(node);
    var src = rec && cur === rec.out ? rec.src : cur;            // tarjimani o'zimiz yozganmiz — asl matndan
    if (!src || !/[A-Za-zЀ-ӿ]/.test(src)) return;
    var tr = lookup(src, ctxOf(parent));
    var out;
    if (tr == null) { out = src; }
    else {
      var lead = src.match(/^\s*/)[0], tail = src.match(/\s*$/)[0];
      out = lead + tr + tail;
    }
    if (out !== cur) { writing = true; node.nodeValue = out; writing = false; }
    if (tr != null || rec) ORIG.set(node, { src: src, out: out });
  }
  function doAttrs(el) {
    if (skipped(el) && !(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
    var recs = AORIG.get(el) || {};
    var touched = false;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a), r = recs[a];
      var src = r && cur === r.out ? r.src : cur;
      var tr = lookup(src, ctxOf(el));
      var out = tr == null ? src : tr;
      if (out !== cur) { writing = true; el.setAttribute(a, out); writing = false; }
      if (tr != null || r) { recs[a] = { src: src, out: out }; touched = true; }
    }
    if (touched) AORIG.set(el, recs);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skipped(root) && root.tagName !== 'TEXTAREA' && root.tagName !== 'INPUT') return; doAttrs(root); }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) {
          var tg = n.tagName;
          if (tg === 'SCRIPT' || tg === 'STYLE' || tg === 'CANVAS') return NodeFilter.FILTER_REJECT;
          if (n.matches && n.matches('.msg-text, [data-no-i18n], [contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }

  /* ---------------- kuzatuvchi: keyin qo'shilgan matnlar ---------------- */
  var mo = null, queue = [], scheduled = false;
  function flush() {
    scheduled = false;
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) { try { walk(q[i]); } catch (e) {} }
  }
  function startObserver() {
    if (mo || !document.body) return;
    mo = new MutationObserver(function (list) {
      if (writing || lang === 'uz') return;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'characterData') queue.push(m.target);
        else if (m.type === 'attributes') queue.push(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) queue.push(m.addedNodes[j]);
      }
      if (queue.length && !scheduled) { scheduled = true; (window.queueMicrotask || setTimeout)(flush); }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  /* ---------------- til almashtirgich ---------------- */
  function ensureSwitcher() {
    if (document.getElementById('ssLangBtn')) return;
    var host = document.querySelector('.header-actions');
    if (!host) return;
    var st = document.createElement('style');
    st.textContent =
      '#ssLangWrap{position:relative;display:inline-flex}' +
      '#ssLangBtn{height:34px;min-width:44px;padding:0 10px;border-radius:17px;border:1px solid #dadce0;background:#fff;color:#1f2937;' +
      ' font:600 12.5px/1 system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:4px}' +
      '#ssLangBtn:hover{background:#f1f3f4}' +
      '#ssLangMenu{position:absolute;top:calc(100% + 6px);right:0;z-index:100001;min-width:150px;background:#fff;border:1px solid #e5e7eb;' +
      ' border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.14);padding:6px;display:none}' +
      '#ssLangMenu.open{display:block}' +
      '#ssLangMenu button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border:0;' +
      ' background:none;border-radius:8px;cursor:pointer;font:500 14px/1.2 system-ui,sans-serif;color:#1f2937;text-align:left}' +
      '#ssLangMenu button:hover{background:#f3f4f6}#ssLangMenu button[aria-checked="true"]{color:#1d4ed8;font-weight:700}' +
      '#ssLangMenu small{color:#9ca3af;font-weight:600}' +
      '@media (max-width:600px){#ssLangBtn{height:30px;min-width:38px;padding:0 8px;font-size:11.5px}}';
    document.head.appendChild(st);
    var wrap = document.createElement('div'); wrap.id = 'ssLangWrap'; wrap.setAttribute('data-no-i18n', '');
    var btn = document.createElement('button'); btn.type = 'button'; btn.id = 'ssLangBtn';
    btn.setAttribute('aria-haspopup', 'menu'); btn.title = 'Til / Язык / Language';
    var menu = document.createElement('div'); menu.id = 'ssLangMenu'; menu.setAttribute('role', 'menu');
    LANGS.forEach(function (l) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.dataset.lang = l;
      b.innerHTML = '<span>' + D.names[l] + '</span><small>' + D.short[l] + '</small>';
      b.addEventListener('click', function () { menu.classList.remove('open'); set(l); });
      menu.appendChild(b);
    });
    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', function () { menu.classList.remove('open'); });
    wrap.appendChild(btn); wrap.appendChild(menu);
    host.insertBefore(wrap, host.firstChild);
    paintSwitcher();
  }
  function paintSwitcher() {
    var b = document.getElementById('ssLangBtn'); if (!b) return;
    b.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">translate</span>' + D.short[lang];
    document.querySelectorAll('#ssLangMenu [data-lang]').forEach(function (x) { x.setAttribute('aria-checked', x.dataset.lang === lang ? 'true' : 'false'); });
  }

  /* ---------------- slayd/loyiha namuna matnlari (canvas ichida) ---------------- */
  var PH = D.placeholders || {};
  function ph(key, l) { var p = PH[key]; return p ? (p[l || lang] || p.uz) : ''; }
  function phKeyOf(text) {                                        // matn qaysi namuna (istalgan tilda)?
    var t = norm(text || '');
    for (var k in PH) for (var i = 0; i < LANGS.length; i++) if (norm(PH[k][LANGS[i]]) === t) return k;
    return null;
  }
  /** Foydalanuvchi o'zgartirmagan namuna matnlarni joriy tilga o'tkazadi (til almashganda / birinchi ochilishda). */
  function relabelPlaceholders() {
    try {
      var c = (typeof canvas !== 'undefined') ? canvas : null;
      var changed = false;
      if (c && c.getObjects) {
        c.getObjects().forEach(function (o) {
          if (!o || !/text/i.test(o.type || '') || o.isEditing) return;
          var k = phKeyOf(o.text);
          if (k && o.text !== ph(k)) { o.set('text', ph(k)); changed = true; }
        });
        if (changed) { c.requestRenderAll && c.requestRenderAll(); try { if (typeof saveCurrentSlideState === 'function') saveCurrentSlideState(); } catch (e) {} }
      }
      var tEl = document.getElementById('presentationTitle');
      if (tEl && document.activeElement !== tEl && phKeyOf(tEl.textContent) === 'project') {
        tEl.textContent = ph('project');
        try { if (typeof projectTitle !== 'undefined') projectTitle = ph('project'); } catch (e) {}
      }
    } catch (e) {}
  }

  function set(l) {
    if (LANGS.indexOf(l) < 0 || l === lang) return;
    lang = l;
    lsSet(l);
    document.documentElement.lang = l;
    walk(document.body);                 // uz ga qaytsa ham — asl matnlar tiklanadi
    relabelPlaceholders();
    paintSwitcher();
    try { document.dispatchEvent(new CustomEvent('ss:lang', { detail: { lang: l } })); } catch (e) {}
  }

  /* ---------------- brauzer tarjimoni (Google Translate) uchun ikonka himoyasi ----------------
   * Ikonkalar — shrift ligaturalari: "add", "image", "mic" kabi SO'ZLAR belgiga aylanadi. Tarjimon bu so'zlarni ham
   * o'girib, tugmalarni buzardi. Faqat ikonkalarga translate="no" qo'yiladi — qolgan matnlarni tarjimon bemalol o'giradi. */
  var ICON_SEL = '.material-symbols-outlined, .material-icons, .material-symbols-rounded';
  function protectIcons(root) {
    try {
      if (!root || root.nodeType !== 1) return;
      if (root.matches && root.matches(ICON_SEL)) { root.setAttribute('translate', 'no'); root.classList.add('notranslate'); }
      var list = root.querySelectorAll ? root.querySelectorAll(ICON_SEL) : [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].getAttribute('translate') !== 'no') { list[i].setAttribute('translate', 'no'); list[i].classList.add('notranslate'); }
      }
    } catch (e) {}
  }
  function startIconGuard() {
    protectIcons(document.body);
    try {
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var a = list[i].addedNodes;
          for (var j = 0; j < a.length; j++) if (a[j].nodeType === 1) protectIcons(a[j]);
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  function init() {
    startIconGuard();
    document.documentElement.lang = lang;
    ensureSwitcher();
    if (lang !== 'uz') walk(document.body);
    startObserver();
    // birinchi slayd canvas tayyor bo'lgach namuna matnlar ham shu tilda bo'lsin
    var tries = 0, iv2 = setInterval(function () {
      tries++;
      var ready = false;
      try { ready = typeof canvas !== 'undefined' && canvas && canvas.getObjects && typeof slides !== 'undefined' && slides.length > 0; } catch (e) {}
      if (ready || tries > 60) { clearInterval(iv2); if (ready) relabelPlaceholders(); }
    }, 250);
    // header kech chizilsa ham almashtirgich paydo bo'lsin
    if (!document.getElementById('ssLangBtn')) { var n = 0, iv = setInterval(function () { ensureSwitcher(); if (document.getElementById('ssLangBtn') || ++n > 40) clearInterval(iv); }, 250); }
  }

  window.SSI18n = {
    get lang() { return lang; },
    set: set,
    t: t,
    ph: ph,                                  // SSI18n.ph('titleMain') → joriy tildagi namuna matn
    phKeyOf: phKeyOf,
    isPlaceholder: function (text) { return !!phKeyOf(text); },
    speechLang: function () { return lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : 'uz-UZ'; },
    apply: walk
  };
  window.ssPh = function (key, fallback) { return ph(key) || fallback || ''; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
