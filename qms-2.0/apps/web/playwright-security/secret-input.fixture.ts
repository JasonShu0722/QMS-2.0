import { expect, test } from '@playwright/test';
import { fillSecret } from '../playwright/secret-input';

const canary = process.env.SECRET_INPUT_CANARY!;
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

test('disabled secret input fails', async ({ page }) => {
  await page.setContent('<label>Password<input type="password" disabled></label>');
  const input = page.getByLabel('Password');
  if (process.env.SECRET_INPUT_MODE === 'baseline') await input.fill(canary, { timeout: 100 });
  else await fillSecret(input, canary, { timeout: 100 });
});

test('enabled secret input replaces the value and emits browser input', async ({ page }) => {
  await page.setContent('<label>Password<input type="password" value="old value" oninput="this.dataset.edited = event.isTrusted"></label>');
  const input = page.getByLabel('Password');
  await fillSecret(input, canary);
  expect((await input.inputValue()) === canary).toBe(true);
  await expect(input).toHaveAttribute('data-edited', 'true');
});
