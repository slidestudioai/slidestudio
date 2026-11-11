// v63: botdan kelgan diagramma — panel ranglari grafikdagi bilan bir xil, bitta rang o'zgarsa qolganlari joyida qoladi
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('botdan kelgan diagramma: panel haqiqiy ranglarni ko\'rsatadi va rang o\'zgartirish ishlaydi', async ({ page }) => {
  await openEditor(page);
  const buf = require('fs').readFileSync(require('path').join(__dirname, '..', 'fixtures', 'bot_charts.pptx')).toString('base64');
  await page.evaluate(async (b) => { const bin = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); await window.importPptxClient(new File([bin], 'bot.pptx')); }, buf);
  await page.waitForFunction(() => slides.length >= 5, null, { timeout: 20000 });
  // bitta seriyali ustunli diagramma yaratib, panelni tekshiramiz (botdagi kabi: bitta rang)
  const r = await page.evaluate(async () => {
    const g = window.ssBuildChart({ chart: 'bar', labels: ['A', 'B', 'C'], series: [{ name: 'S', values: [1, 2, 3] }], colors: ['#123456'], left: 60, top: 140, width: 600, height: 300 });
    canvas.add(g); canvas.setActiveObject(g);
    window.ssTcPanel.open(g);
    const pick = [...document.querySelectorAll('#ssTcPanel [data-pc]')].map((i) => i.value);
    const bars = () => window.ssTcPanel && canvas.getActiveObject().getObjects().filter((o) => o.type === 'rect' && o.height > 3 && o.width > 8).map((o) => o.fill);
    const before = bars();
    const inp = document.querySelector('#ssTcPanel [data-pc="1"]');
    inp.value = '#ff0000'; inp.oninput();
    await new Promise((res) => setTimeout(res, 400));
    return { pick, before, after: bars() };
  });
  expect(r.pick).toEqual(['#123456', '#123456', '#123456']);              // panel = grafikdagi ranglar
  expect(r.before).toEqual(['#123456', '#123456', '#123456']);
  expect(r.after).toEqual(['#123456', '#ff0000', '#123456']);              // faqat tanlangan ustun o'zgardi
  // chiziqli diagramma: har bir yorliq uchun ishlamaydigan rang tanlagichlar yo'q, chiziq rangi bor
  const line = await page.evaluate(() => {
    const g = window.ssBuildChart({ chart: 'line', labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }], colors: ['#00aa00'], left: 60, top: 140 });
    canvas.add(g); canvas.setActiveObject(g); window.ssTcPanel.open(g);
    return { pc: document.querySelectorAll('#ssTcPanel [data-pc]').length, sc: document.querySelectorAll('#ssTcPanel [data-sc]').length };
  });
  expect(line).toEqual({ pc: 0, sc: 1 });
});
