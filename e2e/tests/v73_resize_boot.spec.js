// v73: cho'zganda narsalar buzilmaydi (bir nechta belgilangan narsa, guruh, jadval, krossvord) va
//      sekin / javob bermaydigan server bo'lsa ham muharrir bo'sh qolib ketmaydi
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

async function cornerXY(page, corner) {
  return page.evaluate((corner) => {
    const o = canvas.getActiveObject(); o.setCoords();
    const el = canvas.upperCanvasEl.getBoundingClientRect();
    const k = el.width / canvas.getWidth();
    const p = o.oCoords[corner];
    return p ? { x: el.left + p.x * k, y: el.top + p.y * k } : null;
  }, corner);
}
async function drag(page, corner, dx, dy) {
  const a = await cornerXY(page, corner);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + dx / 2, a.y + dy / 2, { steps: 6 });
  await page.mouse.move(a.x + dx, a.y + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('bir nechta narsani yonga cho\'zish: matn harflari cho\'zilmaydi (eni kengayadi), rasm nisbati saqlanadi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    canvas.clear(); canvas.setBackgroundColor('#ffffff');
    const t = new fabric.Textbox('Salom dunyo bu sinov matni', { left: 100, top: 100, width: 200, fontSize: 24, fontFamily: 'Arial' });
    const r = new fabric.Rect({ left: 100, top: 220, width: 200, height: 80, fill: '#93c5fd' });
    const el = document.createElement('canvas'); el.width = 100; el.height = 100; el.getContext('2d').fillRect(0, 0, 100, 100);
    const img = new fabric.Image(el, { left: 340, top: 100, scaleX: 1, scaleY: 1 });
    canvas.add(t, r, img);
    canvas.setActiveObject(new fabric.ActiveSelection([t, r, img], { canvas }));
    canvas.requestRenderAll();
  });
  await drag(page, 'mr', 220, 0);
  const s = await page.evaluate(() => {
    const objs = canvas.getActiveObject().getObjects();
    canvas.discardActiveObject();
    const t = canvas.getObjects().find((o) => o.type === 'textbox'), img = canvas.getObjects().find((o) => o.type === 'image');
    const r = canvas.getObjects().find((o) => o.type === 'rect');
    return { n: objs.length, tScale: [t.scaleX, t.scaleY], fs: t.fontSize, tw: t.width, img: [img.scaleX, img.scaleY], rw: r.width * r.scaleX, rScale: r.scaleX };
  });
  expect(s.n).toBe(3);                                      // tanlov saqlandi
  expect(s.tScale).toEqual([1, 1]);                         // harflar cho'zilmagan
  expect(s.fs).toBe(24);                                    // yonga cho'zilganda shrift o'zgarmaydi
  expect(s.tw).toBeGreaterThan(260);                        // eni kengaydi
  expect(Math.abs(s.img[0] - s.img[1])).toBeLessThan(0.01); // rasm nisbati saqlandi
  expect(s.rw).toBeGreaterThan(260);                        // shakl esa cho'zildi
  expect(s.rScale).toBe(1);
});

test('jadvalni yonga cho\'zish: qayta quriladi, kataklar keng, shrift buzilmaydi', async ({ page }) => {
  await openEditor(page);
  const before = await page.evaluate(() => {
    canvas.clear();
    const t = ssBuildTable({ rows: [['A', 'B'], ['1', '2'], ['3', '4']], left: 80, top: 80, width: 300 });
    canvas.add(t); canvas.setActiveObject(t); canvas.requestRenderAll();
    return { w: t.width, fs: t.ssSpec.fs0 || t.ssSpec.fs };
  });
  await drag(page, 'mr', 200, 0);
  const r = await page.evaluate(() => {
    const t = canvas.getActiveObject();
    return { kind: t.ssKind, sx: t.scaleX, sy: t.scaleY, w: t.width, fs: t.ssSpec.fs0 || t.ssSpec.fs, n: canvas.getObjects().filter((o) => o.ssKind === 'table').length };
  });
  expect(r.kind).toBe('table');
  expect(r.n).toBe(1);
  expect([r.sx, r.sy]).toEqual([1, 1]);                      // masshtab yo'q — haqiqiy o'lcham
  expect(r.w).toBeGreaterThan(before.w + 120);
  expect(r.fs).toBe(before.fs);
});

test('krossvord to\'ri faqat burchakdan (nisbat bilan) kattalashadi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    canvas.clear();
    await SS_CROSSWORD.insert({ words: [{ answer: 'GERAKL', clue: 'a' }, { answer: 'ANUBIS', clue: 'b' }, { answer: 'LOKI', clue: 'c' }], showClues: false }, null);
    const g = canvas.getObjects().find((o) => o.ssRole === 'cw_grid');
    canvas.discardActiveObject(); canvas.setActiveObject(g); canvas.requestRenderAll();
  });
  await page.waitForTimeout(100);
  expect(await cornerXY(page, 'br')).not.toBeNull();
  const vis = await page.evaluate(() => { const g = canvas.getActiveObject(); return ['ml', 'mr', 'mt', 'mb', 'br'].map((k) => g.isControlVisible(k)); });
  expect(vis).toEqual([false, false, false, false, true]);
});

test('server javob bermasa ham muharrir ochiladi (slaydlar ro\'yxati va AI paneli)', async ({ page }) => {
  await page.route('**/api/config/models', () => {});          // hech qachon javob bermaydi
  await page.route('**/api/config/public', () => {});
  await openEditor(page);                                         // helpers: slaydlar paydo bo'lishini kutadi
  await expect(page.locator('#sidebar .slide-item').first()).toBeVisible({ timeout: 20_000 });
});

test.describe('Telegram Mini App (to\'liq ekran)', () => {
  test.use({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
  test('AI paneli, chap panel va yuqori qator Telegram tugmalari ostida qolmaydi; sahifa surilib qolmaydi', async ({ page }) => {
    await page.addInitScript(() => {
      const noop = () => {};
      window.Telegram = { WebApp: { initData: 'query_id=x&hash=x', initDataUnsafe: {}, version: '8.0', platform: 'android', ready: noop, expand: noop,
        requestFullscreen: noop, isFullscreen: true, isVersionAtLeast: () => true, onEvent: noop, offEvent: noop,
        safeAreaInset: { top: 40, bottom: 16 }, contentSafeAreaInset: { top: 46, bottom: 0 }, BackButton: { show: noop, hide: noop, onClick: noop },
        disableVerticalSwipes: noop, enableClosingConfirmation: noop, openLink: noop, themeParams: {}, colorScheme: 'light' } };
    });
    await openEditor(page);
    const top = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top : -1; }, sel);
    expect(await top('.header-actions')).toBeGreaterThanOrEqual(86);
    await page.evaluate(() => toggleAISidebar(true));
    await page.waitForTimeout(500);
    expect(await top('.ai-sidebar-header')).toBeGreaterThanOrEqual(86);
    await page.evaluate(() => toggleAISidebar(false));
    await page.evaluate(() => toggleSidebarMenu());
    await page.waitForTimeout(500);
    expect(await top('#sidebar .slide-item')).toBeGreaterThanOrEqual(86);
    await page.evaluate(() => { toggleSidebarMenu(); window.scrollTo(0, 60); document.documentElement.scrollTop = 60; window.dispatchEvent(new Event('scroll')); });
    await expect.poll(() => page.evaluate(() => window.scrollY + document.documentElement.scrollTop)).toBe(0);
  });
});
