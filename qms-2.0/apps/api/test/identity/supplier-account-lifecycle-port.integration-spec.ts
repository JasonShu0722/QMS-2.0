import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AdminUserLifecycleService } from '../../src/modules/identity/admin-user-lifecycle.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Disposable loopback PostgreSQL required, never 55440.');
describe('supplier-account identity lifecycle public transaction port', () => {
  let app: INestApplication, db: PrismaService, sessions: SessionService, service: AdminUserLifecycleService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); db = app.get(PrismaService); sessions = app.get(SessionService); service = app.get(AdminUserLifecycleService);
  });
  afterAll(() => app?.close());
  async function fixture(marker = true) {
    const home = await db.organization.create({ data: { code: randomUUID(), name: 'Surviving platform home', type: 'INTERNAL' } });
    const permissions = await db.permission.findMany({ where: { code: { in: ['account:users:read', 'account:users:delete', ...(marker ? ['platform:admin'] : [])] } } });
    const role = await db.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Actual home source', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    const user = await db.user.create({ data: { organizationId: home.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL', userRoles: { create: { organizationId: home.id, roleId: role.id } } } });
    const token = await sessions.create(user.id, db, { mfaVerified: true, reauthenticated: true });
    const actor = { id: user.id, organizationId: home.id, accountType: 'INTERNAL' as const, sessionId: (await sessions.resolve(token))!.id };
    const enterprise = await db.organization.create({ data: { code: randomUUID(), name: 'Exact supplier boundary', type: 'SUPPLIER' } });
    const account = await db.user.create({ data: { organizationId: enterprise.id, username: randomUUID(), email: `${randomUUID()}@example.test`, passwordHash: 'unused', accountType: 'SUPPLIER' } });
    const portalRole = await db.role.create({ data: { organizationId: enterprise.id, code: randomUUID(), name: 'Shared portal source' } });
    await db.userRole.create({ data: { userId: account.id, organizationId: enterprise.id, roleId: portalRole.id } });
    const accountToken = await sessions.create(account.id, db, { mfaVerified: true });
    return { home, actor, enterprise, account, accountToken, portalRole };
  }
  it('deletes only the exact current portal account while retaining its enterprise and historical facts', async () => {
    const f = await fixture();
    const history = await db.problemIndex.create({ data: { organizationId: f.enterprise.id, ownerId: f.account.id, reportNumber: randomUUID(), domainCode: 'supplier-quality', sourceType: 'HISTORY', problemType: 'HISTORY', severity: 'LOW', status: 'CLOSED', closedAt: new Date() } });
    const result = await db.$transaction(tx => service.deleteSupplierAccount(tx, f.actor, f.account.id, f.enterprise.id, { expectedSecurityVersion: f.account.securityVersion }, randomUUID()));
    expect(result).toMatchObject({ userId: f.account.id, deleted: true });
    expect(await db.user.findUniqueOrThrow({ where: { id: f.account.id } })).toMatchObject({ deletedAt: expect.any(Date), status: 'DISABLED', organizationId: f.enterprise.id });
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.enterprise.id } })).toEqual(f.enterprise);
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
    expect(await db.role.findUniqueOrThrow({ where: { id: f.portalRole.id } })).toEqual(f.portalRole);
    expect(await db.userRole.count({ where: { userId: f.account.id } })).toBe(0);
    const [tombstone] = await db.$queryRaw<{ original_identity: { authorizationSources: { organizationId: string; roleId: string; sourceKinds: string[] }[] } }[]>`SELECT original_identity FROM administrative_deletions WHERE entity_kind='USER' AND entity_id=${f.account.id}::uuid`;
    expect(tombstone!.original_identity.authorizationSources).toEqual(expect.arrayContaining([expect.objectContaining({ organizationId: f.enterprise.id, roleId: f.portalRole.id, sourceKinds: ['DIRECT'] })]));
    expect(await sessions.resolve(f.accountToken)).toBeNull();
    expect(await db.user.create({ data: { organizationId: f.enterprise.id, username: f.account.username, email: f.account.email, passwordHash: 'new-unused', accountType: 'SUPPLIER' } })).toHaveProperty('id', expect.not.stringMatching(f.account.id));
  });
  it('rejects missing platform authority, a wrong supplier boundary, stale versions and internal-user substitution', async () => {
    const ordinary = await fixture(false);
    await expect(db.$transaction(tx => service.deleteSupplierAccount(tx, ordinary.actor, ordinary.account.id, ordinary.enterprise.id, { expectedSecurityVersion: ordinary.account.securityVersion }, randomUUID()))).rejects.toMatchObject({ status: 403 });
    const f = await fixture();
    await expect(db.$transaction(tx => service.deleteSupplierAccount(tx, f.actor, f.account.id, randomUUID(), { expectedSecurityVersion: 1 }, randomUUID()))).rejects.toMatchObject({ status: 404 });
    await expect(db.$transaction(tx => service.deleteSupplierAccount(tx, f.actor, f.account.id, f.enterprise.id, { expectedSecurityVersion: f.account.securityVersion + 1 }, randomUUID()))).rejects.toMatchObject({ status: 409 });
    await expect(db.$transaction(tx => service.deleteSupplierAccount(tx, f.actor, f.actor.id, f.home.id, { expectedSecurityVersion: 1 }, randomUUID()))).rejects.toMatchObject({ status: 403 });
    expect(await db.user.findUniqueOrThrow({ where: { id: f.account.id } })).toEqual(f.account);
  });
  it('rolls back credential and identity removal when the actual audit insert fails', async () => {
    const f = await fixture();
    await expect(db.$transaction(tx => service.deleteSupplierAccount(tx, f.actor, f.account.id, f.enterprise.id, { expectedSecurityVersion: f.account.securityVersion }, 'x'.repeat(101)))).rejects.toMatchObject({ code: 'P2000' });
    expect(await db.user.findUniqueOrThrow({ where: { id: f.account.id } })).toEqual(f.account);
    expect(await sessions.resolve(f.accountToken)).not.toBeNull();
    expect(await db.userRole.count({ where: { userId: f.account.id } })).toBe(1);
  });
});
