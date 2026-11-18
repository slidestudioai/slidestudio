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
  await page.route('**/api/media-search**', (r) => r.fulfill({ json: { results: [] } }));   // no replacement found either
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

test('edits on a slide whose picture is still loading are saved (and its thumbnail changes)', async ({ page }) => {
  await openEditor(page);
  await page.route('**/e2e-img/net-d*', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/api/proxy-image**', (r) => (/net-d/.test(decodeURIComponent(r.request().url())) ? r.fulfill({ status: 503, body: '' }) : r.continue()));
  await page.route('**/api/media-search**', (r) => r.fulfill({ json: { results: [] } }));
  const r = await page.evaluate(async () => {
    const u = location.origin + '/e2e-img/net-d.png';
    slides.push({ json: JSON.stringify({ background: '#000', objects: [
      { type: 'textbox', text: 'AI sarlavha', left: 40, top: 20, width: 600, fontSize: 36, fill: '#fff', styles: [] },
      { type: 'image', src: u, ssSrcUrl: u, left: 100, top: 100, width: 640, height: 400, scaleX: 0.5, scaleY: 0.5, crossOrigin: 'anonymous' },
      { type: 'image', src: u + '?2', ssSrcUrl: u + '?2', left: 500, top: 100, width: 640, height: 400, scaleX: 0.5, scaleY: 0.5, crossOrigin: 'anonymous' }] }), thumb: 'old', imageNumbers: [] });
    renderSidebar();
    activeIndex = slides.length - 1;
    await loadSlideCanvasAsync(activeIndex);
    await new Promise((r) => setTimeout(r, 1200));
    // the user's own picture + text, then a normal (not forced) save — like every edit
    const own = await new Promise((res) => fabric.Image.fromURL(location.origin + '/e2e-img/mine.png', res, { crossOrigin: 'anonymous' }));
    own.set({ left: 500, top: 300, scaleX: 0.3, scaleY: 0.3 });
    canvas.add(own);
    canvas.add(new fabric.Textbox('Mening matnim', { left: 40, top: 460, width: 300 }));
    canvas.renderAll();
    saveCurrentSlideState();
    const j = slides[activeIndex].json;
    const slot = canvas.getObjects().find((o) => o.ssMediaSlot);
    return { text: j.indexOf('Mening matnim') >= 0, mine: j.indexOf('mine.png') >= 0, keepsUrl: j.indexOf('net-d.png') >= 0,
             thumb: slides[activeIndex].thumb !== 'old', slotSelectable: !!(slot && slot.selectable && slot.evented) };
  });
  expect(r).toEqual({ text: true, mine: true, keepsUrl: true, thumb: true, slotSelectable: true });
});

test('a dead picture with no pool replacement is replaced by a new search on its slide title', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  let q = null;
  await page.route('**/e2e-img/dead-x*', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/api/proxy-image**', (r) => (/dead-x/.test(decodeURIComponent(r.request().url())) ? r.fulfill({ status: 503, body: '' }) : r.continue()));
  await page.route('**/api/media-search**', (r) => {
    q = new URL(r.request().url()).searchParams.get('q');
    return r.fulfill({ json: { results: [{ url: new URL(r.request().url()).origin + '/e2e-img/found-1.png' }] } });
  });
  await page.evaluate(async () => {
    window._ssImagePool = [];
    isAiStreaming = true;
    try {
      await executeAiCommands({ actions: [{ action: 'replace_slide', slide: 1, background: '#0b1020', elements: [
        { type: 'text', text: 'Menkes kasalligi', left: 40, top: 20, width: 880, height: 50, fontSize: 36, fill: '#fff' },
        { type: 'image', src: location.origin + '/e2e-img/dead-x.png', left: 40, top: 90, width: 430, height: 210 }] }] });
    } finally { isAiStreaming = false; }
  });
  await page.waitForFunction(() => canvas.getObjects().some((o) => o.type === 'image' && /found-1/.test(o.ssSrcUrl || '')), null, { timeout: 40_000 });
  expect(q).toBe('Menkes kasalligi');
  const box = await page.evaluate(() => { const b = canvas.getObjects().find((o) => o.type === 'image').getBoundingRect(true, true); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
  expect(box).toEqual([40, 90, 430, 210]);
});

test('a picture whose server never answers does not block the slide: it opens at once and edits are saved', async ({ page }) => {
  await openEditor(page);
  await page.route('**/e2e-img/hang*', () => {});                       // never answered
  await page.route('**/api/proxy-image**', (r) => (/hang/.test(decodeURIComponent(r.request().url())) ? undefined : r.continue()));
  const r = await page.evaluate(async () => {
    const u = location.origin + '/e2e-img/hang.png';
    slides.push({ json: JSON.stringify({ background: '#000', objects: [
      { type: 'textbox', text: 'AI', left: 40, top: 20, width: 600, fontSize: 36, fill: '#fff', styles: [] },
      { type: 'image', src: u, ssSrcUrl: u, left: 100, top: 100, width: 640, height: 400, scaleX: 0.5, scaleY: 0.5, crossOrigin: 'anonymous' }] }), thumb: 'old', imageNumbers: [] });
    activeIndex = slides.length - 1;
    const t0 = Date.now();
    const ok = await Promise.race([loadSlideCanvasAsync(activeIndex).then(() => true), new Promise((res) => setTimeout(() => res(false), 8000))]);
    const took = Date.now() - t0;
    await new Promise((res) => setTimeout(res, 300));
    canvas.add(new fabric.Textbox('Mening matnim', { left: 40, top: 460, width: 300 }));
    canvas.renderAll();
    saveCurrentSlideState();
    const j = slides[activeIndex].json;
    return { ok, fast: took < 4000, slot: canvas.getObjects().some((o) => o.ssMediaSlot), saved: j.indexOf('Mening matnim') >= 0, keepsUrl: j.indexOf('hang.png') >= 0 };
  });
  expect(r).toEqual({ ok: true, fast: true, slot: true, saved: true, keepsUrl: true });
});

test('a picture that arrives during the slide reveal stays visible; saves and the sidebar thumbnail have it', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    canvas.clear(); canvas.backgroundColor = '#ffffff';
    canvas.add(new fabric.Textbox('Sarlavha', { left: 40, top: 20, width: 600, fontSize: 36, fill: '#000' }));
    const im = await new Promise((res) => fabric.Image.fromURL(location.origin + '/e2e-img/rev-1.png', res, { crossOrigin: 'anonymous' }));
    im.set({ left: 480, top: 120, scaleX: 0.6, scaleY: 0.6 });
    // just swapped in by lazy media: fading in from 0 to 1 (exactly what swapIn does)
    im.__ssTargetOpacity = 1; im.set({ opacity: 0 });
    canvas.add(im);
    im.animate('opacity', 1, { duration: 300, onChange: () => canvas.requestRenderAll(),
      onComplete: () => { if (!im.__ssRevealOp) { im.opacity = 1; delete im.__ssTargetOpacity; } } });
    isAiStreaming = true;
    const rev = window.ssRevealCanvasObjects();                       // the slide reveal starts while the picture fades
    await new Promise((res) => setTimeout(res, 60));
    const midJson = im.toObject().opacity;                             // a save in the middle of the fade
    await rev;
    isAiStreaming = false;
    await new Promise((res) => setTimeout(res, 500));
    saveCurrentSlideStateDirectly();
    await new Promise((res) => setTimeout(res, 900));
    const json = JSON.parse(slides[activeIndex].json).objects.find((o) => o.type === 'image');
    // the sidebar picture of this slide shows the image (pixel inside the image box is not white)
    const domImg = document.querySelectorAll('#sidebar .slide-item')[activeIndex].querySelector('.slide-thumb > img');
    const px = await new Promise((res) => { const i2 = new Image(); i2.onload = () => { const c = document.createElement('canvas'); c.width = i2.width; c.height = i2.height; const x = c.getContext('2d'); x.drawImage(i2, 0, 0); const k = i2.width / 960; res(Array.from(x.getImageData(Math.round(650 * k), Math.round(240 * k), 1, 1).data.slice(0, 3))); }; i2.src = domImg.src; });
    return { live: im.opacity, midJson, saved: json && json.opacity, sameThumb: domImg.src === slides[activeIndex].thumb, white: px.every((v) => v > 245) };
  });
  expect(r).toEqual({ live: 1, midJson: 1, saved: 1, sameThumb: true, white: false });
});

test('a dead loremflickr link (old decks) is replaced at once by a search with its own words — also on a slide that is not open', async ({ page }) => {
  test.setTimeout(60_000);
  await openEditor(page);
  const qs = [];
  let flickr = 0;
  await page.route('**/loremflickr.com/**', (r) => { flickr++; return r.fulfill({ status: 500, body: '' }); });
  await page.route('**/api/proxy-image**', (r) => (/loremflickr/.test(decodeURIComponent(r.request().url())) ? (flickr++, r.fulfill({ status: 400, body: '' })) : r.continue()));
  await page.route('**/api/media-search**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('q'); qs.push(q);
    return r.fulfill({ json: { results: [{ url: new URL(r.request().url()).origin + '/e2e-img/menkes-' + qs.length + '.png' }] } });
  });
  await page.evaluate(() => {
    const u = 'https://loremflickr.com/1280/720/Menkes%2Cdisease%2Ckinky%2Chair?lock=9';
    slides.push({ json: JSON.stringify({ background: '#fff', objects: [
      { type: 'textbox', text: 'Menkes kasalligi', left: 40, top: 20, width: 600, fontSize: 36, fill: '#000', styles: [] },
      { type: 'image', src: u, ssSrcUrl: u, left: 40, top: 90, width: 1280, height: 720, scaleX: 0.3, scaleY: 0.3 }] }), thumb: '', imageNumbers: [] });
    renderSidebar();                                   // the new slide is NOT opened
  });
  await page.waitForFunction(() => /e2e-img\/menkes-/.test(slides[slides.length - 1].json) && slides[slides.length - 1].json.indexOf('ssMediaSlot') < 0, null, { timeout: 30_000 });
  const r = await page.evaluate(() => {
    const o = JSON.parse(slides[slides.length - 1].json).objects.find((x) => x.type === 'image');
    return { url: o.ssSrcUrl, box: [Math.round(o.left), Math.round(o.top), Math.round(o.width * o.scaleX), Math.round(o.height * o.scaleY)] };
  });
  expect(qs[0]).toBe('Menkes disease kinky hair');
  expect(r.url).toMatch(/e2e-img\/menkes-1\.png$/);
  expect(r.box).toEqual([40, 90, 384, 216]);                  // same place and size as the old picture
  expect(flickr).toBe(0);                                     // the dead site is not even asked
});
