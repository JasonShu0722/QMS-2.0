import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { NewProductQualityService } from '../../src/modules/new-product-quality/new-product-quality.service.js';
import { NewProductEightDSourceService, NEW_PRODUCT_SELECTION_SOURCE } from '../../src/modules/new-product-quality/new-product-eight-d-source.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(databaseUrl)) {
  throw new Error('Disposable PostgreSQL is required; preview port 55440 is forbidden');
}

describe('new-product same-fact selection on disposable PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const organizations = new OrganizationService(prisma, mutations, audit, new PositionOnboardingService(prisma, audit));
  const mappings = new ComponentProjectService(prisma, mutations, audit, organizations);
  const ledger = new ProcessDefectLedgerService(prisma, mutations, audit, mappings);
  const sources = new NewProductEightDSourceService(prisma, ledger, mappings);
  const problems = new ProblemIndexService(prisma, new NumberingService(prisma), audit, new OutboxService(prisma));
  const quality = new NewProductQualityService(prisma, mutations, audit, problems, undefined, undefined, sources);
  const reason = 'Human confirms the source belongs to the new-product phase; historical mapping is not publicly available';

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Selection scope', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'No business role-name semantics' } });
    for (const code of ['new-product-quality:projects:read', 'new-product-quality:projects:write', 'process-quality:defects:read', 'process-quality:defects:write', 'component-project:read', 'component-project:manage']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, organizationId: organization.id, roleId: role.id } });
    const actor: AdminActor = { id: user.id, sessionId: session.id, organizationId: organization.id, accountType: 'INTERNAL' };
    const code = `NP-${randomUUID()}`;
    const productCode = `COMP-${randomUUID()}`;
    const project = await quality.createProject(actor, { code, name: 'Existing new-product project', productCode }, randomUUID(), randomUUID());
    const projectRecord = await mappings.createProject(actor, organization.id, { code: project.code, name: 'Component project', stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    const mapping = await mappings.createMapping(actor, organization.id, { componentCode: productCode, projectRecordId: projectRecord.id, productCategory: 'Test category' }, randomUUID(), randomUUID());
    const defect = await ledger.create(actor, { description: 'One process fact', productCode, projectCode: code, occurredAt: null, defectQuantity: null }, randomUUID(), randomUUID());
    return { actor, role, project, projectRecord, mapping, defect };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  function select(f: Fixture, confirmationReason: string | undefined = reason, key = randomUUID(), expectedVersion = f.defect.version) {
    return quality.selectProcessDefect(f.actor, f.project.id, { defectId: f.defect.id, expectedVersion, ...(confirmationReason === undefined ? {} : { reason: confirmationReason }) }, randomUUID(), key);
  }

  async function withoutPermission(f: Fixture, code: string, work: () => Promise<void>) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    try { await work(); }
    finally { await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } }); }
  }

  it('freezes a selection identity distinct from legacy new_product_issues', () => {
    expect(NEW_PRODUCT_SELECTION_SOURCE).toEqual({ sourceDomain: 'new-product-quality', sourceType: 'new-product-defect-selection', problemType: 'NEW_PRODUCT_ISSUE' });
  });

  it('stores inclusion evidence and a reference, without creating another process measurement', async () => {
    const f = await fixture();
    const before = await prisma.processDefect.count({ where: { organizationId: f.actor.organizationId } });
    const selection = await select(f);
    const inclusion = {
      projectId: f.project.id, projectCode: f.project.code, componentCode: f.defect.productCode!,
      mappingId: f.mapping.id, mappingVersion: f.mapping.version,
      projectRecordId: f.projectRecord.id, projectRecordVersion: f.projectRecord.version,
      observedProjectStage: 'NEW_PRODUCT', occurredAt: null, temporalEvidence: 'MANUAL_CONFIRMATION', confirmedById: f.actor.id, confirmationReason: reason,
    };
    expect(selection).toMatchObject({ defect_id: f.defect.id, source_version: f.defect.version, source_snapshot: { id: f.defect.id, occurredAt: null, defectQuantity: null, inclusion } });
    expect(Number.isFinite(Date.parse(selection.source_snapshot.inclusion.observedAt))).toBe(true);
    expect(await prisma.processDefect.count({ where: { organizationId: f.actor.organizationId } })).toBe(before);
    expect(await ledger.detail(f.actor, f.defect.id)).toMatchObject({ occurredAt: null, defectQuantity: null, version: f.defect.version });
  });

  it('accepts exact component mapping rather than requiring the legacy project/product-code OR', async () => {
    const f = await fixture();
    const otherProduct = `OTHER-${randomUUID()}`;
    await prisma.$executeRaw`UPDATE new_product_projects SET product_code = ${otherProduct} WHERE id = ${f.project.id}::uuid`;
    const defect = await ledger.create(f.actor, { description: 'Mapped only', productCode: f.mapping.componentCode, projectCode: null }, randomUUID(), randomUUID());
    await expect(select({ ...f, defect })).resolves.toMatchObject({ defect_id: defect.id, project_id: f.project.id });
  });

  it('rejects same legacy projectCode when the component mapping belongs to another project', async () => {
    const f = await fixture();
    const other = await mappings.createProject(f.actor, f.actor.organizationId, { code: randomUUID(), name: 'Not this project', stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    await mappings.updateMapping(f.actor, f.actor.organizationId, f.mapping.id, { expectedVersion: f.mapping.version, projectRecordId: other.id }, randomUUID(), randomUUID());
    await expect(select(f)).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_DEFECT_PROJECT_MISMATCH' } });
  });

  it('does not let a manual reason bypass an absent component mapping', async () => {
    const f = await fixture();
    const defect = await ledger.create(f.actor, { description: 'Unknown component', productCode: randomUUID(), projectCode: f.project.code }, randomUUID(), randomUUID());
    await expect(select({ ...f, defect })).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_DEFECT_MAPPING_REQUIRED' } });
  });

  it('does not use projectCode as a substitute for a missing productCode', async () => {
    const f = await fixture();
    const defect = await ledger.create(f.actor, { description: 'Missing component', productCode: null, projectCode: f.project.code }, randomUUID(), randomUUID());
    await expect(select({ ...f, defect })).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_DEFECT_MAPPING_REQUIRED' } });
  });

  it.each(['mapping', 'project'] as const)('rejects disabled %s even with a confirmation reason', async target => {
    const f = await fixture();
    if (target === 'mapping') await mappings.updateMapping(f.actor, f.actor.organizationId, f.mapping.id, { expectedVersion: f.mapping.version, status: 'DISABLED' }, randomUUID(), randomUUID());
    else await mappings.updateProject(f.actor, f.actor.organizationId, f.projectRecord.id, { expectedVersion: f.projectRecord.version, status: 'DISABLED' }, randomUUID(), randomUUID());
    await expect(select(f)).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_DEFECT_MAPPING_REQUIRED' } });
  });

  it('keeps unknown temporal evidence explicit without making a business reason mandatory', async () => {
    const f = await fixture();
    const selected = await quality.selectProcessDefect(f.actor, f.project.id, { defectId: f.defect.id, expectedVersion: f.defect.version }, randomUUID(), randomUUID());
    expect(selected).toMatchObject({ selection_reason: null, source_snapshot: { occurredAt: null, inclusion: {
      temporalEvidence: 'UNVERIFIED', confirmedById: null, confirmationReason: null,
      warnings: ['OCCURRED_AT_UNKNOWN', 'HISTORICAL_MAPPING_UNAVAILABLE'],
    } } });
  });

  it('preserves a known occurrence date without requiring a reason or claiming historical verification', async () => {
    const f = await fixture();
    const occurredAt = new Date('2026-10-25T01:23:45.000Z');
    const defect = await ledger.create(f.actor, { description: 'Known occurrence', productCode: f.mapping.componentCode, occurredAt, defectQuantity: 2 }, randomUUID(), randomUUID());
    const selected = await quality.selectProcessDefect(f.actor, f.project.id, { defectId: defect.id, expectedVersion: defect.version }, randomUUID(), randomUUID());
    expect(selected).toMatchObject({ selection_reason: null, source_snapshot: { occurredAt: occurredAt.toISOString(), defectQuantity: 2,
      inclusion: { occurredAt: occurredAt.toISOString(), temporalEvidence: 'UNVERIFIED', warnings: ['HISTORICAL_MAPPING_UNAVAILABLE'] } } });
  });

  it('retains historical selections after mass-production and rejects new inclusions', async () => {
    const f = await fixture();
    const selection = await select(f);
    await mappings.updateProject(f.actor, f.actor.organizationId, f.projectRecord.id, { expectedVersion: f.projectRecord.version, stage: 'MASS_PRODUCTION' }, randomUUID(), randomUUID());
    expect(await quality.selectedDefects(f.actor, f.project.id)).toMatchObject([{ id: selection.id, source_snapshot: selection.source_snapshot }]);
    expect((await quality.projectDetail(f.actor, f.project.id)).selected_defects).toMatchObject([{ id: selection.id, source_snapshot: selection.source_snapshot }]);
    const defect = await ledger.create(f.actor, { description: 'After mass production', productCode: f.mapping.componentCode, projectCode: f.project.code, occurredAt: new Date() }, randomUUID(), randomUUID());
    await expect(select({ ...f, defect })).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_DEFECT_STAGE_INELIGIBLE' } });
  });

  it('does not rewrite the selected fact when the live process record is edited', async () => {
    const f = await fixture();
    const selection = await select(f);
    await ledger.update(f.actor, f.defect.id, { expectedVersion: f.defect.version, defectQuantity: 7, occurredAt: new Date() }, randomUUID(), randomUUID());
    expect(await quality.selectedDefects(f.actor, f.project.id)).toMatchObject([{ source_snapshot: selection.source_snapshot, source_version: selection.source_version }]);
    expect((await quality.projectDetail(f.actor, f.project.id)).selected_defects).toMatchObject([{ source_snapshot: selection.source_snapshot }]);
  });

  it.each(['new-product-quality:projects:read', 'process-quality:defects:read'])('requires %s on selection, replay and both read paths', async code => {
    const f = await fixture();
    const key = randomUUID();
    await select(f, reason, key);
    await withoutPermission(f, code, async () => {
      await expect(select(f, reason, key)).rejects.toMatchObject({ status: 403 });
      await expect(quality.selectedDefects(f.actor, f.project.id)).rejects.toMatchObject({ status: 403 });
      await expect(quality.projectDetail(f.actor, f.project.id)).rejects.toMatchObject({ status: 403 });
    });
  });

  it('uses a live authenticated actor, not a fabricated scope or an expired session', async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(select({ ...f, actor: other.actor })).rejects.toMatchObject({ status: 404 });
    await prisma.session.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(select(f)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects stale versions and rolls back without a selection', async () => {
    const f = await fixture();
    await expect(select(f, reason, randomUUID(), f.defect.version + 1)).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await quality.selectedDefects(f.actor, f.project.id)).toEqual([]);
  });

  it('replays the same inclusion without duplicate facts or selection rows', async () => {
    const f = await fixture();
    const key = randomUUID();
    const selected = await select(f, reason, key);
    expect(await select(f, reason, key)).toEqual(selected);
    expect(await quality.selectedDefects(f.actor, f.project.id)).toHaveLength(1);
    await expect(select(f, 'Changed confirmation', key)).rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_REPLAY' } });
  });

  it('rejects a duplicate inclusion with a different key as a conflict', async () => {
    const f = await fixture();
    await select(f);
    await expect(select(f)).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await quality.selectedDefects(f.actor, f.project.id)).toHaveLength(1);
  });

  it('resolves a selection identity with immutable source version and inclusion after mass-production or remapping', async () => {
    const f = await fixture();
    const selected = await select(f);
    const reference = await sources.sourceReference(f.actor, selected.id);
    expect(reference).toMatchObject({ sourceDomain: NEW_PRODUCT_SELECTION_SOURCE.sourceDomain, sourceType: NEW_PRODUCT_SELECTION_SOURCE.sourceType });
    expect(reference).toMatchObject({ sourceId: selected.id, sourceVersion: selected.source_version, createdBy: f.actor.id,
      sourceSnapshot: { ...selected.source_snapshot, selectionId: selected.id, projectId: f.project.id } });
    await mappings.updateProject(f.actor, f.actor.organizationId, f.projectRecord.id, { expectedVersion: f.projectRecord.version, stage: 'MASS_PRODUCTION' }, randomUUID(), randomUUID());
    await ledger.update(f.actor, f.defect.id, { expectedVersion: f.defect.version, defectQuantity: 3, productCode: randomUUID() }, randomUUID(), randomUUID());
    expect(await sources.sourceReference(f.actor, selected.id)).toEqual(reference);
    expect(await prisma.$transaction(tx => sources.lockAndResolve(tx, reference, f.actor))).toMatchObject({
      organizationId: f.actor.organizationId, createdBy: f.actor.id, sourceVersion: reference.sourceVersion, sourceSnapshot: reference.sourceSnapshot,
    });
  });

  it.each(['new-product-quality:projects:read', 'process-quality:defects:read'])('requires %s for both source-port methods', async code => {
    const f = await fixture();
    const selected = await select(f);
    const reference = await sources.sourceReference(f.actor, selected.id);
    await withoutPermission(f, code, async () => {
      await expect(sources.processReference(f.actor, f.defect.id)).rejects.toMatchObject({ status: 403 });
      await expect(sources.sourceReference(f.actor, selected.id)).rejects.toMatchObject({ status: 403 });
      await expect(prisma.$transaction(tx => sources.lockAndResolve(tx, reference, f.actor))).rejects.toMatchObject({ status: 403 });
    });
  });

  it('rejects forged actor scope, missing sessions and legacy issue identity at the public source port', async () => {
    const f = await fixture();
    const selected = await select(f);
    const reference = await sources.sourceReference(f.actor, selected.id);
    const other = await fixture();
    await expect(sources.sourceReference(other.actor, selected.id)).rejects.toMatchObject({ status: 404 });
    await expect(sources.sourceReference({ ...other.actor, scopeOrganizationId: f.actor.organizationId }, selected.id)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.$transaction(tx => sources.lockAndResolve(tx, { ...reference, sourceType: 'new-product-issue' }, f.actor))).toBeNull();
    await prisma.session.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(sources.sourceReference(f.actor, selected.id)).rejects.toMatchObject({ status: 401 });
    await expect(prisma.$transaction(tx => sources.lockAndResolve(tx, reference, f.actor))).rejects.toMatchObject({ status: 401 });
  });

  it('does not trust caller-supplied snapshots, versions or creator identity', async () => {
    const f = await fixture();
    const selected = await select(f);
    const reference = await sources.sourceReference(f.actor, selected.id);
    const resolved = await prisma.$transaction(tx => sources.lockAndResolve(tx, {
      ...reference, sourceVersion: 999, createdBy: randomUUID(), sourceSnapshot: { defectQuantity: 999 },
    }, f.actor));
    expect(resolved).toMatchObject({ createdBy: reference.createdBy, sourceVersion: reference.sourceVersion, sourceSnapshot: reference.sourceSnapshot });
    await expect(prisma.$transaction(tx => sources.lockAndResolve(tx, reference))).rejects.toMatchObject({ status: 401 });
    await expect(sources.sourceReference(f.actor, 'invalid')).rejects.toMatchObject({ status: 400 });
    await expect(sources.sourceReference(f.actor, randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await prisma.$transaction(tx => sources.lockAndResolve(tx, { ...reference, sourceId: randomUUID() }, f.actor))).toBeNull();
  });

  it('replays the original selection after process edits and mass-production without re-evaluating current admission', async () => {
    const f = await fixture();
    const key = randomUUID();
    const selected = await select(f, reason, key);
    await ledger.update(f.actor, f.defect.id, { expectedVersion: f.defect.version, defectQuantity: 4 }, randomUUID(), randomUUID());
    await mappings.updateProject(f.actor, f.actor.organizationId, f.projectRecord.id, { expectedVersion: f.projectRecord.version, stage: 'MASS_PRODUCTION' }, randomUUID(), randomUUID());
    expect(await select(f, reason, key)).toEqual(selected);
    expect(await quality.selectedDefects(f.actor, f.project.id)).toHaveLength(1);
  });

  it('fails closed instead of falling back to direct process-table access without the source provider', async () => {
    const f = await fixture();
    const missingProvider = new NewProductQualityService(prisma, mutations, audit);
    await expect(missingProvider.selectProcessDefect(f.actor, f.project.id, { defectId: f.defect.id, expectedVersion: f.defect.version }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 503, response: { code: 'NEW_PRODUCT_SOURCE_SERVICE_REQUIRED' } });
  });

  it.each(['selection', 'process'] as const)('holds the %s row lock for the caller transaction', async target => {
    const f = await fixture();
    const selected = await select(f);
    const reference = await sources.sourceReference(f.actor, selected.id);
    const processReference = await sources.processReference(f.actor, f.defect.id);
    await prisma.$transaction(async tx => {
      await sources.lockAndResolve(tx, reference, f.actor);
      await expect(prisma.$transaction(async contender => {
        await contender.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
        if (target === 'process') return ledger.lockAndResolve(contender, processReference);
        return contender.$queryRaw`SELECT id FROM new_product_defect_selections WHERE id = ${selected.id}::uuid FOR UPDATE`;
      })).rejects.toThrow(/lock timeout/i);
    }, { timeout: 10_000 });
  });

  it('reads a saved selection without waiting on its business row lock', async () => {
    const f = await fixture();
    const selected = await select(f);
    let reader: ReturnType<typeof sources.sourceReference> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let completedWhileLocked: boolean;
    try {
      completedWhileLocked = await prisma.$transaction(async blocker => {
        await blocker.$queryRaw`SELECT id FROM new_product_defect_selections WHERE id = ${selected.id}::uuid FOR UPDATE`;
        reader = sources.sourceReference(f.actor, selected.id);
        return Promise.race([reader.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 2_000); })]);
      }, { timeout: 10_000 });
    } finally { if (timer) clearTimeout(timer); }
    expect(await reader).toMatchObject({ sourceId: selected.id });
    expect(completedWhileLocked).toBe(true);
  });

  it('resolves after caller domain locks without upgrading participant or session SHARE locks', async () => {
    const f = await fixture();
    const selected = await select(f);
    const reference = await sources.sourceReference(f.actor, selected.id);
    await prisma.$transaction(async participantHolder => {
      await participantHolder.$queryRaw`SELECT id FROM users WHERE id = ${f.actor.id}::uuid FOR SHARE`;
      await participantHolder.$queryRaw`SELECT id FROM sessions WHERE id = ${f.actor.sessionId}::uuid FOR SHARE`;
      const resolved = await prisma.$transaction(async resolver => {
        await resolver.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
        return sources.lockAndResolve(resolver, reference, f.actor);
      });
      expect(resolved).toMatchObject({ sourceVersion: reference.sourceVersion, sourceSnapshot: reference.sourceSnapshot });
    }, { timeout: 10_000 });
  });

  it.each(['expired-session', 'security-version', 'password-change', 'disabled-user', 'disabled-organization'] as const)(
    'keeps %s rejection on both source methods after removing security row locks', async invalidation => {
      const f = await fixture();
      const selected = await select(f);
      const reference = await sources.sourceReference(f.actor, selected.id);
      if (invalidation === 'expired-session') await prisma.session.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
      if (invalidation === 'security-version') await prisma.user.update({ where: { id: f.actor.id }, data: { securityVersion: { increment: 1 } } });
      if (invalidation === 'password-change') await prisma.user.update({ where: { id: f.actor.id }, data: { mustChangePassword: true } });
      if (invalidation === 'disabled-user') await prisma.user.update({ where: { id: f.actor.id }, data: { status: 'DISABLED' } });
      if (invalidation === 'disabled-organization') await prisma.organization.update({ where: { id: f.actor.organizationId }, data: { status: 'DISABLED' } });
      await expect(sources.sourceReference(f.actor, selected.id)).rejects.toMatchObject({ status: 401, response: { code: 'AUTH_SESSION_REQUIRED' } });
      await expect(prisma.$transaction(tx => sources.lockAndResolve(tx, reference, f.actor))).rejects.toMatchObject({ status: 401, response: { code: 'AUTH_SESSION_REQUIRED' } });
    },
  );

  it('still enforces the actual MFA policy and accepts only an MFA-verified session', async () => {
    const f = await fixture();
    const selected = await select(f);
    const reference = await sources.sourceReference(f.actor, selected.id);
    await prisma.user.update({ where: { id: f.actor.id }, data: { mfaRequirementOverride: true } });
    await expect(sources.sourceReference(f.actor, selected.id)).rejects.toMatchObject({ status: 401, response: { code: 'AUTH_MFA_REQUIRED' } });
    await expect(prisma.$transaction(tx => sources.lockAndResolve(tx, reference, f.actor))).rejects.toMatchObject({ status: 401, response: { code: 'AUTH_MFA_REQUIRED' } });
    await prisma.session.update({ where: { id: f.actor.sessionId }, data: { mfaVerifiedAt: new Date() } });
    expect(await sources.sourceReference(f.actor, selected.id)).toEqual(reference);
    expect(await prisma.$transaction(tx => sources.lockAndResolve(tx, reference, f.actor))).toMatchObject({ sourceSnapshot: reference.sourceSnapshot });
  });
});
