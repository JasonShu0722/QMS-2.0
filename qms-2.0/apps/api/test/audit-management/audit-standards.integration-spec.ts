import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditManagementService } from '../../src/modules/audit-management/audit-management.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('audit standards PostgreSQL versioning', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const service = new AuditManagementService(prisma, new AdminMutationService(prisma, audit), audit);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: `STD-${organizationId.slice(0, 8)}`, name: 'Standards Org', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `std-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'STD_EDITOR', name: 'Standards Editor' } });
    for (const code of ['audit-management:read', 'audit-management:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  });

  afterAll(async () => prisma.$disconnect());

  it('lists standards with their active version and preserves published snapshots after revision', async () => {
    const template = await service.createTemplate(actor, { name: '过程审核检查表', auditType: 'PROCESS', definition: { items: [{ key: 'P1', text: '首版检查项' }] } }, randomUUID(), randomUUID());
    const first = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const list = await service.listTemplates(actor, { auditType: 'PROCESS', search: '检查表' });
    expect(list.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: template.id, latestVersion: 1, status: 'PUBLISHED' })]));
    const revised = await service.reviseTemplate(actor, template.id, { expectedVersion: 2, definition: { items: [{ key: 'P1', text: '二版检查项' }, { key: 'P2', text: '新检查项' }] } }, randomUUID(), randomUUID());
    expect(revised.status).toBe('DRAFT');
    const second = await service.publishTemplate(actor, template.id, revised.version, randomUUID(), randomUUID());
    expect(second.publishedVersion).toBe(2);
    expect(second.status).toBe('PUBLISHED');
    expect(second.version).toBe(4);
    const detail = await service.getTemplateCatalogDetail(actor, template.id);
    expect(detail.versions.map((version: { version: number }) => version.version)).toEqual([2, 1]);
    expect(detail.versions[1].id).toBe(first.versionId);
    expect(detail.versions[1].definition).toEqual({ items: [{ key: 'P1', text: '首版检查项' }] });
    await expect(prisma.$executeRaw`UPDATE audit_template_versions SET definition = '{}'::jsonb WHERE id = ${first.versionId}::uuid`).rejects.toThrow();
    const plan = await service.createPlan(actor, { year: 2026, title: '复用审核标准', auditType: 'PROCESS', plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-02T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, first.versionId, randomUUID(), randomUUID());
    expect(execution.template_version_id).toBe(first.versionId);
  });

  it('rejects stale revisions, duplicate item keys, and cross-organization catalog reads', async () => {
    const template = await service.createTemplate(actor, { name: '产品审核标准', auditType: 'PRODUCT', definition: { items: [{ key: 'A', text: '原检查项' }] } }, randomUUID(), randomUUID());
    await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    await expect(service.reviseTemplate(actor, template.id, { expectedVersion: 1, definition: { items: [{ key: 'A', text: '变更' }] } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(() => service.reviseTemplate(actor, template.id, { expectedVersion: 2, definition: { items: [{ key: 'A', text: '一' }, { key: 'A', text: '二' }] } }, randomUUID(), randomUUID())).toThrow('AUDIT_TEMPLATE_DEFINITION_INVALID');
    const foreign = { ...actor, scopeOrganizationId: randomUUID() };
    await expect(service.getTemplateCatalogDetail(foreign, template.id)).rejects.toMatchObject({ status: 403 });
  });
});
