import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { CustomerComplaintFileResourceAdapter } from '../../src/modules/customer-quality/customer-complaint-file-resource.adapter.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { createObjectStorage } from '../../src/modules/file-management/object-storage.service.js';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '55440') throw new Error('Disposable loopback PostgreSQL required');

describe('formal customer ledger file authorization on PostgreSQL', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const organizations = new OrganizationService(prisma, mutations, audit, new PositionOnboardingService(prisma, audit));
  const ledger = new CustomerComplaintLedgerService(prisma, mutations, audit, new ComponentProjectService(prisma, mutations, audit, organizations), organizations);
  const resources = new FileResourceAccess([]);
  beforeAll(async () => { await prisma.$connect(); new CustomerComplaintFileResourceAdapter(resources, ledger).onModuleInit(); });
  afterAll(() => prisma.$disconnect());

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'File boundary', type: 'INTERNAL' } });
    async function actor(): Promise<AdminActor> {
      const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
      const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date() } });
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Explicit fixture grants' } });
      for (const code of ['customer-quality:complaints:read', 'customer-quality:complaints:write', 'customer-quality:complaints:close']) {
        const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
      return { id: user.id, organizationId: organization.id, accountType: 'INTERNAL', sessionId: session.id };
    }
    const engineer = await actor(), other = await actor();
    const department = await prisma.department.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Quality section' } });
    const position = await prisma.position.create({ data: { organizationId: organization.id, departmentId: department.id, code: randomUUID(), name: 'Not an authorization rule' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: organization.id, userId: engineer.id, positionId: position.id, startedAt: new Date(Date.now() - 3600000) } });
    const row = await ledger.create(engineer, { fields: { complaintType: 'AFTER_SALES', defectDescription: 'File boundary', quantity: 1 }, qualityEngineerAssignmentId: assignment.id }, randomUUID(), randomUUID());
    return { engineer, other, row };
  }

  it('rejects unassigned source writers instead of letting the old file route bypass ledger duties', async () => {
    const f = await fixture();
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.other, { resourceType: 'CustomerComplaint', resourceId: f.row.id }, 'upload'))).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.engineer, { resourceType: 'CustomerComplaint', resourceId: f.row.id }, 'upload'))).resolves.toMatchObject({ organizationId: f.engineer.organizationId });
  });

  it('honors closed-edit permission independently of the retained legacy status', async () => {
    const f = await fixture();
    const closed = await ledger.close(f.engineer, f.row.id, { expectedVersion: f.row.version, note: 'Investigation complete' }, randomUUID(), randomUUID());
    expect(closed.status).toBe('CLOSED');
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.engineer, { resourceType: 'CustomerComplaint', resourceId: f.row.id }, 'delete'))).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.other, { resourceType: 'CustomerComplaint', resourceId: f.row.id }, 'read'))).resolves.toMatchObject({ organizationId: f.other.organizationId });
    const grant = await prisma.userRole.findFirstOrThrow({ where: { userId: f.engineer.id, organizationId: f.engineer.organizationId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:closed-edit' } });
    await prisma.rolePermission.create({ data: { roleId: grant.roleId, permissionId: permission.id } });
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.engineer, { resourceType: 'CustomerComplaint', resourceId: f.row.id }, 'attach'))).resolves.toMatchObject({ organizationId: f.engineer.organizationId });
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.other, { resourceType: 'CustomerComplaint', resourceId: f.row.id }, 'attach'))).rejects.toMatchObject({ status: 403 });
  });

  it('serializes actual file lists for one user/session without upgrading a shared user lock', async () => {
    const f = await fixture();
    const otherRow = await ledger.create(f.engineer, { fields: { complaintType: 'AFTER_SALES', defectDescription: 'Another file resource', quantity: 1 } }, randomUUID(), randomUUID());
    let signalReady!: (pid: number) => void;
    let releaseFirst!: () => void;
    const ready = new Promise<number>(resolve => { signalReady = resolve; });
    const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
    let firstReturn = true;
    class GatedAdapter extends CustomerComplaintFileResourceAdapter {
      override async authorizeAndLock(...args: Parameters<CustomerComplaintFileResourceAdapter['authorizeAndLock']>) {
        const grant = await super.authorizeAndLock(...args);
        if (firstReturn) {
          firstReturn = false;
          const [backend] = await args[0].$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          signalReady(backend!.pid);
          // Pause only after real authorization, before FileLifecycle reauthenticates.
          await gate;
        }
        return grant;
      }
    }
    const gatedResources = new FileResourceAccess([]);
    new GatedAdapter(gatedResources, ledger).onModuleInit();
    const files = new FileLifecycleService(prisma, new FilePolicyService(), createObjectStorage(), audit, gatedResources);
    const first = files.listResource(f.engineer, { resourceType: 'CustomerComplaint', resourceId: f.row.id });
    let settled: Promise<PromiseSettledResult<Awaited<typeof first>>[]> = Promise.allSettled([first]);
    let results: Awaited<typeof settled> = [];
    try {
      const pid = await Promise.race([ready, first.then(() => { throw new Error('First file list did not reach the authorization gate'); })]);
      const second = files.listResource(f.engineer, { resourceType: 'CustomerComplaint', resourceId: otherRow.id });
      settled = Promise.allSettled([first, second]);
      const deadline = Date.now() + 1500;
      let queued: { pid: number; query: string } | undefined;
      while (Date.now() < deadline) {
        [queued] = await prisma.$queryRaw<{ pid: number; query: string }[]>`
          SELECT pid, query FROM pg_stat_activity
          WHERE ${pid}::int = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'
            AND datname = current_database()`;
        if (queued) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(queued).toBeDefined();
      expect(queued!.query).toMatch(/SELECT id FROM (users|sessions) WHERE id = \$1::uuid FOR (NO KEY UPDATE|UPDATE)/);
      console.info('File list authentication blocker', { blockerPid: pid, ...queued });
    } finally {
      releaseFirst();
      results = await settled;
    }
    console.info('Concurrent file list outcomes', JSON.stringify(results.map(result => result.status === 'fulfilled'
      ? result
      : { status: result.status, code: result.reason.code, meta: result.reason.meta, message: result.reason.message })));
    expect(results).toEqual([{ status: 'fulfilled', value: [] }, { status: 'fulfilled', value: [] }]);
  });
});
