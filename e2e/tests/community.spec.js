// v60: izohlar (Instagram kabi yopiq javoblar, admin pin) va saytdagi referal havolasi
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

const post = (id, body, extra) => Object.assign({ id, author: 'Ali', body, created_at: new Date().toISOString(), likes: 0, liked: false, mine: false, pinned: false, replies: [] }, extra || {});

test('izohlar: javoblar yopiq, «N ta javobni ko\'rish» bosilsa ochiladi; admin qadaydi', async ({ page }) => {
  let pinned = false;
  await page.route('**/api/feedback/list**', (r) => r.fulfill({ json: {
    total: 2, is_admin: true,
    posts: [
      post('p2', 'Ikkinchi', { pinned, replies: [] }),
      post('p1', 'Birinchi izoh', { replies: [post('r1', 'javob bir'), post('r2', 'javob ikki')] }),
    ].sort((a, b) => (b.pinned - a.pinned)),
  } }));
  await page.route('**/api/feedback/pin', async (r) => { pinned = JSON.parse(r.request().postData()).pinned; await r.fulfill({ json: { ok: true, pinned } }); });
  await openEditor(page);
  await page.evaluate(() => { supabaseToken = 'devtok'; Feedback.open(); });
  await expect(page.locator('.fb-post:not(.reply)')).toHaveCount(2);
  await expect(page.locator('.fb-post.reply')).toHaveCount(0);                    // javoblar boshida yopiq
  const tg = page.locator('.fb-toggle-replies');
  await expect(tg).toHaveText('2 ta javobni ko\'rish');
  await tg.click();
  await expect(page.locator('.fb-post.reply')).toHaveCount(2);
  await expect(page.locator('.fb-toggle-replies')).toHaveText('Javoblarni yashirish');
  await page.locator('.fb-toggle-replies').click();
  await expect(page.locator('.fb-post.reply')).toHaveCount(0);
  // admin: «Qadash» tugmasi va o'chirish hammada bor
  await expect(page.locator('.fb-act', { hasText: 'Qadash' }).first()).toBeVisible();
  await expect(page.locator('.fb-act.danger')).toHaveCount(2);
  await page.locator('.fb-post:not(.reply)').first().locator('.fb-act', { hasText: 'Qadash' }).click();
  await expect(page.locator('.fb-pinned')).toHaveCount(1);
  await expect(page.locator('.fb-post.pinned')).toHaveCount(1);
});

test('referal: ?ref= kodi Google bilan kirishdan (sahifa qayta yuklanishidan) keyin ham saqlanadi va yuboriladi', async ({ page }) => {
  let claimed = null, signedIn = false;
  await page.route('**/api/referral/claim', async (r) => {
    if (!signedIn) return r.fulfill({ status: 401, json: { error: 'Avval tizimga kiring' } });   // hali kirmagan — kod saqlanib qolishi kerak
    claimed = JSON.parse(r.request().postData()).code; await r.fulfill({ json: { ok: true } });
  });
  await openEditor(page, '/?ref=ABCD2345');
  expect(page.url()).not.toContain('ref=');
  expect(await page.evaluate(() => JSON.parse(window.__ssAuthStorage.getItem('ss-auth-v39-ref')).code)).toBe('ABCD2345');
  await openEditor(page, '/');                                                    // OAuth qaytishi kabi — sahifa qayta yuklandi
  signedIn = true;
  await page.evaluate(() => { supabaseToken = 'devtok'; });
  await expect.poll(() => claimed, { timeout: 8000 }).toBe('ABCD2345');
  await expect.poll(() => page.evaluate(() => window.__ssAuthStorage.getItem('ss-auth-v39-ref'))).toBeNull();
});
