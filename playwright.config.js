import { defineConfig } from '@playwright/test';

// E2E berjalan terhadap build mode demo (Google palsu di browser), jadi tidak butuh kredensial.
const PORT = 5199;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    // Bila browser Playwright tidak terunduh, arahkan ke Chromium yang sudah ada: CHROMIUM_PATH=/path/ke/chrome
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npx vite --mode demo --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
