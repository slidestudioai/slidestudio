// v68: yuklab olingan HTML (file://) ichida YouTube videosi o'z joyida o'ynaydi (avval: havola / xato 153)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { openEditor } = require('./helpers');

test('HTML eksport: file:// da YouTube pleyeri saytdagi /embed-player orqali slayd ichida ochiladi', async ({ page, context }, info) => {
  await openEditor(page);
  await page.evaluate(() => window.VideoKit.addToActive({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));
  await page.waitForTimeout(500);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.evaluate(() => window.exportHTML())]);
  const html = fs.readFileSync(await dl.path(), 'utf8');
  expect(html).toContain('window.__SS_RELAY=');
  const file = path.join(info.outputDir, 'deck.html');
  fs.mkdirSync(info.outputDir, { recursive: true });
  fs.writeFileSync(file, html);

  const viewer = await context.newPage();
  await viewer.route(/youtube\.com|ytimg\.com|fonts\.|cdn/, (r) => r.fulfill({ status: 200, body: '' }));
  await viewer.goto('file://' + file);
  const fr = viewer.locator('.embedwrap iframe').first();
  await expect(fr).toBeAttached({ timeout: 15_000 });
  const src = await fr.getAttribute('src');
  const base = new URL(page.url()).origin;
  expect(src.startsWith(base + '/embed-player?k=youtube&id=dQw4w9WgXcQ')).toBe(true);
  await expect(viewer.locator('.embedwrap a[href*="youtube.com/watch"]')).toHaveCount(0);   // havolaga o'tib ketmaydi
  // pleyer sahifasi haqiqatan ochiladi va ichida YouTube embed bor
  const inner = viewer.frameLocator('.embedwrap iframe').locator('iframe');
  await expect(inner).toHaveAttribute('src', /youtube\.com\/embed\/dQw4w9WgXcQ/, { timeout: 15_000 });
});
