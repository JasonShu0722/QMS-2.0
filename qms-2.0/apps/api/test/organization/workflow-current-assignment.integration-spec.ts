import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Disposable loopback PostgreSQL required, never 55440.');

describe('public current appointment reference, not an authorization grant', () => {
  const db = new PrismaService();
  const audit = new AuditLogService(db);
  const service = new OrganizationResponsibilityService(db, new AdminMutationService(db, audit), audit);
  beforeAll(() => db.$connect());
  afterAll(() => db.$disconnect());
  async function fixture() {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Current appointment', type: 'INTERNAL' } });
    const user = await db.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const department = await db.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Department' } });
    const position = await db.position.create({ data: { organizationId: org.id, departmentId: department.id, code: randomUUID(), name: 'Position' } });
    const assignment = await db.userPosition.create({ data: { organizationId: org.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    return { org, user, department, position, assignment };
  }
  it('resolves exact appointment or user without inventing a permission grant', async () => {
    const f = await fixture();
    await db.$transaction(async tx => {
      const expected = { assignmentId: f.assignment.id, userId: f.user.id, departmentId: f.department.id };
      expect(await service.workflowCurrentAssignment(tx, f.org.id, { assignmentId: f.assignment.id }, true)).toEqual(expected);
      expect(await service.workflowCurrentAssignment(tx, f.org.id, { userId: f.user.id, departmentId: f.department.id })).toEqual(expected);
      expect(await tx.userRole.count({ where: { userId: f.user.id } })).toBe(0);
      expect(await service.workflowCurrentAssignment(tx, randomUUID(), { assignmentId: f.assignment.id })).toBeNull();
      expect(await service.workflowCurrentAssignment(tx, f.org.id, { userId: f.user.id, departmentId: randomUUID() })).toBeNull();
    });
  });
  it('does not resolve expired, pending, deleted or external identities', async () => {
    const f = await fixture();
    const resolve = () => db.$transaction(tx => service.workflowCurrentAssignment(tx, f.org.id, { assignmentId: f.assignment.id }, true));
    await db.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    expect(await resolve()).toBeNull();
    await db.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: null } });
    await db.position.update({ where: { id: f.position.id }, data: { status: 'DISABLED', configurationRequired: true } });
    expect(await resolve()).toBeNull();
    await db.position.update({ where: { id: f.position.id }, data: { configurationRequired: false, status: 'ACTIVE' } });
    await db.department.update({ where: { id: f.department.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
    expect(await resolve()).toBeNull();
    const external = await fixture();
    await db.user.update({ where: { id: external.user.id }, data: { accountType: 'SUPPLIER' } });
    expect(await db.$transaction(tx => service.workflowCurrentAssignment(tx, external.org.id, { userId: external.user.id }))).toBeNull();
  });
  it('rejects an unbounded or ambiguous reference instead of returning an arbitrary person', async () => {
    await expect(db.$transaction(tx => service.workflowCurrentAssignment(tx, randomUUID(), {}))).rejects.toMatchObject({ status: 400 });
    await expect(db.$transaction(tx => service.workflowCurrentAssignment(tx, randomUUID(), { userId: randomUUID(), assignmentId: randomUUID() }))).rejects.toMatchObject({ status: 400 });
  });

  it.each(['DISABLED', 'pending', 'deleted', 'SUPPLIER', 'foreign'] as const)('rejects %s user identity for current appointment', async state => {
    const f = await fixture();
    if (state === 'foreign') {
      const other = await fixture();
      for (const lock of [false, true]) expect(await db.$transaction(tx => service.workflowCurrentAssignment(tx, other.org.id, { userId: f.user.id }, lock))).toBeNull();
      return;
    } else await db.user.update({ where: { id: f.user.id }, data: state === 'pending' ? { configurationRequired: true, status: 'DISABLED' }
      : state === 'deleted' ? { deletedAt: new Date(), status: 'DISABLED' }
      : state === 'SUPPLIER' ? { accountType: 'SUPPLIER' } : { status: state } });
    for (const lock of [false, true]) {
      expect(await db.$transaction(tx => service.workflowCurrentAssignment(tx, f.org.id, { assignmentId: f.assignment.id }, lock))).toBeNull();
    }
  });

  it('filters identity eligibility before candidate pagination/count and preserves every required permission and literal search', async () => {
    const f = await fixture();
    const permissions = await Promise.all([1, 2].map(() => db.permission.create({ data: { code: `fixture:${randomUUID()}`, name: 'Fixture permission' } })));
    const role = await db.role.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Candidate',
      permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    const add = async (username: string, data: Partial<Prisma.UserUncheckedCreateInput> = {}) => {
      const user = await db.user.create({ data: { organizationId: f.org.id, username, passwordHash: 'unused', accountType: 'INTERNAL', ...data } });
      await db.userRole.create({ data: { userId: user.id, organizationId: f.org.id, roleId: role.id } });
      await db.userPosition.create({ data: { organizationId: f.org.id, userId: user.id, positionId: f.position.id, startedAt: new Date(Date.now() - 1000) } });
      return user;
    };
    const prefix = randomUUID();
    await add(`${prefix}-00-disabled`, { status: 'DISABLED' });
    await add(`${prefix}-01-pending`, { configurationRequired: true, status: 'DISABLED' });
    await add(`${prefix}-02-deleted`, { status: 'DISABLED', deletedAt: new Date() });
    await add(`${prefix}-03-supplier`, { accountType: 'SUPPLIER' });
    const foreign = await fixture();
    await db.user.update({ where: { id: foreign.user.id }, data: { username: `${prefix}-04-foreign` } });
    const first = await add(`${prefix}-10-valid`, { fullName: "Visible name%_\\'" });
    const second = await add(`${prefix}-11-valid`);
    const partial = await add(`${prefix}-12-partial`);
    const expired = await add(`${prefix}-05-expired`);
    await db.userPosition.updateMany({ where: { userId: expired.id }, data: { endedAt: new Date(Date.now() - 1) } });
    const future = await add(`${prefix}-06-future`);
    await db.userPosition.updateMany({ where: { userId: future.id }, data: { startedAt: new Date(Date.now() + 60_000) } });
    await db.userRole.deleteMany({ where: { userId: partial.id } });
    const partialRole = await db.role.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Only one grant',
      permissions: { create: { permissionId: permissions[0]!.id } } } });
    await db.userRole.create({ data: { userId: partial.id, organizationId: f.org.id, roleId: partialRole.id } });
    const directory = (search: string = prefix, offset = 0, departmentId = f.department.id) => db.$transaction(tx =>
      service.workflowAppointmentOptions(tx, f.org.id, { search, limit: 1, offset, departmentId }, permissions.map(p => p.code)));
    expect(await directory()).toMatchObject({ total: 2, items: [{ userId: first.id }] });
    expect(await directory(prefix, 1)).toMatchObject({ total: 2, items: [{ userId: second.id }] });
    expect(await directory(prefix, 2)).toEqual({ total: 2, items: [] });
    const exact = await directory("%_\\'");
    expect(exact).toMatchObject({ total: 1, items: [{ userId: first.id, fullName: "Visible name%_\\'" }] });
    expect(Object.keys(exact.items[0]!).sort()).toEqual(['assignmentId', 'departmentId', 'departmentName', 'fullName', 'positionName', 'userId', 'username']);
    expect(await directory(prefix, 0, foreign.department.id)).toEqual({ total: 0, items: [] });
    const responsibilityPage = await service.responsibilityAssignments(f.org.id, { departmentId: f.department.id, search: prefix, limit: 1, offset: 0 });
    expect(responsibilityPage.total).toBe(3);
    expect(responsibilityPage.items).toHaveLength(1);
    expect(responsibilityPage.items[0]!.startedAt).toBeInstanceOf(Date);
    expect(await service.responsibilityAssignments(f.org.id, { departmentId: f.department.id, search: prefix, limit: 1, offset: 3 })).toEqual({ total: 3, items: [] });
    expect(await service.responsibilityAssignments(f.org.id, { departmentId: f.department.id, search: "%_\\'" })).toMatchObject({ total: 1, items: [{ userId: first.id }] });
    expect(await service.responsibilityAssignments(f.org.id, { departmentId: foreign.department.id, search: prefix })).toEqual({ total: 0, items: [] });
    await db.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permissions[1]!.id } });
    expect(await directory()).toEqual({ total: 0, items: [] });
  });

  it.each(['user', 'position', 'department', 'assignment', 'organization'] as const)('holds an actual %s SHARE row lock until caller completion', async target => {
    const f = await fixture();
    let release!: () => void; const gate = new Promise<void>(done => { release = done; });
    let ready!: () => void; const acquired = new Promise<void>(done => { ready = done; });
    const holder = db.$transaction(async tx => {
      expect(await service.workflowCurrentAssignment(tx, f.org.id, { assignmentId: f.assignment.id }, true)).not.toBeNull();
      ready(); await gate;
    });
    try {
      await Promise.race([acquired, holder.then(() => { throw new Error('Holder exited without locks'); })]);
      const relation = { user: 'users', position: 'positions', department: 'departments', assignment: 'user_positions', organization: 'organizations' }[target];
      const id = { user: f.user.id, position: f.position.id, department: f.department.id, assignment: f.assignment.id, organization: f.org.id }[target];
      const error = await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(relation)} WHERE id = ${id}::uuid FOR UPDATE`);
      }).then(() => undefined, (error: unknown) => error);
      const meta = (error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } })?.meta;
      expect(meta?.code ?? meta?.driverAdapterError?.cause?.originalCode).toBe('55P03');
    } finally { release(); await holder; }
  });

  it.each(['expiry', 'revocation', 'replacement'] as const)('rechecks the SAME assignment and identity after a real user lock wait: %s', async change => {
    const f = await fixture();
    const other = await db.user.create({ data: { organizationId: f.org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const replacementPosition = await db.position.create({ data: { organizationId: f.org.id, departmentId: f.department.id, code: randomUUID(), name: 'Another appointment' } });
    // If the selected appointment expires, the still-current second appointment must never replace it.
    await db.userPosition.create({ data: { id: `ffffffff-ffff-4fff-bfff-${randomUUID().slice(-12)}`, organizationId: f.org.id,
      userId: f.user.id, positionId: replacementPosition.id, startedAt: new Date(Date.now() - 1000) } });
    if (change === 'expiry') await db.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: new Date(Date.now() + 600) } });
    let release!: () => void; const gate = new Promise<void>(done => { release = done; });
    let ready!: (pid: number) => void; const acquired = new Promise<number>(done => { ready = done; });
    const writer = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.user.id}::uuid FOR UPDATE`;
      ready((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await gate;
      if (change === 'revocation') await tx.user.update({ where: { id: f.user.id }, data: { configurationRequired: true, status: 'DISABLED' } });
      if (change === 'replacement') await tx.userPosition.update({ where: { id: f.assignment.id }, data: { userId: other.id } });
    });
    let reader: Promise<unknown> | undefined;
    try {
      const pid = await acquired;
      reader = db.$transaction(tx => service.workflowCurrentAssignment(tx, f.org.id, { userId: f.user.id }, true));
      void reader.catch(() => undefined);
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS
          (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (row?.blocked) { blocked = true; break; }
        await delay(5);
      }
      expect(blocked).toBe(true);
      if (change === 'expiry') await delay(650);
    } finally { release(); await writer; }
    expect(await reader).toBeNull();
  });
});
