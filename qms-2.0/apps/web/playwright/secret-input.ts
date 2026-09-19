import type { Locator } from '@playwright/test';

export async function fillSecret(locator: Locator, secret: string, options?: { timeout?: number }) {
  let phase = 'waiting for an editable field';
  try {
    await locator.fill('', options);
    phase = 'opening the Chromium input session';
    const session = await locator.page().context().newCDPSession(locator.page());
    try {
      phase = 'inserting the value';
      await session.send('Input.insertText', { text: secret });
      phase = 'verifying the field value';
      if ((await locator.inputValue(options)) !== secret) throw new Error('Input value mismatch');
    } finally {
      await session.detach();
    }
  } catch {
    throw new Error(`Secret input failed while ${phase}; value redacted.`);
  }
}
