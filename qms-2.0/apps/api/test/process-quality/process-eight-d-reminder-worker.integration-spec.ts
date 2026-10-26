import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { createProcessEightDTaskFixture, clearProcessEightDTaskFixtureEvents, requireDisposableProcessEightDDatabase } from './process-eight-d-task.fixture.js';

requireDisposableProcessEightDDatabase();
describe('compiled process 8D worker entrypoint', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  const organizations: string[] = [];
  beforeAll(async () => { app = await NestFactory.createApplicationContext(AppModule, { logger: false }); prisma = app.get(PrismaService); }, 120000);
  afterEach(async () => clearProcessEightDTaskFixtureEvents(prisma, organizations));
  afterAll(async () => { await app?.close(); });

  function runOnce(): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['dist/worker.js', '--once'], { cwd: process.cwd(), windowsHide: true,
        env: { ...process.env, QMS_WORKER_BATCH_SIZE: '100', QMS_WORKER_LOG_CYCLES: 'true', QMS_RECOVERY_MAIL_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Compiled process 8D worker timed out')); }, 30000);
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', code => { clearTimeout(timeout); resolve({ code, output }); });
    });
  }

  it('discovers persisted overdue reports and delivers through actual App/worker registration, without manual poll', async () => {
    const f = await createProcessEightDTaskFixture(app, organizations);
    const run = await runOnce();
    expect(run).toMatchObject({ code: 0, output: expect.stringContaining('QMS_WORKER_READY') });
    const notices = await prisma.$queryRaw<{ recipient: string }[]>`SELECT recipient_user_id AS recipient FROM process_eight_d_notifications WHERE problem_id = ${f.problem.id}::uuid AND kind = 'HANDLING_REMINDER' ORDER BY recipient_user_id`;
    expect(notices.map(n => n.recipient)).toEqual([f.owner.user.id, f.professional.user.id].sort());
    const repeat = await runOnce(); expect(repeat.code).toBe(0);
    const [count] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM process_eight_d_notifications WHERE problem_id = ${f.problem.id}::uuid AND kind = 'HANDLING_REMINDER'`;
    expect(count?.n).toBe(2);
  }, 120000);

  it('routes malformed extension events to bounded failure/retry receipts in the compiled worker', async () => {
    const f = await createProcessEightDTaskFixture(app, organizations);
    const id = randomUUID();
    const event = await prisma.outboxEvent.create({ data: { eventKey: `deadline:${id}:1`, aggregateType: 'WorkflowDeadlineExtension', aggregateId: id, eventType: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED',
      payload: { organizationId: f.org.id }, createdAt: new Date('1900-01-01T00:00:00Z'), availableAt: new Date(0) } });
    expect((await runOnce()).code).toBe(0);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'PROCESS_EIGHT_D_REMINDER_EVENT_INVALID' });
    expect(await prisma.outboxDeliveryAttempt.count({ where: { outboxEventId: event.id, outcome: 'FAILED' } })).toBe(1);
  }, 120000);
});
