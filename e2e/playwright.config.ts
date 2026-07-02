import { defineConfig, devices } from '@playwright/test';

export const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://skillescrow:skillescrow@localhost:5432/skillescrow_e2e';
const secrets = { SESSION_SECRET: 's'.repeat(32), CSRF_SECRET: 'c'.repeat(32), GITHUB_WEBHOOK_SECRET: 'e2e-webhook-secret' };

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @skillescrow/api exec tsx src/index.ts',
      url: 'http://localhost:3101/health', reuseExistingServer: false, stdout: 'pipe', stderr: 'pipe', timeout: 60_000,
      env: { ...secrets, PORT: '3101', DATABASE_URL: E2E_DB, LOG_LEVEL: 'silent', BOUNTY_CONTRACT_ID: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V', REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379/2' },
    },
    {
      command: 'pnpm --filter @skillescrow/web exec next start -p 3100',
      url: 'http://localhost:3100/docs', reuseExistingServer: false, stdout: 'pipe', stderr: 'pipe', timeout: 60_000,
      env: { API_INTERNAL_URL: 'http://localhost:3101', NEXT_PUBLIC_TOKEN_USDC: 'CUSDCE2E' },
    },
  ],
});
