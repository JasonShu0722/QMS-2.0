import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: 'process-eight-d-workspace-181.acceptance.ts',
});
