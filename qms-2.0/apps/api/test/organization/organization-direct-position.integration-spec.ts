import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import { Prisma } from '../../src/generated/prisma/client.js';
import { effectiveRoleGrants, hasPlatformAdministrator } from '../../src/common/security/effective-role-grants.js';
import { effectiveRoleMembershipSql } from '../../src/common/security/effective-role-membership.sql.js';
import { featurePredicate } from '../../src/modules/workflow/workflow-access-policy.js';
import { ADMIN_PERMISSIONS, PLATFORM_ADMINISTRATOR_PERMISSION } from '../../src/modules/authorization/permission-catalog.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { CustomerComplaintAnalysisService } from '../../src/modules/customer-quality/customer-complaint-analysis.service.js';
import { readComponentEngineerAssignment, listComponentEngineerAssignments } from '../../src/modules/platform-configuration/component-project.service.js';
import { accountDeliveryFixture, type AccountDeliveryFixture } from '../identity/account-delivery-fixture.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Direct positions require disposable loopback PostgreSQL; production and preview 55440 are forbidden.');
}
jest.setTimeout(120_000);

describe('organization-direct positions with real PostgreSQL and HTTP', () => {
  let f: AccountDeliveryFixture;
  const foreignOrganizations: string[] = [];
  const path = (suffix: string) => `/api/v1/organizations/${f.organization.id}${suffix}`;
  const send = (method: 'post' | 'put' | 'patch' | 'delete', suffix: string, body: object) => request(f.app.getHttpServer())[method](path(suffix))
    .set('Cookie', f.cookie).set('x-csrf-token', f.csrf).set('Idempotency-Key', randomUUID()).send(body);
  const get = (suffix: string) => request(f.app.getHttpServer()).get(path(suffix)).set('Cookie', f.cookie);

  beforeAll(async () => {
    f = await accountDeliveryFixture();
    const grant = await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } });
    for (const code of [...ADMIN_PERMISSIONS, 'organization:read', 'workbench:read', 'workflow:act', 'workflow:manage', 'organization:departments:force-delete', 'customer-quality:complaints:read', 'customer-quality:complaints:write']) {
      const permission = await f.prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await f.prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: permission.id } }, create: { roleId: grant.roleId, permissionId: permission.id }, update: {} });
    }
  });
  afterAll(async () => {
    if (f) {
      try { await f.prisma.organization.deleteMany({ where: { id: { in: foreignOrganizations } } }); }
      // Deleted identity fixtures are immutable history; the task-owned disposable container removes them.
      finally { await f.app.close(); }
    }
  });

  const department = () => f.prisma.department.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Real business department' } });
  async function position(departmentId: string | null = null) {
    return (await send('post', '/positions', { departmentId, code: randomUUID(), name: 'Platform administrator' }).expect(201)).body as { id: string; version: number; departmentId: string | null };
  }
  async function appointed(code = 'workflow:act') {
    const p = await position();
    const role = await f.prisma.positionRole.findFirstOrThrow({ where: { positionId: p.id, isCanonical: true } });
    const permission = await f.prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
    await f.prisma.rolePermission.create({ data: { roleId: role.roleId, permissionId: permission.id } });
    const user = await f.target();
    const assignment = await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: user.id, positionId: p.id, startedAt: new Date(Date.now() - 60_000) } });
    return { p, role, user, assignment };
  }
  async function parity(subject: Awaited<ReturnType<typeof appointed>>, allowed: boolean, at = new Date(), tx: Prisma.TransactionClient = f.prisma) {
    const grants = await effectiveRoleGrants(tx, subject.user.id, f.organization.id, at);
    const sql = await tx.$queryRaw<{ role_id: string }[]>(effectiveRoleMembershipSql(
      Prisma.sql`${subject.user.id}::uuid`, Prisma.sql`${f.organization.id}::uuid`, Prisma.sql`${at}::timestamptz`,
    ));
    expect(grants.map(({ role }) => role.id).sort()).toEqual(sql.map(({ role_id }) => role_id).sort());
    expect(grants.some(({ role }) => role.id === subject.role.roleId)).toBe(allowed);
  }

  it('requires an explicit null for direct creation rather than silently defaulting a missing department', async () => {
    await send('post', '/positions', { code: randomUUID(), name: 'Missing ownership' }).expect(400);
    const p = await position();
    expect(p.departmentId).toBeNull();
    expect(await f.prisma.positionRole.count({ where: { positionId: p.id, isCanonical: true } })).toBe(1);
    expect((await get('/positions').expect(200)).body).toContainEqual(expect.objectContaining({ id: p.id, departmentId: null }));
  });

  it('configures, previews and appoints a direct position without a synthetic department', async () => {
    const p = await position();
    await send('put', `/positions/${p.id}/permissions`, { permissionCodes: ['workbench:read'], expectedPermissionCodes: [], mfaRequired: false, expectedMfaRequired: false, expectedRoleVersion: 1 }).expect(200);
    const user = await f.target();
    const preview = (await send('post', '/position-authorization/preview', { positionIds: [p.id], targetUserId: user.id }).expect(200)).body;
    expect(preview.positions).toEqual([expect.objectContaining({ id: p.id, department: null })]);
    expect(preview.effectivePermissionCodes).toContain('workbench:read');
    await send('put', `/users/${user.id}/positions`, { positionIds: [p.id], expectedPositionIds: [], authorizationBaseline: preview.authorizationBaseline }).expect(200);
    expect((await effectiveRoleGrants(f.prisma, user.id, f.organization.id)).flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))).toContain('workbench:read');
    expect(await f.app.get(OrganizationService).currentAssignments(user.id, f.organization.id)).toEqual([expect.objectContaining({ department: null, position: expect.objectContaining({ id: p.id }) })]);
  });

  it('creates an internal account with initial direct appointments and null-department summaries', async () => {
    const p = await position();
    const preview = (await send('post', '/position-authorization/preview', { positionIds: [p.id] }).expect(200)).body;
    const created = await f.post('/admin/users', { organizationId: f.organization.id, username: randomUUID(), accountType: 'INTERNAL', initialPassword: 'direct-appointment-test-password', positionIds: [p.id], authorizationBaseline: preview.authorizationBaseline }).expect(201);
    const summaries = await f.app.get(OrganizationService).currentAssignments(created.body.id, f.organization.id);
    expect(summaries).toEqual([expect.objectContaining({ department: null, position: expect.objectContaining({ id: p.id }) })]);
    expect(await f.prisma.userRole.count({ where: { userId: created.body.id } })).toBe(0);
  });

  it('treats undefined as unchanged, explicit null as a versioned ownership change and rejects stale confirmation', async () => {
    const d = await department();
    const p = await position(d.id);
    await send('patch', `/positions/${p.id}`, { expectedVersion: 1, name: 'Still in department' }).expect(200);
    expect((await f.prisma.position.findUniqueOrThrow({ where: { id: p.id } })).departmentId).toBe(d.id);
    await send('patch', `/positions/${p.id}`, { expectedVersion: 1, departmentId: null }).expect(409);
    await send('patch', `/positions/${p.id}`, { expectedVersion: 2, departmentId: null }).expect(200);
    expect(await f.prisma.position.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ departmentId: null, version: 3 });
    await send('patch', `/positions/${p.id}`, { expectedVersion: 3, departmentId: d.id }).expect(200);
  });

  it('invalidates appointment previews when ownership changes even if the permission set does not', async () => {
    const p = await position();
    const user = await f.target();
    const preview = (await send('post', '/position-authorization/preview', { positionIds: [p.id], targetUserId: user.id }).expect(200)).body;
    const d = await department();
    await send('patch', `/positions/${p.id}`, { expectedVersion: 1, departmentId: d.id }).expect(200);
    await send('put', `/users/${user.id}/positions`, { positionIds: [p.id], expectedPositionIds: [], authorizationBaseline: preview.authorizationBaseline }).expect(409);
    expect(await f.prisma.userPosition.count({ where: { userId: user.id } })).toBe(0);
  });

  it('preserves the same-organization composite foreign key and HTTP scope validation', async () => {
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Foreign', type: 'INTERNAL' } });
    foreignOrganizations.push(other.id);
    const d = await f.prisma.department.create({ data: { organizationId: other.id, code: randomUUID(), name: 'Foreign department' } });
    try {
      await send('post', '/positions', { departmentId: d.id, code: randomUUID(), name: 'Foreign' }).expect(404);
      const p = await position();
      await send('patch', `/positions/${p.id}`, { expectedVersion: 1, departmentId: d.id }).expect(404);
      await expect(f.prisma.position.update({ where: { id: p.id }, data: { departmentId: d.id } })).rejects.toMatchObject({ code: 'P2003' });
    } finally { await f.prisma.department.delete({ where: { id: d.id } }); }
  });

  it.each(['position', 'department', 'disabled-department', 'deleted-department'] as const)('cannot clear ownership to revive an invalid %s', async (kind) => {
    const d = await department();
    const p = await position(d.id);
    if (kind === 'position') await f.prisma.position.update({ where: { id: p.id }, data: { status: 'DISABLED', configurationRequired: true } });
    else await f.prisma.department.update({ where: { id: d.id }, data: { status: 'DISABLED', ...(kind === 'deleted-department' ? { deletedAt: new Date() } : kind === 'department' ? { configurationRequired: true } : {}) } });
    await send('patch', `/positions/${p.id}`, { expectedVersion: 1, departmentId: null }).expect(409);
    expect((await f.prisma.position.findUniqueOrThrow({ where: { id: p.id } })).departmentId).toBe(d.id);
  });

  it('deletes an unrelated business department without moving or revoking the direct position', async () => {
    const a = await appointed();
    const d = await department();
    await send('delete', `/departments/${d.id}`, { expectedVersion: 1 }).expect(200);
    expect((await f.prisma.position.findUniqueOrThrow({ where: { id: a.p.id } })).departmentId).toBeNull();
    await parity(a, true);
  });

  it.each(['position-disabled', 'position-unconfigured', 'position-deleted', 'organization-disabled', 'organization-unconfigured', 'organization-deleted', 'user-disabled', 'future', 'expired'] as const)('ORM and SQL reject %s direct appointments consistently', async (state) => {
    const a = await appointed();
    await parity(a, true);
    if (state === 'organization-deleted') {
      const rollback = new Error('Rollback immutable deleted organization fixture');
      await expect(f.prisma.$transaction(async tx => {
        await tx.organization.update({ where: { id: f.organization.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
        await parity(a, false, new Date(), tx);
        throw rollback;
      })).rejects.toBe(rollback);
      return;
    }
    try {
      if (state === 'position-disabled') await f.prisma.position.update({ where: { id: a.p.id }, data: { status: 'DISABLED' } });
      if (state === 'position-unconfigured') await f.prisma.position.update({ where: { id: a.p.id }, data: { status: 'DISABLED', configurationRequired: true } });
      if (state === 'position-deleted') await f.prisma.position.update({ where: { id: a.p.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
      if (state === 'organization-disabled') await f.prisma.organization.update({ where: { id: f.organization.id }, data: { status: 'DISABLED' } });
      if (state === 'organization-unconfigured') await f.prisma.organization.update({ where: { id: f.organization.id }, data: { status: 'DISABLED', configurationRequired: true } });
      if (state === 'user-disabled') await f.prisma.user.update({ where: { id: a.user.id }, data: { status: 'DISABLED' } });
      if (state === 'future') await f.prisma.userPosition.update({ where: { id: a.assignment.id }, data: { startedAt: new Date(Date.now() + 60_000) } });
      if (state === 'expired') await f.prisma.userPosition.update({ where: { id: a.assignment.id }, data: { endedAt: new Date() } });
      await parity(a, false);
    } finally {
      await f.prisma.organization.update({ where: { id: f.organization.id }, data: { status: 'ACTIVE', configurationRequired: false, deletedAt: null } });
    }
  });

  it('matches exact start and end boundaries without a department', async () => {
    const a = await appointed();
    const at = new Date('2026-10-30T00:00:00.000Z');
    await f.prisma.userPosition.update({ where: { id: a.assignment.id }, data: { startedAt: at } });
    await parity(a, true, at);
    await f.prisma.userPosition.update({ where: { id: a.assignment.id }, data: { startedAt: new Date(at.getTime() + 1) } });
    await parity(a, false, at);
    await f.prisma.userPosition.update({ where: { id: a.assignment.id }, data: { startedAt: new Date(at.getTime() - 1), endedAt: at } });
    await parity(a, false, at);
  });

  it('uses the explicit platform marker, not the administrator display name, and denies supplier projection', async () => {
    const normal = await appointed();
    const administrator = await appointed(PLATFORM_ADMINISTRATOR_PERMISSION);
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Platform target', type: 'INTERNAL' } });
    foreignOrganizations.push(other.id);
    const feature = async (userId: string) => {
      const [row] = await f.prisma.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${other.id}::uuid`, Prisma.sql`'organization:read'`)} AS allowed`);
      return row!.allowed;
    };
    expect(await hasPlatformAdministrator(f.prisma, normal.user.id)).toBe(false);
    expect(await feature(normal.user.id)).toBe(false);
    expect(await hasPlatformAdministrator(f.prisma, administrator.user.id)).toBe(true);
    expect((await effectiveRoleGrants(f.prisma, administrator.user.id, other.id)).some(grant => grant.platformScope)).toBe(true);
    expect(await feature(administrator.user.id)).toBe(true);
    await f.prisma.user.update({ where: { id: administrator.user.id }, data: { accountType: 'SUPPLIER' } });
    expect(await hasPlatformAdministrator(f.prisma, administrator.user.id)).toBe(false);
    expect((await effectiveRoleGrants(f.prisma, administrator.user.id, other.id))).toEqual([]);
    expect(await feature(administrator.user.id)).toBe(false);
  });

  it('never turns a direct platform administrator into a real manager, minister or department candidate', async () => {
    const a = await appointed(PLATFORM_ADMINISTRATOR_PERMISSION);
    const d = await department();
    for (const responsibility of ['SECTION_MANAGER', 'MINISTER']) {
      await send('post', '/management-bindings', { departmentId: d.id, responsibility, positionId: a.p.id }).expect(409);
    }
    const responsibilities = f.app.get(OrganizationResponsibilityService);
    expect((await responsibilities.responsibilityAssignments(f.organization.id, { search: a.user.username })).items).toEqual([]);
    expect(await f.prisma.$transaction(tx => responsibilities.workflowCurrentAssignment(tx, f.organization.id, { assignmentId: a.assignment.id }))).toBeNull();
    const engineer = await readComponentEngineerAssignment(f.prisma, f.organization.id, a.assignment.id, new Date());
    expect(engineer).toMatchObject({ valid: false, departmentId: null });
    const candidates = await listComponentEngineerAssignments(f.prisma, f.organization.id, { search: a.user.username, page: 1, pageSize: 20 }, new Date());
    expect(candidates.items).toEqual([]);
  });

  it('does not offer a direct platform administrator as a professional closure reviewer', async () => {
    const a = await appointed(PLATFORM_ADMINISTRATOR_PERMISSION);
    const d = await department();
    const options = await request(f.app.getHttpServer()).get(`/api/v1/workflows/closure-options?search=${a.user.username}`).set('Cookie', f.cookie).expect(200);
    expect(options.body.users).toEqual([]);
    const preview = await f.post('/workflows/closure-preview', { policy: 'SUPPLIER', severity: 'LOW', responsibleSectionDepartmentId: d.id, professionalUserId: a.user.id }).expect(200);
    expect(preview.body.issues).toContainEqual({ duty: 'PROFESSIONAL', code: 'PARTICIPANT_NOT_ELIGIBLE' });
  });

  it('rejects direct-only complaint analysis candidates without losing their functional permissions', async () => {
    const a = await appointed(PLATFORM_ADMINISTRATOR_PERMISSION);
    const d = await department();
    const p = await position(d.id);
    const engineer = await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: f.actor.id, positionId: p.id } });
    const complaint = await f.prisma.customerQualityComplaint.create({ data: { organizationId: f.organization.id, complaintNumber: randomUUID(), createdById: f.actor.id, updatedById: f.actor.id, qualityEngineerId: f.actor.id, qualityEngineerAssignmentId: engineer.id, qualityEngineerSource: 'MANUAL', registeredStage: 'MASS_PRODUCTION', ledgerStatus: 'FOLLOWING' } });
    const session = await f.prisma.session.findFirstOrThrow({ where: { userId: f.actor.id } });
    const actor = { ...f.actor, sessionId: session.id };
    const analysis = f.app.get(CustomerComplaintAnalysisService);
    const codes = (await effectiveRoleGrants(f.prisma, a.user.id, f.organization.id)).flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code));
    expect(codes).toContain('customer-quality:analyses:fae');
    expect((await analysis.candidates(actor, complaint.id, 'FAE')).some(item => item.userId === a.user.id)).toBe(false);
    await expect(analysis.assign(actor, complaint.id, 'FAE', { expectedVersion: 0, assigneeUserId: a.user.id, assigneeAssignmentId: a.assignment.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'CUSTOMER_ANALYSIS_CANDIDATE_INVALID' }, status: 403 });
    expect(await f.prisma.$queryRaw`SELECT id FROM customer_complaint_analyses WHERE complaint_id = ${complaint.id}::uuid`).toEqual([]);
  });

  it.each(['ACTIVE', 'DISABLED'] as const)('keeps a %s user configured when department deletion ends a business appointment but a direct appointment survives', async status => {
    const a = await appointed();
    const d = await department();
    const p = await position(d.id);
    const business = await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: a.user.id, positionId: p.id } });
    if (status === 'DISABLED') await f.prisma.user.update({ where: { id: a.user.id }, data: { status } });
    const role = await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } });
    const permission = await f.prisma.permission.upsert({ where: { code: PLATFORM_ADMINISTRATOR_PERMISSION }, create: { code: PLATFORM_ADMINISTRATOR_PERMISSION, name: 'Platform administrator' }, update: {} });
    await f.prisma.rolePermission.create({ data: { roleId: role.roleId, permissionId: permission.id } });
    try {
      const preview = (await get(`/departments/${d.id}/force-delete`).expect(200)).body;
      await send('post', `/departments/${d.id}/force-delete`, { expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken }).expect(201);
      expect(await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).toMatchObject({ status, configurationRequired: false });
      expect((await f.prisma.userPosition.findUniqueOrThrow({ where: { id: business.id } })).endedAt).not.toBeNull();
      expect((await f.prisma.userPosition.findUniqueOrThrow({ where: { id: a.assignment.id } })).endedAt).toBeNull();
      await parity(a, status === 'ACTIVE');
    } finally { await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.roleId, permissionId: permission.id } } }); }
  });
});
