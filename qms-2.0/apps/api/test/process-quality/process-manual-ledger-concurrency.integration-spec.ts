import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

const databaseUrl = process.env.DATABASE_URL;
const url = databaseUrl ? new URL(databaseUrl) : undefined;
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Manual ledger concurrency requires disposable loopback PostgreSQL, never preview 55440.');
}

function settled<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

function sqlState(error: unknown) {
  const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } } | undefined;
  return failure?.meta?.code ?? failure?.meta?.driverAdapterError?.cause?.originalCode ?? failure?.code;
}

describe('manual ledger SQE foreign key versus authenticated user lock on real PostgreSQL', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const maintainerId = randomUUID();
  let actor: AdminActor;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: `N3-lock-${organizationId}`, name: 'N3 lock regression', type: 'INTERNAL' } });
    for (const id of [userId, maintainerId]) await prisma.user.create({ data: { id, organizationId, username: `N3-lock-${id}`, passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId, code: `N3-lock-${randomUUID()}`, name: 'No role-name authorization' } });
    const code = 'process-quality:defects:write';
    const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { organizationId, userId, roleId: role.id } });
    await new SessionService(prisma, audit).create(userId, prisma, { reauthenticated: true });
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    actor = { id: userId, organizationId, accountType: 'INTERNAL', sessionId: session.id };
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const source = () => prisma.processDefect.create({ data: { organizationId, description: 'SQE FK lock order', createdById: maintainerId, updatedById: maintainerId } });

  async function connection() {
    const client = new Client({ connectionString: databaseUrl, query_timeout: 10_000 });
    await client.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '8s'");
    return client;
  }

  async function waitForSourceWaiter(blockerPid: number, waiterPid?: number) {
    for (let attempt = 0; attempt < 250; attempt++) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE ${blockerPid} = ANY(pg_blocking_pids(pid)) AND (${waiterPid ?? null}::int IS NULL OR pid = ${waiterPid ?? null}::int)) AS waiting`;
      if (row.waiting) return;
      await delay(10);
    }
    throw new Error('The authenticated user transaction must actually wait for the source row lock');
  }

  function insertMaterial(client: Client, defectId: string, materialId: string) {
    return client.query(`INSERT INTO process_defect_material_items
      (id, organization_id, defect_id, position, material_code, sqe_user_id, created_by_id, updated_by_id)
      VALUES ($1, $2, $3, 0, 'LOCK-MATERIAL', $4, $5, $5)`, [materialId, organizationId, defectId, userId, maintainerId]);
  }

  it('proves the former FOR UPDATE mode blocks the SQE FK while that same user waits for the source', async () => {
    const record = await source();
    const maintenance = await connection();
    const authentication = await connection();
    let pending: ReturnType<typeof settled> | undefined;
    try {
      await maintenance.query('SELECT id FROM process_defects WHERE id = $1 FOR UPDATE', [record.id]);
      const sourcePid = (await maintenance.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const authPid = (await authentication.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await authentication.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      pending = settled(authentication.query('SELECT id FROM process_defects WHERE id = $1 FOR UPDATE', [record.id]));
      await waitForSourceWaiter(sourcePid, authPid);
      // Bound the known old lock ring instead of requiring a deadlock detector victim.
      await maintenance.query("SET LOCAL lock_timeout = '200ms'");
      const inserted = await settled(insertMaterial(maintenance, record.id, randomUUID()));
      await maintenance.query('ROLLBACK');
      const resumed = await pending;
      const failures = [inserted, resumed].flatMap(result => result.ok ? [] : [sqlState(result.error)]);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.every(code => code === '55P03' || code === '40P01')).toBe(true);
    } finally {
      await maintenance.query('ROLLBACK');
      await pending;
      await authentication.query('ROLLBACK');
      await Promise.all([maintenance.end(), authentication.end()]);
    }
  }, 20_000);

  it('lets the real AdminMutation authentication and the SQE FK writer finish without a hidden deadlock', async () => {
    const record = await source();
    const materialId = randomUUID();
    const maintenance = await connection();
    let rawFailure: unknown;
    let pending: ReturnType<typeof settled> | undefined;
    try {
      await maintenance.query('SELECT id FROM process_defects WHERE id = $1 FOR UPDATE', [record.id]);
      const pid = (await maintenance.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      pending = settled(mutations.run({ actor, organizationId, key: randomUUID(), traceId: randomUUID(), action: 'PROCESS_DEFECT_UPDATED',
        payload: { id: record.id, expectedVersion: 1 }, permission: 'process-quality:defects:write' }, async tx => {
        try {
          await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${record.id}::uuid FOR UPDATE`;
          const changed = await tx.processDefect.updateMany({ where: { id: record.id, organizationId, version: 1 }, data: { version: { increment: 1 }, updatedById: userId } });
          if (changed.count !== 1) throw new HttpException({ code: 'CONCURRENCY_CONFLICT' }, 409);
          return changed.count;
        } catch (error) {
          // AdminMutation maps deadlocks and serialization to 409; retain the original error so 40P01 cannot pass as CAS.
          rawFailure = error;
          throw error;
        }
      }));
      await waitForSourceWaiter(pid);
      await insertMaterial(maintenance, record.id, materialId);
      await maintenance.query('COMMIT');
      const result = await pending;
      expect(sqlState(rawFailure)).not.toBe('40P01');
      if (!result.ok) {
        expect(result.error).toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
        expect(['40001', 'P2034']).toContain(sqlState(rawFailure));
      } else expect(result.value).toBe(1);
      const [material] = await prisma.$queryRaw<{ sqeUserId: string }[]>`SELECT sqe_user_id AS "sqeUserId" FROM process_defect_material_items WHERE id = ${materialId}::uuid`;
      expect(material?.sqeUserId).toBe(userId);
      expect((await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } })).version).toBe(result.ok ? 2 : 1);
    } finally {
      await maintenance.query('ROLLBACK');
      await pending;
      await maintenance.end();
    }
  }, 20_000);
});
