import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AdministrativeLifecycleRegistry } from '../../src/common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleImpact } from '../../src/common/security/administrative-lifecycle.types.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { ComponentProjectLifecycleService } from '../../src/modules/platform-configuration/component-project-lifecycle.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Lifecycle tests require disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('component project lifecycle isolated real PostgreSQL (not full AppModule)', () => {
  let app: TestingModule;
  let prisma: PrismaService;
  let registry: AdministrativeLifecycleRegistry;
  let organizations: OrganizationService;
  const rollback = new Error('ROLLBACK_TEST_FIXTURE');

  beforeAll(async () => {
    app = await Test.createTestingModule({ providers: [
      PrismaService, AuditLogService, AdminMutationService, PositionOnboardingService, OrganizationService,
      AdministrativeLifecycleRegistry, ComponentProjectService, ComponentProjectLifecycleService,
    ] }).compile();
    registry = app.get(AdministrativeLifecycleRegistry);
    // Other domains are deliberately neutral: this only verifies configuration's registered effect.
    for (const module of ['workflow', 'identity'] as const) {
      registry.register({ module, async apply() { return { module, changed: 0, pendingConfiguration: 0 }; } });
    }
    registry.seal();
    await app.init();
    prisma = app.get(PrismaService);
    organizations = app.get(OrganizationService);
    const migrations = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(migrations[0]!.count).toBeGreaterThanOrEqual(131);
  });
  afterAll(async () => { await app?.close(); });

  async function inFixture(work: (tx: Prisma.TransactionClient) => Promise<void>) {
    await prisma.$transaction(async tx => {
      await work(tx);
      throw rollback;
    }, { timeout: 30_000 }).catch(error => { if (error !== rollback) throw error; });
  }

  async function fixture(tx: Prisma.TransactionClient) {
    const org = await tx.organization.create({ data: { code: randomUUID(), name: 'Configuration lifecycle', type: 'INTERNAL' } });
    const actorUser = await tx.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const actor: AdminActor = { id: actorUser.id, sessionId: randomUUID(), organizationId: org.id, accountType: 'INTERNAL' };
    async function engineer() {
      const user = await tx.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
      const department = await tx.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Engineering' } });
      const position = await tx.position.create({ data: { organizationId: org.id, departmentId: department.id, code: randomUUID(), name: 'Engineer' } });
      const assignment = await tx.userPosition.create({ data: { organizationId: org.id, userId: user.id, positionId: position.id } });
      return { user, department, position, assignment };
    }
    const affected = await engineer();
    const other = await engineer();
    async function project(customer: string | null, engineerId: string | null, status = 'ACTIVE') {
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO component_project_records
        (id, organization_id, code, name, stage, customer_engineer_assignment_id, project_engineer_assignment_id, status, created_by_user_id, updated_by_user_id, updated_at)
        VALUES (${id}::uuid, ${org.id}::uuid, ${id}, 'Preserved project', 'MASS_PRODUCTION', ${customer}::uuid, ${engineerId}::uuid, ${status}, ${actor.id}::uuid, ${actor.id}::uuid, '2000-01-01'::timestamptz)`;
      const mappingId = randomUUID();
      await tx.$executeRaw`INSERT INTO component_project_mappings
        (id, organization_id, component_code, project_record_id, product_category, created_by_user_id, updated_by_user_id, updated_at)
        VALUES (${mappingId}::uuid, ${org.id}::uuid, ${mappingId}, ${id}::uuid, 'Category', ${actor.id}::uuid, ${actor.id}::uuid, '2000-01-01'::timestamptz)`;
      return { id, mappingId };
    }
    const first = await project(affected.assignment.id, other.assignment.id);
    const second = await project(other.assignment.id, affected.assignment.id);
    const untouched = await project(other.assignment.id, other.assignment.id);
    const impact: AdministrativeLifecycleImpact = {
      kind: 'USER', entityId: affected.user.id, organizationId: org.id, receiptOrganizationId: org.id,
      userIds: [affected.user.id], departmentIds: [], positionIds: [], organizationIds: [],
    };
    return { org, actor, affected, other, first, second, untouched, impact, project };
  }

  async function projectRow(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Record<string, unknown>[]>`SELECT * FROM component_project_records WHERE id = ${id}::uuid`;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }
  async function mappingRow(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Record<string, unknown>[]>`SELECT * FROM component_project_mappings WHERE id = ${id}::uuid`;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }
  async function apply(tx: Prisma.TransactionClient, actor: AdminActor, impact: AdministrativeLifecycleImpact) {
    return (await registry.apply(tx, actor, impact)).find(result => result.module === 'platform-configuration')!;
  }

  it.each(['user', 'department', 'position'] as const)('clears only actual affected assignment suggestions for %s impact and increments each row once', async dimension => {
    await inFixture(async tx => {
      const f = await fixture(tx);
      if (dimension !== 'user') {
        f.impact.kind = 'DEPARTMENT';
        f.impact.entityId = f.affected.department.id;
        f.impact.userIds = [];
        f.impact.departmentIds = dimension === 'department' ? [f.affected.department.id] : [];
        f.impact.positionIds = dimension === 'position' ? [f.affected.position.id] : [];
      }
      expect(await organizations.administrativeAssignmentIds(tx, f.impact)).toEqual([f.affected.assignment.id]);
      const before = await projectRow(tx, f.first.id);
      const secondBefore = await projectRow(tx, f.second.id);
      const untouched = await projectRow(tx, f.untouched.id);
      const mapping = await mappingRow(tx, f.first.mappingId);
      expect(await apply(tx, f.actor, f.impact)).toEqual({ module: 'platform-configuration', changed: 2, pendingConfiguration: 2 });
      const changed = await projectRow(tx, f.first.id);
      expect(changed).toEqual({ ...before, customer_engineer_assignment_id: null, version: 2, updated_by_user_id: f.actor.id, updated_at: expect.any(Date) });
      expect((changed.updated_at as Date).getTime()).toBeGreaterThan((before.updated_at as Date).getTime());
      expect(await projectRow(tx, f.second.id)).toEqual({ ...secondBefore, project_engineer_assignment_id: null, version: 2, updated_by_user_id: f.actor.id, updated_at: changed.updated_at });
      expect(await projectRow(tx, f.untouched.id)).toEqual(untouched);
      expect(await mappingRow(tx, f.first.mappingId)).toEqual(mapping);
      expect(await apply(tx, f.actor, f.impact)).toEqual({ module: 'platform-configuration', changed: 0, pendingConfiguration: 0 });
      expect(await projectRow(tx, f.first.id)).toEqual(changed);
    });
  });

  it('clears two matching columns once, including inactive projects, and records the real cross-organization actor', async () => {
    await inFixture(async tx => {
      const f = await fixture(tx);
      const external = await fixture(tx);
      const both = await f.project(f.affected.assignment.id, f.affected.assignment.id, 'DISABLED');
      const before = await projectRow(tx, both.id);
      await apply(tx, external.actor, f.impact);
      expect(await projectRow(tx, both.id)).toEqual({ ...before, customer_engineer_assignment_id: null, project_engineer_assignment_id: null,
        version: 2, updated_by_user_id: external.actor.id, updated_at: expect.any(Date) });
      expect(await projectRow(tx, external.first.id)).toMatchObject({ version: 1, customer_engineer_assignment_id: external.affected.assignment.id });
    });
  });

  it.each(['DEPARTMENT', 'USER'] as const)('%s distinguishes an affected A assignment from the same user in B through the actual registered effect', async kind => {
    await inFixture(async tx => {
      const f = await fixture(tx);
      const sibling = await tx.userPosition.create({ data: { organizationId: f.org.id, userId: f.affected.user.id, positionId: f.other.position.id } });
      const b = await f.project(sibling.id, sibling.id);
      const before = await projectRow(tx, b.id), mapping = await mappingRow(tx, b.mappingId);
      f.impact = { ...f.impact, kind, entityId: kind === 'DEPARTMENT' ? f.affected.department.id : f.affected.user.id,
        departmentIds: kind === 'DEPARTMENT' ? [f.affected.department.id] : [],
        positionIds: kind === 'DEPARTMENT' ? [f.affected.position.id] : [] };
      const expectedAssignments = kind === 'DEPARTMENT' ? [f.affected.assignment.id] : [f.affected.assignment.id, sibling.id];
      expect((await organizations.administrativeAssignmentIds(tx, f.impact)).sort()).toEqual(expectedAssignments.sort());
      expect(await apply(tx, f.actor, f.impact)).toEqual({ module: 'platform-configuration', changed: kind === 'DEPARTMENT' ? 2 : 3,
        pendingConfiguration: kind === 'DEPARTMENT' ? 2 : 3 });
      expect(await projectRow(tx, b.id)).toEqual(kind === 'DEPARTMENT' ? before : { ...before, customer_engineer_assignment_id: null,
        project_engineer_assignment_id: null, version: 2, updated_by_user_id: f.actor.id, updated_at: expect.any(Date) });
      expect(await mappingRow(tx, b.mappingId)).toEqual(mapping);
      expect(f.impact.userIds).toEqual([f.affected.user.id]);
    });
  });

  it('disables organization-owned records and mappings without deleting, changing stage, or touching other organizations', async () => {
    await inFixture(async tx => {
      const f = await fixture(tx);
      const other = await fixture(tx);
      f.impact = { ...f.impact, kind: 'ORGANIZATION', entityId: f.org.id, organizationIds: [f.org.id], userIds: [] };
      expect((await organizations.administrativeAssignmentIds(tx, f.impact)).sort()).toEqual([f.affected.assignment.id, f.other.assignment.id].sort());
      const before = await projectRow(tx, f.first.id);
      const mapping = await mappingRow(tx, f.first.mappingId);
      const foreign = await projectRow(tx, other.first.id);
      const foreignMapping = await mappingRow(tx, other.first.mappingId);
      expect(await apply(tx, other.actor, f.impact)).toEqual({ module: 'platform-configuration', changed: 6, pendingConfiguration: 6 });
      const changed = await projectRow(tx, f.first.id);
      expect(changed).toEqual({ ...before, customer_engineer_assignment_id: null, project_engineer_assignment_id: null,
        status: 'DISABLED', version: 2, updated_by_user_id: other.actor.id, updated_at: expect.any(Date) });
      const changedMapping = await mappingRow(tx, f.first.mappingId);
      expect(changedMapping).toEqual({ ...mapping, status: 'DISABLED', version: 2, updated_by_user_id: other.actor.id, updated_at: expect.any(Date) });
      for (const row of [f.second, f.untouched]) {
        expect(await projectRow(tx, row.id)).toMatchObject({ status: 'DISABLED', stage: 'MASS_PRODUCTION', version: 2 });
        expect(await mappingRow(tx, row.mappingId)).toMatchObject({ status: 'DISABLED', version: 2 });
      }
      expect(await projectRow(tx, other.first.id)).toEqual(foreign);
      expect(await mappingRow(tx, other.first.mappingId)).toEqual(foreignMapping);
      const resolution = await app.get(ComponentProjectService).resolveForDomain(tx, f.org.id, f.first.mappingId);
      expect(resolution).toMatchObject({ outcome: 'inactive', suggestedQualityEngineerId: null, effectiveQualityEngineerId: null,
        issues: expect.arrayContaining(['MAPPING_OR_PROJECT_DISABLED']) });
      expect(await apply(tx, other.actor, f.impact)).toEqual({ module: 'platform-configuration', changed: 0, pendingConfiguration: 0 });
      expect(await projectRow(tx, f.first.id)).toEqual(changed);
      expect(await mappingRow(tx, f.first.mappingId)).toEqual(changedMapping);
    });
  });

  it('does nothing for empty assignment impact rather than matching all project suggestions', async () => {
    await inFixture(async tx => {
      const f = await fixture(tx);
      const before = await projectRow(tx, f.first.id);
      f.impact.userIds = [];
      expect(await organizations.administrativeAssignmentIds(tx, f.impact)).toEqual([]);
      expect(await apply(tx, f.actor, f.impact)).toEqual({ module: 'platform-configuration', changed: 0, pendingConfiguration: 0 });
      expect(await projectRow(tx, f.first.id)).toEqual(before);
    });
  });

  it('preserves real ledger manual engineer fields and source/history snapshots for user and organization effects', async () => {
    await inFixture(async tx => {
      const f = await fixture(tx);
      const snapshot = { projectId: f.first.id, customerEngineerAssignmentId: f.affected.assignment.id, engineerUserId: f.affected.user.id, stage: 'MASS_PRODUCTION' };
      const complaintId = randomUUID();
      await tx.$executeRaw`INSERT INTO customer_quality_complaints
        (id, organization_id, complaint_number, ledger_status, ledger_raw, ledger_normalized, ledger_mapping_snapshot,
         quality_engineer_id, quality_engineer_assignment_id, quality_engineer_source, registered_stage, created_by_id, updated_by_id, updated_at)
        VALUES (${complaintId}::uuid, ${f.org.id}::uuid, ${complaintId}, 'FOLLOWING', '{}'::jsonb, '{}'::jsonb, ${JSON.stringify(snapshot)}::jsonb,
          ${f.affected.user.id}::uuid, ${f.affected.assignment.id}::uuid, 'MANUAL', 'MASS_PRODUCTION', ${f.actor.id}::uuid, ${f.actor.id}::uuid, CURRENT_TIMESTAMP)`;
      const problem = await tx.problemIndex.create({ data: { organizationId: f.org.id, reportNumber: randomUUID(), domainCode: 'customer-quality', problemType: 'COMPLAINT', sourceType: 'LEDGER', severity: 'LOW' } });
      const source = { organizationId: f.org.id, problemIndexId: problem.id, sourceDomain: 'customer-quality', sourceType: 'COMPLAINT', sourceId: complaintId, sourceVersion: 1, sourceSnapshot: snapshot };
      const link = await tx.domainSourceIssueLink.create({ data: { ...source, createdBy: f.actor.id } });
      const history = await tx.domainSourceIssueLinkHistory.create({ data: { ...source, action: 'LINKED', actorUserId: f.actor.id } });
      const ledgerBefore = await tx.$queryRaw`SELECT * FROM customer_quality_complaints WHERE id = ${complaintId}::uuid`;
      expect((await apply(tx, f.actor, f.impact)).changed).toBe(2);
      await apply(tx, f.actor, { ...f.impact, kind: 'ORGANIZATION', entityId: f.org.id, organizationIds: [f.org.id] });
      expect(await tx.$queryRaw`SELECT * FROM customer_quality_complaints WHERE id = ${complaintId}::uuid`).toEqual(ledgerBefore);
      expect(await tx.domainSourceIssueLink.findUniqueOrThrow({ where: { id: link.id } })).toEqual(link);
      expect(await tx.domainSourceIssueLinkHistory.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
    });
  });

  it('rolls back configuration changes with the caller transaction', async () => {
    let projectId = '';
    let mappingId = '';
    const failure = new Error('PARENT_COMMAND_FAILED');
    await expect(prisma.$transaction(async tx => {
      const f = await fixture(tx);
      projectId = f.first.id;
      mappingId = f.first.mappingId;
      await tx.$executeRaw`SAVEPOINT before_configuration_effect`;
      const before = await projectRow(tx, projectId);
      const mappingBefore = await mappingRow(tx, mappingId);
      const impact = { ...f.impact, kind: 'ORGANIZATION' as const, organizationIds: [f.org.id] };
      expect((await apply(tx, f.actor, impact)).changed).toBe(6);
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_configuration_effect`;
      expect(await projectRow(tx, projectId)).toEqual(before);
      expect(await mappingRow(tx, mappingId)).toEqual(mappingBefore);
      expect((await apply(tx, f.actor, impact)).changed).toBe(6);
      throw failure;
    }, { timeout: 30_000 })).rejects.toBe(failure);
    expect(await prisma.$queryRaw`SELECT id FROM component_project_records WHERE id = ${projectId}::uuid`).toEqual([]);
    expect(await prisma.$queryRaw`SELECT id FROM component_project_mappings WHERE id = ${mappingId}::uuid`).toEqual([]);
  });
});
