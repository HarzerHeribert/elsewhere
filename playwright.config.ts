import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { isolatedAppEnvironment } from './scripts/test-environment';

const testDataDir = join(tmpdir(), `elsewhere-e2e-run-${randomUUID()}`);
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Prefer the actual local GPU for the detailed 3D scene; CI can explicitly select software.
const webglBackend =
  process.env.PLAYWRIGHT_WEBGL_BACKEND || (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync(systemChrome) ? systemChrome : undefined);

/** A separate, local-only instance. Never uses the owner's database, key, or model. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalTeardown: './tests/e2e/teardown.ts',
  metadata: {
    testDataDirectory: testDataDir,
    keepTestData: process.env.ELSEWHERE_KEEP_TEST_DATA === '1',
  },
  // Detailed PBR scenes also run in software WebGL on CI; retain bounded actions/assertions.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: './test-results/e2e',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    actionTimeout: 10_000,
    viewport: { width: 1440, height: 1100 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath,
      args: [
        '--enable-webgl',
        `--use-angle=${webglBackend}`,
        ...(webglBackend === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : []),
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5175/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    env: isolatedAppEnvironment({
      dataDirectory: testDataDir,
      port: 4015,
      webPort: 5175,
      ownerToken: 'elsewhere-e2e-local-test-credential-only-2026',
    }),
  },
});
