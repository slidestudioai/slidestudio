// v68: saqlash → boshqa dasturda tahrirlash → qayta ochish. O'zgarmagan slayd 1:1, o'zgargani yo'qolmaydi.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { openEditor } = require('./helpers');

async function exportBytes(page, fn) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.evaluate((f) => window[f](), fn)]);
  return { b64: fs.readFileSync(await dl.path()).toString('base64'), name: dl.suggestedFilename(), size: fs.statSync(await dl.path()).size };
}
async function importBytes(page, b64, name) {
  await page.evaluate(async ([b, n]) => {
    const u8 = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    await processImportFile(new File([u8], n));
    await new Promise((r) => setTimeout(r, 1500));
  }, [b64, name]);
}
const snap = (page) => page.evaluate(() => { saveCurrentSlideState(); return slides.map((s) => JSON.parse(s.json)); });

test('PPTX: PowerPoint\'da o\'zgartirilgan slayd matni qayta ochilganda saqlanadi, o\'zgarmagani 1:1', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    await SS_KIT.insert('window_card');                       // 1-slayd: dizayn kartochkasi (ichki nusxadan 1:1 qaytishi kerak)
    addSlide('title_body'); await new Promise((r) => setTimeout(r, 300));
    canvas.getObjects().find((o) => o.type === 'textbox').set('text', 'ESKI_SARLAVHA');
    saveCurrentSlideState();
  });
  const before = await snap(page);
  const out = await exportBytes(page, 'exportPPTX');
  // «PowerPoint»: 2-slayd matnini o'zgartiramiz, 1-slaydni faqat qayta yozamiz (atributlar boshqa tartibda)
  const edited = await page.evaluate(async (b) => {
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
    zip.file('ppt/slides/slide2.xml', s2.replace('ESKI_SARLAVHA', 'YANGI_SARLAVHA'));
    const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
    zip.file('ppt/slides/slide1.xml', s1.replace(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/g, '<a:off  x="$1"  y="$2" />'));
    return zip.generateAsync({ type: 'base64' });
  }, out.b64);
  await importBytes(page, edited, out.name);
  const after = await snap(page);
  expect(after.length).toBe(2);
  expect(after[0].objects.filter((o) => o.ssKit).length).toBe(before[0].objects.filter((o) => o.ssKit).length);   // 1:1
  expect(JSON.stringify(after[1])).toContain('YANGI_SARLAVHA');            // boshqa dasturdagi tahrir yo'qolmadi
  expect(JSON.stringify(after[1])).not.toContain('ESKI_SARLAVHA');
});

test('PPTX va HTML: saqla → och — hamma narsa 1:1, fayl kichik (katta rasm siqiladi)', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 3000, 2000); g.addColorStop(0, '#2563eb'); g.addColorStop(1, '#f59e0b'); x.fillStyle = g; x.fillRect(0, 0, 3000, 2000);
    const d = x.getImageData(0, 0, 3000, 2000); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * 40; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } x.putImageData(d, 0, 0);
    await new Promise((res) => fabric.Image.fromURL(c.toDataURL('image/jpeg', 0.95), (im) => { im.set({ left: 480, top: 120, scaleX: 0.14, scaleY: 0.14 }); canvas.add(im); res(); }));
    addSlide('title_body'); await new Promise((r) => setTimeout(r, 300));
    await SS_THEMES.apply('ocean', 'all');
  });
  const key = (j) => j.map((s) => [s.background, (s.objects || []).map((o) => [o.type, Math.round(o.left), Math.round(o.top), Math.round(o.width * (o.scaleX || 1)), Math.round(o.height * (o.scaleY || 1)), o.text || '', o.ssKitItem || ''].join('|'))]);
  const before = key(await snap(page));
  for (const fn of ['exportPPTX', 'exportHTML']) {
    const out = await exportBytes(page, fn);
    expect(out.size).toBeLessThan(2_000_000);                // ~3–4 MB lik rasm bilan ham fayl yengil
    await importBytes(page, out.b64, out.name);
    expect(key(await snap(page))).toEqual(before);
  }
});

test('.ppsx (PowerPoint namoyish fayli) ham ochiladi', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { canvas.getObjects().find((o) => o.type === 'textbox').set('text', 'PPSX_MATNI'); saveCurrentSlideState(); });
  const out = await exportBytes(page, 'exportPPTX');
  const ppsx = await page.evaluate(async (b) => {
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    zip.remove('slide-studio/project.json');                      // boshqa dastur saqlagandek (ichki nusxasiz)
    const ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace('presentationml.presentation.main+xml', 'presentationml.slideshow.main+xml'));
    return zip.generateAsync({ type: 'base64' });
  }, out.b64);
  await page.evaluate(() => { slides.forEach((s) => { s.json = '{"objects":[]}'; }); canvas.clear(); });
  await importBytes(page, ppsx, 'namoyish.ppsx');
  expect(JSON.stringify(await snap(page))).toContain('PPSX_MATNI');
});
