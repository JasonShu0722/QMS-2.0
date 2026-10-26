import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { structureBusinessReferences, structureReferenceLiveCondition } from '../../src/modules/organization/organization-lifecycle.read-model.js';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '55440') throw new Error('Disposable loopback database required');

describe('closure state lifecycle dependency classification on PostgreSQL', () => {
  const prisma = new PrismaService();
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  // Migration-owned rows need real FK parents, but no adapter registration or live management bindings.
  async function fixture(status = 'PENDING') {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Closure lifecycle', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const department = await prisma.department.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Department' } });
    const section = await prisma.department.create({ data: { organizationId: organization.id, parentId: department.id, code: randomUUID(), name: 'Isolated section' } });
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Lifecycle fixture' } });
    const version = await prisma.workflowVersion.create({ data: { organizationId: organization.id, workflowDefinitionId: definition.id, version: 1 } });
    const node = await prisma.workflowNode.create({ data: { organizationId: organization.id, workflowVersionId: version.id, nodeKey: 'closure', type: 'APPROVAL', name: 'Closure', config: {} } });
    const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, domainCode: 'CLOSURE_LIFECYCLE_FIXTURE',
      problemType: 'FIXTURE', sourceType: 'FIXTURE', reportNumber: randomUUID(), severity: 'LOW', status: 'CLOSED' } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: organization.id, problemIndexId: problem.id,
      workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: node.id, status: 'COMPLETED' } });
    await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id } });
    expect(await structureBusinessReferences(prisma, section.id, 'department')).toEqual({ referenced: false, live: false, details: [] });
    const roundId = randomUUID();
    const context = JSON.stringify({ responsibleSectionDepartmentId: section.id });
    await prisma.$executeRaw`INSERT INTO workflow_closure_rounds
      (id, organization_id, problem_id, instance_id, workflow_version_id, node_id, content_version, content_snapshot, context, round_number, status, created_by)
      VALUES (${roundId}::uuid, ${organization.id}::uuid, ${problem.id}::uuid, ${instance.id}::uuid, ${version.id}::uuid, ${node.id}::uuid,
        1, '{}'::jsonb, ${context}::jsonb, 1, ${status}, ${user.id}::uuid)`;
    return { organization, user, section, roundId };
  }

  it.each(['APPROVED', 'RETURNED', 'CANCELLED'])('retains a %s round as history, not live work', async status => {
    const f = await fixture(status);
    const rows = await prisma.$queryRaw(Prisma.sql`SELECT t.id, t.status, (${structureReferenceLiveCondition('workflow_closure_rounds')}) AS live
      FROM workflow_closure_rounds t WHERE t.id = ${f.roundId}::uuid AND t.context->>'responsibleSectionDepartmentId' = ${f.section.id}`);
    expect(rows).toEqual([{ id: f.roundId, status, live: false }]);
    expect(await structureBusinessReferences(prisma, f.section.id, 'department')).toEqual({ referenced: true, live: false, details: [] });
    expect(await structureBusinessReferences(prisma, f.section.id.toUpperCase(), 'department')).toEqual({ referenced: true, live: false, details: [] });
  });
  it('keeps a pending round live', async () => {
    const f = await fixture();
    const rows = await prisma.$queryRaw(Prisma.sql`SELECT t.id, (${structureReferenceLiveCondition('workflow_closure_rounds')}) AS live
      FROM workflow_closure_rounds t WHERE t.id = ${f.roundId}::uuid`);
    expect(rows).toEqual([{ id: f.roundId, live: true }]);
    expect(await structureBusinessReferences(prisma, f.section.id, 'department')).toEqual({ referenced: true, live: true, details: [] });
    expect(await structureBusinessReferences(prisma, f.section.id.toUpperCase(), 'department')).toEqual({ referenced: true, live: true, details: [] });
  });
  it('retains a persisted closure receipt as a reference without making it live work', async () => {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Receipt history only', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    expect(await structureBusinessReferences(prisma, organization.id, 'organization')).toEqual({ referenced: false, live: false, details: [] });
    const key = randomUUID();
    await prisma.$executeRaw`INSERT INTO workflow_closure_receipts (organization_id, actor_user_id, key, digest, response)
      VALUES (${organization.id}::uuid, ${user.id}::uuid, ${key}, ${'a'.repeat(64)}, '{}'::jsonb)`;
    expect(await structureBusinessReferences(prisma, organization.id, 'organization')).toEqual({ referenced: true, live: false,
      details: [{ tableName: 'workflow_closure_receipts', columnName: 'organization_id', count: 1, liveCount: 0 }] });
    expect(await prisma.$queryRaw(Prisma.sql`SELECT t.key, (${structureReferenceLiveCondition('workflow_closure_receipts')}) AS live
      FROM workflow_closure_receipts t WHERE t.organization_id = ${organization.id}::uuid AND t.key = ${key}`))
      .toEqual([{ key, live: false }]);
  });
  it('retains a delivered notification after the round ends without making the organization live', async () => {
    const f = await fixture('APPROVED');
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO closure_notifications
      (id, organization_id, round_id, round_version, recipient_user_id, kind, subject, body)
      VALUES (${id}::uuid, ${f.organization.id}::uuid, ${f.roundId}::uuid, 1, ${f.user.id}::uuid, 'CLOSURE_PENDING', 'Historical closure', 'Delivered')`;
    expect(await prisma.$queryRaw(Prisma.sql`SELECT t.id, (${structureReferenceLiveCondition('closure_notifications')}) AS live
      FROM closure_notifications t WHERE t.id = ${id}::uuid`)).toEqual([{ id, live: false }]);
    expect(await structureBusinessReferences(prisma, f.organization.id, 'organization')).toEqual({ referenced: true, live: false,
      details: [
        { tableName: 'closure_notifications', columnName: 'organization_id', count: 1, liveCount: 0 },
        { tableName: 'problem_indexes', columnName: 'organization_id', count: 1, liveCount: 0 },
        { tableName: 'workflow_closure_rounds', columnName: 'organization_id', count: 1, liveCount: 0 },
        { tableName: 'workflow_definitions', columnName: 'organization_id', count: 1, liveCount: 0 },
        { tableName: 'workflow_instances', columnName: 'organization_id', count: 1, liveCount: 0 },
        { tableName: 'workflow_nodes', columnName: 'organization_id', count: 1, liveCount: 0 },
        { tableName: 'workflow_versions', columnName: 'organization_id', count: 1, liveCount: 0 },
      ] });
  });
  it.each(['PENDING', 'WAITING'])('classifies a real %s duty using its own parent round state', async status => {
    const f = await fixture();
    const other = await fixture();
    const id = randomUUID();
    const participant = JSON.stringify({ userId: f.user.id, departmentId: f.section.id });
    await prisma.$executeRaw`INSERT INTO workflow_closure_duties (id, organization_id, round_id, duty, status, user_id, participant)
      VALUES (${id}::uuid, ${f.organization.id}::uuid, ${f.roundId}::uuid, 'SECTION_MANAGER', ${status}, ${f.user.id}::uuid, ${participant}::jsonb)`;
    for (const roundStatus of ['PENDING', 'APPROVED', 'RETURNED', 'CANCELLED', 'PENDING']) {
      await prisma.$executeRaw`UPDATE workflow_closure_rounds SET status = ${roundStatus} WHERE id = ${f.roundId}::uuid`;
      const rows = await prisma.$queryRaw(Prisma.sql`SELECT t.id, t.status, r.status AS "roundStatus",
        (${structureReferenceLiveCondition('workflow_closure_duties')}) AS live
        FROM workflow_closure_duties t JOIN workflow_closure_rounds r ON r.organization_id = t.organization_id AND r.id = t.round_id
        WHERE t.id = ${id}::uuid`);
      expect(rows).toEqual([{ id, status, roundStatus, live: roundStatus === 'PENDING' }]);
    }
    expect(await prisma.$queryRaw`SELECT status FROM workflow_closure_rounds WHERE id = ${other.roundId}::uuid`).toEqual([{ status: 'PENDING' }]);
  });
  it.each(['PENDING', 'WAITING'])('aggregates an independent participant department for a %s duty without context masking', async status => {
    const f = await fixture();
    const participantSection = await prisma.department.create({ data: { organizationId: f.organization.id, parentId: f.section.parentId,
      code: randomUUID(), name: 'Participant-only section' } });
    const unrelated = await prisma.department.create({ data: { organizationId: f.organization.id, parentId: f.section.parentId,
      code: randomUUID(), name: 'Unrelated section' } });
    expect(participantSection.id).not.toBe(f.section.id);
    expect(await prisma.$queryRaw`SELECT context->>'responsibleSectionDepartmentId' AS section FROM workflow_closure_rounds WHERE id = ${f.roundId}::uuid`)
      .toEqual([{ section: f.section.id }]);
    expect(await structureBusinessReferences(prisma, participantSection.id, 'department')).toEqual({ referenced: false, live: false, details: [] });
    const id = randomUUID();
    const participant = JSON.stringify({ userId: f.user.id, departmentId: participantSection.id });
    await prisma.$executeRaw`INSERT INTO workflow_closure_duties (id, organization_id, round_id, duty, status, user_id, participant)
      VALUES (${id}::uuid, ${f.organization.id}::uuid, ${f.roundId}::uuid, 'SECTION_MANAGER', ${status}, ${f.user.id}::uuid, ${participant}::jsonb)`;
    for (const roundStatus of ['PENDING', 'APPROVED', 'RETURNED', 'CANCELLED', 'PENDING']) {
      await prisma.$executeRaw`UPDATE workflow_closure_rounds SET status = ${roundStatus} WHERE id = ${f.roundId}::uuid`;
      expect(await structureBusinessReferences(prisma, participantSection.id, 'department'))
        .toEqual({ referenced: true, live: roundStatus === 'PENDING', details: [] });
      expect(await structureBusinessReferences(prisma, participantSection.id.toUpperCase(), 'department'))
        .toEqual({ referenced: true, live: roundStatus === 'PENDING', details: [] });
      expect(await structureBusinessReferences(prisma, unrelated.id, 'department')).toEqual({ referenced: false, live: false, details: [] });
    }
    await prisma.$executeRaw`UPDATE workflow_closure_duties SET status = 'CANCELLED' WHERE id = ${id}::uuid`;
    expect(await structureBusinessReferences(prisma, participantSection.id, 'department')).toEqual({ referenced: true, live: false, details: [] });
    expect(await structureBusinessReferences(prisma, f.section.id, 'department')).toEqual({ referenced: true, live: true, details: [] });
    expect(await prisma.$queryRaw`SELECT id, status, participant->>'departmentId' AS department FROM workflow_closure_duties WHERE id = ${id}::uuid`)
      .toEqual([{ id, status: 'CANCELLED', department: participantSection.id }]);
  });
});
