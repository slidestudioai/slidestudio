// v72: tegilmagan boshlang'ich slayd saqlanmaydi; AI'ga yuborilgan matn qayta yuklashdan keyin maydonda qolmaydi
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

const keys = (page) => page.evaluate(() => new Promise((r) => {
  const q = indexedDB.open('slide-studio-v40', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('project');
  q.onsuccess = () => { const k = q.result.transaction('project').objectStore('project').getAllKeys(); k.onsuccess = () => r(k.result); };
}));

test('boshlang\'ich (tegilmagan) slayd saqlanmaydi; o\'zgartirilsa saqlanadi; hammasi tozalansa qoralama o\'chadi', async ({ page }) => {
  await openEditor(page);
  expect(await page.evaluate(() => window.ssIsPristineDeck())).toBe(true);
  await page.evaluate(() => window.ssPersistNow());
  expect(await keys(page)).toEqual([]);
  // foydalanuvchi matn qo'shdi -> saqlanadi
  await page.evaluate(() => { canvas.add(new fabric.Textbox('Mening slaydim', { left: 100, top: 100, width: 300 })); saveCurrentSlideState(); });
  expect(await page.evaluate(() => window.ssIsPristineDeck())).toBe(false);
  await page.evaluate(() => window.ssPersistNow());
  expect(await keys(page)).toEqual(['draft:guest']);
  // hammasini o'chirdi (boshlang'ich holatga qaytdi) -> qoralama ham o'chadi
  await page.evaluate(() => { canvas.getObjects().filter((o) => o.text === 'Mening slaydim').forEach((o) => canvas.remove(o)); saveCurrentSlideState(); });
  await page.evaluate(() => window.ssPersistNow());
  expect(await keys(page)).toEqual([]);
});

test('AI\'ga YUBORILGAN matn qayta yuklashdan keyin maydonda qolmaydi; yuborilmagani qoladi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; window.ensureValidToken = async () => true;
    window.clientAiSearch = function (req) { socket.send(JSON.stringify({ type: 'search_result', id: req.id, results: [] })); };
    toggleAISidebar(true); });
  await page.waitForFunction(() => socket && socket.readyState === 1);
  await page.fill('#aiSidebarInput', 'Kosmos haqida savol');
  expect(await page.evaluate(() => JSON.parse(ssPref.get('draft')).v)).toBe('Kosmos haqida savol');
  await page.evaluate(() => sendSidebarAiPrompt());
  await expect.poll(() => page.evaluate(() => ssPref.get('draft'))).toBeNull();
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
  await page.reload();
  await page.waitForFunction(() => typeof canvas !== 'undefined' && canvas && slides.length > 0);
  await page.waitForTimeout(800);
  expect(await page.inputValue('#aiSidebarInput')).toBe('');
  // yozilgan, lekin yuborilmagan matn (masalan Google'ga kirish uchun sahifa yangilandi) — qaytadi
  await page.fill('#aiSidebarInput', 'Yuborilmagan mavzu');
  await page.reload();
  await page.waitForFunction(() => typeof canvas !== 'undefined' && canvas && slides.length > 0);
  await page.waitForTimeout(800);
  expect(await page.inputValue('#aiSidebarInput')).toBe('Yuborilmagan mavzu');
});

test('tegilmagan mehmon slaydi Google bilan kirishda olib o\'tilmaydi (akkaunt ishini bosib ketmaydi)', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const st = window.__ssAuthStorage;
    const ok = window.ssStashGuestDeck();
    const pristine = st.getItem('ss-auth-v39-guest');
    canvas.add(new fabric.Textbox('Mehmon ishi', { left: 100, top: 100, width: 300 })); saveCurrentSlideState();
    window.ssStashGuestDeck();
    const real = st.getItem('ss-auth-v39-guest');
    window.ssDropGuestDeck();
    return { ok, pristine, real: !!real && real.includes('Mehmon ishi') };
  });
  expect(r.ok).toBe(true);
  expect(r.pristine).toBeNull();
  expect(r.real).toBe(true);
});
