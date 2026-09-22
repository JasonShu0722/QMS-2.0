import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../../src/common/security/security-keyring.js';

describe('authenticated security keyring', () => {
  const originalKeys = process.env.QMS_SECURITY_KEYRING;
  const originalCurrent = process.env.QMS_SECURITY_CURRENT_KEY_ID;

  afterEach(() => {
    if (originalKeys === undefined) delete process.env.QMS_SECURITY_KEYRING;
    else process.env.QMS_SECURITY_KEYRING = originalKeys;
    if (originalCurrent === undefined) delete process.env.QMS_SECURITY_CURRENT_KEY_ID;
    else process.env.QMS_SECURITY_CURRENT_KEY_ID = originalCurrent;
  });

  it('rotates writes to the active key while retaining old-key decryption', () => {
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    process.env.QMS_SECURITY_KEYRING = JSON.stringify({ old: oldKey });
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'old';
    const oldEnvelope = encryptSecret('private-value', 'mfa:user-1');
    process.env.QMS_SECURITY_KEYRING = JSON.stringify({ old: oldKey, new: newKey });
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'new';
    expect(decryptSecret(oldEnvelope, 'mfa:user-1')).toBe('private-value');
    expect(JSON.parse(encryptSecret('private-value', 'mfa:user-1')).keyId).toBe('new');
    expect(oldEnvelope).not.toContain('private-value');
    expect(() => decryptSecret(oldEnvelope, 'mfa:user-2')).toThrow();
    const tampered = JSON.parse(oldEnvelope);
    tampered.ciphertext = randomBytes(13).toString('base64');
    expect(() => decryptSecret(JSON.stringify(tampered), 'mfa:user-1')).toThrow();
  });

  it('fails closed when key configuration is absent or malformed', () => {
    delete process.env.QMS_SECURITY_KEYRING;
    delete process.env.QMS_SECURITY_CURRENT_KEY_ID;
    expect(() => encryptSecret('secret', 'purpose')).toThrow();
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'short';
    process.env.QMS_SECURITY_KEYRING = JSON.stringify({ short: 'short' });
    expect(() => encryptSecret('secret', 'purpose')).toThrow();
  });
});
