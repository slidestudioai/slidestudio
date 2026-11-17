// v68: Dizayn → Mavzular (PowerPoint kabi), telefon yuqori paneli surilishi, slayd zoom tugmalari ostida qolmasligi
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('Dizayn menyusi «Mavzular» bilan ochiladi: 30+ mavzu, har biri o\'z fon va bezagi bilan', async ({ page }) => {
  await openEditor(page);
  await page.locator('#ssKitBtn').click();
  const menu = page.locator('#ssKitMenu.open');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-tab="themes"].on')).toHaveCount(1);
  const n = await menu.locator('[data-theme]').count();
  expect(n).toBeGreaterThanOrEqual(30);
  const uniq = await page.evaluate(() => {
    const T = SS_THEMES.THEMES;
    return { bgs: new Set(Object.values(T).map((t) => t.bg + t.decor + t.a1)).size, n: Object.keys(T).length,
      decorsOk: Object.values(T).every((t) => SS_THEMES.DECOR[t.decor]) };
  });
  expect(uniq.bgs).toBe(uniq.n);                    // hammasi har xil (bir xil dizaynning nusxasi emas)
  expect(uniq.decorsOk).toBe(true);
  await expect(menu.locator('img[data-tprev]').first()).toHaveAttribute('src', /^data:image\/png/, { timeout: 15_000 });
  // «Fon» bo'limida ham ko'p fon turi
  await menu.locator('[data-tab="backgrounds"]').click();
  expect(await menu.locator('[data-item^="bg_"]').count()).toBeGreaterThanOrEqual(20);
});

test('mavzu HAMMA slaydlarga qo\'llanadi, matn rangi o\'zgaradi, bezak tanlanmaydi, yangi slayd ham mavzuni oladi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const w = (ms) => new Promise((r) => setTimeout(r, ms));
    addSlide('title_body'); await w(400); addSlide('title'); await w(400);
    await switchSlide(0); await w(400);
  });
  await page.locator('#ssKitBtn').click();
  const menu = page.locator('#ssKitMenu.open');
  await menu.locator('[data-scope="all"]').click();
  await menu.locator('[data-theme="midnight"]').click();
  await expect.poll(() => page.evaluate(() => slides.every((s) => JSON.parse(s.json).background === '#0B1020')), { timeout: 15_000 }).toBe(true);
  const r = await page.evaluate(() => slides.map((s) => {
    const j = JSON.parse(s.json);
    return { decor: j.objects.filter((o) => o.ssRole === 'bgdecor' && o.ssKitItem === 'theme_midnight').length,
      texts: j.objects.filter((o) => o.type === 'textbox').map((o) => o.fill) };
  }));
  for (const s of r) {
    expect(s.decor).toBeGreaterThan(0);
    for (const f of s.texts) expect(['#F8FAFC', '#CBD5E1']).toContain(f);   // to'q fonda och rangli matn
  }
  const locked = await page.evaluate(() => canvas.getObjects().filter((o) => o.ssRole === 'bgdecor').every((o) => o.selectable === false && o.evented === false));
  expect(locked).toBe(true);
  // «Faqat shu slaydga» — boshqa slaydlar o'zgarmaydi
  await page.evaluate(() => SS_THEMES.apply('leaf', 'one'));
  const bgs = await page.evaluate(() => slides.map((s) => JSON.parse(s.json).background));
  expect(bgs.filter((b) => b === '#F3F8F2')).toHaveLength(1);
  // yangi slayd joriy mavzuni oladi
  await page.evaluate(() => addSlide('title_body'));
  await expect.poll(() => page.evaluate(() => JSON.parse(slides[slides.length - 1].json).background), { timeout: 10_000 }).toBe('#F3F8F2');
});

test('kartochka ustidagi matn rangi mavzu bilan buzilmaydi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    canvas.clear(); canvas.setBackgroundColor('#ffffff');
    canvas.add(new fabric.Rect({ left: 100, top: 100, width: 400, height: 200, fill: '#ffffff' }));
    canvas.add(new fabric.Textbox('Karta ichida', { left: 120, top: 150, width: 300, fontSize: 20, fill: '#111111' }));
    canvas.add(new fabric.Textbox('Fonda', { left: 600, top: 400, width: 300, fontSize: 20, fill: '#111111' }));
    await SS_THEMES.apply('berlin', 'one');
  });
  const f = await page.evaluate(() => canvas.getObjects().filter((o) => o.type === 'textbox').map((o) => [o.text, o.fill]));
  expect(f).toEqual([['Karta ichida', '#111111'], ['Fonda', '#E0E0E0']]);
});

test('kompyuter: slayd o\'ngdagi zoom tugmalari ostida qolmaydi (AI panel ochiq, toolbar yopiq)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openEditor(page);
  await page.evaluate(() => toggleRibbonToolbar(false));
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const c = document.getElementById('canvasCard').getBoundingClientRect();
    const z = document.getElementById('mobileZoomCtl').getBoundingClientRect();
    return { cardRight: c.right, zoomLeft: z.left };
  });
  expect(r.cardRight).toBeLessThanOrEqual(r.zoomLeft);
});

test.describe('telefon', () => {
  test.use({ viewport: { width: 340, height: 720 }, isMobile: true, hasTouch: true });
  test('yuqori panel sig\'masa suriladi va oxirgi tugma (Namoyish) ko\'rinadi', async ({ page }) => {
    await openEditor(page);
    const r = await page.evaluate(async () => {
      document.body.classList.remove('ss-auth-out'); document.body.classList.add('ss-auth-in');
      const q = document.getElementById('ssQuota'); q.style.cssText = 'display:inline-flex!important;width:90px';
      await new Promise((res) => setTimeout(res, 300));
      const bar = document.querySelector('.header-actions');
      bar.style.scrollBehavior = 'auto';
      const before = document.querySelector('.btn-slideshow').getBoundingClientRect().right;
      bar.scrollLeft = 10000;
      await new Promise((res) => setTimeout(res, 300));
      const after = document.querySelector('.btn-slideshow').getBoundingClientRect().right;
      return { overflowX: getComputedStyle(bar).overflowX, before, after, vw: innerWidth, cls: bar.className };
    });
    expect(r.overflowX).toBe('auto');
    expect(r.before).toBeGreaterThan(r.vw);           // avval ekrandan tashqarida
    expect(r.after).toBeLessThanOrEqual(r.vw);        // surilgach ko'rinadi
    expect(r.cls).toContain('ss-more-left');
  });
});

test('boshqa varaqqa o\'tib, keyin yangi varaq qo\'shilsa — yangi varaqdagi o\'zgarish saqlanadi (avval yo\'qolardi)', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise((res) => setTimeout(res, ms));
    addSlide('title_body'); await w(400);
    await switchSlide(0); await w(400);
    addSlide('title_body'); await w(400);
    canvas.add(new fabric.Textbox('YANGI_VARAQ_MATNI', { left: 100, top: 300, width: 300 }));
    saveCurrentSlideState();
    return { n: slides.length, saved: slides[slides.length - 1].json.includes('YANGI_VARAQ_MATNI') };
  });
  expect(r).toEqual({ n: 3, saved: true });
});

test('mavzuli slayd PPTX ga haqiqiy shakllar (rasm emas) bilan chiqadi', async ({ page }) => {
  const fs = require('fs');
  await openEditor(page);
  for (const id of ['slice', 'wave_bottom', 'rings', 'stars']) {
    const themeId = { slice: 'slice', wave_bottom: 'ocean', rings: 'gallery', stars: 'space' }[id];
    await page.evaluate((t) => SS_THEMES.apply(t, 'one'), themeId);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.evaluate(() => window.exportPPTX())]);
    const b64 = fs.readFileSync(await dl.path()).toString('base64');
    const xml = await page.evaluate(async (b) => {
      const zip = await JSZip.loadAsync(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
      return zip.file('ppt/slides/slide1.xml').async('string');
    }, b64);
    const bg = await page.evaluate((t) => SS_THEMES.THEMES[t].bg.slice(1).toUpperCase(), themeId);
    expect(xml.toUpperCase()).toContain(bg);                      // fon rangi
    expect((xml.match(/<p:sp>/g) || []).length).toBeGreaterThanOrEqual(3);   // bezak — tahrirlanadigan shakllar
  }
});
