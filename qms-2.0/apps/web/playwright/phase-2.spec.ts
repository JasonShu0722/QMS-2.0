import { test, expect } from '@playwright/test';
const baseUrl = process.env.QMS_PHASE2_BASE_URL ?? process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
if (!baseUrl) throw new Error('A real gateway URL is required; skipping is forbidden');
test('phase two login entry loads in the real browser', async ({ page }) => {
  await page.goto(`${baseUrl}/login`);
  await expect(page).toHaveURL(/login/);
});
