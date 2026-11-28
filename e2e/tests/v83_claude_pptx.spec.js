// v83: a deck made the way Claude (python-pptx) makes one: default Office theme, 16:9, title / bullets / shape /
// picture / table / chart. Checks that every slide opens and that theme colours are right:
//  - <a:sysClr val="window" lastClr="FFFFFF"/> is white (before: the name «window» won and white/black were lost)
//  - text in a shape with <p:style><a:fontRef><a:schemeClr val="lt1"/> is white (before: black on the orange shape)
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('Claude / python-pptx deck opens with the right slides and colours', async ({ page }) => {
  await openEditor(page);
  const buf = require('fs').readFileSync(require('path').join(__dirname, '..', 'fixtures', 'claude_python_pptx.pptx')).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.importPptxClient(new File([bin], 'claude.pptx'));
  }, buf);
  await expect.poll(() => page.evaluate(() => slides.length)).toBe(5);
  const info = await page.evaluate(() => slides.map((s) => {
    const j = JSON.parse(s.json || '{}');
    return { bg: j.background, texts: (j.objects || []).filter((o) => o.text).map((o) => [o.text, String(o.fill).toLowerCase()]),
             types: (j.objects || []).map((o) => o.type) };
  }));
  expect(info[0].texts.map((t) => t[0])).toEqual(["Sun'iy intellekt", 'Claude tomonidan yaratilgan']);
  expect(info[1].texts[1][0]).toContain('• Uchinchi fikr');
  const shapeText = info[2].texts.find((t) => t[0] === 'Shakl ichidagi matn');
  expect(shapeText[1]).toBe('#ffffff');                       // white, like PowerPoint / LibreOffice
  expect(info[0].texts[0][1]).toBe('#000000');                // tx1 = windowText = black
  expect(info[2].types).toContain('image');
  expect(info[3].types).toContain('group');                   // table
  expect(info[4].types).toContain('group');                   // chart
});
