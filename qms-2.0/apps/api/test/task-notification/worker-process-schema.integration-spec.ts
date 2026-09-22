import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { clearTimingEvents, timingFixture } from './workflow-timing-fixture.js';

if (!process.env.DATABASE_URL) throw new Error('Real PostgreSQL DATABASE_URL is required for the actual worker process.');

describe('actual compiled worker process', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  const organizations: string[] = [];
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [DatabaseModule] }).compile();
    await module.init();
    prisma = module.get(PrismaService);
  });
  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await exited(child);
      }
    }
    await clearTimingEvents(prisma, organizations);
  });
  afterAll(async () => module?.close());

  function start(args: string[] = [], environment: Record<string, string> = {}) {
    const child = spawn(process.execPath, ['dist/worker.js', ...args], {
      cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, QMS_WORKER_POLL_INTERVAL_MS: '100', ...environment }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    return child;
  }

  function exited(child: ChildProcess): Promise<number | null> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
    return new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  }

  it('stays alive through empty polls and consumes events created after startup', async () => {
    const child = start();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker readiness timeout')), 15_000);
      child.stdout!.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('QMS_WORKER_READY')) { clearTimeout(timeout); resolve(); }
      });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Worker exited before readiness: ${code}`)); });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    });
    await delay(350);
    expect(child.exitCode).toBeNull();
    const context = await timingFixture(prisma, organizations);
    const deadline = Date.now() + 10_000;
    let tasks = 0;
    while (!tasks && Date.now() < deadline) {
      tasks = await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } });
      if (!tasks) await delay(50);
    }
    expect(tasks).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(1);
    await delay(250);
    expect(child.exitCode).toBeNull();
  }, 30_000);

  it('retains an explicit once mode and exits successfully after one batch', async () => {
    const context = await timingFixture(prisma, organizations);
    const child = start(['--once']);
    expect(await exited(child)).toBe(0);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
  }, 20_000);

  it('exits nonzero for invalid polling configuration', async () => {
    const child = start([], { QMS_WORKER_POLL_INTERVAL_MS: '0' });
    expect(await exited(child)).toBe(1);
  }, 20_000);
});
