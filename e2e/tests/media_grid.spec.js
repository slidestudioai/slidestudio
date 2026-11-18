// A visual deck: 16 slides x 4 pictures (2x2 grid). 64 pictures at once used to overflow the proxy queue: a picture
// that failed once was silently dropped and the slide stayed empty (only the title). Now each picture is tried
// again, and a picture that never loads is replaced by an unused one from the presentation's pool.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('2x2 grid deck: a picture that fails is retried or replaced — no slide loses its pictures', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  const seen = {};
  const hit = (u) => { seen[u] = (seen[u] || 0) + 1; return seen[u]; };
  const name = (u) => decodeURIComponent(u).match(/e2e-img\/([\w-]+\.png)/)[1];
  const failing = (n, k) => /^dead-/.test(n) || (/^flaky-/.test(n) && k <= 2);
  await page.route('**/api/proxy-image**', (r) => {
    const n = name(r.request().url());
    return failing(n, hit('p:' + n)) ? r.fulfill({ status: 503, body: 'busy' }) : r.continue();
  });
  await page.route('**/e2e-img/**', (r) => {
    const n = name(r.request().url());
    return failing(n, hit('d:' + n)) ? r.fulfill({ status: 404, body: '' }) : r.continue();
  });
  await page.evaluate(async () => {
    const B = location.origin;
    window._ssImagePool = [1, 2, 3, 4, 5, 6].map((i) => ({ url: B + '/e2e-img/pool-' + i + '.png', kind: 'photo' }));
    const acts = [];
    for (let s = 1; s <= 16; s++) {
      const els = [{ type: 'text', text: 'Slayd ' + s, left: 40, top: 20, width: 880, height: 50, fontSize: 36, fill: '#fff' }];
      [[40, 90], [490, 90], [40, 315], [490, 315]].forEach((p, k) => {
        const kind = (s === 3 && k === 1) || (s === 9 && k === 2) ? 'dead' : (s % 4 === 2 ? 'flaky' : 'ok');
        els.push({ type: 'image', src: B + '/e2e-img/' + kind + '-s' + s + '-' + k + '.png', left: p[0], top: p[1], width: 430, height: 210 });
      });
      acts.push(Object.assign({ background: '#0b1020', elements: els }, s === 1 ? { action: 'replace_slide', slide: 1 } : { action: 'insert_slide', after: s - 1 }));
    }
    isAiStreaming = true;
    try { await executeAiCommands({ actions: acts }); } finally { isAiStreaming = false; }
  });
  await page.waitForFunction(() => window.SSLazyMedia.pending() === 0, null, { timeout: 90_000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => slides.map((s) => {
    const d = JSON.parse(s.json);
    const imgs = d.objects.filter((o) => o.type === 'image');
    return { imgs: imgs.length, slots: d.objects.filter((o) => o.ssMediaSlot).length, urls: imgs.map((o) => o.ssSrcUrl || '') };
  }));
  expect(r.length).toBe(16);
  r.forEach((s, i) => { expect({ i, imgs: s.imgs, slots: s.slots }).toEqual({ i, imgs: 4, slots: 0 }); });
  const all = r.flatMap((s) => s.urls);
  expect(all.filter((u) => /dead-/.test(u))).toEqual([]);              // the two dead pictures were replaced ...
  expect(all.filter((u) => /pool-/.test(u)).length).toBe(2);           // ... by two different pool pictures
  expect(new Set(all).size).toBe(64);                                  // no picture twice
  expect(all.filter((u) => /flaky-/.test(u)).length).toBe(16);         // flaky ones loaded on a later try
});

test('a picture is never removed: no pool replacement -> the shimmer stays and the picture appears when the network is back', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  let down = true;
  const block = (r) => (down && /net-/.test(decodeURIComponent(r.request().url())) ? r.fulfill({ status: 503, body: '' }) : r.continue());
  await page.route('**/api/proxy-image**', block);
  await page.route('**/e2e-img/**', block);
  await page.evaluate(async () => {
    window._ssImagePool = [];
    const B = location.origin;
    isAiStreaming = true;
    try {
      await executeAiCommands({ actions: [{ action: 'replace_slide', slide: 1, background: '#0b1020', elements: [
        { type: 'text', text: 'Sarlavha', left: 40, top: 20, width: 880, height: 50, fontSize: 36, fill: '#fff' },
        { type: 'image', src: B + '/e2e-img/net-a.png', left: 40, top: 90, width: 430, height: 210 },
        { type: 'image', src: B + '/e2e-img/ok-b.png', left: 490, top: 90, width: 430, height: 210 }] }] });
    } finally { isAiStreaming = false; }
  });
  await page.waitForTimeout(9000);                                    // all quick retries are over
  const mid = await page.evaluate(() => ({ slots: canvas.getObjects().filter((o) => o.ssMediaSlot).length, imgs: canvas.getObjects().filter((o) => o.type === 'image').length }));
  expect(mid).toEqual({ slots: 1, imgs: 1 });                          // the failed one still holds its place
  down = false;                                                        // the network is back
  await page.waitForFunction(() => canvas.getObjects().filter((o) => o.type === 'image').length === 2, null, { timeout: 40_000 });
  const box = await page.evaluate(() => { const o = canvas.getObjects().find((x) => /net-a/.test(x.ssSrcUrl || '')); const b = o.getBoundingRect(true, true); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
  expect(box).toEqual([40, 90, 430, 210]);
});

test('a saved slide whose picture does not load when opened keeps it (slot), and shows it once it loads', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  let down = true;
  await page.route('**/e2e-img/**', (r) => (down && /net-c/.test(r.request().url()) ? r.fulfill({ status: 404, body: '' }) : r.continue()));
  await page.route('**/api/proxy-image**', (r) => (down && /net-c/.test(decodeURIComponent(r.request().url())) ? r.fulfill({ status: 503, body: '' }) : r.continue()));
  const r1 = await page.evaluate(async () => {
    const u = location.origin + '/e2e-img/net-c.png';
    slides.push({ json: JSON.stringify({ background: '#000', objects: [
      { type: 'image', src: u, ssSrcUrl: u, left: 100, top: 100, width: 640, height: 400, scaleX: 0.5, scaleY: 0.5, crossOrigin: 'anonymous' }] }), thumb: '', imageNumbers: [] });
    activeIndex = slides.length - 1;
    await loadSlideCanvasAsync(activeIndex);
    await new Promise((r) => setTimeout(r, 800));
    saveCurrentSlideState({ force: true });
    const o = canvas.getObjects()[0];
    return { n: canvas.getObjects().length, slot: !!(o && o.ssMediaSlot), w: o && Math.round(o.width * o.scaleX), json: slides[activeIndex].json.indexOf('net-c.png') >= 0 };
  });
  expect(r1).toEqual({ n: 1, slot: true, w: 320, json: true });       // before: the picture was gone, and the save lost it
  down = false;
  await page.waitForFunction(() => canvas.getObjects().some((o) => o.type === 'image' && /net-c/.test(o.ssSrcUrl || '')), null, { timeout: 40_000 });
});
