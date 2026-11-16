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

test('PPTX import: layout bezaklari, erkin shakl, burilgan guruh, gradient, shaffof fon va har bo\'lak o\'z shrift o\'lchami bilan', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    const p = new PptxGenJS(); p.layout = 'LAYOUT_16x9';
    p.addSlide().addText('x', { x: 1, y: 1, w: 1, h: 1 });
    const zip = await JSZip.loadAsync(await p.write({ outputType: 'arraybuffer' }));
    const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const shp = (id, inner) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>${inner}</p:sp>`;
    // layout: bezak (erkin shakl) + 90° burilgan guruh ichidagi gorizontal chiziq
    const lay = Object.keys(zip.files).find((n) => /slideLayouts\/slideLayout1\.xml$/.test(n));
    let lx = await zip.file(lay).async('string');
    const cust = shp(901, `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="50" y="0"/></a:moveTo><a:cubicBezTo><a:pt x="100" y="0"/><a:pt x="100" y="100"/><a:pt x="50" y="100"/></a:cubicBezTo><a:lnTo><a:pt x="0" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr>`);
    const grp = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="902" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="5400000"><a:off x="4572000" y="1371600"/><a:ext cx="1828800" cy="182880"/><a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="182880"/></a:xfrm></p:grpSpPr>${shp(903, '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="182880"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></p:spPr>')}</p:grpSp>`;
    lx = lx.replace('</p:spTree>', cust + grp + '</p:spTree>').replace(/<p:cSld([^>]*)>/, `<p:cSld$1><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:effectLst/></p:bgPr></p:bg>`);
    zip.file(lay, lx);
    // slayd: gradientli quti + ikki xil o'lchamdagi matn bo'laklari, autofit 50%
    let sx = await zip.file('ppt/slides/slide1.xml').async('string');
    const tb = shp(904, `<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF00FF"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFD966"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill></p:spPr><p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:p><a:r><a:rPr sz="6000" b="1"/><a:t>Katta</a:t></a:r><a:br/><a:r><a:rPr sz="2000" b="0"/><a:t>kichik matn</a:t></a:r></a:p></p:txBody>`);
    sx = sx.replace(/<p:bg>[\s\S]*?<\/p:bg>/, '').replace('</p:spTree>', tb + '</p:spTree>');
    zip.file('ppt/slides/slide1.xml', sx);
    const blob = await zip.generateAsync({ type: 'blob' });
    await window.importPptxClient(new File([blob], 't.pptx'));
    await new Promise((res) => setTimeout(res, 800));
    const j = JSON.parse(slides[0].json);
    const objs = j.objects;
    const path = objs.find((o) => o.type === 'path');
    const green = objs.find((o) => o.type === 'rect' && o.fill === '#00aa00');
    const grad = objs.find((o) => o.fill && typeof o.fill === 'object' && o.fill.colorStops);
    const text = objs.find((o) => o.type === 'textbox' && /Katta/.test(o.text));
    // har belgining haqiqiy uslubi (asosiy + o'z uslubi)
    const eff = (line, ch) => Object.assign({ fontSize: text.fontSize, fontWeight: text.fontWeight }, (text.styles && text.styles[line] && text.styles[line][ch]) || {});
    const big = eff(0, 0), small = eff(1, 0);
    return {
      bg: j.background, path: !!path, pathFirst: objs.indexOf(path) < objs.indexOf(text),
      greenAngle: green && Math.round(green.angle), grad: grad && grad.fill.colorStops.map((s) => s.color),
      big: Math.round(big.fontSize), bold: big.fontWeight, small: Math.round(small.fontSize * 10) / 10, smallW: small.fontWeight,
    };
  });
  expect(r.bg).toBe('#ff8080');                    // 50% qizil oq ustida
  expect(r.path).toBe(true);                       // layout'dagi erkin shakl → Fabric path
  expect(r.pathFirst).toBe(true);                  // bezak slayd matnidan orqada
  expect(r.greenAngle).toBe(90);                   // guruh burilishi bolaga o'tdi
  expect(r.grad).toEqual(['#ff00ff', '#ffd966']);  // gradient
  expect(r.big).toBe(40);                          // 60pt × 50% = 30pt = 40px (10 dyuymli slayd = 960px)
  expect(r.bold).toBe('bold');
  expect(r.small).toBe(13.3);                      // 20pt × 50% = 10pt — o'z o'lchami saqlanadi
  expect(r.smallW).toBe('normal');
});

test('aylana: sayt → PPTX → (faqat PowerPoint XML) → sayt: animatsiya va slayd o\'tishi saqlanadi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    canvas.clear();
    const a = new fabric.Rect({ left: 100, top: 100, width: 200, height: 120, fill: '#ff0000' }); a.animName = 'fadeInUp'; a.animDur = 1.2; a.animDelay = 0;
    const b = new fabric.Textbox('Salom', { left: 400, top: 100, width: 300, fontSize: 32 }); b.animName = 'zoomIn'; b.animDur = 0.8; b.animDelay = 1.5;
    const c = window.buildShape('star5', { left: 600, top: 300, width: 100, fill: '#00aa00' }); c.animName = 'pulse'; c.animDur = 1; c.animDelay = 3;
    const g = new fabric.Rect({ left: 100, top: 350, width: 300, height: 100 });
    g.set('fill', new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: 300, y2: 0 }, colorStops: [{ offset: 0, color: '#ff00ff' }, { offset: 1, color: '#ffd966' }] }));
    canvas.add(a, b, c, g);
    saveCurrentSlideState();
    slides[activeIndex].transition = 'wipeR'; slides[activeIndex].transDur = 1.3; slides[activeIndex].transAuto = 4;
  });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.evaluate(() => window.exportPPTX())]);
  const b64 = fs.readFileSync(await dl.path()).toString('base64');
  const r = await page.evaluate(async (b) => {
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    zip.remove('slide-studio/project.json');               // saytning ichki nusxasisiz — xuddi PowerPoint'da saqlangandek
    const blob = await zip.generateAsync({ type: 'blob' });
    await window.importPptxClient(new File([blob], 'rt.pptx'));
    await new Promise((res) => setTimeout(res, 800));
    const s = slides[0], objs = JSON.parse(s.json).objects.filter((o) => o.animName);
    const gr = JSON.parse(s.json).objects.find((o) => o.fill && typeof o.fill === 'object' && o.fill.colorStops);
    const xml = await zip.file('ppt/slides/slide1.xml').async('string');
    return { tr: [s.transition, s.transDur, s.transAuto], anims: objs.map((o) => [o.type, o.animName, o.animDur, o.animDelay]),
      grad: gr && gr.fill.colorStops.map((c) => c.color), gradXml: /<a:gradFill[^>]*><a:gsLst><a:gs pos="0"><a:srgbClr val="FF00FF"[\s\S]*?<a:gs pos="100000"><a:srgbClr val="FFD966"[\s\S]*?<a:lin ang="0"/.test(xml) };
  }, b64);
  expect(r.tr).toEqual(['wipeR', 1.3, 4]);
  expect(r.anims.map((x) => x[1])).toEqual(['fadeInUp', 'zoomIn', 'pulse']);
  expect(r.anims.map((x) => x[2])).toEqual([1.2, 0.8, 1]);
  expect(r.anims.map((x) => x[3])).toEqual([0, 1.5, 3]);
  expect(r.gradXml).toBe(true);                            // PowerPoint'da haqiqiy gradient
  expect(r.grad).toEqual(['#ff00ff', '#ffd966']);          // va qaytib saytga ham gradient bo'lib keladi
});

test('187 ta PowerPoint shakli: menyu, AI, PPTX eksport (o\'z nomi + sariq tutqich) va qayta import', async ({ page }) => {
  await openEditor(page);
  await page.waitForFunction(() => window.SS_PRST && SS_PRST.ready, null, { timeout: 20_000 });
  const menuCount = await page.evaluate(() => document.querySelectorAll('#shapesMenu [data-prst]').length);
  expect(menuCount).toBe(187);
  await page.evaluate(async () => {
    canvas.clear();
    const a = await window.parseElementToFabric({ type: 'shape', shape: 'flowChartDecision', left: 60, top: 60, width: 200, height: 120, fill: '#ff0000' });
    const b = await window.parseElementToFabric({ type: 'cloudCallout', left: 320, top: 60, width: 200, height: 140, fill: '#00aa00' });
    const c = SS_PRST_UI.make('roundRect', { left: 600, top: 60, width: 200, height: 120, adj: { adj: 40000 } });
    const d = SS_PRST_UI.make('rightArrow', { left: 60, top: 300, width: 220, height: 100, stroke: '#111111', strokeWidth: 4 });
    canvas.add(a, b, c, d);
    saveCurrentSlideState();
  });
  const types = await page.evaluate(() => canvas.getObjects().map((o) => o.type + ':' + o.prst));
  expect(types).toEqual(['prstShape:flowChartDecision', 'prstShape:cloudCallout', 'prstShape:roundRect', 'prstShape:rightArrow']);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.evaluate(() => window.exportPPTX())]);
  const b64 = fs.readFileSync(await dl.path()).toString('base64');
  const r = await page.evaluate(async (b) => {
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    const xml = await zip.file('ppt/slides/slide1.xml').async('string');
    zip.remove('slide-studio/project.json');
    await window.importPptxClient(new File([await zip.generateAsync({ type: 'blob' })], 's.pptx'));
    await new Promise((res) => setTimeout(res, 800));
    const objs = JSON.parse(slides[0].json).objects.filter((o) => o.type === 'prstShape');
    return {
      prsts: (xml.match(/prst="(\w+)"/g) || []).map((x) => x.slice(6, -1)),
      adj: /prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 40000"\/>/.test(xml),
      pic: xml.includes('<p:pic>'),
      back: objs.map((o) => o.prst),
      backRx: (JSON.parse(slides[0].json).objects.find((o) => o.type === 'rect' && o.rx > 0) || {}).rx,
      arrowBox: (() => { const o = objs.find((x) => x.prst === 'rightArrow'); return o && [Math.round(o.left), Math.round(o.top), Math.round(o.width), Math.round(o.height)]; })(),
    };
  }, b64);
  expect(r.pic).toBe(false);                                       // rasm emas — PowerPoint'ning o'z shakli
  expect(r.prsts).toEqual(expect.arrayContaining(['flowChartDecision', 'cloudCallout', 'roundRect', 'rightArrow']));
  expect(r.adj).toBe(true);                                        // sariq tutqich qiymati saqlandi
  expect(r.back).toEqual(['flowChartDecision', 'cloudCallout', 'rightArrow']);
  expect(Math.round(r.backRx)).toBe(48);                          // roundRect → saytning yumaloq rect'i (adj 40000 × 120)
  expect(r.arrowBox).toEqual([60 + 2 + 110, 300 + 2 + 50, 220, 100]);   // markaz bo'yicha aniq joyida (chegara 4)
});
