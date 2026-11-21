import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: ['ledger-sticky.component.ts', 'ledger-toolbar-geometry.spec.ts'],
  use: { ...config.use, baseURL: 'http://127.0.0.1:5197' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5197 --strictPort',
    url: 'http://127.0.0.1:5197/playwright/ledger-fixture.html',
  },
});
