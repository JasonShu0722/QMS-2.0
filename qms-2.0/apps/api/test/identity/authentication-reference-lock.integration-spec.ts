import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { assertActiveAuthentication } from '../../src/common/security/session-security.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '55440') {
  throw new Error('Authentication lock validation requires disposable loopback PostgreSQL.');
}
jest.setTimeout(120_000);

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('authentication user locks with real foreign references and security writers', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const roles = new AdminRoleService(prisma, audit, new AdminMutationService(prisma, audit));
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  async function fixture() {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Authentication reference fixture', type: 'INTERNAL' } });
    const person = async () => {
      const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
      const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), securityVersion: user.securityVersion,
        expiresAt: new Date(Date.now() + 3600_000), reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() } });
      const actor: AdminActor = { id: user.id, sessionId: session.id, organizationId: org.id, accountType: 'INTERNAL' };
      return { user, actor };
    };
    return { org, subject: await person(), maintainer: await person() };
  }

  async function holdAuthentication(actor: AdminActor) {
    const ready = signal<number>(); const release = signal<void>();
    const done = prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      ready.resolve((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await release.promise;
    }, { timeout: 20_000 });
    return { pid: await ready.promise, release: () => release.resolve(), done };
  }

  async function waitForBlocker(pid: number) {
    for (let i = 0; i < 200; i++) {
      const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS
        (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
      if (row?.blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected real PostgreSQL lock wait was not observed');
  }

  it('allows a material SQE foreign-key reference while authentication holds the user row', async () => {
    const f = await fixture();
    const source = await prisma.processDefect.create({ data: { organizationId: f.org.id, description: 'Foreign reference fixture',
      createdById: f.maintainer.user.id, updatedById: f.maintainer.user.id } });
    const held = await holdAuthentication(f.subject.actor);
    let result: { ok: true } | { error: unknown };
    try {
      result = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
        await tx.$executeRaw`INSERT INTO process_defect_material_items
          (id, organization_id, defect_id, position, material_code, sqe_user_id, created_by_id, updated_by_id)
          VALUES (${randomUUID()}::uuid, ${f.org.id}::uuid, ${source.id}::uuid, 0, 'MATERIAL',
            ${f.subject.user.id}::uuid, ${f.maintainer.user.id}::uuid, ${f.maintainer.user.id}::uuid)`;
        return { ok: true as const };
      }).catch(error => ({ error }));
    } finally { held.release(); await held.done; }
    expect(result).toEqual({ ok: true });
  });

  it.each(['SHARE', 'UPDATE', 'NO KEY UPDATE'] as const)('still blocks a competing user %s lock', async mode => {
    const f = await fixture(); const held = await holdAuthentication(f.subject.actor);
    let entered = false;
    const contender = prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${f.subject.user.id}::uuid FOR ${Prisma.raw(mode)}`);
      entered = true;
    }, { timeout: 20_000 });
    try { await waitForBlocker(held.pid); expect(entered).toBe(false); }
    finally { held.release(); await held.done; }
    await contender; expect(entered).toBe(true);
  });

  it('does not let the real role grant commit before authentication, then rejects the old session', async () => {
    const f = await fixture();
    const permissions = await prisma.permission.findMany({ where: { code: { in: [...ADMIN_PERMISSIONS] } } });
    const administrator = await prisma.role.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Local administrator',
      permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    await prisma.userRole.create({ data: { organizationId: f.org.id, userId: f.maintainer.user.id, roleId: administrator.id } });
    const requiringMfa = await prisma.role.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'MFA role', mfaRequired: true } });
    const held = await holdAuthentication(f.subject.actor);
    let committed = false;
    const grant = roles.assign(f.maintainer.actor, f.subject.user.id, { roleIds: [requiringMfa.id] }, randomUUID(), randomUUID())
      .then(value => { committed = true; return value; });
    try { await waitForBlocker(held.pid); expect(committed).toBe(false); }
    finally { held.release(); await held.done; }
    await grant; expect(committed).toBe(true);
    await expect(prisma.$transaction(tx => assertActiveAuthentication(tx, f.subject.actor))).rejects.toMatchObject({ status: 401 });
  });

  it('rereads a status revocation that committed while authentication waited for its user lock', async () => {
    const f = await fixture(); const ready = signal<number>(); const release = signal<void>();
    const writer = prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: f.subject.user.id }, data: { status: 'DISABLED', securityVersion: { increment: 1 } } });
      ready.resolve((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await release.promise;
    }, { timeout: 20_000 });
    const pid = await ready.promise;
    const authentication = prisma.$transaction(tx => assertActiveAuthentication(tx, f.subject.actor))
      .then(value => ({ value }), error => ({ error }));
    try { await waitForBlocker(pid); } finally { release.resolve(); await writer; }
    expect(await authentication).toMatchObject({ error: { status: 401 } });
  });
});
