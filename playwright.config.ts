import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
if (!process.env.DATABASE_URL?.includes('/forno_test'))
  throw new Error('E2E-Tests benötigen die separate forno_test-Datenbank.');
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: process.env.APP_ORIGIN ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_PRODUCTION ? 'npm run start' : 'npm run dev -- --hostname 127.0.0.1',
    url: process.env.APP_ORIGIN ?? 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
