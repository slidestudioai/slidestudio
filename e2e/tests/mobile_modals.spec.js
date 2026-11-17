// Phone (375x812, touch): top-up modal with the keyboard open, and the language switcher.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

async function openTopUp(page) {
  await page.evaluate(() => { supabaseToken = 'devtok'; currentUserEmail = 't@e2e.uz'; window.openTopUpModal(); });
  await page.waitForFunction(() => !document.getElementById('topUpModal').hidden);
  await page.waitForTimeout(400);
}

const layout = (page) => page.evaluate(() => {
  const vvH = window.visualViewport ? visualViewport.height : innerHeight;
  const R = (el) => { const r = el.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, vis: getComputedStyle(el).display !== 'none' && r.height > 0 }; };
  const over = (a, b) => a.vis && b.vis && a.t < b.b && b.t < a.b && a.l < b.r && b.l < a.r;
  const i = R(document.querySelector('.tu-input-wrap')), cta = R(document.getElementById('tuPayBtn')), foot = R(document.querySelector('.tu-foot'));
  const card = R(document.querySelector('.tu-card'));
  return {
    inputInView: i.t >= 0 && i.b <= vvH, ctaOverInput: over(i, cta), footOverInput: over(i, foot), cardFits: card.b <= vvH + 1,
    checked: [...document.querySelectorAll('.tu-pkg')].filter((b) => b.getAttribute('aria-checked') === 'true').length,
  };
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('top-up: 92dvh sheet (opens full size), inner scroll if needed; with the keyboard open (Android: page shrinks) the amount input stays visible and nothing covers it', async ({ page }) => {
    await openEditor(page);
    await openTopUp(page);
    const card = await page.evaluate(() => {
      const c = document.querySelector('.tu-card'); const cs = getComputedStyle(c);
      return { h: c.getBoundingClientRect().height, max: parseFloat(cs.maxHeight), body: getComputedStyle(document.querySelector('.tu-body')).overflowY };
    });
    expect(card.max).toBeLessThanOrEqual(812 * 0.92 + 1);          // U1: was 85dvh, which cut the sheet's bottom off
    expect(card.body).toBe('auto');
    expect((await layout(page)).checked).toBe(1);                       // «Popular» preselected
    await page.tap('#tuCustomInput');
    await page.setViewportSize({ width: 375, height: 470 });            // keyboard ~340 px
    await page.waitForTimeout(800);
    await page.keyboard.type('7,5');                                    // decimal comma (uz/ru keyboards)
    await page.waitForTimeout(800);
    const l = await layout(page);
    expect(l.inputInView).toBe(true);
    expect(l.ctaOverInput).toBe(false);
    expect(l.footOverInput).toBe(false);
    expect(l.cardFits).toBe(true);
    expect(l.checked).toBe(0);                                          // typing removed the package selection
    expect(await page.inputValue('#tuCustomInput')).toBe('7,5');
    expect(await page.locator('#tuPayAmount').innerText()).toMatch(/\$8\./);
  });

  test('top-up: iOS keyboard (only visualViewport shrinks) — the sheet moves into the visible part', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      const vv = new EventTarget(); vv.width = 375; vv.height = 812; vv.offsetTop = 0; vv.offsetLeft = 0; vv.scale = 1;
      Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    });
    await openTopUp(page);
    await page.tap('#tuCustomInput');
    await page.evaluate(() => { visualViewport.height = 470; visualViewport.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(800);
    await page.keyboard.type('12');
    await page.waitForTimeout(700);
    const l = await layout(page);
    expect(l.inputInView && !l.ctaOverInput && !l.footOverInput && l.cardFits).toBe(true);
    // keyboard closed -> the pay badges / sticky button come back
    await page.evaluate(() => { document.activeElement.blur(); visualViewport.height = 812; visualViewport.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.getElementById('topUpModal').classList.contains('tu-kb'))).toBe(false);
    expect(await page.locator('.tu-foot').isVisible()).toBe(true);
  });

  test('language switcher opens on tap, is not clipped by the scrolling header, and changes the language', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => { SSI18n.set('en'); document.querySelector('.header-actions').classList.add('ss-more-left', 'ss-more-right'); });
    await page.tap('#ssLangBtn');
    const m = await page.evaluate(() => {
      const menu = document.getElementById('ssLangMenu');
      return [...menu.querySelectorAll('[data-lang]')].map((b) => {
        const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { lang: b.dataset.lang, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, hit: !!(hit && b.contains(hit)), h: r.height };
      });
    });
    expect(m.map((x) => x.lang)).toEqual(['uz', 'ru', 'en']);
    for (const x of m) { expect(x.inView).toBe(true); expect(x.hit).toBe(true); expect(x.h).toBeGreaterThanOrEqual(44); }
    await page.tap('#ssLangMenu [data-lang="ru"]');
    expect(await page.evaluate(() => SSI18n.lang)).toBe('ru');
    expect(await page.evaluate(() => document.getElementById('ssLangMenu').classList.contains('open'))).toBe(false);
    // outside tap closes an open menu
    await page.tap('#ssLangBtn');
    await page.tap('canvas.upper-canvas', { position: { x: 20, y: 20 } }).catch(() => page.mouse.click(200, 600));
    expect(await page.evaluate(() => document.getElementById('ssLangMenu').classList.contains('open'))).toBe(false);
    await page.evaluate(() => SSI18n.set('uz'));
  });
});

test('desktop: language menu still opens right under its button', async ({ page }) => {
  await openEditor(page);
  await page.click('#ssLangBtn');
  const r = await page.evaluate(() => {
    const b = document.getElementById('ssLangBtn').getBoundingClientRect(), m = document.getElementById('ssLangMenu').getBoundingClientRect();
    return { gap: m.top - b.bottom, rightAligned: Math.abs(m.right - b.right) < 2 || m.left >= 8 };
  });
  expect(r.gap).toBeGreaterThanOrEqual(0);
  expect(r.gap).toBeLessThan(20);
  expect(r.rightAligned).toBe(true);
  await page.click('#ssLangMenu [data-lang="en"]');
  expect(await page.evaluate(() => SSI18n.lang)).toBe('en');
  await page.evaluate(() => SSI18n.set('uz'));
});
