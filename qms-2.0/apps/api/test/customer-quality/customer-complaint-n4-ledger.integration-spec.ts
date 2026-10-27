import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { LEDGER_PERMISSIONS } from '../../src/modules/customer-quality/customer-complaint-ledger.types.js';
import { CustomerLedgerListDto } from '../../src/modules/customer-quality/customer-complaint-ledger.dto.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';

if (!process.env.DATABASE_URL || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(process.env.DATABASE_URL).port === '55440') throw new Error('An explicitly leased disposable PostgreSQL database is required');

describe('N4 sole customer complaint ledger with real PostgreSQL', () => {
  const prisma = new PrismaService(process.env.DATABASE_URL);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const organizations = new OrganizationService(prisma, mutations, audit, new PositionOnboardingService(prisma, audit));
  const components = new ComponentProjectService(prisma, mutations, audit, organizations);
  const ledger = new CustomerComplaintLedgerService(prisma, mutations, audit, components, organizations);
  const legacy = new CustomerQualityService(prisma, mutations, audit);
  const organizationId = randomUUID();
  let registrar: AdminActor; let engineer: AdminActor; let other: AdminActor; let assignmentId: string;
  let projectId: string;
  const componentCode = `N4-${randomUUID()}`;
  const make = (fields: object = {}, extra = {}) => ledger.create(registrar, { fields: { complaintType: 'AFTER_SALES', ...fields }, ...extra }, randomUUID(), randomUUID());

  async function person(permissions: string[]) {
    const id = randomUUID(); const sessionId = randomUUID(); const roleId = randomUUID();
    await prisma.user.create({ data: { id, organizationId, username: `N4-${id}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId: id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: `N4-${roleId}`, name: 'Not a role-name authorization rule' } });
    for (const code of permissions) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: id, organizationId, roleId } });
    return { id, sessionId, organizationId, accountType: 'INTERNAL' as const };
  }
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: `N4-${organizationId}`, name: 'N4 ledger', type: 'INTERNAL' } });
    registrar = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write]);
    engineer = await person([...Object.values(LEDGER_PERMISSIONS), 'component-project:manage']);
    other = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write]);
    const department = await prisma.department.create({ data: { organizationId, code: 'N4', name: 'Quality' } });
    const position = await prisma.position.create({ data: { organizationId, departmentId: department.id, code: 'N4', name: 'Any display name' } });
    assignmentId = (await prisma.userPosition.create({ data: { organizationId, userId: engineer.id, positionId: position.id, startedAt: new Date('2026-01-01') } })).id;
    const project = await components.createProject(engineer, organizationId, { code: componentCode, name: 'N4', stage: 'NEW_PRODUCT', projectEngineerAssignmentId: assignmentId }, randomUUID(), randomUUID());
    projectId = project.id;
    await components.createMapping(engineer, organizationId, { componentCode, projectRecordId: projectId, productCategory: 'controller' }, randomUUID(), randomUUID());
  });
  afterAll(async () => prisma.$disconnect());

  it('allows unresolved customer and absent risk, quantity and vehicle facts on the original table', async () => {
    const row = await make({ customerName: '待匹配客户' });
    expect(row).toMatchObject({ status: 'FOLLOWING', customerId: null, normalized: { quantity: null, mileage: null }, registeredByUserId: registrar.id });
    const [fact] = await prisma.$queryRaw<any[]>`SELECT * FROM customer_quality_complaints WHERE id = ${row.id}::uuid`;
    expect(fact).toMatchObject({ customer_id: null, severity: null, severity_policy_version: null, severity_snapshot: null });
    expect(fact.eight_d_content).toEqual({});
  });
  it('preserves invalid originals, does not calculate invalid or mixed-lot metrics', async () => {
    const invalid = await make({ quantity: 'bad', mileage: -1, productionOn: '2026-02-30', occurredOn: '2026-01-01' });
    expect(invalid.raw.quantity).toBe('bad');
    expect(invalid).toMatchObject({ normalized: { quantity: null, mileage: null, productionOn: null }, misTag: null, mileageBand: null, serviceMonths: null });
    const mixed = await make({ quantity: 3, productionOn: '2026-01-31', occurredOn: '2026-05-01', mileage: 5000 });
    expect(mixed.misTag).toBeNull();
    const single = await make({ quantity: 1, productionOn: '2026-01-31', occurredOn: '2026-05-01', mileage: 5000 });
    expect(single).toMatchObject({ serviceMonths: 3, misTag: '12MIS' });
  });
  it('does not deduplicate the same VIN or barcode; preview only suggests authorized rows', async () => {
    const barcode = randomUUID(); const first = await make({ barcode }); const second = await make({ barcode });
    expect(second.id).not.toBe(first.id);
    const preview = await ledger.preview(registrar, { mode: 'CONTINUE', rows: [{ rowNumber: 1, action: 'ADD', fields: { barcode } }] });
    expect(preview.items[0]!.similarities.map(row => row.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  });
  it('locks and checks sessions, tenant scope, expected versions and wrong-body receipt replay', async () => {
    const key = randomUUID(); const input = { fields: { complaintType: 'ZERO_KM' } };
    const first = await ledger.create(registrar, input, randomUUID(), key);
    expect((await ledger.create(registrar, input, randomUUID(), key)).id).toBe(first.id);
    await expect(ledger.create(registrar, { fields: { complaintType: 'AFTER_SALES' } }, randomUUID(), key)).rejects.toMatchObject({ status: 409 });
    await expect(ledger.detail({ ...registrar, sessionId: randomUUID() }, first.id)).rejects.toMatchObject({ status: 401 });
    const revoked = await prisma.session.create({ data: { userId: registrar.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), revokedAt: new Date(), reauthenticatedAt: new Date() } });
    await expect(ledger.detail({ ...registrar, sessionId: revoked.id }, first.id)).rejects.toMatchObject({ status: 401 });
    const outsider = await prisma.organization.create({ data: { code: `N4-${randomUUID()}`, name: 'Outside', type: 'INTERNAL' } });
    await expect(ledger.detail({ ...registrar, scopeOrganizationId: outsider.id }, first.id)).rejects.toMatchObject({ status: 403 });
    await expect(ledger.update(registrar, first.id, { fields: { quantity: 1 }, expectedVersion: 999 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });
  it('provides a read-only analysis lock, without requiring quality-engineer identity', async () => {
    const row = await make({}, { qualityEngineerAssignmentId: assignmentId });
    await expect(prisma.$transaction(tx => ledger.readCase(tx, other, row.id, 'analysis'), { isolationLevel: 'ReadCommitted' })).resolves.toMatchObject({ id: row.id, qualityEngineerId: engineer.id });
    await expect(prisma.$transaction(tx => ledger.lockCase(tx, other, row.id, row.version, 'update'), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction(tx => ledger.readCase(tx, other, row.id, 'analysis'), { isolationLevel: 'Serializable' })).rejects.toMatchObject({ status: 409 });
  });
  it('preserves manual engineer, keeps automatic in-flight engineer and fills late empty mappings', async () => {
    const mapped = await make({ componentCode });
    expect(mapped).toMatchObject({ qualityEngineerId: engineer.id, qualityEngineerSource: 'MAPPING', stage: 'NEW_PRODUCT' });
    const manual = await make({ componentCode }, { qualityEngineerAssignmentId: assignmentId });
    const lateCode = randomUUID(); const late = await make({ componentCode: lateCode });
    expect(late.qualityEngineerId).toBeNull();
    await components.createMapping(engineer, organizationId, { componentCode: lateCode, projectRecordId: projectId, productCategory: 'controller' }, randomUUID(), randomUUID());
    expect((await ledger.detail(registrar, late.id)).qualityEngineerId).toBe(engineer.id);
    await components.updateProject(engineer, organizationId, projectId, { expectedVersion: 1, stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: null }, randomUUID(), randomUUID());
    expect((await ledger.detail(registrar, mapped.id)).qualityEngineerId).toBe(engineer.id);
    expect((await ledger.detail(registrar, manual.id)).qualityEngineerSource).toBe('MANUAL');
    expect((await ledger.detail(registrar, mapped.id)).warnings.map(w => w.code)).toContain('PROJECT_STAGE_CHANGED');
    expect((await ledger.detail(registrar, late.id)).qualityEngineerId).toBe(engineer.id);
  });
  it('receiving is exact registrar or current effective engineer, with no quantity side channel', async () => {
    const row = await make({ quantity: 2 }, { qualityEngineerAssignmentId: assignmentId });
    await expect(ledger.receiving(other, row.id, { expectedVersion: row.version, courierNumber: 'denied' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const updated = await ledger.receiving(registrar, row.id, { expectedVersion: row.version, courierNumber: 'SF-1', receivedOn: '2026-10-26' }, randomUUID(), randomUUID());
    expect(updated).toMatchObject({ courierNumber: 'SF-1', receivedOn: '2026-10-26', normalized: { quantity: 2 } });
  });
  it('closes/reopens independent of old 8D, preserves events and protects closed edit', async () => {
    const row = await make({ quantity: 1 }, { qualityEngineerAssignmentId: assignmentId });
    const closed = await ledger.close(engineer, row.id, { expectedVersion: row.version, note: '调查完成，处理结果已记录' }, randomUUID(), randomUUID());
    expect(closed.status).toBe('CLOSED');
    await expect(ledger.update(registrar, row.id, { expectedVersion: closed.version, fields: { quantity: 3 } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const edit = await ledger.update(engineer, row.id, { expectedVersion: closed.version, fields: { investigation: '补充资料' } }, randomUUID(), randomUUID());
    expect(edit.status).toBe('CLOSED');
    const reopened = await ledger.reopen(engineer, row.id, { expectedVersion: edit.version, note: '继续调查' }, randomUUID(), randomUUID());
    expect(reopened.status).toBe('FOLLOWING');
    const history = (await ledger.detail(engineer, row.id)).history;
    expect(history.map(event => event.eventType)).toEqual(expect.arrayContaining(['CLOSED', 'REOPENED']));
    const [fact] = await prisma.$queryRaw<any[]>`SELECT eight_d_status, closed_by_id, closure_note FROM customer_quality_complaints WHERE id = ${row.id}::uuid`;
    expect(fact).toMatchObject({ eight_d_status: 'DRAFT', closed_by_id: engineer.id, closure_note: '调查完成，处理结果已记录' });
  });
  it('commits actual partial batch outcomes; supplements explicit targets without empty-cell clearing', async () => {
    const target = await make({ vin: 'keep', quantity: 2 }, { qualityEngineerAssignmentId: assignmentId });
    const input = { mode: 'CONTINUE' as const, rows: [
      { rowNumber: 1, action: 'ADD' as const, fields: { quantity: 'bad' } },
      { rowNumber: 2, action: 'SUPPLEMENT' as const, targetId: target.id, expectedVersion: 999, fields: { quantity: 5 } },
      { rowNumber: 3, action: 'SKIP' as const, fields: { barcode: 'skip' } },
      { rowNumber: 4, action: 'SUPPLEMENT' as const, targetId: target.id, expectedVersion: target.version, fields: { vin: '', quantity: null, investigation: '', defectDescription: 'new' } },
    ] };
    const key = randomUUID();
    const result = await ledger.commit(engineer, input, randomUUID(), key);
    expect(result).toMatchObject({ created: 1, supplemented: 1, skipped: 1, failed: 1 });
    expect(result.items[3]!.record).toMatchObject({ normalized: { vin: 'keep', quantity: 2 }, qualityEngineerId: engineer.id });
    expect(await ledger.commit(engineer, input, randomUUID(), key)).toEqual(result);
    await expect(ledger.commit(engineer, { ...input, mode: 'SKIP_ERRORS' }, randomUUID(), key)).rejects.toMatchObject({ status: 409 });
  });
  it('cancels without writes and skips content errors explicitly', async () => {
    const rows = [{ rowNumber: 1, action: 'ADD' as const, fields: { quantity: 'bad' } }];
    expect((await ledger.commit(registrar, { mode: 'CANCEL', rows }, randomUUID(), randomUUID())).items[0]!.outcome).toBe('CANCELLED');
    expect((await ledger.commit(registrar, { mode: 'SKIP_ERRORS', rows }, randomUUID(), randomUUID())).skipped).toBe(1);
  });
  it('filters and counts before paging, with legacy records still readable', async () => {
    const legacyId = randomUUID();
    await prisma.$executeRaw`INSERT INTO customer_quality_complaints (id,organization_id,complaint_number,complaint_type,defect_description,status,created_by_id,updated_by_id,updated_at) VALUES (${legacyId}::uuid,${organizationId}::uuid,${`OLD-${legacyId}`},'ZERO_KM','legacy','ARCHIVED',${registrar.id}::uuid,${registrar.id}::uuid,CURRENT_TIMESTAMP)`;
    expect(await ledger.detail(registrar, legacyId)).toMatchObject({ status: 'CLOSED', legacyStatus: 'ARCHIVED', normalized: { defectDescription: 'legacy' } });
    const page = await ledger.list(registrar, Object.assign(new CustomerLedgerListDto(), { complaintType: 'ZERO_KM', status: 'CLOSED', pageSize: 1 }));
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(page.items[0]!.status).toBe('CLOSED');
    expect(page.items[0]!.normalized.complaintType).toBe('ZERO_KM');
  });
  it('allows only one concurrent CAS writer and does not change the quantity from receiving', async () => {
    const row = await make({ quantity: 2 });
    const results = await Promise.allSettled([1,2].map(i => ledger.receiving(registrar, row.id, { expectedVersion: row.version, courierNumber: `SF-${i}` }, randomUUID(), randomUUID())));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await ledger.detail(registrar, row.id)).normalized.quantity).toBe(2);
  });
  it('rechecks revoked effective permissions before returning an idempotent receipt', async () => {
    const writer = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write]);
    const key = randomUUID(); const input = { fields: { customerName: 'Pending' } };
    await ledger.create(writer, input, randomUUID(), key);
    await prisma.userRole.deleteMany({ where: { userId: writer.id, organizationId } });
    await expect(ledger.create(writer, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    await expect(ledger.list(writer, new CustomerLedgerListDto())).rejects.toMatchObject({ status: 403 });
  });
  it('blocks expired engineer appointments and mere display-name/feature permission impersonation', async () => {
    const row = await make({}, { qualityEngineerAssignmentId: assignmentId });
    await expect(ledger.close(other, row.id, { expectedVersion: row.version, note: 'Not corresponding' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await prisma.userPosition.update({ where: { id: assignmentId }, data: { endedAt: new Date(Date.now()-1000) } });
    try {
      expect((await ledger.detail(registrar, row.id)).qualityEngineerId).toBe(engineer.id);
      await expect(ledger.close(engineer, row.id, { expectedVersion: row.version, note: 'Inactive assignment' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
      expect((await ledger.candidates(registrar, new CustomerLedgerListDto())).items.map(item => item.assignmentId)).not.toContain(assignmentId);
    } finally { await prisma.userPosition.update({ where: { id: assignmentId }, data: { endedAt: null } }); }
  });
  it('rolls back actual PostgreSQL facts and mutation receipts when success audit fails', async () => {
    class FailingAudit extends AuditLogService { override async record(): Promise<never> { throw new Error('Injected audit outage'); } }
    const failing = new CustomerComplaintLedgerService(prisma, mutations, new FailingAudit(prisma), components, organizations);
    const barcode = randomUUID(); const key = randomUUID();
    await expect(failing.create(registrar, { fields: { barcode } }, randomUUID(), key)).rejects.toThrow('Injected audit outage');
    expect(await prisma.adminMutation.count({ where: { actorUserId: registrar.id, organizationId, key } })).toBe(0);
    const [count] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM customer_quality_complaints WHERE organization_id = ${organizationId}::uuid AND ledger_raw->>'barcode' = ${barcode}`;
    expect(count!.count).toBe(0);
    await expect(failing.commit(registrar, { mode: 'CONTINUE', rows: [{ rowNumber: 1, action: 'ADD', fields: { barcode } }] }, randomUUID(), randomUUID())).rejects.toThrow('Injected audit outage');
  });
  it('uses bound search parameters and revalidates customer references rather than trusting IDs', async () => {
    const page = await ledger.list(registrar, Object.assign(new CustomerLedgerListDto(), { search: "' OR 1=1 --" }));
    expect(page.total).toBe(0);
    await expect(make({}, { customerId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  });
  it('preserves full bounded originals in immutable correction history, not a truncated prefix', async () => {
    const original = '原文'.repeat(7000);
    const row = await make({ defectDescription: original });
    const updated = await ledger.update(registrar, row.id, { expectedVersion: 1, fields: { defectDescription: 'corrected' } }, randomUUID(), randomUUID());
    expect(updated.raw.defectDescription).toBe('corrected');
    const history = (await ledger.detail(registrar, row.id)).history;
    const changes = history.map(item => JSON.parse(item.note));
    const payload = changes.every(item => typeof item.chunk === 'string') ? JSON.parse(changes.map(item => item.chunk).join('')) : changes[0];
    expect(payload.previous.defectDescription).toBe(original);
  });
  it('reads the real linked customer name even after customer deactivation without inventing raw input', async () => {
    const customer = await prisma.customerQualityCustomer.create({ data: { organizationId, code: randomUUID(), name: 'Actual customer', createdById: registrar.id, updatedById: registrar.id } });
    const row = await make({}, { customerId: customer.id });
    expect(row.normalized.customerName).toBe('Actual customer');
    expect(row.raw.customerName).toBeUndefined();
    await prisma.customerQualityCustomer.update({ where: { id: customer.id }, data: { active: false } });
    expect((await ledger.detail(registrar, row.id)).normalized.customerName).toBe('Actual customer');
    await expect(make({}, { customerId: customer.id })).rejects.toMatchObject({ status: 409 });
  });
  it('commits the full supported 100-row batch and stores one actual outcome per row', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ rowNumber: i+1, action: 'ADD' as const, fields: { complaintType: 'AFTER_SALES', defectDescription: `row-${i}`, quantity: 1 } }));
    const result = await ledger.commit(registrar, { mode: 'CONTINUE', rows }, randomUUID(), randomUUID());
    expect(result).toMatchObject({ created: 100, supplemented: 0, skipped: 0, failed: 0 });
    expect(new Set(result.items.map(item => item.complaintId)).size).toBe(100);
  }, 60000);
  it('does not assign a newly discovered mapping engineer to a previously closed empty record', async () => {
    const code = randomUUID(); const row = await make({ componentCode: code });
    await prisma.$executeRaw`UPDATE customer_quality_complaints SET ledger_status = 'CLOSED' WHERE id = ${row.id}::uuid`;
    const project = await components.createProject(engineer, organizationId, { code, name: 'Late closed mapping', stage: 'NEW_PRODUCT', projectEngineerAssignmentId: assignmentId }, randomUUID(), randomUUID());
    await components.createMapping(engineer, organizationId, { componentCode: code, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    const detail = await ledger.detail(registrar, row.id);
    expect(detail).toMatchObject({ status: 'CLOSED', qualityEngineerId: null, qualityEngineerAssignmentId: null });
    expect(detail.history).toEqual([]);
    const page = await ledger.list(registrar, Object.assign(new CustomerLedgerListDto(), { componentCode: code, qualityEngineerId: engineer.id, status: 'CLOSED' }));
    expect(page.total).toBe(0);
  });
  it('atomically adopts only a successfully edited legacy fact into the formal ledger', async () => {
    const customer = await legacy.createCustomer(registrar, { code: randomUUID(), name: 'Legacy customer' }, randomUUID(), randomUUID());
    const input = { customerId: customer.id, complaintType: 'ZERO_KM' as const, defectDescription: 'original legacy description', severity: 'LOW', severityPolicyVersion: 'legacy', severitySnapshot: { level: 'LOW' } };
    const old = await legacy.createComplaint(registrar, input, randomUUID(), randomUUID());
    const untouched = await legacy.createComplaint(registrar, input, randomUUID(), randomUUID());
    const patch = { expectedVersion: old.version, customerId: null, fields: { defectDescription: null } }; const key = randomUUID();
    const adopted = await ledger.update(registrar, old.id, patch, randomUUID(), key);
    expect(adopted).toMatchObject({ status: 'FOLLOWING', legacyStatus: 'OPEN', customerId: null, normalized: { defectDescription: null } });
    await expect(legacy.detailComplaint(registrar, old.id)).rejects.toMatchObject({ status: 409 });
    await expect(legacy.updateComplaint(registrar, old.id, { expectedVersion: adopted.version, defectDescription: 'old path bypass' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await legacy.listComplaints(registrar)).map(row => row.id)).not.toContain(old.id);
    expect((await legacy.detailComplaint(registrar, untouched.id)).ledger_status).toBeNull();
    expect(await ledger.update(registrar, old.id, patch, randomUUID(), key)).toEqual(adopted);
    expect((await ledger.detail(registrar, old.id)).history.map(item => item.note).join('')).toContain('original legacy description');
  });
  it('rolls back failed adoption and retains closed legacy state and history on successful adoption', async () => {
    const customer = await legacy.createCustomer(registrar, { code: randomUUID(), name: 'Legacy adoption rollback' }, randomUUID(), randomUUID());
    const old = await legacy.createComplaint(registrar, { customerId: customer.id, complaintType: 'ZERO_KM', defectDescription: 'old', severity: 'LOW', severityPolicyVersion: 'legacy', severitySnapshot: { level: 'LOW' } }, randomUUID(), randomUUID());
    class FailingAudit extends AuditLogService { override async record(): Promise<never> { throw new Error('Adoption audit failure'); } }
    const failing = new CustomerComplaintLedgerService(prisma, mutations, new FailingAudit(prisma), components, organizations);
    const key = randomUUID();
    await expect(failing.update(registrar, old.id, { expectedVersion: old.version, customerId: null, fields: { defectDescription: null } }, randomUUID(), key)).rejects.toThrow('Adoption audit failure');
    expect(await legacy.detailComplaint(registrar, old.id)).toMatchObject({ version: 1, customer_id: customer.id, defect_description: 'old', ledger_status: null });
    expect(await prisma.adminMutation.count({ where: { actorUserId: registrar.id, organizationId, key } })).toBe(0);
    await prisma.$executeRaw`UPDATE customer_quality_complaints SET status = 'ARCHIVED',quality_engineer_id = ${engineer.id}::uuid,quality_engineer_assignment_id = ${assignmentId}::uuid,quality_engineer_source = 'MANUAL',closure_note = 'historical closure' WHERE id = ${old.id}::uuid`;
    const adopted = await ledger.update(engineer, old.id, { expectedVersion: 1, fields: { investigation: 'closed supplement' } }, randomUUID(), randomUUID());
    expect(adopted).toMatchObject({ status: 'CLOSED', legacyStatus: 'ARCHIVED', closureNote: 'historical closure' });
    const [fact] = await prisma.$queryRaw<any[]>`SELECT ledger_status,status,eight_d_status FROM customer_quality_complaints WHERE id = ${old.id}::uuid`;
    expect(fact).toMatchObject({ ledger_status: 'CLOSED', status: 'ARCHIVED', eight_d_status: 'DRAFT' });
  });
});
