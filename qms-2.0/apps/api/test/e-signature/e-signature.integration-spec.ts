import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ESignatureService } from '../../src/modules/e-signature/e-signature.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('An independent disposable PostgreSQL database is required');

describe('electronic signatures on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const service = new ESignatureService(prisma, new AdminMutationService(prisma, audit), audit);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const roleId = randomUUID();
  const otherRoleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };
  const otherActor = { id: otherUserId, organizationId: otherOrganizationId, accountType: 'INTERNAL' as const, sessionId: otherSessionId };

  beforeAll(async () => {
    await prisma.$connect();
    for (const id of [organizationId, otherOrganizationId]) await prisma.organization.create({ data: { id, code: `ES-${id.slice(0, 8)}`, name: '电子签名测试组织', type: 'INTERNAL' } });
    await prisma.user.createMany({ data: [
      { id: userId, organizationId, username: `esign-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' },
      { id: otherUserId, organizationId: otherOrganizationId, username: `esign-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' },
    ] });
    await prisma.session.createMany({ data: [
      { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() },
      { id: otherSessionId, userId: otherUserId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() },
    ] });
    const codes = ['e-signature:signatures:read', 'e-signature:signatures:write', 'e-signature:approvals:read', 'e-signature:approvals:sign'];
    for (const [id, org, code] of [[roleId, organizationId, 'ESIGN'], [otherRoleId, otherOrganizationId, 'ESIGN-OTHER']] as const) {
      await prisma.role.create({ data: { id, organizationId: org, code, name: '电子签名测试角色' } });
      for (const permissionCode of codes) {
        const permission = await prisma.permission.upsert({ where: { code: permissionCode }, create: { code: permissionCode, name: permissionCode }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: id, permissionId: permission.id } });
      }
    }
    await prisma.userRole.createMany({ data: [{ userId, organizationId, roleId }, { userId: otherUserId, organizationId: otherOrganizationId, roleId: otherRoleId }] });
  }, 30_000);

  afterAll(async () => {
    await prisma.$executeRaw`ALTER TABLE approval_signatures DISABLE TRIGGER approval_signature_immutable`;
    await prisma.$executeRaw`DELETE FROM approval_signatures WHERE organization_id IN (${organizationId}::uuid, ${otherOrganizationId}::uuid)`;
    await prisma.$executeRaw`ALTER TABLE approval_signatures ENABLE TRIGGER approval_signature_immutable`;
    await prisma.$executeRaw`DELETE FROM user_signatures WHERE organization_id IN (${organizationId}::uuid, ${otherOrganizationId}::uuid)`;
    await prisma.adminMutation.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [roleId, otherRoleId] } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [roleId, otherRoleId] } } });
    await prisma.role.deleteMany({ where: { id: { in: [roleId, otherRoleId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.$disconnect();
  }, 30_000);

  it('registers a protected fingerprint and revokes it with CAS', async () => {
    const key = randomUUID();
    const created = await service.register(actor, { label: '主签名', signatureData: 'signature-payload-that-is-never-stored' }, randomUUID(), key);
    expect(created).toMatchObject({ organizationId, userId, status: 'ACTIVE', version: 1 });
    expect(created.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(created)).not.toContain('signature-payload-that-is-never-stored');
    const replay = await service.register(actor, { label: '主签名', signatureData: 'signature-payload-that-is-never-stored' }, randomUUID(), key);
    expect(replay.id).toBe(created.id);
    expect((await service.list(actor, { page: 1, pageSize: 20 })).items).toHaveLength(1);
    await expect(service.revoke(actor, created.id, { expectedVersion: 1 }, randomUUID(), randomUUID())).resolves.toMatchObject({ status: 'REVOKED', version: 2 });
    await expect(service.revoke(actor, created.id, { expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('signs an approval resource, preserves an immutable reference, and blocks revoked credentials', async () => {
    const signature = await service.register(actor, { label: '审批签名', signatureData: 'second-signature-payload' }, randomUUID(), randomUUID());
    const key = randomUUID();
    const signed = await service.signApproval(actor, { signatureId: signature.id, resourceType: 'AUDIT_EXECUTION', resourceId: randomUUID(), resourceVersion: 3, note: '审核结论确认' }, randomUUID(), key);
    expect(signed).toMatchObject({ organizationId, signerUserId: userId, resourceType: 'AUDIT_EXECUTION', resourceVersion: 3, note: '审核结论确认' });
    expect(signed.signedDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(await service.signApproval(actor, { signatureId: signature.id, resourceType: signed.resourceType, resourceId: signed.resourceId, resourceVersion: 3, note: '审核结论确认' }, randomUUID(), key)).toMatchObject({ id: signed.id });
    expect(await service.approvals(actor, { resourceType: signed.resourceType, resourceId: signed.resourceId, resourceVersion: 3 })).toEqual([signed]);
    await service.revoke(actor, signature.id, { expectedVersion: 1 }, randomUUID(), randomUUID());
    expect(await service.approvals(actor, { resourceType: signed.resourceType, resourceId: signed.resourceId, resourceVersion: 3 })).toEqual([signed]);
    await expect(service.signApproval(actor, { signatureId: signature.id, resourceType: signed.resourceType, resourceId: signed.resourceId, resourceVersion: 3 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(prisma.$executeRaw`DELETE FROM approval_signatures WHERE id = ${signed.id}::uuid`).rejects.toThrow();
  });

  it('does not expose or accept a signature across organizations', async () => {
    const signature = await service.register(actor, { label: '组织隔离', signatureData: 'third-signature-payload' }, randomUUID(), randomUUID());
    await expect(service.list(otherActor, { organizationId, page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
    await expect(service.signApproval(otherActor, { signatureId: signature.id, resourceType: 'WORKFLOW_TASK', resourceId: randomUUID(), resourceVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});
