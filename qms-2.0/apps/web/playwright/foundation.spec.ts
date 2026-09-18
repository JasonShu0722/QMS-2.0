import { expect, test } from '@playwright/test';

test.skip(!process.env.PLAYWRIGHT_BASE_URL, 'Set PLAYWRIGHT_BASE_URL to smoke test a running QMS 2.0 web shell.');

test('foundation shell smoke', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'QMS 2.0' })).toBeVisible();
});
