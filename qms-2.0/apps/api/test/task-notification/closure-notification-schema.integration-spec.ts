import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Closure notification schema requires disposable loopback PostgreSQL, never preview 55440');
}

describe('closure notification persistence on PostgreSQL', () => {
  const prisma = new PrismaService();
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  it('has a real delivery table, not a pending-duty view pretending to be delivery', async () => {
    const [table] = await prisma.$queryRaw<{ name: string | null }[]>`SELECT to_regclass('closure_notifications')::text AS name`;
    expect(table?.name).toBe('closure_notifications');
  });

  // These FK fixtures need no engine, responsibility resolution or shared worker state.
  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Notice constraints', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'not-for-login', accountType: 'INTERNAL' } });
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Notice constraints' } });
    const version = await prisma.workflowVersion.create({ data: { organizationId: organization.id, workflowDefinitionId: definition.id, version: 1 } });
    const node = await prisma.workflowNode.create({ data: { organizationId: organization.id, workflowVersionId: version.id, nodeKey: 'closure', type: 'APPROVAL', name: 'Closure', config: {} } });
    const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, reportNumber: randomUUID(), domainCode: 'NOTICE_CONSTRAINT_FIXTURE', problemType: 'FIXTURE', sourceType: 'FIXTURE', severity: 'LOW' } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: organization.id, problemIndexId: problem.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: node.id } });
    const roundId = randomUUID();
    await prisma.$executeRaw`INSERT INTO workflow_closure_rounds
      (id, organization_id, problem_id, instance_id, workflow_version_id, node_id, content_version, content_snapshot, context, round_number, created_by, creator_organization_id)
      VALUES (${roundId}::uuid, ${organization.id}::uuid, ${problem.id}::uuid, ${instance.id}::uuid,
        ${version.id}::uuid, ${node.id}::uuid, 1, '{}'::jsonb, '{}'::jsonb, 1, ${user.id}::uuid, ${organization.id}::uuid)`;
    return { organizationId: organization.id, recipientId: user.id, roundId };
  }

  function insert(f: Awaited<ReturnType<typeof fixture>>, id: string, version = 1, kind = 'CLOSURE_PENDING') {
    return prisma.$executeRaw`INSERT INTO closure_notifications
      (id, organization_id, round_id, round_version, recipient_user_id, kind, subject, body)
      VALUES (${id}::uuid, ${f.organizationId}::uuid, ${f.roundId}::uuid, ${version}, ${f.recipientId}::uuid, ${kind}, 'Pending closure', 'Read the current round')`;
  }

  async function rejectsWithState(write: Promise<unknown>, state: string) {
    try {
      await write;
      throw new Error('Expected PostgreSQL to reject the notification');
    } catch (error) {
      expect(error).toMatchObject({ code: 'P2010' });
      const failure = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      expect(failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode).toBe(state);
    }
  }

  it.each([0, -1])('enforces the positive round version CHECK for %s in PostgreSQL', async version => {
    const f = await fixture(); const id = randomUUID();
    await rejectsWithState(insert(f, id, version), '23514');
    expect(await prisma.$queryRaw`SELECT id FROM closure_notifications WHERE id = ${id}::uuid`).toEqual([]);
  });

  it('rejects a version outside PostgreSQL integer range', async () => {
    await rejectsWithState(insert(await fixture(), randomUUID(), 2_147_483_648), '22003');
  });

  it.each(['TASK_ASSIGNED', 'CLOSURE_COMPLETE', ''])('enforces the closure-only notification kind CHECK for %j', async kind => {
    await rejectsWithState(insert(await fixture(), randomUUID(), 1, kind), '23514');
  });

  it('rejects an existing round from another organization through the composite FK', async () => {
    const home = await fixture(); const foreign = await fixture();
    await rejectsWithState(insert({ ...home, roundId: foreign.roundId }, randomUUID()), '23503');
  });

  it('rejects an existing recipient from another organization through the composite FK', async () => {
    const home = await fixture(); const foreign = await fixture();
    await rejectsWithState(insert({ ...home, recipientId: foreign.recipientId }, randomUUID()), '23503');
  });

  it('persists a valid notification and rejects a duplicate round/version/recipient/kind', async () => {
    const f = await fixture(); const id = randomUUID();
    expect(await insert(f, id)).toBe(1);
    await rejectsWithState(insert(f, randomUUID()), '23505');
    expect(await prisma.$queryRaw`SELECT id, round_version AS "roundVersion", kind FROM closure_notifications WHERE round_id = ${f.roundId}::uuid`)
      .toEqual([{ id, roundVersion: 1, kind: 'CLOSURE_PENDING' }]);
  });
});
