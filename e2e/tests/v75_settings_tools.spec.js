// v75: Sozlamalar → «🛠 Asboblar» paneli ochilib ~1 soniyada yopilib qolardi (miniatyura yangilanishi renderSidebar() ni
// chaqirib panelni o'chirardi); 769–900px da esa toggleSidebarMenu panelni yig'ib qo'yardi.
const { test, expect } = require('@playwright/test');
const { openEditor } = require('./helpers');

const state = (page) => page.evaluate(() => ({
  open: document.getElementById('sidebar').classList.contains('open'),
  collapsed: document.getElementById('sidebar').classList.contains('collapsed'),
  panel: !!document.querySelector('#sidebar .settings-panel-inner'),
  list: !!document.querySelector('#sidebar .sidebar-slides-scroll'),
}));

test.describe('telefon', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('Asboblar paneli ochiq qoladi; Orqaga va drawer yopilishi ro\'yxatni qaytaradi', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => toggleSidebarMenu());
    await page.locator('#sidebarSettingsBtn').tap();
    await page.locator('#ssTools').tap();
    await page.waitForTimeout(2500);
    expect(await state(page)).toMatchObject({ open: true, panel: true });
    await page.evaluate(() => { scheduleSidebarRender(0); renderSidebar(); });       // avtomatik qayta chizish
    await page.waitForTimeout(300);
    expect((await state(page)).panel).toBe(true);
    await page.locator('#sidebar .settings-back-btn').tap();
    expect(await state(page)).toMatchObject({ panel: false, list: true });
    await page.locator('#sidebarSettingsBtn').tap();
    await page.locator('#ssTools').tap();
    await page.evaluate(() => toggleSidebarMenu());                                  // drawer yopildi
    expect(await state(page)).toMatchObject({ open: false, panel: false, list: true });
  });
});

test.describe('planshet 820px', () => {
  test.use({ viewport: { width: 820, height: 1180 } });
  test('Asboblar panelni yig\'ib qo\'ymaydi', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => openSettingsV47());
    await page.locator('#ssTools').click();
    await page.waitForTimeout(1500);
    expect(await state(page)).toMatchObject({ collapsed: false, panel: true });
  });
});
