// v82.8: CDN (cdnjs / jsdelivr) blocked -> the editor, login library and dialogs load from /js/vendor/.
const { test, expect } = require('@playwright/test');

test('CDN blocked: editor, Supabase and dialogs still work from our own server', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|telegram\.org)\//, (r) => r.abort('connectionrefused'));
  await page.goto('/');
  await page.waitForFunction(() => typeof canvas !== 'undefined' && canvas && Array.isArray(slides) && slides.length > 0,
    null, { timeout: 30000 });
  const libs = await page.evaluate(() => ({ fabric: !!window.fabric, supabase: !!(window.supabase && window.supabase.createClient),
                                            swal: !!(window.Swal && window.Swal.fire) }));
  expect(libs).toEqual({ fabric: true, supabase: true, swal: true });
  // a dialog really opens
  await page.evaluate(() => { Swal.fire({ title: 'Salom' }); });
  await expect(page.locator('.swal2-popup')).toBeVisible();
  // only the optional export libraries (not vendored) may be missing — nothing else breaks the page
  expect(errors.filter((e) => !/jspdf|PDFLib|PptxGenJS|JSZip|pdfjsLib/i.test(e))).toEqual([]);
});
