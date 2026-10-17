import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { TemporaryPasswordService } from '../../src/modules/identity/temporary-password.service.js';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';

describe('temporary password PostgreSQL lifecycle', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => { f = await accountDeliveryFixture(); });
  afterAll(async () => { await f?.close(); });

  it('generates a readable random temporary password, encrypts it and persists only safe replay metadata', async () => {
    const target = await f.target();
    const token = await f.app.get(SessionService).create(target.id);
    const key = randomUUID();
    const reset = await f.reset(target.id, {}, key).expect(201);
    expect(reset.body).toMatchObject({ userId: target.id, status: 'AVAILABLE' });
    expect(reset.body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await f.read(target.id).expect(201)).body.temporaryPassword).toBe(reset.body.temporaryPassword);
    expect((await f.reset(target.id, {}, key).expect(201)).body.temporaryPassword).toBe(reset.body.temporaryPassword);
    expect(await f.app.get(SessionService).resolve(token)).toBeNull();
    const persisted = await f.prisma.adminMutation.findMany({ where: { key } });
    expect(JSON.stringify(persisted)).not.toContain(reset.body.temporaryPassword);
    expect(JSON.stringify(await f.prisma.auditEvent.findMany({ where: { resourceId: target.id } }))).not.toContain(reset.body.temporaryPassword);
    const raw = await f.prisma.$queryRaw<Array<{ encrypted_value: string }>>`SELECT encrypted_value FROM user_temporary_passwords WHERE user_id = ${target.id}::uuid`;
    expect(raw[0].encrypted_value).not.toContain(reset.body.temporaryPassword);
    expect((await f.post('/admin/users', { organizationId: f.organization.id, username: `plain-${randomUUID()}`, accountType: 'INTERNAL', initialPassword: 'existing-single-user-password' }).expect(201)).body).not.toHaveProperty('passwordHash');
  });

  it('expires immediately for reads and login regardless of maintenance scheduling', async () => {
    const target = await f.target();
    const result = await f.reset(target.id).expect(201);
    await f.prisma.$executeRaw`UPDATE user_temporary_passwords SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = ${target.id}::uuid`;
    const expired = await f.read(target.id).expect(201);
    expect(expired.body).toMatchObject({ status: 'EXPIRED' });
    expect(expired.body).not.toHaveProperty('temporaryPassword');
    await f.login(target.username, result.body.temporaryPassword).expect(401);
  });

  it('refuses resetting the current administrator into an unrecoverable response', async () => {
    const before = await f.prisma.user.findUniqueOrThrow({ where: { id: f.actor.id } });
    await f.reset(f.actor.id).expect(409);
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: f.actor.id } })).credentialVersion).toBe(before.credentialVersion);
  });

  it('does not resurrect an old reset on idempotent replay and keeps credential reset compatible', async () => {
    const target = await f.target();
    const key = randomUUID();
    const old = await f.reset(target.id, {}, key).expect(201);
    const current = await f.reset(target.id, { temporaryPassword: 'administrator-selected-password' }).expect(201);
    expect(current.body.temporaryPassword).toBe('administrator-selected-password');
    const replay = await f.reset(target.id, {}, key).expect(201);
    expect(replay.body).not.toHaveProperty('temporaryPassword');
    await f.login(target.username, old.body.temporaryPassword).expect(401);
    const code = randomUUID();
    const credential = await f.post(`/admin/users/${target.id}/password-reset`, { temporaryCode: code }).expect(201);
    await f.post('/auth/password-reset/complete', { resetId: credential.body.resetId, temporaryCode: code, newPassword: 'credential-exchanged-password' }).expect(204);
    expect((await f.read(target.id).expect(201)).body).not.toHaveProperty('temporaryPassword');
    expect((await f.login(target.username, 'credential-exchanged-password').expect(200)).body.securityState).toBe('AUTHENTICATED');
  });

  it('requires reset permission and all target role organizations before returning a secret', async () => {
    const target = await f.target();
    await f.reset(target.id).expect(201);
    const foreign = await f.prisma.organization.create({ data: { code: `FOREIGN-${randomUUID()}`, name: 'Foreign', type: 'INTERNAL' } });
    const role = await f.prisma.role.create({ data: { organizationId: foreign.id, code: 'FOREIGN', name: 'Foreign' } });
    await f.prisma.userRole.create({ data: { userId: target.id, roleId: role.id, organizationId: foreign.id } });
    await f.read(target.id).expect(403);
    await f.reset(target.id).expect(403);
    await f.prisma.userRole.deleteMany({ where: { roleId: role.id } });
    await f.prisma.organization.delete({ where: { id: foreign.id } });
    const ordinary = await f.target();
    const token = await f.app.get(SessionService).create(ordinary.id);
    await f.post(`/admin/users/${target.id}/temporary-password/read`, {}, undefined, `qms_session=${token}; qms_csrf=${f.csrf}`).expect(403);
  });

  it('rolls back reset and refuses read when audit fails', async () => {
    const target = await f.target();
    const initial = await f.reset(target.id).expect(201);
    const before = await f.prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const record = jest.spyOn(f.app.get(AuditLogService), 'record').mockRejectedValue(new Error('audit unavailable'));
    try {
      await f.reset(target.id).expect(500);
      await f.read(target.id).expect(500);
    } finally { record.mockRestore(); }
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).credentialVersion).toBe(before.credentialVersion);
    expect((await f.read(target.id).expect(201)).body.temporaryPassword).toBe(initial.body.temporaryPassword);
  });

  it('keeps only the current password after concurrent reset attempts and purges expired ciphertext idempotently', async () => {
    const target = await f.target();
    const results = await Promise.all([f.reset(target.id), f.reset(target.id)]);
    expect(results.every((response) => [201, 409].includes(response.status))).toBe(true);
    expect(results.some((response) => response.status === 201)).toBe(true);
    const current = await f.read(target.id).expect(201);
    for (const result of results.filter((response) => response.status === 201)) {
      await f.login(target.username, result.body.temporaryPassword).expect(result.body.temporaryPassword === current.body.temporaryPassword ? 200 : 401);
    }
    await f.prisma.$executeRaw`UPDATE user_temporary_passwords SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = ${target.id}::uuid`;
    await f.app.get(TemporaryPasswordService).purgeExpired();
    await f.app.get(TemporaryPasswordService).purgeExpired();
    expect(await f.prisma.userTemporaryPassword.count({ where: { userId: target.id } })).toBe(0);
    await f.login(target.username, current.body.temporaryPassword).expect(401);
  });
});
