import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { fillSecret } from './secret-input';

const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
const { TOTP, Secret } = requireApi('otpauth');
type Login = components['schemas']['LoginResponseDto'];
type AuthenticationResponse = Pick<APIResponse, 'status' | 'json'>;
const cachePath = process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE;
function key() {
  if (!cachePath || !isAbsolute(cachePath) || !process.env.QMS_BACKUP_KEY) throw new Error('Disposable MFA acceptance requires an external encrypted cache and key');
  const location = relative(resolve(process.cwd(), '../../..'), cachePath);
  if (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location)) throw new Error('Acceptance secrets must remain outside the checkout');
  const value = Buffer.from(process.env.QMS_BACKUP_KEY, 'base64');
  if (value.length !== 32) throw new Error('Invalid acceptance key');
  return value;
}
function readCache(): Record<string, string[]> {
  const encryptionKey = key(); if (!existsSync(cachePath!)) return {};
  const bytes = readFileSync(cachePath!); const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
}
function writeCache(cache: Record<string, string[]>) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(cache)), cipher.final()]);
  writeFileSync(cachePath!, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
}
async function post(client: APIRequestContext, path: string, data?: object) {
  const csrf = await client.get('/api/v1/auth/csrf'); expect(csrf.status()).toBe(200);
  return client.post(`/api/v1/${path}`, { headers: { 'x-csrf-token': (await csrf.json()).csrfToken }, data });
}
export async function completeMfa(client: APIRequestContext, response: AuthenticationResponse, identifier: string, page?: Page): Promise<Login> {
  expect(response.status()).toBe(200);
  const login = await response.json() as Login;
  if (login.securityState === 'AUTHENTICATED') return login;
  const cache = readCache(); let authenticated: AuthenticationResponse;
  if (login.securityState === 'MFA_ENROLLMENT_REQUIRED') {
    let enrollment: AuthenticationResponse;
    if (page) {
      await expect(page).toHaveURL(/\/mfa$/);
      const pending = page.waitForResponse((entry) => entry.url().endsWith('/me/mfa/enrollment'));
      await page.getByRole('button', { name: '启用 MFA', exact: true }).click(); enrollment = await pending;
    } else enrollment = await post(client, 'me/mfa/enrollment');
    expect(enrollment.status()).toBe(200);
    const enrolled = await enrollment.json() as components['schemas']['MfaEnrollmentDto'];
    const code = new TOTP({ secret: Secret.fromBase32(enrolled.secret), period: 30, digits: 6 }).generate();
    if (page) {
      await fillSecret(page.getByLabel('验证码或恢复码'), code);
      const pending = page.waitForResponse((entry) => entry.url().endsWith('/me/mfa/enrollment/confirm'));
      await page.getByRole('button', { name: /^验\s*证$/ }).click(); authenticated = await pending;
    } else authenticated = await post(client, 'me/mfa/enrollment/confirm', { code });
    expect(authenticated.status()).toBe(200);
    cache[identifier] = (await authenticated.json()).recoveryCodes; writeCache(cache);
    if (page) await page.getByRole('button', { name: '已保存，继续', exact: true }).click();
  } else {
    const code = cache[identifier]?.shift(); if (!code) throw new Error('MFA acceptance recovery cache unavailable for disposable account');
    writeCache(cache);
    if (page) {
      await expect(page).toHaveURL(/\/mfa$/);
      await fillSecret(page.getByLabel('验证码或恢复码'), code);
      const pending = page.waitForResponse((entry) => entry.url().endsWith('/auth/mfa/verify'));
      await page.getByRole('button', { name: /^验\s*证$/ }).click(); authenticated = await pending;
    } else authenticated = await post(client, 'auth/mfa/verify', { code });
    expect(authenticated.status()).toBe(200);
  }
  if ((cache[identifier]?.length ?? 0) < 3) {
    const regenerated = await post(client, 'me/mfa/recovery-codes'); expect(regenerated.status()).toBe(200);
    cache[identifier] = (await regenerated.json()).recoveryCodes; writeCache(cache);
  }
  return await authenticated.json() as Login;
}
