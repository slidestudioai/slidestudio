// v83: (1) hello / thanks / «what can you do» are answered on the page itself — no AI call, no balance, no sign-in;
//      repeated greetings get a different, livelier answer each time; a real topic still goes to the AI.
//      (2) Deep AI is locked for a free user: the select shows 🔒, switches back to Fast and explains why.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('small talk is answered without the AI, topics still go to the AI', async ({ page }) => {
  await openEditor(page);
  await page.waitForFunction(() => window.SSSmallTalk && window.SSSmallTalk.classify('salom'));
  await page.evaluate(() => { toggleAISidebar(true); window.__sent = []; const ws = window.socket;
    if (ws) { const o = ws.send.bind(ws); ws.send = (d) => { window.__sent.push(d); return o(d); }; } });
  const botTexts = () => page.$$eval('#aiChatBody .ai-msg.bot .msg-text', (els) => els.map((e) => e.innerText.trim()));
  const ask = async (t) => {
    await page.fill('#aiSidebarInput', t);
    // v83: the answer is streamed like the AI: «💭 ...» first, then it grows piece by piece
    const seen = await page.evaluate(() => new Promise((res) => {
      sendSidebarAiPrompt();
      const els = document.querySelectorAll('#aiChatBody .ai-msg.bot .msg-text');
      const span = els[els.length - 1], lens = new Set([span.innerText]);
      const t = setInterval(() => { lens.add(span.innerText); if (!window.SSSmallTalk.busy()) { clearInterval(t); res(Array.from(lens)); } }, 10);
    }));
    expect(['', '💭 ...']).toContain(seen[0]);                              // the same «thinking» start as the AI
    expect(seen.length).toBeGreaterThan(4);                               // then it grew in several steps
  };

  await ask('salom');
  await ask('slm');
  await ask('privt');
  await ask('sen nima qila olasan?');
  const t = await botTexts();
  const last4 = t.slice(-4);
  expect(last4[0]).toMatch(/Salom|Привет|Hello/);
  expect(new Set(last4.slice(0, 3)).size).toBe(3);                      // never the same answer
  expect(last4.join('')).not.toContain('💭');
  expect(last4[3]).toContain('PPTX');
  expect(await page.evaluate(() => window.__sent.length)).toBe(0);        // nothing went to the server / AI
  expect(await page.inputValue('#aiSidebarInput')).toBe('');
  // a guest who writes a real topic is asked to sign in as before (it is NOT answered locally)
  await page.fill('#aiSidebarInput', 'Salom, kosmos haqida 5 ta slayd');
  const before = (await botTexts()).length;
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForTimeout(400);
  expect((await botTexts()).length).toBe(before);
});

test('Deep AI is locked for a free user (🔒, back to Fast, explanation)', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    supabaseToken = 'devtok'; currentUserEmail = 'free@e2e.uz';
    Monitoring.applyServerUsage({ free_credits: 200, paid_credits: 0, deep_allowed: false, deep_min_paid_pages: 10, unlimited: false });
    toggleAISidebar(true);
  });
  await expect.poll(() => page.$eval('#aiModelSelect option[value="deep"]', (o) => o.textContent)).toContain('🔒');
  await page.selectOption('#aiModelSelect', 'deep');
  await expect(page.locator('.swal2-popup')).toContainText('10');
  expect(await page.inputValue('#aiModelSelect')).toBe('fast');
  // a paid user above the limit: the lock is gone
  await page.evaluate(() => { Swal.close(); Monitoring.applyServerUsage({ free_credits: 0, paid_credits: 400, deep_allowed: true, deep_min_paid_pages: 10 }); });
  await expect.poll(() => page.$eval('#aiModelSelect option[value="deep"]', (o) => o.textContent)).not.toContain('🔒');
  await page.selectOption('#aiModelSelect', 'deep');
  expect(await page.inputValue('#aiModelSelect')).toBe('deep');
});

test('«ℹ️ Yordam / Imkoniyatlar» in the header opens the guide (same text as the bot)', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#ssHelpBtn')).toBeVisible();
  await page.click('#ssHelpBtn');
  const pop = page.locator('.swal2-popup');
  await expect(pop).toContainText('3');
  await expect(pop).toContainText('PPTX');
  await expect(pop.locator('.ss-guide li')).toHaveCount(9);             // 5 features + 4 steps
});
