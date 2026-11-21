// v69: Telegram linking works on the FIRST try; on a phone the payment result is confirmed even if it is slow
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

const futureTok = () => 'L.4242.0.' + (Math.floor(Date.now() / 1000) + 1500) + '.abcdef0123456789abcd';

test('?tglink: manzilda qoladi («Brauzerda ochish» uchun), Google\'dan qaytgach o\'zi ulanadi, server bir marta xato bersa ham', async ({ page }) => {
  const tok = futureTok();
  let calls = 0;
  await page.route('**/api/telegram/link-complete', async (r) => {
    calls++;
    const body = JSON.parse(r.request().postData());
    expect(body.link).toBe(tok);
    if (calls === 1) return r.fulfill({ status: 503, json: { error: 'link_failed' } });   // server is waking up
    return r.fulfill({ json: { ok: true } });
  });
  await openEditor(page, '/?tglink=' + encodeURIComponent(tok));
  // not signed in yet: the token stays in the address bar and in localStorage
  expect(page.url()).toContain('tglink=');
  expect(await page.evaluate(() => JSON.parse(window.__ssAuthStorage.getItem('ss-auth-v39-tglink')).t)).toBe(tok);
  await expect(page.locator('.swal2-popup')).toBeVisible();                 // clear «sign in with Google» prompt
  // Google OAuth returns WITHOUT the query string -> the token comes from localStorage
  await openEditor(page, '/');
  await page.evaluate(() => { supabaseToken = 'devtok'; });
  await expect.poll(() => calls, { timeout: 20_000 }).toBe(2);              // retried after the 503
  await expect.poll(() => page.evaluate(() => window.__ssAuthStorage.getItem('ss-auth-v39-tglink'))).toBeNull();
  expect(page.url()).not.toContain('tglink=');
});

test('?tglink: eskirgan havola darhol aniq xabar beradi (kutib o\'tirmaydi)', async ({ page }) => {
  const old = 'L.4242.0.' + (Math.floor(Date.now() / 1000) - 60) + '.abcdef0123456789abcd';
  let calls = 0;
  await page.route('**/api/telegram/link-complete', (r) => { calls++; r.fulfill({ json: { ok: true } }); });
  await openEditor(page, '/?tglink=' + encodeURIComponent(old));
  expect(page.url()).not.toContain('tglink=');
  expect(await page.evaluate(() => window.__ssAuthStorage.getItem('ss-auth-v39-tglink'))).toBeNull();
  expect(calls).toBe(0);
});

test('telefon: to\'lovdan qaytgach kredit kech tushsa ham kutadi va «+N kredit» deydi', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      if (location.search.includes('payment=success'))
        localStorage.setItem('ss-auth-v39-pay', JSON.stringify({ at: Date.now(), expected: 100, beforePaid: 0, beforeTotal: 10 }));
    } catch (e) {}
  });
  await openEditor(page, '/?payment=success&status=succeeded');
  expect(await page.evaluate(() => window.__ssAuthStorage.getItem('ss-auth-v39-pay'))).toBeNull();
  expect(page.url()).not.toContain('payment=');
  // the webhook is "slow": credits appear only now (40+ s after return in real life — before, the site stopped at 40 s)
  await page.evaluate(() => {
    window.loadUserStats = async () => {};
    const real = Monitoring.getState;
    Monitoring.getState = () => Object.assign({}, real() || {}, { paid_credits: 100, total: 110 });
  });
  await expect(page.locator('#tuToast')).toContainText('+100', { timeout: 15_000 });
});

test('tanlangan til sahifa yangilanganda saqlanadi (avval har safar inglizchaga qaytardi)', async ({ page }) => {
  await openEditor(page, '/');
  await page.evaluate(() => SSI18n.set('ru'));
  await page.reload();
  await page.waitForFunction(() => typeof SSI18n !== 'undefined');
  expect(await page.evaluate(() => SSI18n.lang)).toBe('ru');
  await page.evaluate(() => SSI18n.set('uz'));
  await page.reload();
  await page.waitForFunction(() => typeof SSI18n !== 'undefined');
  expect(await page.evaluate(() => SSI18n.lang)).toBe('uz');
});
