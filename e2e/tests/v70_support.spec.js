// v70: ⚙️ Sozlamalar → «💬 Yordam»: foydalanuvchi adminga yozadi; Terms sozlamalarda yo'q (sidebar pastida bor)
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

async function openSettings(page) {
  await page.evaluate(() => { try { localStorage.setItem('ss-auth-v39-lang', 'uz'); } catch (e) {} window.SSI18n && SSI18n.set && SSI18n.set('uz'); });
  await page.evaluate(() => window.openSettingsPanel());
  await expect(page.locator('#ssSet')).toBeVisible();
}

test('mehmon: «Yordam» tugmasi bor, oyna kirishni so\'raydi', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await page.locator('#ssSupport').click();
  await expect(page.locator('#ssSet')).toHaveCount(0);
  await expect(page.locator('#ssSup')).toBeVisible();
  await expect(page.locator('#ssSupLogin')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ssSup')).toHaveCount(0);
});

test('kirgan foydalanuvchi xabar yuboradi va admin javobini ko\'radi', async ({ page }) => {
  const thread = [{ id: 1, body: 'Eski savol', from_admin: false, created_at: '2026-11-20T10:00:00Z' },
                  { id: 2, body: 'Admin javobi', from_admin: true, created_at: '2026-11-20T11:00:00Z' }];
  let sent = null, auth = '';
  await page.route('**/api/support/unread', (r) => r.fulfill({ json: { unread: 1 } }));
  await page.route('**/api/support/my', (r) => r.fulfill({ json: { messages: thread, unread: 0 } }));
  await page.route('**/api/support/send', (r) => {
    sent = r.request().postDataJSON(); auth = r.request().headers()['authorization'] || '';
    thread.push({ id: 3, body: sent.body, from_admin: false, created_at: '2026-11-21T10:00:00Z' });
    return r.fulfill({ json: { ok: true } });
  });
  await openEditor(page);
  await page.evaluate(() => { supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; });
  await openSettings(page);
  await expect(page.locator('#ssSupport .ss-sup-badge')).toHaveText('1');
  await page.locator('#ssSupport').click();
  await expect(page.locator('#ssSup .sssup-m')).toHaveCount(2);
  await expect(page.locator('#ssSup .sssup-m.adm')).toContainText('Admin javobi');
  await page.fill('#ssSupText', '<b>Yangi</b> savol');
  await page.locator('#ssSupSend').click();
  await expect(page.locator('#ssSup .sssup-m')).toHaveCount(3);
  expect(sent.body).toBe('<b>Yangi</b> savol');
  expect(auth).toBe('Bearer devtok');
  // matn HTML sifatida emas, oddiy matn sifatida ko'rinadi
  await expect(page.locator('#ssSup .sssup-m.me').last()).toContainText('<b>Yangi</b> savol');
  await expect(page.locator('#ssSupText')).toHaveValue('');
});

test('Terms sozlamalarda yo\'q, sidebar pastida esa bor', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await expect(page.locator('#ssSet')).not.toContainText('Terms');
  await page.locator('#ssTools').click();
  await expect(page.locator('.settings-panel-inner')).toBeVisible();
  await expect(page.locator('.settings-panel-inner')).not.toContainText('Terms');
  await expect(page.locator('.settings-panel-inner [data-a="legal"]')).toHaveCount(0);
  await page.locator('.settings-panel-inner [data-a="back"]').click();
  await expect(page.locator('#sidebarTermsLink')).toHaveCount(1);
});

test.describe('telefon', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('«Orqaga» tugmasi Yordam oynasini yopadi va saytda qoladi', async ({ page }) => {
    await openEditor(page);
    const url = page.url();
    await page.evaluate(() => window.ssOpenSupport());
    await expect(page.locator('#ssSup')).toBeVisible();
    await page.waitForTimeout(300);
    await page.goBack();
    await expect(page.locator('#ssSup')).toHaveCount(0);
    expect(page.url()).toBe(url);
  });
});
