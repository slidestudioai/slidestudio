// v71: krossvord — joylash algoritmi, AI elementi, mavzu ranglari, PPTX eksport, «Qo'shish → Krossvord» oynasi
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { openEditor } = require('./helpers');

const WORDS = [
  { answer: 'GERAKL', clue: "Yunon mifologiyasida 12 ta jasorat ko'rsatgan yarim xudo" },
  { answer: 'ANUBIS', clue: "Misr mifologiyasida chiyabo'ri boshli marhumlar xudosi" },
  { answer: 'HUMO', clue: 'Baxt va omad keltiruvchi afsonaviy qush' },
  { answer: 'LOKI', clue: 'Skandinaviya mifologiyasida ayyorlik xudosi' },
  { answer: 'KITSUNE', clue: "Yapon mifologiyasidagi to'qqiz dumli sehrli tulki" },
  { answer: 'KASHSHEY', clue: "Slavyan mifologiyasida o'limi igna uchida yashiringan sehrgar" },
  { answer: "O'G'UZXON", clue: 'Turkiy xalqlar afsonaviy hukmdori' },
];

async function aiDeck(page) {
  await page.evaluate(async (w) => {
    await executeAiCommands({ actions: [
      { action: 'replace_slide', slide: 1, background: '#FFFFFF', elements: [
        { type: 'text', text: 'Dunyo miflari: krossvord', left: 48, top: 36, width: 864, height: 52, fontSize: 36, fontWeight: 'bold', fill: '#1B2A41' },
        { type: 'crossword', words: w, left: 48, top: 110, width: 864, height: 390 }] },
      { action: 'insert_slide', after: 1, background: '#FFFFFF', elements: [
        { type: 'text', text: 'Javoblar', left: 48, top: 36, width: 864, height: 52, fontSize: 36, fontWeight: 'bold', fill: '#1B2A41' },
        { type: 'crossword', words: w, showAnswers: true, showClues: false, left: 130, top: 104, width: 700, height: 400 }] },
    ] });
  }, WORDS);
  await page.waitForTimeout(800);
}

test('joylash: hamma so\'z kesishadi, Oʻ/Gʻ bitta katak, raqamlar to\'g\'ri', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate((w) => {
    const L = SS_CROSSWORD.layout(w);
    const at = {}; L.cells.forEach((c) => { at[c.r + ',' + c.c] = c; });
    const ok = L.words.every((x) => {
      const t = SS_CROSSWORD.tokens(x.answer);
      return t.every((ch, k) => { const c = at[(x.row + (x.dir === 'down' ? k : 0)) + ',' + (x.col + (x.dir === 'across' ? k : 0))]; return c && c.ch === ch; })
        && at[x.row + ',' + x.col].n === x.num;
    });
    return { placed: L.words.length, unplaced: L.unplaced, ok, oguz: SS_CROSSWORD.tokens("O'G'UZXON").length, nums: L.words.map((x) => x.num) };
  }, WORDS);
  expect(r.unplaced).toEqual([]);
  expect(r.placed).toBe(7);
  expect(r.ok).toBe(true);
  expect(r.oguz).toBe(7);
  expect(r.nums).toEqual([...r.nums].sort((a, b) => a - b));
});

test('AI: {"type":"crossword"} — to\'r bitta guruh, savollar tahrirlanadigan matn, javoblar slaydi, saqlanadi', async ({ page }) => {
  await openEditor(page);
  await aiDeck(page);
  const s1 = await page.evaluate(async () => {
    await switchSlide(0);
    const objs = canvas.getObjects().filter((o) => o.ssKitItem === 'crossword');
    const g = objs.find((o) => o.ssRole === 'cw_grid');
    return { roles: objs.map((o) => o.ssRole), cells: g.getObjects().filter((k) => k.ssRole === 'cw_cell').length,
      letters: g.getObjects().filter((k) => k.ssRole === 'cw_letter').length, clue: objs.filter((o) => o.ssRole === 'cw_clue').map((o) => o.type),
      data: JSON.parse(g.cwData).words.length };
  });
  expect(s1.roles.filter((r) => r === 'cw_grid')).toHaveLength(1);
  expect(s1.clue).toEqual(['textbox', 'textbox']);
  expect(s1.cells).toBeGreaterThan(30);
  expect(s1.letters).toBe(0);
  expect(s1.data).toBe(7);
  const s2 = await page.evaluate(async () => {
    await switchSlide(1);
    const g = canvas.getObjects().find((o) => o.ssRole === 'cw_grid');
    return { letters: g.getObjects().filter((k) => k.ssRole === 'cw_letter').map((k) => k.text).join(''), clues: canvas.getObjects().filter((o) => o.ssRole === 'cw_clue').length };
  });
  expect(s2.letters.length).toBeGreaterThan(30);
  expect(s2.letters).toContain('O‘');
  expect(s2.clues).toBe(0);
  // AI keyingi so'rovda krossvordni element sifatida ko'radi
  const map = await page.evaluate(() => extractDeckStateMap()[0].objects.filter((o) => o.type === 'crossword' || o.partOf));
  expect(map.find((o) => o.type === 'crossword').words[0]).toHaveProperty('answer');
  expect(map.filter((o) => o.partOf === 'crossword').length).toBe(4);
});

test('mavzu almashsa krossvord ranglari ham moslashadi (ochiq va boshqa slaydda)', async ({ page }) => {
  await openEditor(page);
  await aiDeck(page);
  await page.evaluate(() => switchSlide(0));
  await page.waitForTimeout(400);
  await page.evaluate(() => SS_THEMES.aiSetTheme({ theme: 'midnight', target: 'all' }));
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const T = SS_THEMES.THEMES.midnight;
    const head = canvas.getObjects().find((o) => o.ssRole === 'cw_head');
    const j = JSON.parse(slides[1].json);
    const g = j.objects.find((o) => o.ssRole === 'cw_grid');
    const cell = g.objects.find((o) => o.ssRole === 'cw_cell');
    return { head: head.fill, a1: T.a1, cellStroke: cell.stroke };
  });
  expect(r.head).toBe(r.a1);
  expect(r.cellStroke).toBe(r.a1);
});

test('PPTX: krossvord PowerPoint\'da oddiy shakllar va matn (rasm emas)', async ({ page }) => {
  await openEditor(page);
  await aiDeck(page);
  await page.evaluate(() => { slides.splice(0, 1); return switchSlide(0); });   // javoblar slaydi 1-o'rinda
  await page.waitForTimeout(500);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.evaluate(() => window.exportPPTX())]);
  const b64 = fs.readFileSync(await dl.path()).toString('base64');
  const xml = await page.evaluate(async (b) => {
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    return zip.file('ppt/slides/slide1.xml').async('string');
  }, b64);
  expect(xml).not.toContain('<p:pic>');
  const rects = (xml.match(/prst="rect"/g) || []).length;
  expect(rects).toBeGreaterThan(30);
  expect(xml).toContain('>K<');
  expect(xml).toContain('>O‘<');
});

test('«Qo\'shish → Krossvord» oynasi: namuna, slaydga qo\'shish, javoblar slaydi, qayta tahrirlash', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { try { SSI18n.set('uz'); } catch (e) {} });
  await page.locator('.top-menu-item', { hasText: "Qo'shish" }).first().click();
  await page.locator('#insertMenu div', { hasText: 'Krossvord' }).click();
  await expect(page.locator('#ssCw')).toBeVisible();
  await page.click('#cwSample');
  await expect(page.locator('#cwPv svg rect').first()).toBeVisible();
  await expect(page.locator('#cwNote')).toContainText("ta so'z");
  const before = await page.evaluate(() => slides.length);
  await page.click('#cwOk');
  await expect(page.locator('#ssCw')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => slides.length)).toBe(before + 1);
  // javoblar slaydida harflar bor
  await expect.poll(() => page.evaluate(() => { const g = canvas.getObjects().find((o) => o.ssRole === 'cw_grid'); return !!g && g.getObjects().some((k) => k.ssRole === 'cw_letter'); })).toBe(true);
  await page.waitForTimeout(500);
  // birinchi slaydga qaytib, krossvordni tanlab qayta ochish
  await page.evaluate(async () => { await switchSlide(0); const g = canvas.getObjects().find((o) => o.ssRole === 'cw_grid'); canvas.setActiveObject(g); openCrosswordDialog(); });
  await expect(page.locator('#ssCw .cwh b')).toHaveText('Krossvordni tahrirlash');
  await expect(page.locator('#ssCw .a').first()).not.toHaveValue('');
  await page.locator('#ssCw .q').first().fill('Yangi savol matni');
  await page.click('#cwOk');
  await expect.poll(() => page.evaluate(() => canvas.getObjects().filter((o) => o.ssRole === 'cw_clue').map((o) => o.text).join('\n'))).toContain('Yangi savol matni');
  expect(await page.evaluate(() => canvas.getObjects().filter((o) => o.ssRole === 'cw_grid').length)).toBe(1);   // eskisi almashtirildi
});
