import 'reflect-metadata';
import { PasswordHasherService } from '../../src/common/security/password-hasher.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService(new PasswordHasherService());

  it('hashes with Argon2id and verifies only the matching password', async () => {
    const encoded = await service.hash('A strong passphrase!');

    expect(encoded).toMatch(/^\$argon2id\$/);
    await expect(service.verify(encoded, 'A strong passphrase!')).resolves.toBe(true);
    await expect(service.verify(encoded, 'wrong')).resolves.toBe(false);
  });

  it('treats a malformed stored hash as a failed verification', async () => {
    await expect(service.verify('not-an-argon2-hash', 'anything')).resolves.toBe(false);
  });
});
