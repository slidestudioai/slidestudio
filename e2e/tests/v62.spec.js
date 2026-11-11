// v62: PPTX animatsiyalari (shakllar ham), shakl nomi AI holatida, ro'yxatlarda qo'l kursori, «O'ylab bo'ldi» yozuvi
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

async function buildDeck(page) {
  await page.evaluate(async () => {
    await executeAiCommands({ actions: [
      { action: 'replace_slide', slide: 1, background: '#0F172A', elements: [
        { type: 'rect', left: 40, top: 140, width: 428, height: 300, fill: '#1E293B', rx: 16, ry: 16, animation: 'zoomIn' },
        { type: 'text', text: 'Sarlavha', left: 40, top: 40, width: 880, height: 52, fontSize: 40, fill: '#F8FAFC', animation: 'fadeInDown' },
        { type: 'shape', shape: 'star5', left: 600, top: 200, width: 120, height: 120, fill: '#F59E0B', animation: 'pulse' },
      ] },
      { action: 'insert_slide', after: 1, background: '#0F172A', elements: [
        { type: 'text', text: 'Ikkinchi', left: 40, top: 40, width: 880, height: 52, fontSize: 40, fill: '#F8FAFC', animation: 'slideInLeft' },
      ] },
      { action: 'set_transition', target: 'all', transition: 'zoom' },
    ] });
  });
}

test('PPTX: har bir animatsiya (shakl ham) PowerPoint effektiga, o\'tish <p:transition> ga yoziladi; ogohlantirish chiqadi', async ({ page }) => {
  await openEditor(page);
  await buildDeck(page);
  const shape = await page.evaluate(() => JSON.parse(slides[0].json).objects.find((o) => o.shapeType === 'star5'));
  expect(shape && shape.animName).toBe('pulse');                                   // AI shakliga animatsiya qo'yildi
  expect(await page.evaluate(() => extractDeckStateMap()[0].objects.some((o) => o.shape === 'star5'))).toBe(true);
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(() => exportPPTX());
  const d = await dl;
  const bytes = require('fs').readFileSync(await d.path()).toString('base64');
  const info = await page.evaluate(async (b64) => {
    const zip = await JSZip.loadAsync(b64, { base64: true });
    const out = [];
    for (const n of ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']) {
      const x = await zip.file(n).async('string');
      const names = [...x.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)].map((m) => m[1]);
      const targets = [...x.matchAll(/spTgt spid="(\d+)"/g)].map((m) => m[1]);
      out.push({ effects: (x.match(/presetClass="(entr|emph|exit)"/g) || []).length, targetsOk: targets.every((t) => names.includes(t)),
        trBeforeTiming: x.indexOf('<p:transition') > 0 && x.indexOf('<p:transition') < x.indexOf('<p:timing') });
    }
    return out;
  }, bytes);
  expect(info[0]).toEqual({ effects: 3, targetsOk: true, trBeforeTiming: true });
  expect(info[1]).toEqual({ effects: 1, targetsOk: true, trBeforeTiming: true });
  await expect(page.locator('.swal2-popup', { hasText: 'Google Slides' })).toBeVisible();
});

test('ochiladigan ro\'yxatlar (AI rejimi, shrift) ustida qo\'l kursori', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => toggleAISidebar(true));
  const c = await page.evaluate(() => ['#aiModelSelect', '#fontFamily'].map((s) => document.querySelector(s) && getComputedStyle(document.querySelector(s)).cursor));
  expect(c).toEqual(['pointer', 'pointer']);
});

test('Chuqur AI: javob tugagach «javob yozilmoqda» qolib ketmaydi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; window.ensureValidToken = async () => true;
    document.getElementById('aiModelSelect').value = 'deep'; toggleAISidebar(true); });
  await page.waitForFunction(() => socket && socket.readyState === 1);
  await page.fill('#aiSidebarInput', '2 ta slayd yarat');
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => isAiStreaming, null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
  const rows = await page.$$eval('.ai-search-row.thinking .asr-text', (r) => r.map((x) => x.textContent));
  expect(rows.length).toBeGreaterThan(0);
  for (const t of rows) expect(t).not.toMatch(/yozilmoqda/);
});
