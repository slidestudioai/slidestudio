// v83: one deck per account in the cloud (3 days): what is made on one device opens by itself on another
// (site <-> Telegram Mini App), and a draft older than 3 days is not opened again.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

function fakeCloud(page, store) {
  return page.route('**/api/draft/**', async (r) => {
    const op = r.request().url().split('/').pop();
    const auth = r.request().headers()['authorization'] || '';
    if (!/Bearer devtok/.test(auth)) return r.fulfill({ status: 401, json: { error: 'login' } });
    if (op === 'save') {
      const b = JSON.parse(r.request().postData() || '{}');
      store.saves.push(b);
      store.deck = b.deck; store.at = b.saved_at;
      return r.fulfill({ json: { ok: true, saved_at: b.saved_at } });
    }
    if (op === 'load') return r.fulfill({ json: store.deck ? { deck: store.deck, saved_at: store.at, ttl_days: 3 } : { deck: null } });
    if (op === 'delete') { store.deck = null; return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ status: 404, body: '' });
  });
}
const login = (page) => page.evaluate(() => {
  supabaseToken = 'devtok'; currentUserEmail = 'ali@e2e.uz'; window._ssAuthUid = 'u-ali';
  window.ssFreshToken = async () => 'devtok';
});

test('a deck made on one device opens by itself on another device of the same account', async ({ browser }) => {
  const store = { saves: [], deck: null, at: 0 };
  // device 1: the site
  const a = await browser.newPage();
  await fakeCloud(a, store);
  await openEditor(a);
  await login(a);
  await a.evaluate(() => { canvas.add(new fabric.Textbox('Bulutdagi slayd', { left: 100, top: 100, width: 300 })); saveCurrentSlideState(); });
  await a.evaluate(() => window.ssPersistNow());
  await expect.poll(() => store.saves.length, { timeout: 15000 }).toBeGreaterThan(0);
  expect(JSON.stringify(store.deck.slides)).toContain('Bulutdagi slayd');
  await a.close();

  // device 2 (e.g. the Telegram Mini App): empty browser storage, signs in after start-up
  const b = await browser.newPage();
  await fakeCloud(b, store);
  await openEditor(b);
  expect(await b.evaluate(() => window.ssIsPristineDeck())).toBe(true);
  await login(b);
  await b.evaluate(() => window.dispatchEvent(new CustomEvent('ss-logged-in')));
  await expect.poll(() => b.evaluate(() => JSON.stringify(slides.map((s) => s.json))), { timeout: 15000 }).toContain('Bulutdagi slayd');
  await b.close();
});

test('a local draft older than 3 days is not opened again', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('slide-studio-v40', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('project');
    q.onsuccess = () => {
      const tx = q.result.transaction('project', 'readwrite');
      tx.objectStore('project').put({ v: 2, owner: 'draft:guest', title: 'Eski', activeIndex: 0, savedAt: Date.now() - 4 * 24 * 3600 * 1000,
        slides: [{ json: JSON.stringify({ objects: [{ type: 'textbox', text: 'Juda eski slayd', left: 10, top: 10, width: 200 }], background: '#ffffff' }) }] }, 'draft:guest');
      tx.oncomplete = res;
    };
  }));
  await page.reload();
  await page.waitForFunction(() => typeof canvas !== 'undefined' && canvas && slides.length > 0);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => JSON.stringify(slides.map((s) => s.json)))).not.toContain('Juda eski slayd');
});

test('a fresh local draft (under 3 days) still opens after a reload', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { canvas.add(new fabric.Textbox('Yangi qoralama', { left: 100, top: 100, width: 300 })); saveCurrentSlideState(); });
  await page.evaluate(() => window.ssPersistNow());
  await page.reload();
  await page.waitForFunction(() => typeof canvas !== 'undefined' && canvas && slides.length > 0);
  await expect.poll(() => page.evaluate(() => JSON.stringify(slides.map((s) => s.json)))).toContain('Yangi qoralama');
});
