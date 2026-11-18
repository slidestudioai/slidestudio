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

test('F4: «To\'xtatish» stops the AI on the server, keeps finished slides, socket stays open', async ({ page }) => {
  await openEditor(page);
  await login(page);
  await page.evaluate(() => {
    window.__msgs = [];
    const om = socket.onmessage;
    socket.onmessage = function (ev) { try { window.__msgs.push(JSON.parse(ev.data)); } catch (e) {} return om.apply(this, arguments); };
    window.__done = 0;
    const orig = window.ssMarkSlideDone;
    window.ssMarkSlideDone = function () { window.__done++; return orig.apply(this, arguments); };
  });
  await page.fill('#aiSidebarInput', '6 ta slayd yarat sekin');
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => isAiStreaming && (currentAiStreamBuffer || '').length > 80, null, { timeout: 30_000 });
  // the main button is now «To'xtatish»
  await expect(page.locator('#btnSidebarAi.stop-mode')).toHaveCount(1);
  const reqId = await page.evaluate(() => window._ssAiReq.id);
  const sock = await page.evaluate(() => { window.__sock = socket; return socket.readyState; });
  const t0 = Date.now();
  await page.click('#btnSidebarAi');
  // the server answers «stopped» quickly (it read the cancel during the stream)
  await page.waitForFunction((id) => window.__msgs.some((m) => m.type === 'end' && m.request_id === id), reqId, { timeout: 5000 });
  const tookMs = Date.now() - t0;
  const end = await page.evaluate((id) => window.__msgs.find((m) => m.type === 'end' && m.request_id === id), reqId);
  expect(end.finish_reason).toBe('stopped');
  expect(tookMs).toBeLessThan(3000);
  expect(await page.evaluate(() => socket === window.__sock && socket.readyState === 1)).toBe(true);   // not closed
  await expect(page.locator('#btnSidebarAi.stop-mode')).toHaveCount(0);
  // no slide is added after the stop; finished slides are still there
  const slidesAtStop = await page.evaluate(() => slides.length);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => slides.length)).toBe(slidesAtStop);
  expect(slidesAtStop).toBeGreaterThanOrEqual(1);
  // the next request works at once (no AI_BUSY, no stale chunks of the stopped answer)
  await page.fill('#aiSidebarInput', '1 ta slayd yarat');
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 30_000 });
  const errs = await page.evaluate(() => window.__msgs.filter((m) => m.type === 'error').map((m) => m.code || m.message));
  expect(errs).toEqual([]);
});

for (const blocked of [false, true]) {
  test(`AI input bar stays compact (voice.js ${blocked ? 'blocked' : 'loaded'}): no paperclip, no loose «UZ», wide text box`, async ({ page }) => {
    if (blocked) await page.route(/voice\.js/, (r) => r.abort());   // old cache / blocker / slow network
    await openEditor(page);
    await page.evaluate(() => toggleAISidebar(true));
    const r = await page.evaluate(() => {
      const box = document.querySelector('.ai-sidebar-input-box');
      const ta = document.getElementById('aiSidebarInput');
      const mic = document.getElementById('micBtnSidebar');
      const lang = mic.querySelector('.ss-mic-lang');
      return {
        attach: getComputedStyle(document.getElementById('attachBtnSidebar')).display,
        micShown: getComputedStyle(mic).display !== 'none',
        langPos: getComputedStyle(lang).position,
        ratio: ta.getBoundingClientRect().width / box.getBoundingClientRect().width,
      };
    });
    expect(r.attach).toBe('none');
    expect(r.langPos).toBe('absolute');                   // the language is a small badge ON the mic, never beside it
    if (blocked) expect(r.micShown).toBe(false);          // no working voice input -> no mic button taking space
    expect(r.ratio).toBeGreaterThan(blocked ? 0.75 : 0.6);
  });
}

test('AI message buttons (copy, regenerate, speak, edit) show the hand cursor everywhere on the button; the text keeps the text cursor', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { toggleAISidebar(true); appendAiChatMessage('user', 'salom'); appendAiChatMessage('bot', 'javob matni'); });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.ai-msg-actions .ai-action-btn')];
    const cur = (x, y) => getComputedStyle(document.elementFromPoint(x, y)).cursor;
    // middle of the button, its left edge, and the corner next to the (round) button
    const res = btns.map((b) => { const q = b.getBoundingClientRect(); return [cur(q.left + q.width / 2, q.top + q.height / 2), cur(q.left + 2, q.top + q.height / 2)]; });
    const corners = btns.map((b) => { const q = b.getBoundingClientRect(); return cur(q.left + 1, q.top + 1); });
    const t = document.querySelector('.ai-msg .msg-text');
    return { n: btns.length, all: [...new Set(res.flat())], corners: [...new Set(corners)].filter((c) => c === 'text'), text: getComputedStyle(t).cursor };
  });
  expect(r.n).toBeGreaterThanOrEqual(3);
  expect(r.all).toEqual(['pointer']);
  expect(r.corners).toEqual([]);                       // no text (I-beam) cursor around the buttons either
  expect(r.text).toBe('text');
});
