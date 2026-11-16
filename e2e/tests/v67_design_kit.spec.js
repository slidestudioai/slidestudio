// v67: dizayn to'plami (kartochka / ramka / stiker / fon) va Fabric.js ⇄ PowerPoint 1:1 eksport
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { openEditor } = require('./helpers');

const EMU = 9525;                 // 1 px = 1/96 dyuym = 9525 EMU

async function exportSlideXml(page) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.evaluate(() => window.exportPPTX())]);
  const b64 = fs.readFileSync(await dl.path()).toString('base64');
  return page.evaluate(async (b) => {
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    return zip.file('ppt/slides/slide1.xml').async('string');
  }, b64);
}
function shapes(xml) { return xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []; }
function xfrm(sp) {
  const m = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(sp);
  return m ? { x: +m[1], y: +m[2], cx: +m[3], cy: +m[4] } : null;
}

test('«+» avvalgidek faqat rasm yuklaydi, dizayn menyusi esa toolbar boshidagi alohida tugmada', async ({ page }) => {
  await openEditor(page);
  await page.waitForSelector('#ssSlidePlus', { state: 'attached' });
  const plus = await page.evaluate(() => {
    let called = 0;
    const orig = window.triggerSidebarImageUpload;
    window.triggerSidebarImageUpload = () => { called++; };
    document.getElementById('ssSlidePlus').click();
    window.triggerSidebarImageUpload = orig;
    return { called, menuOpen: !!document.querySelector('#ssKitMenu.open') };
  });
  expect(plus).toEqual({ called: 1, menuOpen: false });
  const pos = await page.evaluate(() => {
    const tb = document.getElementById('ribbonToolbar');
    const btns = [...tb.querySelectorAll('button')];
    return { first: btns[0].id, visible: btns[0].getBoundingClientRect().width > 0 };
  });
  expect(pos).toEqual({ first: 'ssKitBtn', visible: true });            // boshqa tugmalardan oldin
});

test('«Dizayn» menyusi: uslub tanlanadi, retro oyna kartochkasi slaydga qo\'shiladi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { canvas.clear(); canvas.setBackgroundColor('#ffffff'); });
  await page.locator('#ssKitBtn').click();
  const menu = page.locator('#ssKitMenu.open');
  await expect(menu).toBeVisible();
  await expect(page.locator('#ssKitBtn')).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('[data-tab]')).toHaveCount(4);
  await expect(menu.locator('[data-act="upload"]')).toHaveCount(0);   // rasm yuklash menyuda yo'q — u «+» tugmasida
  await menu.locator('[data-style="neo_brutalism"]').click();
  await menu.locator('[data-item="window_card"]').click();
  await expect(menu).toBeHidden();
  const r = await page.evaluate(() => {
    const parts = canvas.getObjects().filter((o) => o.ssKit);
    const fr = parts.find((o) => o.ssRole === 'frame');
    const fb = fr.getBoundingRect(true, true);
    const texts = parts.filter((o) => o.type === 'textbox');
    const inside = texts.every((t) => { const b = t.getBoundingRect(true, true); return b.left >= fb.left - 1 && b.top >= fb.top - 1 && b.left + b.width <= fb.left + fb.width + 1 && b.top + b.height <= fb.top + fb.height + 1; });
    return { n: parts.length, kits: new Set(parts.map((o) => o.ssKit)).size, stroke: fr.strokeWidth, rx: fr.rx, sh: fr.shadow && { blur: fr.shadow.blur, x: fr.shadow.offsetX, y: fr.shadow.offsetY }, inside, saved: JSON.parse(slides[activeIndex].json).objects.filter((o) => o.ssKit).length };
  });
  expect(r.n).toBeGreaterThanOrEqual(6);            // ramka + sarlavha paneli + 3 nuqta + matnlar
  expect(r.kits).toBe(1);
  expect(r.stroke).toBe(3);
  expect(r.rx).toBe(6);
  expect(r.sh).toEqual({ blur: 0, x: 6, y: 6 });    // qattiq soya
  expect(r.inside).toBe(true);                      // matn kartochkadan chiqmaydi
  expect(r.saved).toBe(r.n);                        // slayd JSON'ida ssKit saqlangan
});

test('AI: {"type":"kit"} elementlari karta sifatida joylanadi va bo\'laklarga yoyiladi', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    const c = await window.createFabricCanvasFromElements([
      { type: 'kit', item: 'bg_rules', style: 'academic' },
      { type: 'kit', item: 'stat_card', style: 'modern_cards', left: 60, top: 120, width: 260, height: 180, number: '92%', label: 'Mijozlar mamnun' },
      { type: 'kit', item: 'list_card', style: 'neo_brutalism', left: 360, top: 120, width: 420, height: 280, title: 'Afzalliklar', items: ['Tez', 'Arzon', 'Sifatli'] },
    ], '#ffffff');
    const objs = c.getObjects();
    const fr = objs.filter((o) => o.ssRole === 'frame').map((o) => [Math.round(o.left), Math.round(o.top), Math.round(o.width), Math.round(o.height)]);
    return { fr, decorFirst: objs[0].ssRole === 'bgdecor', checks: objs.filter((o) => o.shapeType === 'check').length, n: objs.length };
  });
  expect(r.fr).toEqual([[60, 120, 260, 180], [360, 120, 420, 280]]);   // CardFit kit bo'laklarini surmaydi
  expect(r.decorFirst).toBe(true);
  expect(r.checks).toBe(3);
});

test('PPTX eksport 1:1: qalin chegara, burchak radiusi, qattiq soya, yulduz, chiziq, matn — rasm emas, haqiqiy shakl', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    canvas.clear(); canvas.setBackgroundColor('#ffffff');
    canvas.add(new fabric.Rect({ left: 100, top: 80, width: 300, height: 160, rx: 12, ry: 12, fill: '#ffffff', stroke: '#111111', strokeWidth: 4,
      shadow: new fabric.Shadow({ color: '#111111', blur: 0, offsetX: 6, offsetY: 6 }) }));
    canvas.add(window.buildShape('star5', { left: 500, top: 100, width: 120, height: 120, fill: '#ff0000' }));
    canvas.add(new fabric.Line([0, 0, 200, 0], { left: 100, top: 400, stroke: '#000000', strokeWidth: 4 }));
    canvas.add(new fabric.Textbox('Salom dunyo, bu sinov matni ancha uzun bo\'lib, bir necha qatorga bo\'linadi', { left: 600, top: 300, width: 300, fontSize: 24, lineHeight: 1.2, fontFamily: 'Arial', fill: '#111111' }));
    await window.SS_KIT.insert('window_card', { style: 'neo_brutalism', left: 40, top: 300, width: 300, height: 200 });
    canvas.discardActiveObject();
    // kit'ni guruhga aylantiramiz — eksport guruhni ham alohida shakllarga yoyishi kerak
    const parts = canvas.getObjects().filter((o) => o.ssKit);
    parts.forEach((o) => canvas.remove(o));
    canvas.add(new fabric.Group(parts));
    saveCurrentSlideState();
  });
  const xml = await exportSlideXml(page);
  expect(xml).not.toContain('<p:pic>');                         // hech biri rasmga aylanmadi
  const sp = shapes(xml);

  const card = sp.find((s) => s.includes('prst="roundRect"') && s.includes('outerShdw'));
  expect(card).toBeTruthy();
  // chegara markazda: geometriya = left + strokeWidth/2
  expect(xfrm(card)).toEqual({ x: 102 * EMU, y: 82 * EMU, cx: 300 * EMU, cy: 160 * EMU });
  expect(card).toContain('<a:gd name="adj" fmla="val 7500"/>');  // rx 12 / min(300,160)
  expect(card).toContain('</a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');   // ichki rang (fill) saqlanadi
  expect(card).toContain('<a:ln w="38100">');                    // 4px = 3pt
  expect(card).toMatch(/blurRad="0" dist="8082\d" dir="2700000"/); // qattiq soya 6,6 → 45°

  const star = sp.find((s) => s.includes('<a:custGeom>') && (s.match(/<a:lnTo>/g) || []).length === 9);
  expect(star).toBeTruthy();
  expect(star).toContain('<a:close />');
  expect(star).toContain('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>');

  const line = sp.find((s) => s.includes('prst="line"'));
  expect(xfrm(line)).toEqual({ x: 102 * EMU, y: 402 * EMU, cx: 200 * EMU, cy: 0 });

  expect(xml).toContain('<a:spcPts val="2441"/>');               // 24px·0.75·1.2·1.13 = 24.41pt — Fabric qator qadami

  // guruhlangan retro oyna: ramka + panel + 3 nuqta (ellipse) + matnlar — hammasi alohida tahrirlanadigan obyekt
  expect(sp.filter((s) => s.includes('prst="ellipse"')).length).toBeGreaterThanOrEqual(3);
  const frame = sp.find((s) => s.includes('outerShdw') && s.includes('prst="roundRect"') && xfrm(s).x === Math.round(41.5 * EMU));             // 40 + 3/2 chegara
  expect(frame).toBeTruthy();
});
