// Brauzer testlari. Server o'zi ishga tushadi (DEV rejim, AI/Supabase kalitlarisiz).
//   cd e2e && npm ci && npx playwright install --with-deps chromium && npm test
const { defineConfig } = require('@playwright/test');
const PORT = Number(process.env.E2E_PORT || 8765);

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'off' },
  webServer: {
    command: `python main.py`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/healthz`,
    env: { PORT: String(PORT), SLIDE_STUDIO_DEV_MODE: '1', SLIDE_STUDIO_HMAC_SECRET: 'e2e-' + 'x'.repeat(40) },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
