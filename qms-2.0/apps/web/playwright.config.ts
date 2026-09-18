import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  },
});

