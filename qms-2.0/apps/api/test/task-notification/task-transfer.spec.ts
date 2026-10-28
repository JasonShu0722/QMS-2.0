import 'reflect-metadata';
import { Prisma } from '../../src/generated/prisma/client.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { TaskTransferService } from '../../src/modules/task-notification/task-transfer.service.js';

const jest = import.meta.jest;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const organizationId = id(1);
const actor = { id: id(2), organizationId, accountType: 'INTERNAL' as const, sessionId: id(3) };
const assignment = { permission: 'workflow:act' };
const notFound = { status: 404, response: { code: 'TASK_NOT_FOUND' } };

// Transaction doubles exercise the real transfer and mutation services, not PostgreSQL.
function transferFixture(config: Record<string, unknown>, controlledVersion: boolean, marker: string) {
  const user = { id: actor.id, organizationId, accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE' },
    mfaEnabled: false, mfaPreference: 'DISABLED', mfaRequirementOverride: null, mustChangePassword: false, securityVersion: 1 };
  const target = { ...user, id: id(4) };
  const task = { id: id(5), organizationId, workflowVersionId: id(6), workflowNode: { config }, version: 1,
    claimedByUserId: actor.id, claimedAt: new Date(0), status: 'IN_PROGRESS', dueAt: null };
  const state = { controlledVersion };
  let receipt: unknown = null;
  const tx = {
    $queryRaw: jest.fn(async (raw: TemplateStringsArray | Prisma.Sql) => {
      const sql = Array.isArray(raw) ? raw.join('?') : (raw as Prisma.Sql).text;
      if (sql.includes(`config ? '${marker}'`)) return state.controlledVersion ? [{ id: id(7) }] : [];
      if (sql.includes(' AS allowed')) return [{ allowed: true }];
      return [{ id: task.id }];
    }),
    user: { findUnique: async ({ where }: { where: { id: string } }) => where.id === target.id ? target : user },
    organization: { findUnique: async () => ({ status: 'ACTIVE' }) },
    session: { findFirst: async () => ({ reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() }) },
    userRole: { findMany: async () => [{ organizationId, role: { id: id(8), organizationId, mfaRequired: false,
      permissions: ['task:transfer', 'workflow:act'].map(code => ({ permission: { id: code, code } })) } }] },
    userPosition: { findMany: async () => [] },
    workflowTask: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => where.id === task.id ? task : null),
      update: jest.fn(async ({ data }: { data: { claimedByUserId: string; claimedAt: Date; status: string } }) => {
        Object.assign(task, { ...data, version: task.version + 1 });
        return task;
      }),
    },
    adminMutation: {
      findUnique: jest.fn(async () => receipt),
      create: jest.fn(async ({ data }: { data: unknown }) => { receipt = data; return data; }),
    },
  };
  const prisma = { $transaction: async (work: (transaction: typeof tx) => unknown) => work(tx) };
  const audit = { record: jest.fn(async (..._args: unknown[]) => undefined) };
  const service = new TaskTransferService(prisma as never, new AdminMutationService(prisma as never, audit as never), audit as never);
  const input = { assigneeUserId: target.id, items: [{ id: task.id, expectedVersion: 1 }] };
  const transfer = () => service.transfer(actor, organizationId, input, 'transfer-test', 'transfer-key');
  return { tx, task, state, audit, input, transfer };
}

describe.each(['processEightD', 'supplierEightD'])('generic task transfer %s boundary (unit)', marker => {
  const fixture = (config: Record<string, unknown> = { assignment }, controlledVersion = false) => transferFixture(config, controlledVersion, marker);
  it.each([null, false, {}, { schemaVersion: 1 }])('rejects a declared controlled owner policy: %p', async value => {
    const f = fixture({ assignment, [marker]: value });
    const before = { ...f.task };
    await expect(f.transfer()).rejects.toMatchObject(notFound);
    expect(f.task).toEqual(before);
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
    expect(f.tx.adminMutation.findUnique).not.toHaveBeenCalled();
    expect(f.tx.adminMutation.create).not.toHaveBeenCalled();
  });

  it('rejects a closure-review node even outside a process version', async () => {
    const f = fixture({ assignment, closureReview: {} });
    await expect(f.transfer()).rejects.toMatchObject(notFound);
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
  });

  it('rejects an unmarked node in a controlled fixed version', async () => {
    const f = fixture({ assignment }, true);
    await expect(f.transfer()).rejects.toMatchObject(notFound);
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
    expect(f.tx.adminMutation.findUnique).not.toHaveBeenCalled();
  });

  it.each([true, false])('rechecks marked/unmarked controlled resources before returning a valid receipt: %p', async marked => {
    const f = fixture();
    await f.transfer();
    if (marked) f.task.workflowNode.config = { assignment, [marker]: null };
    else f.state.controlledVersion = true;
    const before = { ...f.task };
    f.tx.workflowTask.update.mockClear();
    f.tx.adminMutation.findUnique.mockClear();
    f.tx.adminMutation.create.mockClear();
    await expect(f.transfer()).rejects.toMatchObject(notFound);
    expect(f.task).toEqual(before);
    expect(f.tx.adminMutation.findUnique).not.toHaveBeenCalled();
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
    expect(f.tx.adminMutation.create).not.toHaveBeenCalled();
  });

  it('authorizes the entire batch before mutating an ordinary first item', async () => {
    const f = fixture();
    const controlled = { ...f.task, id: id(9), workflowNode: { config: { assignment, [marker]: null } } };
    f.tx.workflowTask.findFirst.mockImplementation(async ({ where }) => where.id === controlled.id ? controlled : f.task);
    f.input.items.push({ id: controlled.id, expectedVersion: 1 });
    await expect(f.transfer()).rejects.toMatchObject(notFound);
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
    expect(f.tx.adminMutation.create).not.toHaveBeenCalled();
  });

  it('preserves ordinary legacy transfer, success audit, and receipt replay with a stale expected version', async () => {
    const f = fixture();
    const result = [{ id: f.task.id, version: 2, assigneeUserId: f.input.assigneeUserId, status: 'IN_PROGRESS' }];
    await expect(f.transfer()).resolves.toEqual(result);
    await expect(f.transfer()).resolves.toEqual(result);
    expect(f.task).toMatchObject({ version: 2, claimedByUserId: f.input.assigneeUserId });
    expect(f.tx.workflowTask.findFirst).toHaveBeenCalledWith({ where: { id: f.task.id, organizationId }, include: { workflowNode: true } });
    expect(f.tx.workflowTask.update).toHaveBeenCalledTimes(1);
    expect(f.tx.adminMutation.create).toHaveBeenCalledTimes(1);
    expect(f.audit.record).toHaveBeenCalledTimes(1);
    expect(f.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'TASK_TRANSFERRED', outcome: 'SUCCESS' }), expect.anything());
  });
});
