import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';

describe('account batch PostgreSQL partial commit and replay', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => { f = await accountDeliveryFixture(); });
  afterAll(async () => { await f?.close(); });

  it('commits a valid row and records duplicate and invalid email errors without persisting secrets', async () => {
    const username = `batch-${randomUUID()}`;
    const body = { organizationId: f.organization.id, rows: [
      { rowNumber: 2, username, accountType: 'INTERNAL' },
      { rowNumber: 3, username, accountType: 'INTERNAL' },
      { rowNumber: 4, username: `bad-${randomUUID()}`, email: 'invalid-email', accountType: 'INTERNAL' },
    ] };
    const key = randomUUID();
    const first = await f.post('/admin/users/batch', body, key).expect(201);
    expect(first.body.rows.map((row: { status: string }) => row.status)).toEqual(['SUCCESS', 'ERROR', 'ERROR']);
    expect(first.body.rows[0].temporaryPassword).toMatchObject({ status: 'AVAILABLE', temporaryPassword: expect.any(String) });
    expect(first.body.rows[1].code).toBe('ADMIN_USER_DUPLICATE');
    expect(first.body.rows[2].code).toBe('ADMIN_BATCH_ROW_INVALID');
    const replay = await f.post('/admin/users/batch', body, key).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(await f.prisma.user.count({ where: { organizationId: f.organization.id, username } })).toBe(1);
    const raw = await f.prisma.$queryRaw<Array<{ result: unknown }>>`SELECT result FROM account_batch_rows WHERE batch_id = ${first.body.batchId}::uuid`;
    expect(JSON.stringify(raw)).not.toContain(first.body.rows[0].temporaryPassword.temporaryPassword);
    await f.post('/admin/users/batch', { ...body, rows: body.rows.slice(0, 1) }, key).expect(409);
    const result = first.body.rows[0];
    const login = await f.login(username, result.temporaryPassword.temporaryPassword).expect(200);
    await f.post('/auth/password-change/complete', { newPassword: 'permanent-after-batch-password' }, undefined, f.challengeCookie(login)).expect(200);
    const after = await f.post('/admin/users/batch', body, key).expect(201);
    expect(after.body.rows[0].temporaryPassword).not.toHaveProperty('temporaryPassword');
  });

  it('rejects batch limits and cross organization requests before creating any rows', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ rowNumber: index + 2, username: `limit-${randomUUID()}`, accountType: 'INTERNAL' }));
    await f.post('/admin/users/batch', { organizationId: f.organization.id, rows }).expect(400);
    await f.post('/admin/users/batch', { organizationId: randomUUID(), rows: rows.slice(0, 1) }).expect(403);
    expect(await f.prisma.user.count({ where: { username: { in: rows.map((row) => row.username) } } })).toBe(0);
  });

  it('lets create-only actors create without exposing reset-protected temporary passwords', async () => {
    const assignment = await f.prisma.rolePermission.findFirstOrThrow({ where: { roleId: (await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } })).roleId, permission: { code: 'account:users:reset' } } });
    await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: assignment.roleId, permissionId: assignment.permissionId } } });
    try {
      const username = `create-only-${randomUUID()}`;
      const response = await f.post('/admin/users/batch', { organizationId: f.organization.id, rows: [{ rowNumber: 2, username, accountType: 'INTERNAL' }] }).expect(201);
      expect(response.body.rows[0]).toMatchObject({ username, status: 'SUCCESS', temporaryPassword: { status: 'UNAVAILABLE' } });
      expect(response.body.rows[0].temporaryPassword).not.toHaveProperty('temporaryPassword');
      expect(await f.prisma.user.count({ where: { username } })).toBe(1);
    } finally { await f.prisma.rolePermission.create({ data: { roleId: assignment.roleId, permissionId: assignment.permissionId } }); }
  });

  it('resumes after a later row audit failure without duplicating previously committed users', async () => {
    const rows = [2, 3, 4].map((rowNumber) => ({ rowNumber, username: `resume-${randomUUID()}`, accountType: 'INTERNAL' }));
    const body = { organizationId: f.organization.id, rows };
    const key = randomUUID();
    const audit = f.app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (...args) => {
      if (args[0].action === 'USER_CREATED' && args[0].metadata?.rowNumber === 3) throw new Error('audit unavailable');
      return original(...args);
    });
    try { await f.post('/admin/users/batch', body, key).expect(500); }
    finally { spy.mockRestore(); }
    expect(await f.prisma.user.count({ where: { username: { in: rows.map((row) => row.username) } } })).toBe(1);
    const replay = await f.post('/admin/users/batch', body, key).expect(201);
    expect(replay.body.rows.every((row: { status: string }) => row.status === 'SUCCESS')).toBe(true);
    expect(await f.prisma.user.count({ where: { username: { in: rows.map((row) => row.username) } } })).toBe(3);
  });
});
