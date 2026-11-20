// Undo / redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) as a user uses it: drag, delete, add slide, panel, typing.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

// helpers inside the page
async function setup(page) {
  await openEditor(page);
  await page.evaluate(() => {
    window.__ss = {
      center(o) {
        const r = canvas.upperCanvasEl.getBoundingClientRect();
        const p = o.getCenterPoint(); const vt = canvas.viewportTransform;
        const z = r.width / canvas.getWidth();
        return { x: r.left + (p.x * vt[0] + vt[4]) * z, y: r.top + (p.y * vt[3] + vt[5]) * z };
      },
      add() {
        const o = new fabric.Rect({ left: 300, top: 250, width: 120, height: 90, fill: '#22aa55' });
        canvas.add(o); canvas.setActiveObject(o); canvas.requestRenderAll();
        canvas.fire('object:modified', { target: o });
        return o._oid;
      },
      rect() { return canvas.getObjects().find((o) => o.type === 'rect' && o.fill === '#22aa55'); },
      st() { const r = this.rect(); return { left: r ? Math.round(r.left) : null, n: canvas.getObjects().length, slides: slides.length, idx: activeIndex, step: historyStep, len: globalHistory.length }; },
    };
  });
  await page.evaluate(() => __ss.add());
  await page.waitForTimeout(1200);
  await page.mouse.click(5, 5);
}
async function drag(page, dx) {
  const c = await page.evaluate(() => __ss.center(__ss.rect()));
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y, { steps: 5 }); await page.mouse.move(c.x + dx, c.y, { steps: 5 });
  await page.mouse.up();
}
const st = (page) => page.evaluate(() => __ss.st());

test('U1: Ctrl+Z right after a drag undoes only that drag (save was still deferred)', async ({ page }) => {
  await setup(page);
  const a = await st(page);
  await drag(page, 100); await page.waitForTimeout(1200);
  const b = await st(page);
  await drag(page, 100);                          // second drag, then undo IMMEDIATELY
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  const c = await st(page);
  expect(c.left).toBe(b.left);                    // only the 2nd drag is undone
});

test('U2: three fast Ctrl+Z / Ctrl+Y = exactly three steps', async ({ page }) => {
  await setup(page);
  const s = [await st(page)];
  for (let i = 0; i < 3; i++) { await drag(page, 60); await page.waitForTimeout(1100); s.push(await st(page)); }
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  await page.waitForTimeout(1500);
  const u = await st(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+y');
  await page.waitForTimeout(1500);
  const r = await st(page);
  expect(u.left).toBe(s[0].left);
  expect(r.left).toBe(s[3].left);
});

test('U3: delete -> Ctrl+Z brings it back -> Ctrl+Shift+Z deletes again', async ({ page }) => {
  await setup(page);
  const c = await page.evaluate(() => __ss.center(__ss.rect()));
  await page.mouse.click(c.x, c.y); await page.keyboard.press('Delete'); await page.waitForTimeout(1100);
  const d = await st(page);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  const u = await st(page);
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(800);
  const r = await st(page);
  expect(d.left).toBeNull(); expect(u.left).not.toBeNull(); expect(r.left).toBeNull();
});

test('U4: add slide -> the first Ctrl+Z removes it', async ({ page }) => {
  await setup(page);
  const a = await st(page);
  await page.evaluate(() => addSlide('title_body')); await page.waitForTimeout(1200);
  const b = await st(page);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
  const c = await st(page);
  expect(b.slides).toBe(a.slides + 1); expect(c.slides).toBe(a.slides);
});

test('U5: Ctrl+Z in the AI prompt does not touch the slides', async ({ page }) => {
  await setup(page);
  await drag(page, 80); await page.waitForTimeout(1100);
  const a = await st(page);
  await page.evaluate(() => { const el = document.getElementById('aiSidebarInput'); el.focus(); });
  await page.keyboard.type('salom'); await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  const b = await st(page);
  expect(b.left).toBe(a.left);
});

test('U6: edited text -> Ctrl+Z restores the old text', async ({ page }) => {
  await openEditor(page);
  const t0 = await page.evaluate(() => { const t = canvas.getObjects().find(o => o.type === 'textbox'); return t && t.text; });
  const c = await page.evaluate(() => { const t = canvas.getObjects().find(o => o.type === 'textbox'); const r = canvas.upperCanvasEl.getBoundingClientRect(); const p = t.getCenterPoint(); const z = r.width / canvas.getWidth(); const vt = canvas.viewportTransform; return { x: r.left + (p.x * vt[0] + vt[4]) * z, y: r.top + (p.y * vt[3] + vt[5]) * z }; });
  await page.mouse.dblclick(c.x, c.y); await page.waitForTimeout(300);
  await page.keyboard.press('Control+a'); await page.keyboard.type('Yangi matn');
  await page.mouse.click(5, 5); await page.waitForTimeout(1300);
  const t1 = await page.evaluate(() => canvas.getObjects().find(o => o.type === 'textbox').text);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(900);
  const t2 = await page.evaluate(() => canvas.getObjects().find(o => o.type === 'textbox').text);
  expect(t1).toBe('Yangi matn'); expect(t2).toBe(t0);
});

test('U7: clicks / selection / thumbnails are not undo steps', async ({ page }) => {
  await setup(page);
  const a = await st(page);
  await drag(page, 90); await page.waitForTimeout(1200);
  const b = await st(page);
  // only clicks / selection / slide thumbnail refresh — no real change
  const c = await page.evaluate(() => __ss.center(__ss.rect()));
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(300); await page.mouse.click(5, 5); await page.waitForTimeout(1300);
  await page.evaluate(() => { try { refreshSlideThumb(0); } catch (e) {} }); await page.waitForTimeout(800);
  const m = await st(page);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(900);
  const u = await st(page);
  expect(u.left).toBe(a.left);
});

test('U8: panel change -> Ctrl+Z right away -> Ctrl+Y brings it back', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { const r = __ss.rect(); canvas.setActiveObject(r); r.set('opacity', 0.5); canvas.requestRenderAll(); window.ssDeferSave(); });
  await page.keyboard.press('Control+z'); await page.waitForTimeout(900);
  const u = await page.evaluate(() => { const r = __ss.rect(); return r && r.opacity; });
  await page.keyboard.press('Control+y'); await page.waitForTimeout(900);
  const r2 = await page.evaluate(() => { const r = __ss.rect(); return r && r.opacity; });
  expect(u).toBe(1); expect(r2).toBe(0.5);
});

test('U9: nothing to undo -> a normal note, not a red error', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { while (historyStep > 0) historyStep--; });
  await page.mouse.click(5, 5);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  const t = await page.evaluate(() => { const el = document.getElementById('toastNotification'); return { show: el.classList.contains('show'), error: el.classList.contains('error') }; });
  expect(t.show).toBe(true); expect(t.error).toBe(false);
});

test('U10: slide transition is kept by an undo', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { slides[0].transition = 'fade'; slides[0].transDur = 700; recordGlobalState(); });
  await drag(page, 70); await page.waitForTimeout(1200);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(900);
  const t = await page.evaluate(() => ({ tr: slides[0].transition, d: slides[0].transDur }));
  expect(t.tr).toBe('fade');
});

test('U11: Ctrl+Z while typing undoes the typing only', async ({ page }) => {
  await openEditor(page);
  const c = await page.evaluate(() => { const t = canvas.getObjects().find(o => o.type === 'textbox'); const r = canvas.upperCanvasEl.getBoundingClientRect(); const p = t.getCenterPoint(); const z = r.width / canvas.getWidth(); const vt = canvas.viewportTransform; return { x: r.left + (p.x * vt[0] + vt[4]) * z, y: r.top + (p.y * vt[3] + vt[5]) * z }; });
  await page.mouse.dblclick(c.x, c.y); await page.waitForTimeout(300);
  await page.keyboard.press('End'); await page.keyboard.type(' ABC');
  const t1 = await page.evaluate(() => canvas.getObjects().find(o => o.type === 'textbox').text);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => ({ text: canvas.getObjects().find(o => o.type === 'textbox').text, editing: !!(canvas.getActiveObject() && canvas.getActiveObject().isEditing), n: slides.length }));
  expect(t1).toContain('ABC');
  expect(t2.text).not.toContain('ABC'); expect(t2.editing).toBe(true); expect(t2.n).toBe(1);
});

test('U12: undo / redo buttons are dimmed when not available; history entries are objects', async ({ page }) => {
  await setup(page);
  const a = await page.evaluate(() => ({ u: document.querySelector('[onclick="undo()"]').classList.contains('ss-hist-off'), r: document.querySelector('[onclick="redo()"]').classList.contains('ss-hist-off') }));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(900);
  const b = await page.evaluate(() => ({ r: document.querySelector('[onclick="redo()"]').classList.contains('ss-hist-off'), type: typeof globalHistory[historyStep] }));
  expect(a.u).toBe(false); expect(a.r).toBe(true); expect(b.r).toBe(false); expect(b.type).toBe('object');
});
