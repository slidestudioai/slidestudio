// v63/v64: mehmon slaydlari Google'ga kirishda yo'qolmaydi, chiqishda tozalanadi; telefonda faqat matn nusxalanadi
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('mehmon slaydlari redirect (sahifa qayta yuklanishi)dan keyin tiklanadi, vaqtincha nusxa darhol o\'chadi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    await executeAiCommands({ actions: [
      { action: 'replace_slide', slide: 1, background: '#0F172A', elements: [{ type: 'text', text: 'Mehmon slaydi', left: 40, top: 40, width: 880, height: 52, fontSize: 40, fill: '#ffffff' }] },
      { action: 'insert_slide', after: 1, background: '#0F172A', elements: [{ type: 'text', text: 'Ikkinchi', left: 40, top: 40, width: 880, height: 52, fontSize: 40, fill: '#ffffff' }] },
    ] });
  });
  expect(await page.evaluate(() => window.ssStashGuestDeck())).toBe(true);
  await openEditor(page, '/');                                            // Google'dan qaytish kabi
  await expect.poll(() => page.evaluate(() => slides.length), { timeout: 15000 }).toBe(2);
  expect(await page.evaluate(() => JSON.parse(slides[0].json).objects.some((o) => o.text === 'Mehmon slaydi'))).toBe(true);
  expect(await page.evaluate(() => window.__ssAuthStorage.getItem('ss-auth-v39-guest'))).toBeNull();
  await openEditor(page, '/');                                            // keyingi ochilishda qayta tiklanmaydi
  expect(await page.evaluate(() => slides.length)).toBe(1);
});

test('chiqishda vaqtincha nusxa va kanvas tozalanadi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { window.ssStashGuestDeck(); });
  await page.evaluate(() => { window.location.reload = () => {}; return handleLogout(); });
  expect(await page.evaluate(() => window.__ssAuthStorage.getItem('ss-auth-v39-guest'))).toBeNull();
  expect(await page.evaluate(() => canvas.getObjects().length)).toBe(0);
});

test('telefonda «Nusxalash» faqat matn uchun ishlaydi', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openEditor(page);
  const r = await page.evaluate(async () => {
    window.__toasts = []; const o = window.showToast; window.showToast = function (m, k) { window.__toasts.push([String(m), k]); return o && o.apply(this, arguments); };
    const rect = new fabric.Rect({ left: 10, top: 10, width: 50, height: 50, fill: '#f00' }); canvas.add(rect); canvas.setActiveObject(rect);
    window.ssMenuCopy();
    const t = canvas.getObjects().find((x) => x.type === 'textbox'); canvas.setActiveObject(t);
    window.ssMenuCopy();
    await new Promise((res) => setTimeout(res, 300));
    return window.__toasts;
  });
  expect(r[0][0]).toMatch(/faqat matnni/);
  expect(r[0][1]).toBe('error');
  expect(r[1][0]).toMatch(/Matn nusxalandi/);
});
