// v82.3: «Saytdan chiqasizmi?» only when the newest edits are not auto-saved yet; never on the way to Google / payment.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

async function closeAndCountDialogs(page) {
  let n = 0;
  page.on('dialog', async (d) => { if (d.type() === 'beforeunload') n++; await d.dismiss().catch(() => {}); });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 800));
  return n;
}

async function addText(page, text) {
  await page.mouse.click(5, 5);                                     // a real gesture (Chrome asks only after one)
  await page.evaluate((t) => {
    canvas.add(new fabric.Textbox(t, { left: 60, top: 60, width: 300 }));
    canvas.renderAll(); saveCurrentSlideState(); hasUnsavedChanges = true;
  }, text);
}

test('saved draft: closing the tab does not ask', async ({ page }) => {
  await openEditor(page);
  await addText(page, 'Saqlangan matn');
  await page.evaluate(() => window.ssPersistNow());
  expect(await page.evaluate(() => window.ssDraftDirty())).toBe(false);
  expect(await closeAndCountDialogs(page)).toBe(0);
});

test('an edit that is not saved yet: closing the tab asks', async ({ page }) => {
  await openEditor(page);
  await addText(page, 'Saqlangan matn');
  await page.evaluate(() => window.ssPersistNow());
  await addText(page, 'Yangi, hali saqlanmagan');
  expect(await closeAndCountDialogs(page)).toBe(1);
});

test('going to the payment page / Google never asks', async ({ page }) => {
  await openEditor(page);
  await addText(page, 'Hali saqlanmagan');
  await page.evaluate(() => { window.__ssLeaving = true; });
  expect(await closeAndCountDialogs(page)).toBe(0);
});
