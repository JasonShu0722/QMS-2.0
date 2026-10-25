import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { clearTimingEvents, timingFixture } from './workflow-timing-fixture.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Closure worker process requires disposable loopback PostgreSQL, never preview 55440');
}

describe('compiled application worker closure routing and legacy compatibility', () => {
  const prisma = new PrismaService();
  const organizations: string[] = [];
  const eventIds: string[] = [];
  beforeAll(() => prisma.$connect());
  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({ where: { id: { in: eventIds.splice(0) } } });
    await clearTimingEvents(prisma, organizations);
  });
  afterAll(() => prisma.$disconnect());

  function runOnce(): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['dist/worker.js', '--once'], { cwd: process.cwd(), windowsHide: true,
        env: { ...process.env, QMS_WORKER_BATCH_SIZE: '1', QMS_WORKER_LOG_CYCLES: 'true', QMS_RECOVERY_MAIL_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Compiled worker closure probe timed out')); }, 20_000);
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', code => { clearTimeout(timeout); resolve({ code, output }); });
    });
  }

  it('routes closure events through the compiled APPLICATION_OUTBOX_HANDLER and retains real parse failures', async () => {
    const roundId = randomUUID();
    const event = await prisma.outboxEvent.create({ data: { aggregateId: roundId, aggregateType: 'WorkflowClosureRound', eventType: 'WORKFLOW_CLOSURE_CHANGED',
      eventKey: `closure:${roundId}:1`, payload: {}, availableAt: new Date(0), createdAt: new Date('1900-01-01T00:00:00Z') } });
    eventIds.push(event.id);
    const child = await runOnce();
    expect(child).toMatchObject({ code: 0, output: expect.stringContaining('QMS_WORKER_READY') });
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'WORKFLOW_CLOSURE_EVENT_INVALID' });
  }, 25_000);

  it('still projects the legacy workflow task and notification in the same compiled worker entrypoint', async () => {
    const fixture = await timingFixture(prisma, organizations);
    const event = await prisma.outboxEvent.update({ where: { eventKey: `workflow:${fixture.started.instanceId}:1` }, data: { availableAt: new Date(0), createdAt: new Date('1900-01-01T00:00:00Z') } });
    const child = await runOnce();
    expect(child).toMatchObject({ code: 0, output: expect.stringContaining('QMS_WORKER_READY') });
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: 'PROCESSED', attempts: 0 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: fixture.started.instanceId } })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: fixture.organization.id } })).toBe(1);
  }, 25_000);
});
