// UX: top-up opens full size, the deck survives a reload (until a confirmed logout), logout asks first,
// no browser auto-translate, and the phone «Back» closes the open window instead of leaving the site.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

async function back(page) {
  await page.evaluate(() => history.back());
  await page.waitForTimeout(450);
}

test.describe('phone', () => {
  test.use(phone);

  test('U1: top-up opens at full optimal size right away (everything visible, no inner scroll on 375x812)', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => { supabaseToken = 'devtok'; window.openTopUpModal(); });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const c = document.querySelector('.tu-card'), b = document.querySelector('.tu-body');
      const bottom = (s) => document.querySelector(s).getBoundingClientRect().bottom;
      return { h: c.getBoundingClientRect().height, scroll: b.scrollHeight - b.clientHeight, max: parseFloat(getComputedStyle(c).maxHeight),
               cta: bottom('#tuPayBtn'), input: bottom('#tuCustomInput'), summary: bottom('.tu-summary'), foot: bottom('.tu-foot'), vh: innerHeight };
    });
    expect(r.max).toBeCloseTo(812 * 0.92, 0);
    expect(r.scroll).toBeLessThanOrEqual(1);
    for (const k of ['cta', 'input', 'summary', 'foot']) expect(r[k]).toBeLessThanOrEqual(r.vh + 1);
  });

  test('U5: phone «Back» closes the open window and stays on the site (top-up, media search, settings, presentation)', async ({ page }) => {
    await openEditor(page);
    const url = page.url();
    await page.evaluate(() => { slides[0].__marker = 'mine'; });
    // top-up
    await page.evaluate(() => { supabaseToken = 'devtok'; window.openTopUpModal(); });
    await page.waitForTimeout(400);
    await back(page);
    expect(await page.evaluate(() => document.getElementById('topUpModal').hidden)).toBe(true);
    // media search
    await page.evaluate(() => window.openMediaBrowser());
    await page.waitForTimeout(400);
    await back(page);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('mediaBrowserModal')).display)).toBe('none');
    // settings
    await page.evaluate(() => window.openSettingsV47());
    await page.waitForTimeout(400);
    await back(page);
    expect(await page.evaluate(() => !!document.getElementById('ssSet'))).toBe(false);
    // presentation
    await page.evaluate(() => window.startPresentation());
    await page.waitForFunction(() => getComputedStyle(document.getElementById('presentationOverlay')).display !== 'none', null, { timeout: 15000 });
    await page.waitForTimeout(500);
    await back(page);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('presentationOverlay')).display)).toBe('none');
    // still the same page, the same deck
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => slides[0].__marker)).toBe('mine');
  });

  test('U5: closing with X removes the extra history entry; nested windows close one by one', async ({ page }) => {
    await openEditor(page);
    const len0 = await page.evaluate(() => history.length);
    await page.evaluate(() => { supabaseToken = 'devtok'; window.openTopUpModal(); });
    await page.waitForTimeout(400);
    await page.click('#topUpModal [data-tu-close]');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => SSBackNav.state().depth)).toBe(0);
    // two windows: settings, then the language menu on top of it
    await page.evaluate(() => window.openSettingsV47());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('ssLangBtn').click());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => SSBackNav.state().stack)).toEqual(['settings', 'lang']);
    await back(page);
    expect(await page.evaluate(() => document.getElementById('ssLangMenu').classList.contains('open'))).toBe(false);
    expect(await page.evaluate(() => !!document.getElementById('ssSet'))).toBe(true);           // only the top one closed
    await back(page);
    expect(await page.evaluate(() => !!document.getElementById('ssSet'))).toBe(false);
    expect(await page.evaluate(() => history.length)).toBeGreaterThanOrEqual(len0);
  });
});

test('U2: the deck survives a reload; a confirmed logout deletes it', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    projectTitle = 'Mening taqdimotim'; document.getElementById('presentationTitle').innerText = projectTitle;
    slides.push({ json: JSON.stringify({ objects: [{ type: 'textbox', text: 'Saqlanadigan matn', left: 50, top: 50, width: 300 }], background: '#fef3c7' }), thumb: '', imageNumbers: [] });
    slides.push({ json: JSON.stringify({ objects: [], background: '#dbeafe' }), thumb: '', imageNumbers: [] });
    renderSidebar();
    await window.ssPersistNow();
  });
  await page.reload();
  await page.waitForFunction(() => typeof canvas !== 'undefined' && canvas && Array.isArray(slides) && slides.length > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => slides.length === 3, null, { timeout: 15000 });
  const s = await page.evaluate(() => ({ n: slides.length, title: projectTitle, txt: slides[1].json.indexOf('Saqlanadigan matn') >= 0 }));
  expect(s).toEqual({ n: 3, title: 'Mening taqdimotim', txt: true });
  // logout (confirmed) -> the draft is gone
  await page.evaluate(() => { window.location.reload = () => {}; });
  const p = page.evaluate(() => handleLogout());
  await page.waitForSelector('#ssConfirm.open');
  await page.click('#ssConfirm [data-ss-ok]');
  expect(await p).toBe(true);
  expect(await page.evaluate(() => window.ssLoadSavedProject())).toBeNull();
});

test('U2: a draft belongs to its account only', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    window._ssAuthUid = 'user-A';
    slides.push({ json: JSON.stringify({ objects: [], background: '#000000' }), thumb: '', imageNumbers: [] });
    await window.ssPersistNow();
    const mine = await window.ssLoadSavedProject();
    window._ssAuthUid = 'user-B';
    const other = await window.ssLoadSavedProject();
    window._ssAuthUid = '';
    return { mine: !!(mine && mine.slides.length === 2), other };
  });
  expect(r).toEqual({ mine: true, other: null });
});

test('U3: «Chiqish» asks first — red «Chiqish», grey «Bekor qilish»; cancel keeps the session', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { SSI18n.set('uz'); supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; window.location.reload = () => {}; });
  let p = page.evaluate(() => handleLogout());
  await page.waitForSelector('#ssConfirm.open');
  const ui = await page.evaluate(() => {
    const d = document.getElementById('ssConfirm');
    const ok = d.querySelector('[data-ss-ok]'), no = d.querySelector('[data-ss-cancel]');
    return { text: d.innerText, ok: ok.innerText, no: no.innerText, okBg: getComputedStyle(ok).backgroundColor, noBg: getComputedStyle(no).backgroundColor };
  });
  expect(ui.text).toContain('Haqiqatan ham akkauntdan chiqmoqchimisiz?');
  expect(ui.ok).toBe('Chiqish');
  expect(ui.no).toBe('Bekor qilish');
  expect(ui.okBg).toBe('rgb(220, 38, 38)');          // red
  expect(ui.noBg).toBe('rgb(229, 231, 235)');        // grey
  await page.click('#ssConfirm [data-ss-cancel]');
  expect(await p).toBe(false);
  expect(await page.evaluate(() => currentUserEmail)).toBe('t@e2e.uz');
  p = page.evaluate(() => handleLogout());
  await page.waitForSelector('#ssConfirm.open');
  await page.click('#ssConfirm [data-ss-ok]');
  expect(await p).toBe(true);
  expect(await page.evaluate(() => currentUserEmail)).toBe('');
  // the same window in English (the site's own translator, not the browser's)
  await page.evaluate(() => SSI18n.set('en'));
  p = page.evaluate(() => handleLogout());
  await page.waitForSelector('#ssConfirm.open');
  await page.waitForTimeout(200);
  expect(await page.innerText('#ssConfirm')).toContain('Do you really want to sign out?');
  await page.click('#ssConfirm [data-ss-cancel]');
  expect(await p).toBe(false);
});

test('U4: browser auto-translate is blocked for the page, the slides and the presentation', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => ({
    html: document.documentElement.getAttribute('translate'),
    meta: !!document.querySelector('meta[name="google"][content="notranslate"]'),
    canvas: document.getElementById('canvasWrapper').getAttribute('translate'),
    pres: document.getElementById('presentationOverlay').getAttribute('translate'),
  }));
  expect(r).toEqual({ html: 'no', meta: true, canvas: 'no', pres: 'no' });
  await page.evaluate(() => window.startPresentation());
  await page.waitForFunction(() => document.querySelector('#presentationOverlay iframe, iframe[srcdoc]'), null, { timeout: 15000 });
  const inner = await page.evaluate(() => {
    const f = document.querySelector('#presentationOverlay iframe') || document.querySelector('iframe[srcdoc]');
    return (f.getAttribute('srcdoc') || '').slice(0, 300);
  });
  expect(inner).toContain('translate="no"');
  expect(inner).toContain('notranslate');
});
