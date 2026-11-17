/* =====================================================================
 * 54_back_nav.js — phone «Orqaga» (Android Back / iOS swipe back) closes the open window, not the site
 *
 *  Every modal / drawer / panel / presentation listed in LAYERS is watched. When one opens, a history entry is
 *  added (history.pushState, same URL). «Orqaga» then pops that entry: we close the TOP-most open layer and the user
 *  stays on the site with their slides. When a layer is closed with its own X button, the extra history entry is
 *  removed again (history.go(-n)), so later «Orqaga» presses still behave normally.
 * ===================================================================== */
(function () {
  'use strict';
  if (window.SSBackNav) return;

  function $(id) { return document.getElementById(id); }
  function call(name) { try { var f = window[name]; if (typeof f === 'function') { f(); return true; } } catch (e) {} return false; }
  function shown(el) {
    if (!el || !el.isConnected || el.hidden) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function mobile() { return (window.innerWidth || 1024) <= 768; }
  function esc() {
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); } catch (e) {}
  }
  function clickClose(el) {
    var b = el && el.querySelector('[data-tu-close], [data-ss-cancel], [data-close], .close-btn, .modal-close, .mb-close, [aria-label="Yopish"], [aria-label="Close"]');
    if (b) { b.click(); return true; }
    return false;
  }

  // name, element, extra "is it open" test, how to close (first that works wins; the generic chain follows)
  var LAYERS = [
    { name: 'confirm', el: function () { return $('ssConfirm'); }, close: function (el) { if (el.__ssClose) el.__ssClose(); } },
    { name: 'swal', el: function () { return document.querySelector('.swal2-container'); }, close: function () { try { Swal.close(); } catch (e) {} } },
    { name: 'lang', el: function () { return $('ssLangMenu'); }, open: function (el) { return el.classList.contains('open'); },
      close: function (el) { el.classList.remove('open'); } },
    { name: 'topup', el: function () { return $('topUpModal'); }, close: function (el) { clickClose(el); } },
    { name: 'settings', el: function () { return $('ssSet'); }, close: function (el) { esc(); if (el.isConnected) el.remove(); } },
    { name: 'media', el: function () { return $('mediaBrowserModal'); }, close: function () { call('closeMediaBrowser'); } },
    { name: 'export', el: function () { return $('exportModal'); }, close: function () { call('closeExportModal'); } },
    { name: 'import', el: function () { return $('importModal'); }, close: function () { call('closeImportModal'); } },
    { name: 'color', el: function () { return $('colorModal'); }, close: function () { call('closeColorPicker'); } },
    { name: 'bottomAi', el: function () { return $('bottomAiModal'); }, open: function (el) { return el.classList.contains('open'); },
      close: function () { call('closeBottomAiModal'); } },
    { name: 'anim', el: function () { return $('animPanel'); }, close: function (el) { clickClose(el) || el.remove(); } },
    { name: 'transition', el: function () { return $('ssTrPanel'); }, close: function () { call('ssCloseTrPanel'); } },
    { name: 'textcolor', el: function () { return $('ssTcPanel'); }, close: function (el) { clickClose(el) || el.remove(); } },
    { name: 'lightbox', el: function () { return $('imageLightboxOverlay'); }, close: function (el) { clickClose(el) || el.click(); } },
    { name: 'present', el: function () { return $('presentationOverlay'); }, close: function () { call('closePresentation'); } },
    // drawers count as layers only on phones (on a computer they are normal side panels)
    { name: 'slides', el: function () { return $('sidebar'); }, open: function (el) { return mobile() && el.classList.contains('open'); },
      close: function () { call('toggleSidebarMenu'); } },
    { name: 'aiPanel', el: function () { return $('aiSidebar'); }, open: function (el) { return mobile() && el.classList.contains('open'); },
      close: function () { try { toggleAISidebar(false); } catch (e) { call('toggleAISidebar'); } } },
  ];

  function isOpen(L) {
    var el = L.el();
    if (!el) return false;
    if (L.open) return !!L.open(el) && (L.name === 'slides' || L.name === 'aiPanel' || shown(el));
    return shown(el);
  }

  var stack = [];          // names of open layers, in the order they were opened (last = top)
  var depth = 0;           // history entries we pushed
  var ignorePops = 0;      // popstate events caused by our own history.go()
  var closing = false;

  function sync() {
    var open = LAYERS.filter(isOpen).map(function (L) { return L.name; });
    stack = stack.filter(function (n) { return open.indexOf(n) >= 0; });
    open.forEach(function (n) { if (stack.indexOf(n) < 0) stack.push(n); });
    if (closing) return;
    var n = stack.length;
    while (depth < n) {
      depth++;
      try { history.pushState({ ssLayer: depth }, '', location.href); } catch (e) { depth--; break; }
    }
    if (n < depth) {                       // closed with its own button: remove our extra entries
      var k = depth - n;
      depth = n;
      ignorePops++;
      try { history.go(-k); } catch (e) { ignorePops--; }
    }
  }

  var queued = false;
  function schedule() {                    // at most every 120 ms (animations change styles every frame)
    if (queued) return;
    queued = true;
    setTimeout(function () { queued = false; sync(); }, 120);
  }

  window.addEventListener('popstate', function () {
    if (ignorePops > 0) { ignorePops--; return; }
    if (depth <= 0) return;                // not ours: a normal back navigation
    depth--;
    var top = stack[stack.length - 1];
    var L = LAYERS.filter(function (x) { return x.name === top; })[0];
    if (!L) return;
    closing = true;
    try {
      var el = L.el();
      if (L.close) L.close(el);
      if (isOpen(L)) { esc(); }
      if (isOpen(L) && el && el.style) el.style.display = 'none';      // last resort for display-based windows
    } catch (e) {}
    closing = false;
    stack.pop();
    schedule();
  });

  function start() {
    try {
      new MutationObserver(schedule).observe(document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'],
      });
    } catch (e) {}
    window.addEventListener('resize', schedule);
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.SSBackNav = { state: function () { return { stack: stack.slice(), depth: depth }; }, layers: LAYERS.map(function (L) { return L.name; }) };
})();
