// Phone UX: the AI panel does not jump with the keyboard, the slide is not moved by an accidental touch,
// undo / redo are always at hand.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test('AI panel: the keyboard changes its size at once (no 0.3 s height animation) and it follows the visible part', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const vv = new EventTarget(); vv.width = 375; vv.height = 812; vv.offsetTop = 0; vv.offsetLeft = 0; vv.scale = 1;
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  });
  // the handler was attached to the real visualViewport at start-up -> re-dispatch on the real one too
  await page.evaluate(() => toggleAISidebar(true));
  await page.waitForTimeout(500);
  const tp = await page.evaluate(() => getComputedStyle(document.getElementById('aiSidebar')).transitionProperty);
  expect(tp).not.toMatch(/(^|,\s*)(all|height|top)(,|$)/);
  await page.tap('#aiSidebarInput');
  const sizes = await page.evaluate(async () => {
    const ai = document.getElementById('aiSidebar');
    // what adjustAiForKeyboard writes for a keyboard of 342 px with the page shifted by 120 px (iPhone)
    document.documentElement.style.setProperty('--ai-panel-h', '470px');
    document.documentElement.style.setProperty('--ai-panel-top', '120px');
    ai.classList.add('keyboard-open');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = ai.getBoundingClientRect();
    return { top: Math.round(b.top), h: Math.round(b.height) };
  });
  expect(sizes).toEqual({ top: 120, h: 470 });            // immediately, not after an animation
});

test('AI panel still slides out when closed', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => toggleAISidebar(true));
  await page.waitForTimeout(500);
  await page.evaluate(() => toggleAISidebar(false));
  const mid = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 90)); return document.getElementById('aiSidebar').getBoundingClientRect().width; });
  expect(mid).toBeGreaterThan(100);                        // still visible while sliding
  await page.waitForTimeout(500);
  const end = await page.evaluate(() => { const b = document.getElementById('aiSidebar').getBoundingClientRect(); return b.width === 0 || b.left >= innerWidth - 1; });
  expect(end).toBe(true);
});

// finger events like a real phone (Fabric listens to touch events on its upper canvas)
async function drag(page, sel, from, to) {
  await page.evaluate(([sel, from, to]) => {
    const el = document.querySelector(sel);
    const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, x, y, list) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: list ? [mk(x, y)] : [], targetTouches: list ? [mk(x, y)] : [], changedTouches: [mk(x, y)] }));
    fire('touchstart', from[0], from[1], true);
    const n = 8;
    for (let i = 1; i <= n; i++) fire('touchmove', from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n, true);
    fire('touchend', to[0], to[1], false);
  }, [sel, from, to]);
  await page.waitForTimeout(150);
}

test('at normal zoom a finger on the empty area does not drag the slide away', async ({ page }) => {
  await openEditor(page);
  const before = await page.evaluate(() => { const r = document.getElementById('canvasCard').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
  const wr = await page.evaluate(() => { const r = document.getElementById('canvasWrapper').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 30 }; });
  await drag(page, '#canvasWrapper', [wr.x, wr.y], [wr.x + 5, wr.y + 220]);         // a «pull down» / scroll gesture
  const after = await page.evaluate(() => { const r = document.getElementById('canvasCard').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
  expect(after).toEqual(before);
});

test('a touch on an object that is not selected only selects it; a selected one moves after a real drag', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    canvas.discardActiveObject();
    const r = new fabric.Rect({ left: 300, top: 200, width: 200, height: 120, fill: '#2563eb' });
    r.__probe = true; canvas.add(r); canvas.renderAll();
  });
  const pt = (x, y) => page.evaluate(([x, y]) => {        // canvas coordinates -> screen
    const el = canvas.upperCanvasEl.getBoundingClientRect(), z = el.width / canvas.getWidth();
    return [el.left + x * z, el.top + y * z];
  }, [x, y]);
  const a = await pt(400, 260), b = await pt(400, 360);
  await drag(page, '.upper-canvas', a, b);
  let st = await page.evaluate(() => { const o = canvas.getObjects().find((x) => x.__probe); return { left: Math.round(o.left), top: Math.round(o.top), sel: canvas.getActiveObject() === o }; });
  expect(st).toEqual({ left: 300, top: 200, sel: true });   // not moved, but selected
  await drag(page, '.upper-canvas', a, b);                  // now it is selected: a real drag moves it
  st = await page.evaluate(() => { const o = canvas.getObjects().find((x) => x.__probe); return { left: Math.round(o.left), top: Math.round(o.top) }; });
  expect(st.top).toBeGreaterThan(260);
  // a tiny shake of a selected object does not move it
  const c = await pt(400, st.top + 60), d = await pt(403, st.top + 63);
  const t0 = st.top;
  await drag(page, '.upper-canvas', c, d);
  st = await page.evaluate(() => { const o = canvas.getObjects().find((x) => x.__probe); return { top: Math.round(o.top) }; });
  expect(st.top).toBe(t0);
});

test('undo / redo are always in the bottom row on a phone and work', async ({ page }) => {
  await openEditor(page);
  const vis = await page.evaluate(() => ['mobUndoBtn', 'mobRedoBtn'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 20 && r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0; }));
  expect(vis).toEqual([true, true]);
  await page.evaluate(() => { canvas.add(new fabric.Textbox('UNDO-ME', { left: 100, top: 100, width: 200 })); canvas.renderAll(); saveCurrentSlideState(); recordGlobalState(); });
  await page.waitForTimeout(300);
  await page.tap('#mobUndoBtn');
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => slides[activeIndex].json.indexOf('UNDO-ME') >= 0)).toBe(false);
  await page.tap('#mobRedoBtn');
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => slides[activeIndex].json.indexOf('UNDO-ME') >= 0)).toBe(true);
});
