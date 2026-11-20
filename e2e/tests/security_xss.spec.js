// Untrusted data never runs as code on our origin: an imported deck's fields, an imported HTML file, the account label.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

test('a crafted deck (imageNumbers / thumb with markup) does not run code in the sidebar', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    window.__xss = 0;
    slides.push({ json: JSON.stringify({ objects: [], background: '#fff' }), thumb: '" onerror="window.__xss=1" x="',
                  imageNumbers: ['<img src=x onerror="window.__xss=2">', 3] });
    renderSidebar();
    await new Promise((res) => setTimeout(res, 600));
    const item = document.querySelectorAll('#sidebar .slide-item')[slides.length - 1];
    return { xss: window.__xss, nums: item.querySelector('.img-nums') ? item.querySelector('.img-nums').textContent : '' };
  });
  expect(r.xss).toBe(0);
  expect(r.nums).toBe('#3');
});

test('an imported non-Slide-Studio HTML file opens sandboxed: it cannot read the session storage of the site', async ({ page, context }) => {
  await openEditor(page);
  await page.evaluate(() => { try { localStorage.setItem('ss-auth-v39-test', 'SECRET'); } catch (e) {} });
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(() => window.ssOpenHtmlSandboxed('<html><body><p id="m">hello</p><script>' +
      'var r; try { r = String(localStorage.getItem("ss-auth-v39-test")); } catch (e) { r = "blocked"; }' +
      'var p; try { p = String(window.parent.document.title); } catch (e) { p = "blocked"; }' +
      'document.getElementById("m").textContent = r + "|" + p + "|" + location.origin;<\/script></body></html>')),
  ]);
  await popup.waitForLoadState();
  const f = popup.frames().find((x) => x !== popup.mainFrame());
  await f.waitForSelector('#m');
  await expect.poll(() => f.textContent('#m')).toContain('|');
  const txt = await f.textContent('#m');
  expect(txt).not.toContain('SECRET');
  expect(txt.split('|')[1]).toBe('blocked');        // cannot touch the opener page either
  expect(txt.split('|')[2]).toBe('null');           // its own isolated origin
});

test('the account label is shown as text, never as markup', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    window.__xss = 0;
    currentUserEmail = '<img src=x onerror="window.__xss=3">@x.uz'; supabaseToken = 'devtok';
    renderSidebarUserProfile(document.getElementById('sidebar'));
    await new Promise((res) => setTimeout(res, 400));
    const t = document.querySelector('.sidebar-user-section');
    return { xss: window.__xss, shows: t ? t.textContent.indexOf('<img') >= 0 : false };
  });
  expect(r).toEqual({ xss: 0, shows: true });
});
