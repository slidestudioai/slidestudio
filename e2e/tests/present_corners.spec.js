// Presentation: a dark slide has no thin white line at the rounded corners of the stage.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('dark slide in the presentation: no white pixels along the rounded corners', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 880 });
  await openEditor(page);
  await page.evaluate(() => {
    slides[0].json = JSON.stringify({ background: '#0f172a', objects: [{ type: 'textbox', text: 'Sun\'iy intellekt', left: 80, top: 120, width: 500, fontSize: 48, fill: '#ffffff', styles: [] }] });
    });
  await page.evaluate(async () => { await loadSlideCanvasAsync(0); await new Promise((r) => setTimeout(r, 400)); window.startPresentation(); });
  const frame = page.frameLocator('#presViewerFrame');
  await frame.locator('#stage').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const box = await page.evaluate(() => {
    const f = document.getElementById('presViewerFrame'), fr = f.getBoundingClientRect();
    const st = f.contentDocument.getElementById('stage').getBoundingClientRect();
    return { x: fr.left + st.left, y: fr.top + st.top, w: st.width, h: st.height };
  });
  const png = await page.screenshot({ clip: { x: Math.floor(box.x) - 2, y: Math.floor(box.y) - 2, width: Math.ceil(box.w) + 4, height: Math.ceil(box.h) + 4 } });
  const worst = await page.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
    let max = 0;
    // the four 16x16 corner squares of the stage (where the rounded edge is)
    for (const [cx, cy] of [[0, 0], [W - 16, 0], [0, H - 16], [W - 16, H - 16]]) {
      for (let y = cy; y < cy + 16; y++) for (let xx = cx; xx < cx + 16; xx++) {
        const i = (y * W + xx) * 4; max = Math.max(max, (d[i] + d[i + 1] + d[i + 2]) / 3);
      }
    }
    return Math.round(max);
  }, png.toString('base64'));
  expect(worst).toBeLessThan(45);           // dark slide #0f172a ≈ 26, page ≈ 17; the old white under-layer gave a light edge ≈ 60..110
});
