import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import request from 'supertest';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';
import { CreateAdminUserDto } from '../../src/modules/identity/dto/admin-user.dto.js';
import { adminMutationDigests } from '../../src/common/security/security-keyring.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Position onboarding requires disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('initial positions and authorization preview on real PostgreSQL', () => {
  let f: AccountDeliveryFixture;
  let departmentId: string;
  let positionId: string;
  let roleId: string;
  let adminRoleId: string;
  const previewPath = () => `/organizations/${f.organization.id}/position-authorization/preview`;
  const preview = (positionIds = [positionId], extra = {}) => f.post(previewPath(), { positionIds, ...extra });
  const payload = (authorizationBaseline: string, positions = [positionId]) => ({ organizationId: f.organization.id, username: `onboard-${randomUUID()}`, accountType: 'INTERNAL', initialPassword: 'onboarding-test-password', positionIds: positions, authorizationBaseline });

  beforeAll(async () => {
    f = await accountDeliveryFixture();
    adminRoleId = (await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } })).roleId;
    for (const code of [...ADMIN_PERMISSIONS, 'organization:read', 'notification:read']) {
      const permission = await f.prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await f.prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: adminRoleId, permissionId: permission.id } }, create: { roleId: adminRoleId, permissionId: permission.id }, update: {} });
    }
    departmentId = (await f.prisma.department.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Onboarding department' } })).id;
    positionId = (await f.prisma.position.create({ data: { organizationId: f.organization.id, departmentId, code: randomUUID(), name: 'Onboarding position' } })).id;
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'notification:read' } });
    roleId = (await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Legacy onboarding source', permissions: { create: { permissionId: permission.id } } } })).id;
    await f.prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId, roleId } });
  });
  afterAll(async () => {
    if (f) {
      await f.prisma.userPosition.deleteMany({ where: { organizationId: f.organization.id } });
      await f.prisma.positionRole.deleteMany({ where: { organizationId: f.organization.id } });
      await f.prisma.position.deleteMany({ where: { organizationId: f.organization.id } });
      await f.prisma.department.deleteMany({ where: { organizationId: f.organization.id } });
      await f.close();
    }
  });

  it('returns a no-store read-only preview distinguishing historical sources', async () => {
    const before = await f.prisma.userPosition.count({ where: { organizationId: f.organization.id } });
    const response = await preview().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ authorizationBaseline: expect.any(String), effectivePermissionCodes: ['notification:read'], effectiveMfaRequired: false, positions: [expect.objectContaining({ id: positionId, permissionCodes: [], historicalSources: [expect.objectContaining({ roleId, permissionCodes: ['notification:read'] })] })] });
    expect(await f.prisma.userPosition.count({ where: { organizationId: f.organization.id } })).toBe(before);
  });

  it('rejects internal creation without initial positions but preserves supplier DTO validation', async () => {
    const body = payload('unused');
    const { positionIds: _positions, authorizationBaseline: _baseline, ...legacy } = body;
    await f.post('/admin/users', legacy).expect(400);
    expect(await f.prisma.user.count({ where: { username: body.username } })).toBe(0);
    expect(validateSync(plainToInstance(CreateAdminUserDto, { ...legacy, accountType: 'SUPPLIER' }))).toEqual([]);
  });

  it('creates user and appointments once and keeps the replay receipt secret-free', async () => {
    const body = payload((await preview().expect(200)).body.authorizationBaseline);
    const key = randomUUID();
    const first = await f.post('/admin/users', body, key).expect(201);
    expect((await f.post('/admin/users', body, key).expect(201)).body).toEqual(first.body);
    expect(await f.prisma.userPosition.count({ where: { userId: first.body.id, positionId } })).toBe(1);
    expect(await f.prisma.userRole.count({ where: { userId: first.body.id } })).toBe(0);
    const receipt = await f.prisma.adminMutation.findFirstOrThrow({ where: { key } });
    expect(JSON.stringify(receipt.response)).not.toContain(body.initialPassword);
    await f.post('/admin/users', { ...body, positionIds: [] }, key).expect(400);
  });

  it('allows an empty-permission position without inventing a default grant', async () => {
    const empty = await f.prisma.position.create({ data: { organizationId: f.organization.id, departmentId, code: randomUUID(), name: 'No system permission' } });
    const response = await preview([empty.id]).expect(200);
    expect(response.body.effectivePermissionCodes).toEqual([]);
    const created = await f.post('/admin/users', payload(response.body.authorizationBaseline, [empty.id])).expect(201);
    expect(await f.prisma.userPosition.count({ where: { userId: created.body.id } })).toBe(1);
    expect(await f.prisma.userRole.count({ where: { userId: created.body.id } })).toBe(0);
  });

  it.each(['mfa', 'permission', 'mapping', 'department'])('rejects a stale %s authorization baseline before creating the user', async (change) => {
    const body = payload((await preview().expect(200)).body.authorizationBaseline);
    if (change === 'mfa') await f.prisma.role.update({ where: { id: roleId }, data: { mfaRequired: true } });
    if (change === 'permission') await f.prisma.rolePermission.deleteMany({ where: { roleId } });
    if (change === 'mapping') await f.prisma.position.update({ where: { id: positionId }, data: { roleVersion: { increment: 1 } } });
    if (change === 'department') await f.prisma.department.update({ where: { id: departmentId }, data: { version: { increment: 1 } } });
    try { await f.post('/admin/users', body).expect(409); }
    finally {
      await f.prisma.role.update({ where: { id: roleId }, data: { mfaRequired: false } });
      const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'notification:read' } });
      await f.prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId, permissionId: permission.id } }, create: { roleId, permissionId: permission.id }, update: {} });
    }
    expect(await f.prisma.user.count({ where: { username: body.username } })).toBe(0);
  });

  it('rolls back user, appointment and receipt when appointment audit fails', async () => {
    const body = payload((await preview().expect(200)).body.authorizationBaseline);
    const key = randomUUID();
    const audit = f.app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (...args) => {
      if (args[0].action === 'USER_POSITIONS_REPLACED') throw new Error('appointment audit unavailable');
      return original(...args);
    });
    try { await f.post('/admin/users', body, key).expect(500); } finally { spy.mockRestore(); }
    expect(await f.prisma.user.count({ where: { username: body.username } })).toBe(0);
    expect(await f.prisma.adminMutation.count({ where: { key } })).toBe(0);
  });

  it('keeps batch row numbers and partial success; stale rows roll back before ERROR receipts', async () => {
    const baseline = (await preview().expect(200)).body.authorizationBaseline;
    const rows = [2, 7, 12].map((rowNumber) => ({ rowNumber, username: `batch-position-${randomUUID()}`, accountType: 'INTERNAL', positionIds: [positionId], authorizationBaseline: rowNumber === 7 ? 'stale' : baseline }));
    const key = randomUUID();
    const body = { organizationId: f.organization.id, rows };
    const first = await f.post('/admin/users/batch', body, key).expect(201);
    expect(first.body.rows.map((row: { status: string }) => row.status)).toEqual(['SUCCESS', 'ERROR', 'SUCCESS']);
    expect(first.body.rows.map((row: { rowNumber: number }) => row.rowNumber)).toEqual([2, 7, 12]);
    expect(first.body.rows[1].code).toBe('CONCURRENCY_CONFLICT');
    expect(await f.prisma.user.count({ where: { username: rows[1]!.username } })).toBe(0);
    for (const row of [first.body.rows[0], first.body.rows[2]]) expect(await f.prisma.userPosition.count({ where: { userId: row.userId, positionId } })).toBe(1);
    expect((await f.post('/admin/users/batch', body, key).expect(201)).body).toEqual(first.body);
    await f.post('/admin/users/batch', { ...body, rows: rows.map((row) => ({ ...row, positionIds: [] })) }, key).expect(409);
  });

  it('records new legacy three-column rows as errors without creating users', async () => {
    const username = `missing-position-${randomUUID()}`;
    const response = await f.post('/admin/users/batch', { organizationId: f.organization.id, rows: [{ rowNumber: 4, username, accountType: 'INTERNAL' }] }).expect(201);
    expect(response.body.rows[0]).toMatchObject({ rowNumber: 4, status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' });
    expect(await f.prisma.user.count({ where: { username } })).toBe(0);
  });

  it('reads an exact old batch success receipt and rejects adding positions under its key', async () => {
    const user = await f.target();
    const rows = [{ rowNumber: 2, username: user.username, email: null, accountType: 'INTERNAL' }, { rowNumber: 9, username: `old-pending-${randomUUID()}`, email: null, accountType: 'INTERNAL' }];
    const key = randomUUID();
    const requestDigest = adminMutationDigests(JSON.stringify({ organizationId: f.organization.id, rows }), process.env.QMS_RATE_LIMIT_SECRET?.trim() ?? 'qms-development-rate-limit-secret-not-for-production')[0]!;
    const batch = await f.prisma.accountBatch.create({ data: { organizationId: f.organization.id, actorId: f.actor.id, key, requestDigest } });
    await f.prisma.accountBatchRow.create({ data: { batchId: batch.id, rowNumber: 2, result: { rowNumber: 2, username: user.username, status: 'SUCCESS', userId: user.id, credentialVersion: user.credentialVersion } } });
    const body = { organizationId: f.organization.id, rows };
    const response = await f.post('/admin/users/batch', body, key).expect(201);
    expect(response.body.rows[0]).toMatchObject({ status: 'SUCCESS', userId: user.id });
    expect(response.body.rows[1]).toMatchObject({ status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' });
    expect(await f.prisma.userPosition.count({ where: { userId: user.id } })).toBe(0);
    expect((await f.prisma.accountBatch.findUniqueOrThrow({ where: { id: batch.id } })).requestDigest).toBe(requestDigest);
    const baseline = (await preview().expect(200)).body.authorizationBaseline;
    await f.post('/admin/users/batch', { ...body, rows: rows.map((row) => ({ ...row, positionIds: [positionId], authorizationBaseline: baseline })) }, key).expect(409);
  });

  it('requires assignment permissions again at submission and stops batches on 403', async () => {
    const baseline = (await preview().expect(200)).body.authorizationBaseline;
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'organization:positions:assign' } });
    await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: adminRoleId, permissionId: permission.id } } });
    try {
      await preview().expect(403);
      const body = payload(baseline);
      await f.post('/admin/users', body).expect(403);
      await f.post('/admin/users/batch', { organizationId: f.organization.id, rows: [{ rowNumber: 2, username: body.username, accountType: 'INTERNAL', positionIds: [positionId], authorizationBaseline: baseline }] }).expect(403);
      expect(await f.prisma.user.count({ where: { username: body.username } })).toBe(0);
    } finally { await f.prisma.rolePermission.create({ data: { roleId: adminRoleId, permissionId: permission.id } }); }
  });

  it('records a position grant-ceiling denial as a row error and continues valid neighbors', async () => {
    const limited = await f.prisma.position.create({ data: { organizationId: f.organization.id, departmentId, code: randomUUID(), name: 'Permission drift position' } });
    const role = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Drifting grant' } });
    await f.prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: limited.id, roleId: role.id } });
    const allowedBaseline = (await preview().expect(200)).body.authorizationBaseline;
    const limitedBaseline = (await preview([limited.id]).expect(200)).body.authorizationBaseline;
    const permission = await f.prisma.permission.upsert({ where: { code: 'workflow:manage' }, create: { code: 'workflow:manage', name: 'Manage workflows' }, update: {} });
    await f.prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    await preview([limited.id]).expect(403);
    const rows = [2, 7, 12].map((rowNumber) => ({ rowNumber, username: `ceiling-${randomUUID()}`, accountType: 'INTERNAL', positionIds: [rowNumber === 7 ? limited.id : positionId], authorizationBaseline: rowNumber === 7 ? limitedBaseline : allowedBaseline }));
    const response = await f.post('/admin/users/batch', { organizationId: f.organization.id, rows }).expect(201);
    expect(response.body.rows.map((row: { status: string }) => row.status)).toEqual(['SUCCESS', 'ERROR', 'SUCCESS']);
    expect(response.body.rows[1]).toMatchObject({ rowNumber: 7, code: 'FEATURE_PERMISSION_DENIED' });
    expect(await f.prisma.user.count({ where: { username: rows[1]!.username } })).toBe(0);
    expect(await f.prisma.userPosition.count({ where: { positionId: limited.id } })).toBe(0);
    expect(await f.prisma.accountBatchRow.count({ where: { batchId: response.body.batchId } })).toBe(3);
  });

  it('rejects disabled structures, unknown positions, duplicate IDs and unknown target users', async () => {
    await preview([randomUUID()]).expect(404);
    await preview([positionId, positionId]).expect(400);
    await preview([positionId], { targetUserId: randomUUID() }).expect(404);
    await f.prisma.department.update({ where: { id: departmentId }, data: { status: 'DISABLED' } });
    try { await preview().expect(409); }
    finally { await f.prisma.department.update({ where: { id: departmentId }, data: { status: 'ACTIVE' } }); }
  });

  it('requires CSRF on read-only POST previews', async () => {
    await f.post(previewPath(), { positionIds: [positionId] }, undefined, f.cookie.replace(/qms_csrf=[^;]+/, 'qms_csrf=wrong-token')).expect(403);
  });

  it('requires target-user read permission and retains direct sources separately', async () => {
    const user = await f.target();
    await f.prisma.userRole.create({ data: { userId: user.id, roleId, organizationId: f.organization.id } });
    const response = await preview([], { targetUserId: user.id }).expect(200);
    expect(response.body).toMatchObject({ positions: [], retainedSources: [expect.objectContaining({ roleId, permissionCodes: ['notification:read'] })], effectivePermissionCodes: ['notification:read'] });
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:read' } });
    await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: adminRoleId, permissionId: permission.id } } });
    try {
      await preview([], { targetUserId: user.id }).expect(403);
      await preview().expect(200);
    } finally { await f.prisma.rolePermission.create({ data: { roleId: adminRoleId, permissionId: permission.id } }); }
  });

  it('does not let canonical or historical sources exceed the grant ceiling', async () => {
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'notification:read' } });
    await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: adminRoleId, permissionId: permission.id } } });
    try { await preview().expect(403); }
    finally { await f.prisma.rolePermission.create({ data: { roleId: adminRoleId, permissionId: permission.id } }); }
  });

  it('previews canonical permissions separately and creates multiple appointments atomically', async () => {
    const created = await f.post(`/organizations/${f.organization.id}/positions`, { departmentId, code: randomUUID(), name: 'Canonical empty position' }).expect(201);
    const own = await f.prisma.positionRole.findFirstOrThrow({ where: { positionId: created.body.id, isCanonical: true } });
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'notification:read' } });
    await f.prisma.rolePermission.create({ data: { roleId: own.roleId, permissionId: permission.id } });
    const response = await preview([positionId, created.body.id]).expect(200);
    expect(response.body.positions.find((position: { id: string }) => position.id === created.body.id)).toMatchObject({ permissionCodes: ['notification:read'], historicalSources: [] });
    const user = await f.post('/admin/users', payload(response.body.authorizationBaseline, [created.body.id, positionId])).expect(201);
    expect(await f.prisma.userPosition.count({ where: { userId: user.body.id } })).toBe(2);
  });

  it('returns bounded effective appointment summaries on list and detail without leaking another organization', async () => {
    const user = await f.target();
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Other organization', type: 'INTERNAL' } });
    const foreign = await f.prisma.user.create({ data: { organizationId: other.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    try {
      const positions = await Promise.all(Array.from({ length: 4 }, () => f.prisma.position.create({ data: { organizationId: f.organization.id, departmentId, code: randomUUID(), name: 'Summary position' } })));
      await f.prisma.userPosition.createMany({ data: positions.map(({ id }) => ({ userId: user.id, organizationId: f.organization.id, positionId: id })) });
      const list = await request(f.app.getHttpServer()).get(`/api/v1/admin/users?organizationId=${f.organization.id}`).set('Cookie', f.cookie).expect(200);
      const summary = list.body.find((entry: { id: string }) => entry.id === user.id);
      expect(summary.totalPositions).toBe(4);
      expect(summary.positions).toHaveLength(3);
      expect(summary.positions[0]).toMatchObject({ id: expect.any(String), code: expect.any(String), name: 'Summary position', department: { id: departmentId } });
      expect(list.body.some((entry: { id: string }) => entry.id === foreign.id)).toBe(false);
      const detail = await request(f.app.getHttpServer()).get(`/api/v1/admin/users/${user.id}?organizationId=${f.organization.id}`).set('Cookie', f.cookie).expect(200);
      expect(detail.body.positions).toEqual(summary.positions);
      expect(detail.body.totalPositions).toBe(4);
      await request(f.app.getHttpServer()).get(`/api/v1/admin/users?organizationId=${other.id}`).set('Cookie', f.cookie).expect(403);
    } finally {
      await f.prisma.user.delete({ where: { id: foreign.id } });
      await f.prisma.organization.delete({ where: { id: other.id } });
    }
  });
});
