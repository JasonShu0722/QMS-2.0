import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditQueryService } from '../../src/modules/audit-log/audit-query.service.js';
import { AuditExportService } from '../../src/modules/audit-log/audit-export.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { archivedOrganizationDelete } from '../../src/modules/organization/organization-history-archive.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)
  || (process.env.QMS_ORGANIZATION_DELETE_TEST_DB !== undefined
    && decodeURIComponent(connection.pathname.slice(1)) !== process.env.QMS_ORGANIZATION_DELETE_TEST_DB)) {
  throw new Error('Requires disposable loopback PostgreSQL and the dedicated organization-delete database when specified; never preview/production.');
}
jest.setTimeout(120_000);

describe('organization deletion archives management history on real PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let service: OrganizationService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    service = app.get(OrganizationService);
    // Provisioning and migrations belong to the parent, not this suite.
    await db.$queryRaw`SELECT organization_id FROM organization_initializations LIMIT 0`;
    await db.$queryRaw`SELECT id FROM organization_mutation_archives LIMIT 0`;
  });
  afterAll(async () => { await app?.close(); });

  async function fixture() {
    const root = await db.organization.create({ data: { code: randomUUID(), name: 'Archive root', type: 'INTERNAL' } });
    async function administrator(platform = true) {
      const user = await db.user.create({ data: { organizationId: root.id, username: randomUUID(), passwordHash: 'test-only', accountType: 'INTERNAL' } });
      const codes = platform ? ['platform:admin'] : ['organization:read', 'organization:manage', 'audit:read', 'audit:export'];
      const permissions = await Promise.all(codes.map(code => db.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
      const role = await db.role.create({ data: { organizationId: root.id, code: randomUUID(), name: 'Explicit administrator', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
      await db.userRole.create({ data: { organizationId: root.id, roleId: role.id, userId: user.id } });
      const token = await app.get(SessionService).create(user.id, db, { mfaVerified: true, reauthenticated: true });
      const session = (await app.get(SessionService).resolve(token))!;
      return { actor: { id: user.id, organizationId: root.id, accountType: 'INTERNAL', sessionId: session.id } as AdminActor, role };
    }
    const { actor, role } = await administrator();
    const child = (parentId = root.id, key = randomUUID()) => service.createChild(actor, parentId, { code: randomUUID(), name: 'Empty child' }, randomUUID(), key);
    const remove = (id: string, version = 1, key = randomUUID(), by = actor) => service.deleteOrganization(by, id, { expectedVersion: version }, randomUUID(), key);
    return { root, actor, role, administrator, child, remove };
  }

  it('retains every success/failure/denial and receipt after repeated code/name/status edits by another admin', async () => {
    const f = await fixture();
    const org = await f.child();
    const second = await f.administrator();
    for (let version = 1; version <= 4; version++) await service.update(second.actor, org.id, {
      expectedVersion: version, code: `EDIT-${randomUUID()}`, name: `Correction ${version}`, status: version % 2 ? 'DISABLED' : 'ACTIVE',
    }, randomUUID(), randomUUID());
    for (const outcome of ['SUCCESS', 'FAILURE', 'DENIED'] as const) await db.auditEvent.create({ data: {
      organizationId: org.id, actorUserId: second.actor.id, action: 'UNKNOWN_MANAGEMENT_ACTION', resourceType: 'Administration',
      resourceId: org.id, outcome, traceId: randomUUID(), metadata: outcome === 'FAILURE' ? Prisma.JsonNull
        : outcome === 'DENIED' ? ['retained-original-array'] : { reasonCode: 'RETAIN_ORIGINAL' },
    } });
    const events = await db.auditEvent.findMany({ where: { organizationId: org.id } });
    const receipts = await db.adminMutation.findMany({ where: { organizationId: org.id } });
    expect((await service.organizationLifecycle(second.actor, org.id)).deleteBlockers).toEqual([]);
    await f.remove(org.id, 5, randomUUID(), second.actor);
    for (const original of events) {
      const archived = await db.auditEvent.findUniqueOrThrow({ where: { id: original.id } });
      const metadata = original.metadata && typeof original.metadata === 'object' && !Array.isArray(original.metadata)
        ? original.metadata : { originalMetadata: original.metadata };
      expect(archived).toMatchObject({ ...original, organizationId: f.root.id, metadata: {
        ...metadata, organizationId: org.id, originalOrganizationId: org.id,
        originalOrganizationCode: expect.any(String), originalOrganizationName: metadata.structureName ?? 'Correction 4',
      } });
      expect(Array.isArray(archived.metadata)).toBe(false);
    }
    for (const receipt of receipts) {
      const [archived] = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM organization_mutation_archives WHERE id = ${receipt.id}::uuid`;
      expect(archived).toMatchObject({ actor_user_id: receipt.actorUserId, organization_id: org.id, key: receipt.key,
        action: receipt.action, request_digest: receipt.requestDigest, response: receipt.response, created_at: receipt.createdAt, scope_organization_id: f.root.id });
    }
    const query = await app.get(AuditQueryService).list(second.actor, { organizationId: f.root.id, resourceId: org.id, pageSize: 100 });
    expect(query.items.map(e => e.id)).toEqual(expect.arrayContaining(events.map(e => e.id)));
    for (const original of events) {
      const name = original.metadata && typeof original.metadata === 'object' && !Array.isArray(original.metadata)
        ? original.metadata.structureName : undefined;
      expect(query.items.find(e => e.id === original.id)?.metadata).toMatchObject({
        originalOrganizationId: org.id, originalOrganizationCode: expect.any(String), originalOrganizationName: name ?? 'Correction 4',
      });
    }
    const exportService = app.get(AuditExportService);
    const artifact = await exportService.create(second.actor, { organizationId: f.root.id, resourceId: org.id }, randomUUID());
    const csv = await exportService.download(second.actor, f.root.id, artifact.id, randomUUID());
    for (const event of events) expect(csv.content).toContain(event.id);
    expect(csv.content).toContain('originalOrganizationId');
    expect(csv.content).toContain('Correction 4');
  });

  it('keeps department resource facts separate from original organization provenance across query, export and multiple archives', async () => {
    const f = await fixture(); const parent = await f.child(); const org = await f.child(parent.id);
    const department = await service.createDepartment(f.actor, org.id, { code: `DEP-${randomUUID()}`, name: 'Department, not organization' }, randomUUID(), randomUUID());
    await service.deleteDepartment(f.actor, org.id, department.id, { expectedVersion: 1 }, randomUUID(), randomUUID());
    const events = await db.auditEvent.findMany({ where: { organizationId: org.id, resourceId: department.id } });
    expect(events.map(event => event.action).sort()).toEqual(['DEPARTMENT_CREATED', 'DEPARTMENT_DELETED']);
    await f.remove(org.id);
    for (const scope of [parent.id, f.root.id]) {
      if (scope === f.root.id) await f.remove(parent.id);
      const result = await app.get(AuditQueryService).list(f.actor, { organizationId: scope, resourceId: department.id, pageSize: 100 });
      for (const event of events) {
        const archived = await db.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
        expect(archived).toMatchObject({ ...event, organizationId: scope, metadata: {
          ...event.metadata as object, originalOrganizationId: org.id, originalOrganizationCode: org.code, originalOrganizationName: org.name,
        } });
        expect(result.items.find(item => item.id === event.id)?.metadata).toMatchObject({
          originalOrganizationId: org.id, originalOrganizationCode: org.code, originalOrganizationName: org.name,
        });
      }
    }
    // An actual export artifact is a retained reference; create it only in the final surviving scope.
    const artifact = await app.get(AuditExportService).create(f.actor, { organizationId: f.root.id, resourceId: department.id }, randomUUID());
    const csv = await app.get(AuditExportService).download(f.actor, f.root.id, artifact.id, randomUUID());
    for (const event of events) expect(csv.content.split('\r\n').find(line => line.includes(event.id))).toMatch(
      new RegExp(`,"${org.id}","${org.code}","${org.name}"$`),
    );
  });

  it.each(['audit', 'receipt', 'both'] as const)('durable initialization permits missing %s without guessing role names', async missing => {
    const f = await fixture(); const org = await f.child();
    if (missing !== 'receipt') await db.auditEvent.deleteMany({ where: { organizationId: org.id } });
    if (missing !== 'audit') await db.adminMutation.deleteMany({ where: { action: 'ORGANIZATION_CREATED', response: { path: ['value', 'id'], equals: org.id } } });
    await f.remove(org.id);
    expect(await db.organization.findUnique({ where: { id: org.id } })).toBeNull();
  });

  it('allows a truly uninitialized empty legacy node without audit or receipts', async () => {
    const f = await fixture();
    const org = await db.organization.create({ data: { parentId: f.root.id, type: 'INTERNAL', code: randomUUID(), name: 'No initialization' } });
    await f.remove(org.id);
  });

  it('never recreates a deleted child with its original create key even when its create receipt and audit were removed', async () => {
    const f = await fixture(); const key = randomUUID(); const dto = { code: randomUUID(), name: 'Durable create tombstone' };
    const org = await service.createChild(f.actor, f.root.id, dto, randomUUID(), key);
    await db.adminMutation.deleteMany({ where: { organizationId: f.root.id, key } });
    await db.auditEvent.deleteMany({ where: { organizationId: org.id } });
    await f.remove(org.id);
    await expect(service.createChild(f.actor, f.root.id, dto, randomUUID(), key)).rejects.toMatchObject({ status: 409 });
    expect(await db.organization.count({ where: { code: dto.code } })).toBe(0);
  });

  it.each(['audit-only', 'strict-legacy', 'unknown', 'replaced-role'] as const)('classifies legacy %s with actual grants, not missing-log blockers', async kind => {
    const f = await fixture(); const org = await f.child();
    await db.$executeRaw`DELETE FROM organization_initializations WHERE organization_id = ${org.id}::uuid`;
    if (kind === 'audit-only') await db.adminMutation.deleteMany({ where: { action: 'ORGANIZATION_CREATED', response: { path: ['value', 'id'], equals: org.id } } });
    if (kind === 'strict-legacy' || kind === 'replaced-role') {
      await db.auditEvent.updateMany({ where: { organizationId: org.id }, data: { metadata: { resourceVersion: 1 } } });
      const { createdAt } = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
      if (kind === 'strict-legacy') {
        await db.role.updateMany({ where: { organizationId: org.id }, data: { createdAt: new Date(createdAt.getTime() + 1) } });
        expect((await service.organizationLifecycle(f.actor, org.id)).deleteBlockerDetails).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'NON_INITIALIZATION_ROLES', count: 1 }),
        ]));
        await expect(f.remove(org.id)).rejects.toMatchObject({ status: 409 });
      }
      // Explicit historical fixture: legacy transaction-default timestamps, not reconstructed production provenance.
      await db.role.updateMany({ where: { organizationId: org.id }, data: { createdAt } });
      await db.auditEvent.updateMany({ where: { organizationId: org.id, action: 'ORGANIZATION_CREATED' }, data: { createdAt } });
      await db.adminMutation.updateMany({ where: { action: 'ORGANIZATION_CREATED', response: { path: ['value', 'id'], equals: org.id } }, data: { createdAt } });
      expect((await service.organizationLifecycle(f.actor, org.id)).deleteBlockers).toEqual([]);
    }
    if (kind === 'replaced-role') {
      const role = await db.role.findFirstOrThrow({ where: { organizationId: org.id }, include: { permissions: true } });
      await db.auditEvent.updateMany({ where: { organizationId: org.id }, data: { metadata: { resourceVersion: 1 } } });
      await db.role.delete({ where: { id: role.id } });
      const replacement = await db.role.create({ data: { organizationId: org.id, code: role.code, name: role.name,
        permissions: { create: role.permissions.map(({ permissionId }) => ({ permissionId })) } } });
      await db.userRole.create({ data: { organizationId: org.id, userId: f.actor.id, roleId: replacement.id } });
    }
    if (kind === 'unknown' || kind === 'replaced-role') {
      if (kind === 'unknown') {
        await db.auditEvent.deleteMany({ where: { organizationId: org.id } });
        await db.adminMutation.deleteMany({ where: { action: 'ORGANIZATION_CREATED', response: { path: ['value', 'id'], equals: org.id } } });
      }
      const lifecycle = await service.organizationLifecycle(f.actor, org.id);
      expect(lifecycle.deleteBlockerDetails).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'NON_INITIALIZATION_ROLES', count: 1 }),
        expect.objectContaining({ code: 'NON_INITIALIZATION_GRANTS', count: 1 }),
      ]));
      await expect(f.remove(org.id)).rejects.toMatchObject({ status: 409 });
    } else await f.remove(org.id);
  });

  it.each(['regrant', 'extra-grant', 'extra-role', 'changed-permission', 'foreign-grant'] as const)('never clears real %s authorization', async kind => {
    const f = await fixture(); const org = await f.child();
    const role = await db.role.findFirstOrThrow({ where: { organizationId: org.id } });
    const originalGrant = { organizationId: org.id, roleId: role.id, userId: f.actor.id };
    if (kind === 'regrant') { await db.userRole.deleteMany({ where: originalGrant }); await db.userRole.create({ data: originalGrant }); }
    if (kind === 'extra-grant') { const second = await f.administrator(); await db.userRole.create({ data: { ...originalGrant, userId: second.actor.id } }); }
    if (kind === 'extra-role') await db.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Real configuration' } });
    if (kind === 'changed-permission') {
      const permission = await db.permission.upsert({ where: { code: 'audit:read' }, create: { code: 'audit:read', name: 'Audit read' }, update: {} });
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    if (kind === 'foreign-grant') await db.userRole.create({ data: { ...originalGrant, organizationId: f.root.id } });
    await expect(f.remove(org.id)).rejects.toMatchObject({ status: 409 });
    expect(await db.role.findUnique({ where: { id: role.id } })).not.toBeNull();
  });

  it('retains business references after audit and create receipts are missing', async () => {
    const f = await fixture(); const org = await f.child();
    await db.auditEvent.deleteMany({ where: { organizationId: org.id } });
    await db.materialMaster.create({ data: { organizationId: org.id, materialCode: randomUUID(), materialName: 'Real material', createdById: f.actor.id, updatedById: f.actor.id } });
    expect((await service.organizationLifecycle(f.actor, org.id)).deleteBlockerDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'REFERENCE:material_masters.organization_id', count: 1 }),
    ]));
    await expect(f.remove(org.id)).rejects.toMatchObject({ status: 409 });
  });

  it('preserves multi-level identities, colliding receipt keys, original create tombstones and delete retries', async () => {
    const f = await fixture(); const parent = await f.child();
    const createKey = randomUUID(); const dto = { code: randomUUID(), name: 'Grandchild' };
    const org = await service.createChild(f.actor, parent.id, dto, randomUUID(), createKey);
    const sharedKey = randomUUID();
    await service.update(f.actor, f.root.id, { expectedVersion: 1, name: 'Root edit' }, randomUUID(), sharedKey);
    await service.update(f.actor, org.id, { expectedVersion: 1, name: 'Grandchild edit' }, randomUUID(), sharedKey);
    const originals = await db.auditEvent.findMany({ where: { organizationId: org.id } });
    const deleteKey = randomUUID(); await f.remove(org.id, 2, deleteKey);
    await expect(service.createChild(f.actor, parent.id, dto, randomUUID(), createKey)).rejects.toMatchObject({ status: 409 });
    await service.update(f.actor, f.root.id, { expectedVersion: 2, name: 'Live colliding delete key' }, randomUUID(), deleteKey);
    const afterFirst = await db.auditEvent.findMany({ where: { id: { in: originals.map(e => e.id) } } });
    await f.remove(parent.id);
    for (const event of afterFirst) expect(await db.auditEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual({ ...event, organizationId: f.root.id });
    expect(await f.remove(org.id, 2, deleteKey)).toEqual({ id: org.id, deleted: true });
    await expect(f.remove(org.id, 3, deleteKey)).rejects.toMatchObject({ status: 409 });
    await expect(f.remove(org.id, 2, randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await db.auditEvent.count({ where: { resourceId: org.id, action: 'ORGANIZATION_DELETED' } })).toBe(1);
    expect(await db.adminMutation.count({ where: { organizationId: f.root.id, key: sharedKey } })).toBe(1);
    await expect(service.createChild(f.actor, parent.id, dto, randomUUID(), createKey)).rejects.toBeDefined();
    expect(await db.organization.findUnique({ where: { id: org.id } })).toBeNull();
    expect(afterFirst.every(e => (e.metadata as Record<string, unknown>).originalOrganizationId === org.id)).toBe(true);
    await db.userRole.deleteMany({ where: { userId: f.actor.id } });
    await expect(f.remove(org.id, 2, deleteKey)).rejects.toMatchObject({ status: 403 });
  });

  it('rolls back archival, initialization cleanup and deletion when the final audit insert fails', async () => {
    const f = await fixture(); const org = await f.child();
    await service.update(f.actor, org.id, { expectedVersion: 1, name: 'Edited' }, randomUUID(), randomUUID());
    const events = await db.auditEvent.findMany({ where: { organizationId: org.id }, orderBy: { id: 'asc' } });
    const receipts = await db.adminMutation.findMany({ where: { organizationId: org.id } });
    const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('Audit rollback injection'));
    try { await expect(f.remove(org.id, 2)).rejects.toThrow('Audit rollback injection'); } finally { failure.mockRestore(); }
    expect(await db.auditEvent.findMany({ where: { organizationId: org.id }, orderBy: { id: 'asc' } })).toEqual(events);
    expect(await db.adminMutation.findMany({ where: { organizationId: org.id } })).toEqual(receipts);
    expect(await db.$queryRaw`SELECT id FROM organization_mutation_archives WHERE organization_id = ${org.id}::uuid`).toEqual([]);
    expect(await db.$queryRaw`SELECT organization_id FROM organization_initializations WHERE organization_id = ${org.id}::uuid`).toHaveLength(1);
    await f.remove(org.id, 2);
  });

  it('never runs new work for missing, wrong-scope or wrong-action archived receipts', async () => {
    const f = await fixture(); const parent = await f.child(); const org = await f.child(parent.id);
    const key = randomUUID(); await f.remove(org.id, 1, key); await f.remove(parent.id);
    let workRan = false;
    for (const kind of ['missing', 'wrong-scope', 'wrong-action'] as const) {
      await expect(app.get(AdminMutationService).run({
        actor: f.actor, organizationId: f.root.id, key, permission: 'organization:manage', traceId: randomUUID(),
        action: kind === 'wrong-action' ? 'ORGANIZATION_UPDATED' : 'ORGANIZATION_DELETED',
        payload: { organizationId: org.id, parentId: parent.id, expectedVersion: 1 },
        archivedReceipt: { organizationId: kind === 'wrong-scope' ? f.root.id : parent.id,
          find: tx => archivedOrganizationDelete(tx, f.actor.id, kind === 'missing' ? randomUUID() : key, org.id) },
      }, async () => { workRan = true; return {}; })).rejects.toMatchObject({ status: kind === 'missing' ? 404 : 409 });
    }
    expect(workRan).toBe(false);
    expect(await db.adminMutation.count({ where: { organizationId: f.root.id, actorUserId: f.actor.id, key } })).toBe(0);
  });

  it('does not authorize by username, expired authentication, or a permission in the wrong scope', async () => {
    const f = await fixture(); const org = await f.child(); const ordinary = await f.administrator(false);
    const original = await db.user.findUniqueOrThrow({ where: { id: ordinary.actor.id }, select: { username: true } });
    try {
      await db.user.update({ where: { id: ordinary.actor.id }, data: { username: 'admin' } });
      await expect(f.remove(org.id, 1, randomUUID(), ordinary.actor)).rejects.toMatchObject({ status: 403 });
      await db.session.update({ where: { id: f.actor.sessionId }, data: { reauthenticatedAt: new Date(0) } });
      await expect(f.remove(org.id)).rejects.toMatchObject({ status: 403 });
      expect(await db.organization.findUnique({ where: { id: org.id } })).not.toBeNull();
    } finally {
      await db.user.update({ where: { id: ordinary.actor.id }, data: original });
    }
  });

  it('rechecks actor revocation after a real PostgreSQL lock wait', async () => {
    const f = await fixture(); const org = await f.child();
    const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
    let deletion: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [f.actor.id]);
      deletion = f.remove(org.id).then(value => ({ value }), error => ({ error }));
      let blocked = false;
      for (let i = 0; i < 200; i++) {
        const [row] = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (row?.blocked) { blocked = true; break; } await delay(25);
      }
      expect(blocked).toBe(true);
      await blocker.query('DELETE FROM user_roles WHERE user_id = $1', [f.actor.id]);
      await blocker.query('UPDATE users SET security_version = security_version + 1 WHERE id = $1', [f.actor.id]);
      await blocker.query('COMMIT');
      expect(await deletion).toHaveProperty('error');
      expect(await db.organization.findUnique({ where: { id: org.id } })).not.toBeNull();
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await deletion; }
  });
});
