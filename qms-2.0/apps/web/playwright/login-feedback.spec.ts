import { expect, test } from '@playwright/test';
import { completeMfa } from './mfa-login';
import { FEEDBACK_FORM_URL } from '../src/features/feedback/feedback-config';

test('login toolbar shares keyboard language and appearance across viewport sizes', async ({ page }) => {
  await page.goto('/login');
  const toolbar = page.getByRole('group', { name: 'Language / 语言 · 外观设置' });
  await expect(toolbar.getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '需求反馈' })).toHaveCount(0);
  expect(await page.locator('.login-container').evaluate(el => getComputedStyle(el).backgroundImage)).toMatch(/^url\(/);
  for (const width of [1920, 1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
    const entry = await toolbar.boundingBox();
    const form = await page.locator('.login-form').boundingBox();
    expect(entry).not.toBeNull(); expect(form).not.toBeNull();
    expect(entry!.y + entry!.height <= form!.y || entry!.x >= form!.x + form!.width).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) {
      for (const button of await toolbar.getByRole('button').all()) {
        await expect.poll(async () => (await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
        await expect.poll(async () => (await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
  const language = page.getByRole('button', { name: 'Language / 语言' });
  await language.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: '简体中文' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Appearance settings' })).toBeVisible();
  await expect(language).toBeFocused();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Appearance settings' })).toBeVisible();
  await language.click(); await page.getByRole('menuitemradio', { name: '简体中文' }).click();
  await page.getByRole('button', { name: '外观设置' }).click();
  for (const [mode, value] of [['浅色', 'light'], ['深色', 'dark']]) {
    const modeOption = page.getByRole('radio', { name: mode, exact: true });
    await modeOption.focus(); await modeOption.press('Space');
    for (const [name, accent] of [['晴空蓝', 'blue'], ['湖水青', 'teal'], ['鸢尾紫', 'purple']]) {
      const accentOption = page.getByRole('radio', { name, exact: true });
      await accentOption.focus(); await accentOption.press('Space');
      await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', value);
      await expect(page.locator('html')).toHaveAttribute('data-qms-accent', accent);
    }
  }
  const systemOption = page.getByRole('radio', { name: '跟随系统', exact: true });
  await systemOption.focus(); await systemOption.press('Space');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-qms-accent', 'purple');
  await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', 'dark');
});

test('authenticated portals share native drag feedback and safe external opening', async ({ page, context, browserName }) => {
  test.setTimeout(120_000);
  const storageKey = 'qms:feedback-position:v1';
  for (const [identifier, password, portal, path] of [
    ['local.internal', process.env.QMS_SEED_INTERNAL_PASSWORD, 'internal', '/app/workbench'],
    ['local.supplier', process.env.QMS_SEED_SUPPLIER_PASSWORD, 'supplier', '/supplier/inbox'],
  ]) {
    if (!password) throw new Error('Disposable seed credential is required');
    await context.clearCookies();
    const csrf = await context.request.get('/api/v1/auth/csrf'); expect(csrf.status()).toBe(200);
    const login = await context.request.post('/api/v1/auth/login', { headers: { 'x-csrf-token': (await csrf.json()).csrfToken }, data: { identifier, password } });
    const authenticated = await completeMfa(context.request, login, identifier!);
    expect(authenticated.securityState).toBe('AUTHENTICATED');
    await page.goto(path!);
    await expect(page).toHaveURL(path!);
    const feedback = page.getByRole('button', { name: '需求反馈', exact: true });
    await expect(feedback).toHaveCount(1);
    await expect(page.locator('.qms-auth-toolbar')).toHaveCount(0);
    if (portal === 'internal') {
      await expect(page.locator('.qms-workbench a[href="/app/my-tasks"]')).toHaveCount(1);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    for (let i = 0; i < 10; i++) {
      const box = (await feedback.boundingBox())!;
      await page.mouse.move(box.x + 24, box.y + 24); await page.mouse.down();
      await page.mouse.move(i % 2 ? 1340 : 30, 200 + i * 20, { steps: 5 }); await page.mouse.up();
      expect(context.pages()).toHaveLength(1);
      const result = (await feedback.boundingBox())!;
      expect(Math.min(Math.abs(result.x - 16), Math.abs(result.x - 1302))).toBeLessThan(1);
    }
    if (browserName === 'chromium') {
      const session = await context.newCDPSession(page);
      for (let i = 0; i < 10; i++) {
        const box = (await feedback.boundingBox())!;
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 24, y: box.y + 24 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: i % 2 ? 1320 : 40, y: 180 + i * 20 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        expect(context.pages()).toHaveLength(1);
      }
      await session.detach();
    }
    for (const action of ['Enter', 'Space', 'click']) {
      await feedback.focus();
      const opened = context.waitForEvent('page');
      const outbound = context.waitForEvent('request', request => request.url() === FEEDBACK_FORM_URL);
      if (action === 'click') await feedback.click(); else await page.keyboard.press(action);
      const form = await opened;
      await expect(form).toHaveURL(FEEDBACK_FORM_URL);
      expect((await (await outbound).allHeaders()).referer).toBeUndefined();
      expect(await form.evaluate(() => window.opener === null)).toBe(true); await form.close();
    }
    await page.setViewportSize({ width: 390, height: 500 });
    await expect.poll(async () => { const box = (await feedback.boundingBox())!; return box.x + box.width; }).toBeLessThanOrEqual(374);
    const resized = (await feedback.boundingBox())!;
    expect(resized.x).toBeGreaterThanOrEqual(16); expect(resized.x + resized.width).toBeLessThanOrEqual(374);
    expect(resized.y + resized.height).toBeLessThanOrEqual(484);
    await page.evaluate(key => localStorage.setItem(key, '{bad'), storageKey); await page.reload(); await expect(feedback).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await feedback.evaluate(el => getComputedStyle(el).transitionProperty)).toBe('none');
    await page.getByRole('button', { name: '外观设置' }).click();
    const covered = await feedback.evaluate(el => { const box = el.getBoundingClientRect(); return !el.contains(document.elementFromPoint(box.x + 24, box.y + 24)); });
    expect(covered).toBe(true);
    await page.getByRole('dialog').getByRole('button', { name: /close|关闭/i }).click();
    await page.emulateMedia({ media: 'print' }); await expect(feedback).toBeHidden(); await page.emulateMedia({ media: 'screen' });
  }
});
