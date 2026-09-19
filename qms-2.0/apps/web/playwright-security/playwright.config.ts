import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'secret-input.fixture.ts',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.SECRET_INPUT_REPORT }]],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
