/* v30b — Chat kiritish maydoni: qutining istalgan joyini bosganda matn maydoni fokus oladi */
(function () {
  'use strict';
  function wire(box) {
    if (!box || box.__ssFocusWired) return;
    box.__ssFocusWired = true;
    var ta = box.querySelector('textarea, input[type="text"]');
    if (!ta) return;
    function focusIt(e) {
      var t = e.target;
      if (t === ta) return;
      if (t.closest && t.closest('button')) return;
      e.preventDefault();
      try { ta.focus({ preventScroll: true }); } catch (er) { ta.focus(); }
      try { var n = ta.value.length; ta.setSelectionRange(n, n); } catch (er) {}
    }
    box.addEventListener('mousedown', focusIt);
    box.addEventListener('touchend', function (e) {
      var t = e.target;
      if (t === ta || (t.closest && t.closest('button'))) return;
      focusIt(e);
    }, { passive: false });
  }
  function init() {
    document.querySelectorAll('.ai-sidebar-input-box, .bottom-ai-modal .bottom-ai-input-box').forEach(wire);
    var ta = document.getElementById('aiSidebarInput');
    if (ta) {
      // placeholder matni ustiga bosish ham ishlasin: maydon balandligini tashqi qutiga moslaymiz
      ta.style.minHeight = '44px';
      ta.addEventListener('pointerdown', function () { if (document.activeElement !== ta) { try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); } } });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
