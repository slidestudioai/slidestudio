// v61: ogohlantirish bosishni to'smaydi, AI «Bekor qilish» → «Qaytarish», Telegram ulangan bo'lsa «Uzish»
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('xato ogohlantirishidan keyin AI yozish joyi va tugma bosiladi (o\'ngda ikkinchi oyna yo\'q)', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { toggleAISidebar(true); showToast('Ulanish uzildi. Qayta ulanmoqda.', 'error'); });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => { const p = document.getElementById('errorPopup'); return !!(p && p.classList.contains('show')); })).toBe(false);
  for (const sel of ['#aiSidebarInput', '#btnSidebarAi']) {
    const hit = await page.evaluate((sel) => {
      const el = document.querySelector(sel); const r = el.getBoundingClientRect();
      return [0.25, 0.5, 0.75].every((fy) => { const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height * fy); return t === el || el.contains(t); });
    }, sel);
    expect(hit).toBe(true);
  }
});

test('AI «Bekor qilish» dan keyin «Qaytarish» AI natijasini qaytaradi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; window.ensureValidToken = async () => true;
    window.clientAiSearch = function (req) { socket.send(JSON.stringify({ type: 'search_result', id: req.id, results: [] })); };
    toggleAISidebar(true); });
  await page.waitForFunction(() => socket && socket.readyState === 1);
  await page.fill('#aiSidebarInput', '3 ta slayd yarat');
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => isAiStreaming, null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => slides.length)).toBe(3);
  await page.locator('.ai-undo-btn').last().click();
  await expect.poll(() => page.evaluate(() => slides.length)).toBe(1);
  const redo = page.locator('.ai-redo-btn').last();
  await expect(redo).toBeVisible();
  await redo.click();
  await expect.poll(() => page.evaluate(() => slides.length)).toBe(3);
  await expect(page.locator('.ai-undo-btn').last()).toBeVisible();          // yana bekor qilish mumkin
});

test('v81: saytda «Telegram botni ulash» / «Uzish» yo\'q (yagona yo\'l — botdagi «Google akkauntni ulash»)', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; });
  expect(await page.evaluate(() => [typeof window.ssTgLink, typeof window.ssTgDecorate, typeof window.ssGoogleLink])).toEqual(['undefined', 'undefined', 'undefined']);
  expect(await page.locator('[data-tg-link], [data-google-link]').count()).toBe(0);
});
