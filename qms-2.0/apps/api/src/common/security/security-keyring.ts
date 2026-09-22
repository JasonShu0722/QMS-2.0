import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';

function keys() {
  try {
    const current = process.env.QMS_SECURITY_CURRENT_KEY_ID;
    const encoded = JSON.parse(process.env.QMS_SECURITY_KEYRING ?? '{}') as Record<string, string>;
    const entries = new Map(Object.entries(encoded).map(([id, value]) => [id, Buffer.from(value, 'base64')]));
    if (!current || !entries.has(current) || [...entries.values()].some((value) => value.length !== 32)) throw new Error();
    return { current, entries };
  } catch {
    throw new HttpException({ code: 'AUTH_SECURITY_KEY_UNAVAILABLE', message: '安全密钥配置不可用' }, 503);
  }
}

export function encryptSecret(plaintext: string, context: string): string {
  const { current, entries } = keys();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', entries.get(current)!, nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, keyId: current, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}

export function adminMutationDigests(canonicalPayload: string, legacySecret: string): string[] {
  const sign = (key: string | Buffer) => createHmac('sha256', key).update('qms:admin-mutation:v1\0').update(canonicalPayload).digest('hex');
  if (!process.env.QMS_SECURITY_KEYRING && process.env.NODE_ENV !== 'production') return [sign(legacySecret)];
  const { current, entries } = keys();
  return [...new Set([sign(entries.get(current)!), ...[...entries.values()].map(sign), sign(process.env.QMS_ADMIN_LEGACY_DIGEST_SECRET ?? legacySecret)])];
}

export function decryptSecret(envelope: string, context: string): string {
  const { entries } = keys();
  try {
    const payload = JSON.parse(envelope) as { version: number; keyId: string; nonce: string; tag: string; ciphertext: string };
    const key = entries.get(payload.keyId);
    if (payload.version !== 1 || !key) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.nonce, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new HttpException({ code: 'AUTH_SECURITY_KEY_UNAVAILABLE', message: '安全密钥配置不可用' }, 503);
  }
}
