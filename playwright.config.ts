import { defineConfig, devices } from '@playwright/test';

/**
 * Browser acceptance run (blueprint §9: "use real browser tests for interaction
 * where possible"). The sandbox this was written in has no browser binaries and
 * no access to the Playwright download host, so the suite is executed in CI
 * (`npm run test:e2e`) — and, when Playwright is installed locally, by hand.
 *
 * The server is started by `scripts/e2e-server.mts`: it creates an isolated
 * `.e2e-data` directory, seeds a fictional household (never the real appdata),
 * and runs `next dev` with the development identity bypass — the bypass is
 * impossible in production by construction (`src/lib/config.ts`).
 */
export default defineConfig({
  testDir: './e2e',
  // One worker: these tests share a single server and database, and one of them
  // deliberately restores an archive over the installation.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The `github` reporter turns each failure into an annotation, so a failed CI
  // run is diagnosable from the API without downloading job logs.
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A phone-ish default; desktop specs override the viewport.
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'mobile',
      testMatch: /home\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop',
      testMatch: /desktop\.spec\.ts/,
      use: { viewport: { width: 1400, height: 950 } },
    },
    {
      name: 'backup',
      testMatch: /backup\.spec\.ts/,
      use: { viewport: { width: 1400, height: 950 } },
    },
  ],
  webServer: {
    command: 'node --import tsx scripts/e2e-server.mts',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
