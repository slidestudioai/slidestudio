// v69 QA review: table resize, duplicate / delete slide keep the latest edits, English UI has no Uzbek leftovers
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

// page (x, y) of a fabric object's control corner, e.g. 'br'
async function cornerXY(page, corner) {
  return page.evaluate((corner) => {
    const o = canvas.getActiveObject(); o.setCoords();
    const el = canvas.upperCanvasEl.getBoundingClientRect();
    const k = el.width / canvas.getWidth();
    const p = o.oCoords[corner];
    return { x: el.left + p.x * k, y: el.top + p.y * k };
  }, corner);
}

test('jadvalni burchakdan kattalashtirish: ichidagi kataklar ham kattalashadi (ramka bo\'sh qolmaydi)', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const t = ssBuildTable({ rows: [['A', 'B'], ['1', '2'], ['3', '4']], left: 80, top: 80, width: 300 });
    canvas.add(t); canvas.setActiveObject(t); canvas.requestRenderAll();
  });
  const a = await cornerXY(page, 'br');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 80, a.y + 40, { steps: 8 });
  await page.mouse.move(a.x + 160, a.y + 60, { steps: 8 });
  await page.mouse.up();
  const r = await page.evaluate(() => {
    const t = canvas.getActiveObject();
    const box = t.getBoundingRect(true, true);
    // the cells (children) must fill the selection box: compare the box with the union of child rects
    const m = t.calcTransformMatrix();
    let minX = 1e9, maxX = -1e9;
    t.getObjects().forEach((c) => {
      const p1 = fabric.util.transformPoint({ x: c.left, y: c.top }, m);
      const p2 = fabric.util.transformPoint({ x: c.left + c.width, y: c.top + c.height }, m);
      minX = Math.min(minX, p1.x, p2.x); maxX = Math.max(maxX, p1.x, p2.x);
    });
    return { boxW: box.width, kidsW: maxX - minX, scaleX: t.scaleX };
  });
  expect(r.boxW).toBeGreaterThan(350);                    // it really got bigger
  expect(Math.abs(r.kidsW - r.boxW)).toBeLessThan(8);     // and the table fills its box (before: cells stayed 300 px)
});

test('slaydni o\'zgartirib DARHOL nusxalash: nusxada ham, asl slaydda ham oxirgi o\'zgarish bor', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    canvas.add(new fabric.Rect({ left: 40, top: 40, width: 60, height: 60, fill: '#ff0000' })); canvas.requestRenderAll();
  });
  await page.locator('#sidebar [data-idx]').first().click({ button: 'right' });
  await page.locator('#slideContextMenu .context-menu-item').first().click();   // Duplicate
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({ n: slides.length, active: activeIndex,
    s0: String(slides[0].json).includes('#ff0000'), s1: String(slides[1].json).includes('#ff0000'),
    onCanvas: canvas.getObjects().some((o) => o.fill === '#ff0000') }));
  expect(r).toEqual({ n: 2, active: 1, s0: true, s1: true, onCanvas: true });
});

test('boshqa slaydni o\'chirish: ochiq slayd o\'zgarmaydi va undagi oxirgi o\'zgarish yo\'qolmaydi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const w = (ms) => new Promise((r) => setTimeout(r, ms));
    addSlide(); await w(400); addSlide(); await w(600);        // 3 slides, the 3rd is open
    canvas.add(new fabric.Rect({ left: 300, top: 40, width: 60, height: 60, fill: '#0000ff', ssMark: 'third' })); canvas.requestRenderAll();
  });
  await page.locator('#sidebar [data-idx]').first().click({ button: 'right' });
  await page.locator('#slideContextMenu .context-menu-item').nth(1).click();     // Delete slide 1
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({ n: slides.length, active: activeIndex,
    blue: canvas.getObjects().some((o) => o.fill === '#0000ff') }));
  expect(r).toEqual({ n: 2, active: 1, blue: true });
});

test('ingliz tilida jadval paneli va animatsiya nomlari tarjima qilingan', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ss-lang', 'en'); } catch (e) {} });
  await openEditor(page);
  const r = await page.evaluate(() => {
    const miss = [];
    ['Katak foni', 'Zebra rangi', 'Chegara rangi', 'Shrift:', 'Ranglarni tiklash', 'Tanlangan katak (2-qator, 3-ustun)',
      'Chiziq va ulagichlar (18)', 'To\'lov yakunlanmadi. Qaytadan urinib ko\'ring.',
      '«tabiat» — 6 ta natija topildi, eng mosi tanlanmoqda', 'Internetdan rasm qidirilmoqda: «tabiat»…', '3 ta qidiruv', '−4.6 varaq'].forEach((s) => { if (SSI18n.t(s) === s) miss.push(s); });
    SS_FX.list.forEach((e) => { if (SSI18n.t(e[2]) === e[2]) miss.push(e[2]); });
    return miss;
  });
  expect(r).toEqual([]);
});
