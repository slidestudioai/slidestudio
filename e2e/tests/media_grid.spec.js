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
