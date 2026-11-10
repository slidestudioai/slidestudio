const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('telefon: gorizontal scroll yo\'q, slayd ekranda', async ({ page }) => {
  const errors = await openEditor(page);
  expect(errors).toEqual([]);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(390);
  const c = await page.locator('#canvasCard').boundingBox();
  expect(c.x).toBeGreaterThanOrEqual(-1);
  expect(c.x + c.width * 0).toBeLessThan(390);
});

test('Telegram Mini App: xavfsiz hudud va «Orqaga» tugmasi', async ({ page }) => {
  await page.addInitScript(() => {
    window.__bb = [];
    const fake = {
      initData: 'query_id=1', initDataUnsafe: { user: { id: 1, first_name: 'Test' } },
      safeAreaInset: { top: 40, bottom: 20 }, contentSafeAreaInset: { top: 10 },
      platform: 'android', version: '8.0', colorScheme: 'light', themeParams: {},
      expand() {}, ready() {}, onEvent() {}, offEvent() {}, setHeaderColor() {}, setBackgroundColor() {},
      disableVerticalSwipes() {},
      BackButton: { show() { __bb.push('show'); }, hide() { __bb.push('hide'); }, onClick(f) { window.__bbf = f; } },
      MainButton: { show() {}, hide() {}, setText() {}, onClick() {} },
      HapticFeedback: { impactOccurred() {}, selectionChanged() {}, notificationOccurred() {} },
    };
    Object.defineProperty(window, 'Telegram', { configurable: true, get: () => ({ WebApp: fake }), set: () => {} });
  });
  await openEditor(page, '/?src=tg');
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('50px');
  await page.evaluate(() => toggleAISidebar(true));
  await expect.poll(() => page.evaluate(() => __bb[__bb.length - 1])).toBe('show');
  await page.evaluate(() => __bbf());
  await expect.poll(() => page.evaluate(() => document.getElementById('aiSidebar').classList.contains('open'))).toBe(false);
  await expect.poll(() => page.evaluate(() => __bb[__bb.length - 1])).toBe('hide');
});
