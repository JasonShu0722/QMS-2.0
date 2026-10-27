import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditExportService } from '../../src/modules/audit-log/audit-export.service.js';
import { AuditQueryService } from '../../src/modules/audit-log/audit-query.service.js';
import { AppModule } from '../../src/app.module.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL');

describe('controlled audit exports', () => {
  const prisma = new PrismaService(process.env.DATABASE_URL!);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const actor = { id: userId, organizationId, sessionId: randomUUID(), accountType: 'INTERNAL' as const };
  const audit = new AuditLogService(prisma);
  const service = new AuditExportService(prisma, audit);
  const originalKey = process.env.QMS_SECURITY_CURRENT_KEY_ID;
  const originalKeyring = process.env.QMS_SECURITY_KEYRING;
  let roleId: string;
  let exportPermissionId: string;
  beforeAll(async () => {
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'export-test';
    process.env.QMS_SECURITY_KEYRING = JSON.stringify({ 'export-test': randomBytes(32).toString('base64') });
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: organizationId, name: 'Exports', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: userId, passwordHash: 'unused', accountType: 'INTERNAL' } });
    roleId = (await prisma.role.create({ data: { organizationId, code: 'EXPORTER', name: 'Exporter' } })).id;
    for (const code of ['audit:read', 'audit:export']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      if (code === 'audit:export') exportPermissionId = permission.id;
    }
    await prisma.userRole.create({ data: { organizationId, userId, roleId } });
    await prisma.session.create({ data: { id: actor.sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() } });
    await prisma.platformSettings.create({ data: { organizationId, exportRetentionMinutes: 5 } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: userId, action: '=FORMULA()', resourceType: 'Test', resourceId: '@SUM(1,1)', outcome: 'SUCCESS', traceId: 'export-safe', metadata: { token: 'never-export-secret' } } });
  });
  afterAll(async () => {
    if (originalKey === undefined) delete process.env.QMS_SECURITY_CURRENT_KEY_ID; else process.env.QMS_SECURITY_CURRENT_KEY_ID = originalKey;
    if (originalKeyring === undefined) delete process.env.QMS_SECURITY_KEYRING; else process.env.QMS_SECURITY_KEYRING = originalKeyring;
    await prisma.$disconnect();
  });

  it('uses retention settings, encrypts content and prevents spreadsheet formula execution', async () => {
    const artifact = await service.create(actor, { action: '=FORMULA()' }, 'export-test');
    expect(artifact.rowCount).toBe(1);
    expect(new Date(artifact.expiresAt).getTime() - Date.now()).toBeGreaterThan(290000);
    expect(new Date(artifact.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300000);
    const persisted = await prisma.exportArtifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(persisted.ciphertext).not.toContain('FORMULA');
    const result = await service.download(actor, organizationId, artifact.id, 'export-test');
    expect(result.content).toContain('"\'=FORMULA()"');
    expect(result.content).toContain('"\'@SUM(1,1)"');
    expect(result.content).not.toContain('never-export-secret');
    expect(await prisma.auditEvent.count({ where: { resourceId: artifact.id, action: { in: ['AUDIT_EXPORT_CREATED', 'AUDIT_EXPORT_DOWNLOADED'] } } })).toBe(2);
  });

  it('exports exactly the keyword-filtered query rows with exact resource/outcome/time boundaries', async () => {
    const traceId = `keyword-export-${randomUUID()}`;
    const createdAt = new Date('2026-01-01T12:00:00Z');
    const base = { organizationId, actorUserId: userId, resourceType: 'KeywordExportTest', resourceId: traceId, outcome: 'SUCCESS', traceId, createdAt };
    const actions = ['USER_UPDATED', 'USER_CREATED', 'LEGACY_Unknown_ACTION', 'USERxUPDATED', 'PERCENT%ACTION', 'PERCENTxACTION', 'BACK\\ACTION', 'BACKxACTION', 'MFA_ENABLED'];
    const queries = new AuditQueryService(prisma, audit);
    const artifacts: string[] = [];
    try {
      await prisma.auditEvent.createMany({ data: [
        ...actions.map((action) => ({ ...base, action })),
        { ...base, action: 'USER_UPDATED', resourceType: `${base.resourceType}Extra` },
        { ...base, action: 'USER_UPDATED', resourceId: `${traceId}-extra` },
        { ...base, action: 'USER_UPDATED', outcome: 'DENIED' },
        { ...base, action: 'USER_UPDATED', createdAt: new Date(createdAt.getTime() + 1) },
        { ...base, action: 'USER_UPDATED', organizationId: null },
        { ...base, action: 'USER_UPDATED', actorUserId: null },
      ] });
      for (const [action, expected] of [
        ['用户', ['USER_UPDATED', 'USER_CREATED']],
        ['uSeR_upD', ['USER_UPDATED']],
        ['unknown', ['LEGACY_Unknown_ACTION']],
        ['mFa', ['MFA_ENABLED']],
        ['%', ['PERCENT%ACTION']],
        ['USER_UPDATED', ['USER_UPDATED']],
        ['BACK\\', ['BACK\\ACTION']],
        ['不存在的动作', []],
      ] as const) {
        const filters = { action, resourceType: base.resourceType, resourceId: traceId, actorUserId: userId, outcome: base.outcome, from: createdAt.toISOString(), to: createdAt.toISOString() };
        const first = await queries.list(actor, { ...filters, pageSize: 1 });
        const items = [...first.items];
        if (first.nextCursor) {
          const second = await queries.list(actor, { ...filters, pageSize: 1, cursor: first.nextCursor });
          expect(second.total).toBe(expected.length);
          expect(second.nextCursor).toBeNull();
          items.push(...second.items);
        }
        expect(first.total).toBe(expected.length);
        expect(items.map((entry) => entry.action).sort()).toEqual([...expected].sort());
        const artifact = await service.create(actor, filters, traceId);
        artifacts.push(artifact.id);
        expect(artifact.rowCount).toBe(first.total);
        const csv = await service.download(actor, organizationId, artifact.id, traceId);
        const ids = csv.content.replace(/^\uFEFF/, '').split('\r\n').slice(1).map((line) => line.split(',')[0]!.replaceAll('"', ''));
        expect(ids).toEqual(items.map((entry) => entry.id));
      }
    } finally {
      await prisma.exportArtifact.deleteMany({ where: { id: { in: artifacts } } });
      await prisma.auditEvent.deleteMany({ where: { traceId } });
    }
  });

  it('rechecks permissions for download and audits denied access without leaking foreign IDs', async () => {
    const artifact = await service.create(actor, {}, 'export-test');
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: exportPermissionId } } });
    try { await expect(service.download(actor, organizationId, artifact.id, 'denied-export')).rejects.toMatchObject({ status: 403 }); }
    finally { await prisma.rolePermission.create({ data: { roleId, permissionId: exportPermissionId } }); }
    await expect(service.download(actor, randomUUID(), artifact.id, 'denied-export')).rejects.toMatchObject({ status: 403 });
    expect(await prisma.auditEvent.count({ where: { organizationId, action: 'AUDIT_EXPORT_DENIED', traceId: 'denied-export' } })).toBe(2);
  });

  it('appends safe actor columns, freezes current profiles at creation, and protects every formula-bearing string', async () => {
    const old = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });
    try {
      await prisma.user.update({ where: { id: userId }, data: { username: '-USERNAME' } });
      await prisma.organization.update({ where: { id: organizationId }, data: { name: '\t@ORGANIZATION()' } });
      const artifact = await service.create(actor, { action: '=FORMULA()' }, 'export-summary');
      await prisma.user.update({ where: { id: userId }, data: { username: 'changed-after-export' } });
      const result = await service.download(actor, organizationId, artifact.id, 'export-summary');
      const lines = result.content.replace(/^\uFEFF/, '').split('\r\n');
      expect(lines[0]).toBe('"id","createdAt","actorUserId","action","resourceType","resourceId","outcome","traceId","actionLabel","accountType","username","organizationName","originalOrganizationId","originalOrganizationCode","originalOrganizationName"');
      expect(result.content).toContain('"\'=FORMULA()","INTERNAL","\'-USERNAME","\'\t@ORGANIZATION()"');
      expect(lines[1]).toMatch(/,"","",""$/);
      expect(result.content).not.toContain('changed-after-export');
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { username: old.username } });
      await prisma.organization.update({ where: { id: organizationId }, data: { name: 'Exports' } });
    }
  });

  it.each([
    ['=ORIGINAL_CODE()', '+ORIGINAL_NAME()'],
    ['-ORIGINAL_CODE', '@ORIGINAL_NAME("frozen",1)'],
  ])('escapes archived organization code %s and freezes original provenance in the artifact', async (code, name) => {
    const traceId = `archived-export-${randomUUID()}`;
    const originalOrganizationId = randomUUID();
    const event = await prisma.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'ORGANIZATION_DELETED', resourceType: 'Organization', resourceId: originalOrganizationId, outcome: 'SUCCESS', traceId,
      metadata: { originalOrganizationId, originalOrganizationCode: code, originalOrganizationName: name, token: 'never-export-secret' } } });
    let artifactId: string | undefined;
    try {
      const artifact = await service.create(actor, { resourceId: originalOrganizationId }, traceId);
      artifactId = artifact.id;
      expect(artifact.rowCount).toBe(1);
      await prisma.auditEvent.update({ where: { id: event.id }, data: { metadata: {
        originalOrganizationId: randomUUID(), originalOrganizationCode: 'changed-after-export', originalOrganizationName: 'changed-after-export',
      } } });
      await prisma.organization.update({ where: { id: organizationId }, data: { name: 'changed-after-export' } });
      const result = await service.download(actor, organizationId, artifact.id, traceId);
      const lines = result.content.replace(/^\uFEFF/, '').split('\r\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(`"${event.id}",`);
      expect(lines[1]).toContain(`,"Exports","${originalOrganizationId}","'${code}","'${name.replaceAll('"', '""')}"`);
      expect(result.content).not.toMatch(/changed-after-export|never-export-secret/);
    } finally {
      await prisma.organization.update({ where: { id: organizationId }, data: { name: 'Exports' } });
      if (artifactId) await prisma.exportArtifact.delete({ where: { id: artifactId } });
      await prisma.auditEvent.deleteMany({ where: { traceId } });
    }
  });

  it('allows exactly 5000 rows and rejects 5001 without creating an artifact', async () => {
    const action = `LIMIT_${randomUUID()}`;
    try {
      await prisma.auditEvent.createMany({ data: Array.from({ length: 5000 }, () => ({ organizationId, actorUserId: userId, action, resourceType: 'LimitTest', outcome: 'SUCCESS', traceId: 'export-limit' })) });
      expect((await service.create(actor, { action }, 'export-limit')).rowCount).toBe(5000);
      await prisma.auditEvent.create({ data: { organizationId, action, resourceType: 'LimitTest', outcome: 'SUCCESS', traceId: 'export-limit' } });
      const count = await prisma.exportArtifact.count({ where: { organizationId } });
      await expect(service.create(actor, { action }, 'export-limit')).rejects.toMatchObject({ status: 422 });
      expect(await prisma.exportArtifact.count({ where: { organizationId } })).toBe(count);
    } finally { await prisma.auditEvent.deleteMany({ where: { organizationId, action } }); }
  });

  it('exports no current identity for a foreign actor while retaining the raw UUID and action', async () => {
    const foreignOrg = randomUUID(); const foreignUser = randomUUID(); const eventId = randomUUID();
    try {
      await prisma.organization.create({ data: { id: foreignOrg, code: foreignOrg, name: 'foreign-private-organization', type: 'INTERNAL' } });
      await prisma.user.create({ data: { id: foreignUser, organizationId: foreignOrg, username: 'foreign-private-actor', passwordHash: 'never-export-secret', email: `${foreignUser}@private.test`, accountType: 'INTERNAL' } });
      await prisma.auditEvent.create({ data: { id: eventId, organizationId, actorUserId: foreignUser, action: 'USER_UPDATED', resourceType: 'ForeignActorTest', outcome: 'DENIED', traceId: 'export-foreign-actor' } });
      const artifact = await service.create(actor, { resourceType: 'ForeignActorTest' }, 'export-foreign-actor');
      const result = await service.download(actor, organizationId, artifact.id, 'export-foreign-actor');
      expect(result.content).toContain(`"${foreignUser}","USER_UPDATED"`);
      expect(result.content).toContain('"更新用户","","",""');
      expect(result.content).not.toMatch(/foreign-private|never-export-secret|private.test/);
    } finally {
      await prisma.auditEvent.deleteMany({ where: { id: eventId } });
      await prisma.user.deleteMany({ where: { id: foreignUser } });
      await prisma.organization.deleteMany({ where: { id: foreignOrg } });
    }
  });

  it('rejects another authorized exporter who did not create the artifact', async () => {
    const otherId = randomUUID(); const sessionId = randomUUID();
    try {
      await prisma.user.create({ data: { id: otherId, organizationId, username: otherId, passwordHash: 'unused', accountType: 'INTERNAL' } });
      await prisma.userRole.create({ data: { userId: otherId, roleId, organizationId } });
      await prisma.session.create({ data: { id: sessionId, userId: otherId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() } });
      const artifact = await service.create(actor, {}, 'export-owner');
      await expect(service.download({ ...actor, id: otherId, sessionId }, organizationId, artifact.id, 'export-owner')).rejects.toMatchObject({ status: 404 });
    } finally { await prisma.user.deleteMany({ where: { id: otherId } }); }
  });

  it('expires downloads and cleans ciphertext without deleting source audit', async () => {
    const artifact = await service.create(actor, {}, 'export-test');
    const before = await prisma.auditEvent.count({ where: { organizationId } });
    await prisma.exportArtifact.update({ where: { id: artifact.id }, data: { createdAt: new Date(Date.now() - 600000), expiresAt: new Date(Date.now() - 1) } });
    await expect(service.download(actor, organizationId, artifact.id, 'expired-export')).rejects.toMatchObject({ status: 410 });
    await service.purgeExpired();
    expect((await prisma.exportArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).ciphertext).toBeNull();
    expect(await prisma.auditEvent.count({ where: { organizationId } })).toBeGreaterThanOrEqual(before);
  });

  it('revalidates the session in the download transaction after an HTTP guard could have accepted it', async () => {
    const artifact = await service.create(actor, {}, 'export-session');
    await prisma.session.update({ where: { id: actor.sessionId }, data: { revokedAt: new Date() } });
    try { await expect(service.download(actor, organizationId, artifact.id, 'export-revoked')).rejects.toMatchObject({ status: 401 }); }
    finally { await prisma.session.update({ where: { id: actor.sessionId }, data: { revokedAt: null } }); }
    await prisma.user.update({ where: { id: userId }, data: { securityVersion: { increment: 1 } } });
    try { await expect(service.download(actor, organizationId, artifact.id, 'export-stale')).rejects.toMatchObject({ status: 401 }); }
    finally {
      const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      await prisma.session.update({ where: { id: actor.sessionId }, data: { securityVersion: current.securityVersion } });
    }
    expect(await prisma.auditEvent.count({ where: { resourceId: artifact.id, action: 'AUDIT_EXPORT_DOWNLOADED' } })).toBe(0);
  });

  it('rolls back artifact creation if its audit cannot be persisted', async () => {
    const before = await prisma.exportArtifact.count({ where: { organizationId } });
    const failing = new AuditExportService(prisma, { record: jest.fn(async () => { throw new Error('audit unavailable'); }) } as never);
    await expect(failing.create(actor, {}, 'export-test')).rejects.toThrow();
    expect(await prisma.exportArtifact.count({ where: { organizationId } })).toBe(before);
  });

  it('enforces HTTP authentication, CSRF, strict filters and no-store downloads', async () => {
    const app = (await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
    try {
      const token = await app.get(SessionService).create(userId, prisma, { mfaVerified: true, reauthenticated: true });
      const csrf = randomUUID(); const cookie = `qms_session=${token}; qms_csrf=${csrf}`;
      await request(app.getHttpServer()).post('/api/v1/admin/audit-exports').send({}).expect(403);
      await request(app.getHttpServer()).post('/api/v1/admin/audit-exports').set('Cookie', cookie).set('x-csrf-token', csrf).send({ pageSize: 10000 }).expect(400);
      const result = await request(app.getHttpServer()).post('/api/v1/admin/audit-exports').set('Cookie', cookie).set('x-csrf-token', csrf).send({ action: '=FORMULA()' }).expect(201);
      const content = await request(app.getHttpServer()).get(result.body.downloadPath).set('Cookie', cookie).expect(200);
      expect(content.headers['cache-control']).toBe('no-store');
      expect(content.body.filename).toMatch(/^qms-audit-.*\.csv$/);
    } finally { await app.close(); }
  });
});
