// v83: first open (free server waking up): the login client is not ready yet when the user writes to the AI and
// taps «🔐 Google bilan kirish». Before, the click did nothing («supabaseClient null») — only a second tap worked.
const { test, expect } = require('@playwright/test');

async function setup(page, { delayMs = 0, failFirst = 0 } = {}) {
  let n = 0;
  const google = { url: '' };
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.fulfill({ status: 200, body: '' }));
  await page.route(/fakeproj\.supabase\.co/, (r) => { google.url = r.request().url(); r.fulfill({ status: 200, body: 'ok' }); });
  await page.route('**/api/config/public', async (r) => {
    n += 1;
    if (n <= failFirst) return r.fulfill({ status: 503, body: 'waking up' });
    if (delayMs) await new Promise((s) => setTimeout(s, delayMs));
    const j = await (await r.fetch()).json();
    j.supabase_url = 'https://fakeproj.supabase.co';
    j.supabase_publishable_key = 'sb_publishable_test';
    return r.fulfill({ json: j });
  });
  return google;
}

async function writeToAiAndLogin(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof canvas !== 'undefined' && canvas && slides.length > 0, null, { timeout: 30000 });
  await page.locator('#aiSidebarInput').fill('Salom, 5 ta slayd');
  await page.locator('#aiSidebarInput').press('Enter');
  await page.locator('.swal2-confirm').click();
}

test('login client still loading: one tap on «Google bilan kirish» opens Google', async ({ page }) => {
  const google = await setup(page, { delayMs: 10000 });
  await writeToAiAndLogin(page);
  await expect.poll(() => google.url, { timeout: 25000 }).toContain('/auth/v1/authorize?provider=google');
});

test('config request fails while the server wakes up: login still opens Google', async ({ page }) => {
  const google = await setup(page, { failFirst: 3 });
  await writeToAiAndLogin(page);
  await expect.poll(() => google.url, { timeout: 25000 }).toContain('/auth/v1/authorize?provider=google');
});
