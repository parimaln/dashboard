import { defineConfig } from '@playwright/test';

/**
 * The layout suite runs against the real server in MOCK=1 mode, so it exercises
 * the actual production bundle and the actual SSE path — just with fixtures
 * instead of upstreams.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8099',
    trace: 'retain-on-failure',
    launchOptions: {
      // Use a preinstalled Chromium when the environment provides one
      // (CI images and sandboxes often ship the full browser but not the
      // headless shell Playwright would otherwise download).
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    },
  },
  projects: [
    {
      // The target display: 4096x2160 is DCI 4K, 1.896:1 — not 16:9.
      name: 'tv-4k',
      use: { viewport: { width: 4096, height: 2160 }, deviceScaleFactor: 1 },
    },
    {
      // A developer's laptop, to prove the layout is resolution-agnostic.
      name: 'laptop',
      use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: 'npm run build && MOCK=1 PORT=8099 npm start',
    url: 'http://127.0.0.1:8099/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { MOCK: '1', PORT: '8099' },
  },
});
