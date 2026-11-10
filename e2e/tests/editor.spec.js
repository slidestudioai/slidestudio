const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { openEditor, pixel } = require('./helpers');

test('editor xatosiz yuklanadi', async ({ page }) => {
  const errors = await openEditor(page);
  expect(errors).toEqual([]);
  await expect(page.locator('#canvasCard')).toBeVisible();
});

test('fon rangi DARHOL ko\'rinadi (boshqa elementni bosish shart emas)', async ({ page }) => {
  await openEditor(page);
  // poll emas: bitta o'qish. Eski xatoda keyinroq boshqa sabab bilan qayta chizilishi mumkin edi, lekin darhol emas.
  await page.evaluate(() => setSlideBackground('#ff0000'));
  await page.waitForTimeout(250);
  expect(await pixel(page)).toBe('255,0,0');
  await page.evaluate(() => setSlideBackground('#0000ff'));
  await page.waitForTimeout(250);
  expect(await pixel(page)).toBe('0,0,255');
});

test('toDataURL (thumbnail) kutilayotgan renderni bekor qilmaydi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    canvas.backgroundColor = '#00ff00';
    canvas.requestRenderAll();
    canvas.toDataURL({ format: 'png', multiplier: 0.2 });   // fabric 5 bu yerda renderni bekor qilardi
  });
  await page.waitForTimeout(250);
  expect(await pixel(page)).toBe('0,255,0');
});

test('fon rasmi yuklanganda darhol ko\'rinadi', async ({ page }) => {
  await openEditor(page);
  // 4x4 yashil PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGNgYPiPhBjIEgAA6ycP8SkrpMMAAAAASUVORK5CYII=', 'base64');
  const file = path.join(os.tmpdir(), 'ss-e2e-green.png');
  fs.writeFileSync(file, png);
  page.once('filechooser', (fc) => fc.setFiles(file));
  await page.evaluate(() => triggerBackgroundImageUpload());
  await expect.poll(async () => (await pixel(page, 100, 100)).split(',').map(Number)[1] > 150, { timeout: 5000 }).toBe(true);
});

test('Sozlamalar paneli ochilganda slayd ko\'rinadigan joydan chiqib ketmaydi', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openEditor(page);
  await page.evaluate(() => openSettingsPanel());
  await page.click('#ssTools');
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const w = document.getElementById('canvasWrapper').getBoundingClientRect();
    const c = document.querySelector('#canvasCard').getBoundingClientRect();
    return { wl: w.left, wr: w.right, cl: c.left, cr: c.right };
  });
  expect(r.cl).toBeGreaterThanOrEqual(r.wl - 1);
  expect(r.cr).toBeLessThanOrEqual(r.wr + 1);
});

test('yuqori panel tugmalari bir xil balandlikda', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openEditor(page);
  const hs = await page.$$eval('.header-actions > button, .header-actions > #ssQuota',
    (els) => els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(hs.length).toBeGreaterThan(2);
  expect(new Set(hs).size).toBe(1);
});

test('yuqori panel: kirmagan — balans yo\'q, «Kirish» bor; kirgan — balans bor, «Kirish» yo\'q', async ({ page }) => {
  for (const vp of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp);
    await openEditor(page);
    await expect(page.locator('#googleLoginBtn')).toBeVisible();
    await expect(page.locator('#ssQuota')).toBeHidden();
    await page.evaluate(() => { supabaseToken = 'fake-token'; currentUserEmail = 'test@example.com'; window.ssSyncAuthHeader(); });
    await expect(page.locator('#googleLoginBtn')).toBeHidden();
    await expect(page.locator('#ssQuota')).toBeVisible();
    await page.evaluate(() => { supabaseToken = 'dev-token'; currentUserEmail = ''; window.ssSyncAuthHeader(); });
    await expect(page.locator('#ssQuota')).toBeHidden();
  }
});
