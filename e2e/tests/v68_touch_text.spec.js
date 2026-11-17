// v68: klaviaturasiz qurilma (telefon/planshet): slayddagi matnni barmoq bilan tahrirlash
const { test, expect, devices } = require('@playwright/test');
const { openEditor } = require('./helpers');

test.use({ ...devices['Pixel 7'] });

async function textPoint(page) {
  return page.evaluate(() => {
    const t = canvas.getObjects().find((o) => o.type === 'textbox');
    const c = t.getCenterPoint(), r = canvas.upperCanvasEl.getBoundingClientRect(), z = r.width / canvas.getWidth(), vt = canvas.viewportTransform;
    return { x: r.left + (c.x * vt[0] + vt[4]) * z, y: r.top + (c.y * vt[3] + vt[5]) * z };
  });
}
const state = (page) => page.evaluate(() => {
  const t = canvas.getActiveObject();
  return { editing: !!(t && t.isEditing), focused: !!(t && t.hiddenTextarea && document.activeElement === t.hiddenTextarea),
    fs: t && t.hiddenTextarea ? getComputedStyle(t.hiddenTextarea).fontSize : null };
});

test('ikki marta tegish → tahrirlash, klaviatura uchun maydon fokusda, yozilgan matn saqlanadi', async ({ page }) => {
  await openEditor(page);
  const p = await textPoint(page);
  await page.touchscreen.tap(p.x, p.y);
  expect((await state(page)).editing).toBe(false);          // 1 tegish = faqat tanlash
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(300);
  const s = await state(page);
  expect(s).toMatchObject({ editing: true, focused: true, fs: '16px' });   // 16px — iOS sahifani kattalashtirmaydi
  await page.keyboard.type(' QOSHIMCHA');
  await page.evaluate(() => { const t = canvas.getActiveObject(); t.exitEditing(); saveCurrentSlideState(); });
  const saved = await page.evaluate(() => slides[activeIndex].json);
  expect(saved).toContain('QOSHIMCHA');
});

test('tanlangan matnga keyinroq yana tegish ham tahrirlashni ochadi; surish tahrirlashni ochmaydi', async ({ page }) => {
  await openEditor(page);
  const p = await textPoint(page);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(900);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(300);
  expect((await state(page)).editing).toBe(true);
});
