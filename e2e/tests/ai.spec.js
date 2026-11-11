// AI slayd yaratish oqimi — soxta AI server bilan (e2e/fake_ai_server.py): Tez va Pro AI, rasm qidiruvi,
// xabarni tahrirlab qayta yuborish, «Qayta yaratish», yuklanish effektlari.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test.describe.configure({ mode: 'serial' });

async function login(page, model = 'fast') {
  await page.evaluate((m) => {
    supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz';
    window.ensureValidToken = async () => true;
    // brauzer qidiruvi (tashqi saytlar) o'rniga server qidiruvi ishlatilsin
    window.clientAiSearch = function (req) { socket.send(JSON.stringify({ type: 'search_result', id: req.id, results: [] })); };
    window.__toasts = [];
    const o = window.showToast; window.showToast = function (msg, k) { window.__toasts.push(String(msg)); return o && o.apply(this, arguments); };
    document.getElementById('aiModelSelect').value = m;
    toggleAISidebar(true);
  }, model);
  await page.waitForFunction(() => socket && socket.readyState === 1);
}

async function ask(page, text) {
  await page.fill('#aiSidebarInput', text);
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => isAiStreaming, null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
}

const deck = (page) => page.evaluate(() => slides.map((s) => (JSON.parse(s.json || '{}').objects || []).map((o) => o.type)));

for (const model of ['fast', 'deep']) {
  test(`${model}: 4 ta slayd + 4 ta rasm — hammasi joyida, xato yo'q`, async ({ page }) => {
    const errors = await openEditor(page);
    await login(page, model);
    await ask(page, 'Kosmos haqida 4 ta slayd yarat, 4 ta rasm bilan');
    const d = await deck(page);
    expect(d.length).toBe(4);
    for (const s of d) expect(s).toContain('image');
    expect(errors).toEqual([]);
    const toasts = await page.evaluate(() => window.__toasts.join(' | '));
    expect(toasts).not.toMatch(/so'ralgan|xato|Xatolik/i);          // «3/5 yaratildi» kabi noto'g'ri ogohlantirish yo'q
  });
}

test('xabarni tahrirlab qayta yuborish: eski natija ustiga qo\'shilmaydi', async ({ page }) => {
  await openEditor(page);
  await login(page);
  await ask(page, 'Kosmos haqida 4 ta slayd yarat, 4 ta rasm bilan');
  expect((await deck(page)).length).toBe(4);
  await page.evaluate(() => {
    const u = [...document.querySelectorAll('#aiChatBody .ai-msg')].filter((m) => m.dataset.sender === 'user').pop();
    editUserMessage(u);
  });
  await page.fill('.ai-edit-input', 'Okean haqida 3 ta slayd yarat, 3 ta rasm bilan');
  await page.click('.ai-edit-save');
  await page.waitForFunction(() => isAiStreaming, null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const d = await deck(page);
  expect(d.length).toBe(3);
  for (const s of d) expect(s).toContain('image');
  const users = await page.$$eval('#aiChatBody .ai-msg', (els) => els.filter((m) => m.dataset.sender === 'user').map((m) => m.innerText));
  expect(users.length).toBe(1);
  expect(users[0]).toContain('Okean');
});

test('«Qayta yaratish»: slaydlar ikkilanmaydi', async ({ page }) => {
  await openEditor(page);
  await login(page);
  await ask(page, 'Kosmos haqida 4 ta slayd yarat, 4 ta rasm bilan');
  expect((await deck(page)).length).toBe(4);
  await page.evaluate(() => regenerateLastResponse());
  await page.waitForFunction(() => isAiStreaming, null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  expect((await deck(page)).length).toBe(4);
});

test('rasm qidiruvi natijalari birma-bir chiqadi, slayd yaratilayotganda skelet ko\'rinadi', async ({ page }) => {
  await openEditor(page);
  await login(page);
  await page.fill('#aiSidebarInput', 'sekin: 5 ta slayd yarat, 5 ta rasm bilan');
  await page.evaluate(() => sendSidebarAiPrompt());
  const okCounts = [];
  let sawSkeleton = false, sawBuilding = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const st = await page.evaluate(() => ({
      ok: document.querySelectorAll('.ai-search-row.ok, .ai-search-row.none').length,
      skel: !!document.getElementById('ssSlideSkel'),
      building: document.body.classList.contains('ss-ai-building'),
      streaming: isAiStreaming,
    }));
    okCounts.push(st.ok);
    sawSkeleton = sawSkeleton || st.skel;
    sawBuilding = sawBuilding || st.building;
    if (!st.streaming && Date.now() - t0 > 2000) break;
    await page.waitForTimeout(150);
  }
  const distinct = [...new Set(okCounts)].filter((n) => n > 0 && n < 5);
  expect(distinct.length).toBeGreaterThanOrEqual(2);              // hammasi bir zumda emas — oraliq holatlar bo'lgan
  expect(sawSkeleton).toBe(true);
  expect(sawBuilding).toBe(true);
  expect(await page.evaluate(() => document.getElementById('ssSlideSkel'))).toBeNull();   // tugagach yo'qoladi
  expect((await deck(page)).length).toBe(5);
});
