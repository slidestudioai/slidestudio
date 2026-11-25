// v82: «Orqaga» (phone Back) bilan yopilgan oyna QAYTA OCHILADI — tugma «ishlamay qolmaydi».
// Har oyna 3 marta: ochish -> Orqaga -> yopildi -> qayta ochish -> ko'rinadi -> o'z tugmasi bilan yopish.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

const LAYERS = [
  { name: 'media', open: 'openMediaBrowser()', el: 'mediaBrowserModal', close: 'closeMediaBrowser()' },
  { name: 'export', open: 'openExportModal()', el: 'exportModal', close: 'closeExportModal()' },
  { name: 'topup', open: "(supabaseToken = 'devtok', openTopUpModal())", el: 'topUpModal',
    close: "document.querySelector('#topUpModal [data-tu-close]').click()" },
  { name: 'settings', open: 'openSettingsV47()', el: 'ssSet', close: "document.getElementById('ssSet').remove()" },
  { name: 'support', open: "(supabaseToken = 'devtok', ssOpenSupport())", el: 'ssSup', close: "document.getElementById('ssSup').remove()" },
  { name: 'bottomAi', open: 'openBottomAiModal()', el: 'bottomAiModal', close: 'closeBottomAiModal()' },
  { name: 'present', open: 'startPresentation()', el: 'presentationOverlay', close: 'closePresentation()' },
];

function visible(page, id) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, id);
}

async function waitVisible(page, id, want) {
  await expect.poll(() => visible(page, id), { timeout: 8000 }).toBe(want);
}

for (const L of LAYERS) {
  test(`back -> reopen works 3 times: ${L.name}`, async ({ page }) => {
    const errors = await openEditor(page);
    const url = page.url();
    for (let i = 0; i < 3; i++) {
      await page.evaluate(L.open);
      await waitVisible(page, L.el, true);
      await page.waitForTimeout(300);                        // back-nav pushes its history entry (120 ms debounce)
      await page.goBack();
      await waitVisible(page, L.el, false);
      expect(page.url()).toBe(url);                          // still on the site
      await page.evaluate(L.open);                           // the SAME button again
      await waitVisible(page, L.el, true);
      await page.evaluate(L.close);
      await waitVisible(page, L.el, false);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => SSBackNav.state().depth)).toBe(0);
    }
    expect(errors.filter((e) => !/ResizeObserver/.test(e))).toEqual([]);
  });
}

test('fast: close with X, open another at once, Back closes the new one and stays on the site', async ({ page }) => {
  await openEditor(page);
  const url = page.url();
  for (let i = 0; i < 4; i++) {
    await page.evaluate('openExportModal()');
    await page.waitForTimeout(250);
    await page.evaluate('closeExportModal(); openMediaBrowser()');   // no pause between them
    await waitVisible(page, 'mediaBrowserModal', true);
    await page.waitForTimeout(400);
    await page.goBack();
    await waitVisible(page, 'mediaBrowserModal', false);
    expect(page.url()).toBe(url);
    await page.evaluate('openMediaBrowser()');
    await waitVisible(page, 'mediaBrowserModal', true);
    await page.evaluate('closeMediaBrowser()');
    await waitVisible(page, 'mediaBrowserModal', false);
  }
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => SSBackNav.state().depth)).toBe(0);
});

