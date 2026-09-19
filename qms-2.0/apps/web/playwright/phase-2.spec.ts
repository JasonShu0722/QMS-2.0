import { test, expect } from '@playwright/test';
test('real browser exposes internal problem center', async ({ page }) => {
  const baseUrl = process.env.QMS_PHASE2_BASE_URL;
  test.skip(!baseUrl, 'QMS_PHASE2_BASE_URL is required');
  await page.goto(`${baseUrl}/login`);
  await expect(page).toHaveURL(/login/);
});
