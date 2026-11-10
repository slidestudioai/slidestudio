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

test('botdan kelgan PPTX: GIF harakatli, tugma havolasi saqlanadi (Mini App «Muharrirda ochish»)', async ({ page }) => {
  await openEditor(page);
  const buf = require('fs').readFileSync(require('path').join(__dirname, '..', 'fixtures', 'bot_deck.pptx')).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.importPptxClient(new File([bin], 'bot.pptx'));
  }, buf);
  await expect.poll(() => page.evaluate(() => slides.length)).toBe(3);
  const info = await page.evaluate(() => {
    const o = JSON.parse(slides[1].json || '{}').objects || [];
    return { gif: o.some((x) => x.type === 'gifImage' && /^data:image\/gif/.test(x.gifUrl || '')),
             link: o.some((x) => x.linkUrl === 'https://example.com') };
  });
  expect(info).toEqual({ gif: true, link: true });
});

test('yuqori tugmalar yumaloq (pill), chap panel torroq', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openEditor(page);
  const r = await page.$$eval('.header-actions > button', (els) => els.filter((e) => e.offsetParent && !e.classList.contains('btn-ribbon-toggle'))
    .map((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius)));
  expect(r.length).toBeGreaterThan(1);
  for (const v of r) expect(v).toBeGreaterThanOrEqual(16);
  const w = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
  expect(w).toBeLessThanOrEqual(212);
  expect(w).toBeGreaterThanOrEqual(190);
});

test('e\'lon popup: «Reklama» yozuvisiz chiqadi va yopilgach qayta chiqmaydi', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/notice/next**', (r) => {
    calls++;
    const seen = new URL(r.request().url()).searchParams.get('exclude') || '';
    const notice = seen.split(',').includes('42') ? null
      : { id: 42, title: 'Yangi imkoniyat', body: 'Endi botda GIF ham bor', media_type: 'none', media_url: '', button_text: 'Ko\'rish',
          has_link: true, click_url: '/api/ads/click/42?s=site', kind: 'notice', label: false };
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ notice }) });
  });
  await openEditor(page);
  await expect(page.locator('#ssNotice .ssn')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#ssNotice')).toContainText('Yangi imkoniyat');
  await expect(page.locator('#ssNotice')).not.toContainText('Reklama');
  await page.click('#ssNotice .ssn-x');
  await expect(page.locator('#ssNotice')).toHaveCount(0);
  await page.evaluate(() => window.ssCheckNotice());
  await page.waitForTimeout(500);
  await expect(page.locator('#ssNotice')).toHaveCount(0);
});
