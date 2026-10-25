import { PrismaService } from '../../src/database/prisma.service.js';
import { WorkflowEventHandler } from '../../src/modules/task-notification/workflow-event.handler.js';
import { timingFixture, clearTimingEvents } from './workflow-timing-fixture.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Closure projection requires disposable loopback PostgreSQL, never preview 55440');
}

describe('closure gate legacy projection guard on PostgreSQL', () => {
  const prisma = new PrismaService();
  const organizations: string[] = [];
  const handler = new WorkflowEventHandler();
  beforeAll(() => prisma.$connect());
  afterAll(async () => { await clearTimingEvents(prisma, organizations); await prisma.$disconnect(); });

  async function project(instanceId: string, version: number) {
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${instanceId}:${version}` } });
    // Exercise the real atomic handler without claiming another fixture's events.
    await prisma.$transaction(async (tx) => {
      await handler.handle(tx, { ...event, processingAt: new Date() });
    });
    return event;
  }

  it('completes previous pending tasks and advances the cursor without a gate task or notification', async () => {
    const fixture = await timingFixture(prisma, organizations);
    await project(fixture.started.instanceId, 1);
    const submitted = await fixture.action(fixture.started, 'SUBMIT');
    await prisma.workflowNode.update({ where: { id: submitted.currentNodeId }, data: {
      type: 'APPROVAL', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL' }, assignment: 'HANDLER' },
    } });
    await project(submitted.instanceId, 2);
    expect(await prisma.workflowTask.findMany({ where: { workflowInstanceId: submitted.instanceId } }))
      .toEqual([expect.objectContaining({ entryInstanceVersion: 1, status: 'COMPLETED' })]);
    expect(await prisma.notification.count({ where: { organizationId: fixture.organization.id } })).toBe(1);
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: submitted.instanceId } }))
      .toMatchObject({ taskProjectionVersion: 2 });
    await project(submitted.instanceId, 2);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: submitted.instanceId } })).toBe(1);
  });

  it('does not block the next ordinary event behind a skipped gate projection', async () => {
    const fixture = await timingFixture(prisma, organizations);
    await project(fixture.started.instanceId, 1);
    const submitted = await fixture.action(fixture.started, 'SUBMIT');
    await prisma.workflowNode.update({ where: { id: submitted.currentNodeId }, data: {
      type: 'APPROVAL', config: { closureReview: { schemaVersion: 1, policy: 'SUPPLIER' }, assignment: 'HANDLER' },
    } });
    await project(submitted.instanceId, 2);
    // Return event already produced by the legacy runtime fixture, before its gate config is restored.
    await prisma.workflowNode.update({ where: { id: submitted.currentNodeId }, data: { type: 'CLOSE', config: { isEnd: true, assignment: 'HANDLER' } } });
    const returned = await fixture.action(submitted, 'RETURN');
    await project(returned.instanceId, 3);
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: returned.instanceId } }))
      .toMatchObject({ taskProjectionVersion: 3 });
    expect(await prisma.workflowTask.findMany({ where: { workflowInstanceId: returned.instanceId }, orderBy: { entryInstanceVersion: 'asc' } }))
      .toEqual([expect.objectContaining({ entryInstanceVersion: 1, status: 'COMPLETED' }), expect.objectContaining({ entryInstanceVersion: 3, status: 'PENDING' })]);
  });

  it('preserves legacy ordinary projections', async () => {
    const fixture = await timingFixture(prisma, organizations);
    await project(fixture.started.instanceId, 1);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: fixture.started.instanceId, status: 'PENDING' } })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: fixture.organization.id } })).toBe(1);
  });
});
