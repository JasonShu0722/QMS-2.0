import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export default defineConfig({
  testDir: './playwright',
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
