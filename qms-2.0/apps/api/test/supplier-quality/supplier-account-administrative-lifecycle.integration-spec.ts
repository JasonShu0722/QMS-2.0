import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Supplier lifecycle requires explicitly disposable loopback PostgreSQL, never preview 55440.');
}

describe('REQ0031 G: profile-bound supplier account administration in the real App', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  // Keep immutable histories and receipts in the explicitly disposable database.
  afterAll(async () => { await app?.close(); });

  async function actor(platform = true) {
    const home = await prisma.organization.create({ data: { code: randomUUID(), name: 'G internal owner', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: home.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused' } });
    const codes = ['supplier-quality:profiles:read', 'supplier-quality:profiles:write', 'account:users:read', 'account:users:create', 'account:users:reset', 'account:users:status', 'account:users:delete', ...(platform ? ['platform:admin'] : [])];
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await prisma.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'G fixture', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: home.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { reauthenticated: true, mfaVerified: true });
    return { home, user, role, token };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  function http(who: { token: string }, method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object, key = randomUUID()) {
    const call = request(app.getHttpServer())[method](path).set('Cookie', [`qms_session=${who.token}`, `qms_csrf=${csrf}`]);
    return method === 'get' ? call : call.set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body ?? {});
  }
  async function profile(who: Actor) {
    return (await http(who, 'post', '/api/v1/supplier-quality/profiles', { businessCode: randomUUID(), displayName: 'G supplier' }).expect(201)).body;
  }
  function accounts(id: string) { return `/api/v1/supplier-quality/profiles/${id}/accounts`; }

  it('lets independent platform B manage only actual profile-linked accounts, delete permanently and rebuild with a new UUID', async () => {
    const a = await actor(), b = await actor();
    const p = await profile(a);
    const username = `g-${randomUUID()}`, email = `${randomUUID()}@example.test`;
    const input = { username, email };
    const creationKey = randomUUID();
    const target = (await http(a, 'post', accounts(p.id), input, creationKey).expect(201)).body;
    const scoped = `${accounts(p.id)}?organizationId=${a.home.id}`;
    const listing = (await http(b, 'get', scoped).expect(200)).body;
    expect(listing).toMatchObject({ canCreate: true, canReset: true, canSetStatus: true, canDelete: true });
    expect(listing.items.map((item: { id: string }) => item.id)).toContain(target.id);
    expect(await prisma.userRole.count({ where: { userId: b.user.id, organizationId: target.organizationId } })).toBe(0);
    await http(b, 'get', `/api/v1/admin/users?organizationId=${target.organizationId}`).expect(403);
    await http(b, 'post', `${accounts(p.id)}/${target.id}/temporary-password/reset`, { organizationId: a.home.id }).expect(201);
    const resetTarget = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const disabled = (await http(b, 'put', `${accounts(p.id)}/${target.id}/status`, { organizationId: a.home.id, status: 'DISABLED', expectedSecurityVersion: resetTarget.securityVersion }).expect(200)).body;
    const active = (await http(b, 'put', `${accounts(p.id)}/${target.id}/status`, { organizationId: a.home.id, status: 'ACTIVE', expectedSecurityVersion: disabled.securityVersion }).expect(200)).body;
    await http(b, 'post', accounts(p.id), { organizationId: a.home.id, username: `g-other-${randomUUID()}` }).expect(201);
    const expiresAt = new Date(Date.now() + 60_000);
    const session = await prisma.session.create({ data: { userId: target.id, tokenHash: randomUUID(), expiresAt, securityVersion: active.securityVersion } });
    await prisma.passwordReset.create({ data: { userId: target.id, codeHash: randomBytes(32).toString('hex'), expiresAt } });
    await prisma.mfaRecoveryCode.create({ data: { userId: target.id, codeHash: randomBytes(32).toString('hex') } });
    const signatureId = randomUUID(), approvalId = randomUUID();
    await prisma.$executeRaw`INSERT INTO user_signatures(id, organization_id, user_id, label, fingerprint) VALUES (${signatureId}::uuid, ${target.organizationId}::uuid, ${target.id}::uuid, 'G signature', ${'e'.repeat(64)})`;
    await prisma.$executeRaw`INSERT INTO approval_signatures(id, organization_id, signature_id, signer_user_id, resource_type, resource_id, resource_version, signature_fingerprint, signed_digest) VALUES (${approvalId}::uuid, ${target.organizationId}::uuid, ${signatureId}::uuid, ${target.id}::uuid, 'REPORT', 'g-report', 1, ${'e'.repeat(64)}, ${'b'.repeat(64)})`;
    const signed = await prisma.$queryRaw`SELECT * FROM approval_signatures WHERE id = ${approvalId}::uuid`;
    const problem = await prisma.supplierQualityProblem.create({ data: {
      ownerOrganizationId: a.home.id, supplierOrganizationId: target.organizationId, profileId: p.id,
      title: 'Retained supplier facts', materialCode: 'G-MATERIAL', defectDescription: 'Historical defect', defectQuantity: 1,
      severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', createdById: a.user.id,
      responseDraft: { create: { content: { facts: 'Original supplier evidence' }, updatedById: target.id } },
    }, include: { responseDraft: true } });
    const path = `${accounts(p.id)}/${target.id}?organizationId=${a.home.id}`;
    await http(b, 'delete', path, { expectedSecurityVersion: 999 }).expect(409);
    const key = randomUUID(), body = { expectedSecurityVersion: active.securityVersion };
    const deleted = (await http(b, 'delete', path, body, key).expect(200)).body;
    expect(deleted).toMatchObject({ userId: target.id, deleted: true });
    expect((await http(b, 'delete', path, body, key).expect(200)).body).toEqual(deleted);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    expect(await prisma.passwordReset.count({ where: { userId: target.id, consumedAt: null } })).toBe(0);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: target.id, consumedAt: null } })).toBe(0);
    expect(await prisma.userTemporaryPassword.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.$queryRaw`SELECT * FROM approval_signatures WHERE id = ${approvalId}::uuid`).toEqual(signed);
    expect(await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: problem.id }, include: { responseDraft: true } })).toEqual(problem);
    expect((await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: p.id } })).supplierOrganizationId).toBe(target.organizationId);
    expect((await http(b, 'get', scoped).expect(200)).body.items.map((item: { id: string }) => item.id)).not.toContain(target.id);
    await http(b, 'put', `${accounts(p.id)}/${target.id}/status`, { organizationId: a.home.id, status: 'ACTIVE', expectedSecurityVersion: active.securityVersion + 1 }).expect(404);
    await http(a, 'post', accounts(p.id), input, creationKey).expect(404);
    const rebuilt = (await http(b, 'post', accounts(p.id), { ...input, organizationId: a.home.id }).expect(201)).body;
    expect(rebuilt.id).not.toBe(target.id);
    const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: b.role.id, permissionId: marker.id } } });
    await http(b, 'delete', path, body, key).expect(403);
  }, 30_000);

  it('preserves caretaker actions but denies force deletion, portal callers and mismatched supplier targets', async () => {
    const ordinary = await actor(false), admin = await actor();
    const p = await profile(ordinary), other = await profile(ordinary);
    const first = (await http(ordinary, 'post', accounts(p.id), { username: randomUUID() }).expect(201)).body;
    const second = (await http(ordinary, 'post', accounts(other.id), { username: randomUUID() }).expect(201)).body;
    expect((await http(ordinary, 'get', accounts(p.id)).expect(200)).body.canDelete).toBe(false);
    await http(ordinary, 'post', `${accounts(p.id)}/${first.id}/temporary-password/reset`).expect(201);
    await http(ordinary, 'delete', `${accounts(p.id)}/${first.id}`, { expectedSecurityVersion: 1 }).expect(403);
    await http(admin, 'delete', `${accounts(p.id)}/${second.id}?organizationId=${ordinary.home.id}`, { expectedSecurityVersion: 1 }).expect(404);
    await http(admin, 'delete', `${accounts(randomUUID())}/${first.id}?organizationId=${ordinary.home.id}`, { expectedSecurityVersion: 1 }).expect(404);
    await http(admin, 'delete', `/api/v1/admin/users/${first.id}?organizationId=${first.organizationId}`, { expectedSecurityVersion: 1 }).expect(403);
    await prisma.user.update({ where: { id: first.id }, data: { mustChangePassword: false } });
    const token = await app.get(SessionService).create(first.id, prisma, { reauthenticated: true, mfaVerified: true });
    await http({ token }, 'delete', `${accounts(p.id)}/${second.id}?organizationId=${ordinary.home.id}`, { expectedSecurityVersion: 1 }).expect(403);
  });

  it('does not let historical mixed grants block force deletion or delete a shared role', async () => {
    const a = await actor(), b = await actor();
    const p = await profile(a);
    const target = (await http(a, 'post', accounts(p.id), { username: randomUUID() }).expect(201)).body;
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:read' } });
    const sharedRole = await prisma.role.create({ data: { organizationId: a.home.id, code: randomUUID(), name: 'Historical mixed shared role', permissions: { create: { permissionId: permission.id } } } });
    for (const userId of [target.id, a.user.id]) await prisma.userRole.create({ data: { userId, organizationId: a.home.id, roleId: sharedRole.id } });
    await http(b, 'post', `${accounts(p.id)}/${target.id}/temporary-password/reset`, { organizationId: a.home.id }).expect(403);
    await http(b, 'delete', `${accounts(p.id)}/${target.id}?organizationId=${a.home.id}`, { expectedSecurityVersion: target.securityVersion }).expect(200);
    expect(await prisma.role.count({ where: { id: sharedRole.id } })).toBe(1);
    expect(await prisma.userRole.count({ where: { userId: a.user.id, roleId: sharedRole.id } })).toBe(1);
    expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(0);
    await http(b, 'post', `${accounts(p.id)}/${target.id}/temporary-password/reset`, { organizationId: a.home.id }).expect(404);
  });

  it('rechecks platform authority after a temporary-password read waits for the target lock', async () => {
    const a = await actor(), b = await actor();
    const p = await profile(a);
    const target = (await http(a, 'post', accounts(p.id), { username: randomUUID() }).expect(201)).body;
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id}::uuid FOR UPDATE`;
      locked();
      await gate;
    }, { timeout: 20_000 });
    await acquired;
    const pending = http(b, 'get', `${accounts(p.id)}/${target.id}/temporary-password?organizationId=${a.home.id}`).then(response => response);
    try {
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM users%FOR UPDATE%') AS waiting`;
        if (row?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: b.role.id, permissionId: marker.id } } });
    } finally {
      release();
      await holder;
    }
    expect((await pending).status).toBe(403);
  }, 30_000);

  it('deletes exact profile accounts from surviving home after the historical owner is disabled and force-deleted', async () => {
    const a = await actor(), b = await actor();
    await prisma.organization.update({ where: { id: a.home.id }, data: { parentId: b.home.id } });
    const p = await profile(a);
    const first = (await http(a, 'post', accounts(p.id), { username: randomUUID() }).expect(201)).body;
    const second = (await http(a, 'post', accounts(p.id), { username: randomUUID() }).expect(201)).body;
    const originalProfile = await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: p.id } });
    await prisma.organization.update({ where: { id: a.home.id }, data: { status: 'DISABLED' } });
    await http(b, 'get', `${accounts(p.id)}?organizationId=${a.home.id}`).expect(403);
    await http(b, 'delete', `${accounts(p.id)}/${first.id}?organizationId=${b.home.id}`, { expectedSecurityVersion: first.securityVersion }).expect(404);
    const firstPath = `${accounts(p.id)}/${first.id}?organizationId=${a.home.id}`;
    const firstBody = { expectedSecurityVersion: first.securityVersion };
    const firstKey = randomUUID();
    await http(b, 'delete', firstPath, firstBody, firstKey).expect(200);
    const orgPath = `/api/v1/organizations/${a.home.id}/force-delete`;
    const preview = (await http(b, 'get', orgPath).expect(200)).body;
    await http(b, 'post', orgPath, { expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken }).expect(201);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.home.id } })).deletedAt).not.toBeNull();
    await http(b, 'delete', `${accounts(p.id)}/${second.id}?organizationId=${a.home.id}`, { expectedSecurityVersion: second.securityVersion }).expect(200);
    await http(b, 'delete', firstPath, firstBody, firstKey).expect(200);
    expect(await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: p.id } })).toEqual(originalProfile);
    for (const account of [first, second]) {
      const retained = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
      expect(retained.organizationId).toBe(account.organizationId);
      expect(retained.deletedAt).not.toBeNull();
    }
    const receipt = await prisma.adminMutation.findUniqueOrThrow({ where: { actorUserId_organizationId_key: { actorUserId: b.user.id, organizationId: b.home.id, key: firstKey } } });
    expect(receipt.organizationId).toBe(b.home.id);
    await http(b, 'post', accounts(p.id), { organizationId: a.home.id, username: randomUUID() }).expect(403);
  }, 30_000);
});
