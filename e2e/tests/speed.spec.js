// Speed / streaming UX: no artificial waits, text before media (shimmer slot + fade-in, no layout shift),
// slides in order, Stop keeps finished slides and tells the server to stop.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

async function login(page) {
  await page.evaluate(() => {
    supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; window.ensureValidToken = async () => true;
    document.getElementById('aiModelSelect').value = 'fast'; toggleAISidebar(true);
  });
  await page.waitForFunction(() => socket && socket.readyState === 1);
}

function slowImages(page, ms) {
  const slow = async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    try { await route.continue(); } catch (e) {}
  };
  // the e2e server serves the AI images itself (/e2e-img/...); real deployments go through /api/proxy-image
  return Promise.all([page.route('**/api/proxy-image**', slow), page.route('**/e2e-img/**', slow)]);
}

test('F2: slide text appears before its image; a shimmer slot holds the place; image fades in at the same box', async ({ page }) => {
  await openEditor(page);
  await slowImages(page, 4500);               // longer than the whole AI answer -> the preload cannot hide the wait
  await login(page);
  await page.evaluate(() => {
    window.__slotSeen = null;
    window.__swaps = [];
    const t0 = Date.now();
    document.addEventListener('ss:media-slot', (e) => window.__swaps.push(Object.assign({ at: Date.now() - t0 }, e.detail)));
    const iv = setInterval(() => {
      try {
        const objs = canvas.getObjects();
        const slot = objs.find((o) => o.ssMediaSlot);
        const text = objs.find((o) => o.type === 'textbox' && (o.text || '').trim());
        if (slot && text && !window.__slotSeen) {
          const b = slot.getBoundingRect(true, true);
          window.__slotSeen = { at: Date.now() - t0, box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], id: slot.ssSlotId };
        }
      } catch (e) {}
    }, 30);
    window.__slotIv = iv;
  });
  await page.fill('#aiSidebarInput', '1 ta slayd yarat, 1 ta rasm bilan');
  await page.evaluate(() => sendSidebarAiPrompt());
  // the slide (with its text) is shown while the image is still downloading
  await page.waitForFunction(() => !!window.__slotSeen, null, { timeout: 30_000 });
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 30_000 });
  // the image replaces the slot
  await page.waitForFunction(() => window.__swaps.length > 0 && window.SSLazyMedia.pending() === 0, null, { timeout: 30_000 });
  await page.waitForTimeout(400);                                         // fade-in (0.3 s) finished
  const res = await page.evaluate(() => {
    clearInterval(window.__slotIv);
    const objs = canvas.getObjects();
    const img = objs.find((o) => o.type === 'image' && o.ssSrcUrl);
    const b = img && img.getBoundingRect(true, true);
    const json = slides[activeIndex].json;
    return {
      slotLeft: objs.some((o) => o.ssMediaSlot), swap: window.__swaps[0], slot: window.__slotSeen,
      img: b ? [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] : null,
      opacity: img ? img.opacity : null, jsonHasSlot: json.indexOf('ssMediaSlot') >= 0, jsonHasUrl: json.indexOf('ssSrcUrl') >= 0,
    };
  });
  expect(res.swap.ok).toBe(true);
  expect(res.swap.at - res.slot.at).toBeGreaterThanOrEqual(1000);       // text was on screen >= 1 s before the image
  expect(res.slotLeft).toBe(false);
  expect(res.img).not.toBeNull();
  for (let k = 0; k < 4; k++) expect(Math.abs(res.img[k] - res.slot.box[k])).toBeLessThanOrEqual(2);   // no layout shift
  expect(res.opacity).toBeCloseTo(1, 2);
  expect(res.jsonHasSlot).toBe(false);
  expect(res.jsonHasUrl).toBe(true);
});

test('F1+F3: several slides come one after another, in order, with no artificial seconds-long pauses', async ({ page }) => {
  await openEditor(page);
  await slowImages(page, 2000);
  await login(page);
  await page.evaluate(() => {
    window.__order = [];
    const t0 = Date.now();
    const orig = window.ssMarkSlideDone;
    window.ssMarkSlideDone = function (s) { window.__order.push({ i: slides.indexOf(s), t: Date.now() - t0 }); return orig.apply(this, arguments); };
  });
  const t0 = Date.now();
  await page.fill('#aiSidebarInput', '4 ta slayd yarat, har birida rasm');
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
  const total = Date.now() - t0;
  const order = await page.evaluate(() => window.__order);
  expect(order.length).toBeGreaterThanOrEqual(4);
  for (let k = 1; k < order.length; k++) expect(order[k].i).toBeGreaterThan(order[k - 1].i);          // in order
  // before: >= 2 s minimum per slide (+ 0.7 s hold + image wait) -> 4 slides took > 10 s
  expect(total).toBeLessThan(9000);
});
