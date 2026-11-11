import { defineConfig, devices } from '@playwright/test';

const PORT = 4202;

/** Browser tests run against the production build of the site, under the same /nazar/ path as GitHub Pages. */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // The live charts animate; too many browsers at once starve each other on a laptop.
  workers: process.env.CI ? 2 : 4,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/nazar/`,
    trace: 'retain-on-failure',
    channel: process.env.CI ? undefined : 'chrome',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run site:build && npm run site:preview',
    url: `http://localhost:${PORT}/nazar/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
