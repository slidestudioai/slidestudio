// Audit (C4, H5, M6) — browser checks: no token in URLs, resume after a network drop, clear error / queue texts.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

async function login(page) {
  await page.evaluate(() => {
    supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; window.ensureValidToken = async () => true;
    document.getElementById('aiModelSelect').value = 'fast'; toggleAISidebar(true);
  });
  await page.waitForFunction(() => socket && socket.readyState === 1);
}

test('C4: auth token never appears in a request or WebSocket URL', async ({ page }) => {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  page.on('websocket', (ws) => urls.push(ws.url()));
  await openEditor(page);
  await login(page);
  await page.evaluate(() => { try { loadUserStats(); } catch (e) {} });
  await page.fill('#aiSidebarInput', '1 ta slayd yarat');
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => isAiStreaming, null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
  expect(urls.some((u) => u.includes('/ws/chat'))).toBeTruthy();
  for (const u of urls) expect(u).not.toMatch(/[?&]token=/);
});

test('H5: connection drops mid-answer -> reconnect resumes, slides are complete and not duplicated', async ({ page }) => {
  await openEditor(page);
  await login(page);
  const before = await page.evaluate(() => slides.length);
  await page.fill('#aiSidebarInput', '3 ta slayd yarat sekin');
  await page.evaluate(() => sendSidebarAiPrompt());
  // wait until part of the answer arrived, then break the connection (like a mobile network drop)
  await page.waitForFunction(() => isAiStreaming && (currentAiStreamBuffer || '').length > 60, null, { timeout: 30_000 });
  const reqId = await page.evaluate(() => (window._ssAiReq || {}).id);
  expect(reqId).toBeTruthy();
  const cutLen = await page.evaluate(() => {
    window.__toasts = [];
    window.__resumed = '';
    const orig = window.showToast;
    window.showToast = function (m) { window.__toasts.push(String(m)); return orig.apply(this, arguments); };
    // the reconnect creates a new socket: record resume_result on it
    window.__wrapResume = setInterval(() => {
      if (socket && !socket.__wrapped) {
        socket.__wrapped = true;
        const om = socket.onmessage;
        socket.onmessage = function (ev) {
          try { const d = JSON.parse(ev.data); if (d.type === 'resume_result') window.__resumed = d.stream_text || ''; } catch (e) {}
          return om.apply(this, arguments);
        };
      }
    }, 50);
    const n = (currentAiStreamBuffer || '').length;
    socket.close();
    return n;
  });
  await page.waitForFunction(() => !!(window._ssResumeState && window._ssResumeState()), null, { timeout: 5000 });
  // reconnect (3 s) -> resume_pending ... -> resume_result -> the rest is applied
  await page.waitForFunction(() => !window._ssResumeState() && !isAiStreaming && !window._ssAiReq, null, { timeout: 60_000 });
  const after = await page.evaluate(() => slides.length);
  const resumed = await page.evaluate(() => { clearInterval(window.__wrapResume); return window.__resumed; });
  // the answer was really resumed: the success toast was shown and the buffer continued past the cut
  const toasts = await page.evaluate(() => window.__toasts);
  expect(toasts.some((m) => /Ulanish tiklandi/.test(m))).toBeTruthy();
  expect(resumed.length).toBeGreaterThan(cutLen);          // server kept the WHOLE streamed answer
  expect(resumed.trim().endsWith('```')).toBeTruthy();       // ... up to the end of the JSON block
  expect(after).toBeLessThanOrEqual(before + 3);           // nothing applied twice
  expect(after).toBeGreaterThanOrEqual(3);
});

test('M6: server error codes become clear texts; queue position is shown', async ({ page }) => {
  await openEditor(page);
  const t = await page.evaluate(() => [
    _ssErrText({ code: 'AI_TIMEOUT' }),
    _ssErrText({ code: 'RATE_LIMITED', retry_after: 12 }),
    _ssErrText({ code: 'AI_BUSY' }),
    _ssErrText({ message: 'eski server matni' }),
  ]);
  expect(t[0]).toContain('Varaq yechilmadi');
  expect(t[1]).toContain('12 soniyadan');
  expect(t[2]).toContain('hali bajarilmoqda');
  expect(t[3]).toBe('eski server matni');

  await login(page);
  await page.fill('#aiSidebarInput', '2 ta slayd yarat sekin');
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => isAiStreaming, null, { timeout: 8000 });
  const q = await page.evaluate(() => {
    const el = document.getElementById(currentBotMsgId);
    const span = el && el.querySelector('.msg-text');
    if (span) span.innerText = '💭 ...';
    socket.onmessage({ data: JSON.stringify({ type: 'queue', position: 3 }) });
    return span ? span.innerText : '';
  });
  expect(q).toMatch(/3/);
  expect(q.startsWith('⏳')).toBeTruthy();
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 60_000 });
});

test('M6: an AI error before any text offers «Qayta urinish»', async ({ page }) => {
  await openEditor(page);
  await login(page);
  await page.fill('#aiSidebarInput', '2 ta slayd yarat sekin');
  await page.evaluate(() => sendSidebarAiPrompt());
  await page.waitForFunction(() => isAiStreaming, null, { timeout: 8000 });
  await page.evaluate(() => {
    currentAiStreamBuffer = '';
    socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'AI_ERROR', message: 'x' }) });
  });
  await page.waitForFunction(() => !isAiStreaming, null, { timeout: 10_000 });
  await page.evaluate(() => { try { refreshChatMessageActions(); } catch (e) {} });
  const label = await page.locator('[data-role="continue"]').last().innerText();
  expect(label).toMatch(/Qayta urinish|Retry|Повторить/);
});
