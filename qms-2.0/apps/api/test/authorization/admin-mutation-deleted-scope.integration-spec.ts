import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { accountDeliveryFixture, type AccountDeliveryFixture } from '../identity/account-delivery-fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Deleted scope rejection requires disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120000);

describe('administrative rejection after organization deletion', () => {
  let f: AccountDeliveryFixture;
  let sessionId: string;
  beforeAll(async () => {
    f = await accountDeliveryFixture();
    const token = f.cookie.match(/qms_session=([^;]+)/)![1]!;
    sessionId = (await f.app.get(SessionService).resolve(token))!.id;
  });
  afterAll(async () => { await f?.close(); });

  it('keeps the original denial and its traceable audit when the requested organization is gone', async () => {
    const deleted = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Deleted scope', type: 'INTERNAL' } });
    await f.prisma.organization.delete({ where: { id: deleted.id } });
    const key = randomUUID();
    const traceId = randomUUID();
    const work = jest.fn<() => Promise<never>>();
    await expect(f.app.get(AdminMutationService).run({
      actor: { id: f.actor.id, organizationId: f.organization.id, sessionId, accountType: 'INTERNAL' },
      organizationId: deleted.id, key, action: 'N1_REJECTION_TEST', payload: {}, permission: 'organization:manage', traceId,
    }, work)).rejects.toMatchObject({ status: 403 });
    expect(work).not.toHaveBeenCalled();
    expect(await f.prisma.adminMutation.count({ where: { key } })).toBe(0);
    expect(await f.prisma.auditEvent.findFirstOrThrow({ where: { traceId, action: 'ACTION_REJECTED' } })).toMatchObject({
      organizationId: f.organization.id, actorUserId: f.actor.id, outcome: 'DENIED',
      metadata: { organizationId: deleted.id, reasonCode: 'FEATURE_PERMISSION_DENIED' },
    });
  });

  it('does not suppress an unrelated audit failure', async () => {
    const audit = jest.spyOn(f.app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('Audit unavailable'));
    try {
      await expect(f.app.get(AdminMutationService).run({
        actor: { id: f.actor.id, organizationId: f.organization.id, sessionId, accountType: 'INTERNAL' },
        organizationId: f.organization.id, key: randomUUID(), action: 'N1_REJECTION_TEST', payload: {}, permission: 'organization:manage', traceId: randomUUID(),
      }, async () => undefined)).rejects.toThrow('Audit unavailable');
    } finally { audit.mockRestore(); }
  });

  it('does not relocate a foreign-key audit failure when the requested scope still exists', async () => {
    const failure = Object.assign(new Error('Other audit FK failure'), { code: 'P2003' });
    const audit = jest.spyOn(f.app.get(AuditLogService), 'record').mockRejectedValueOnce(failure);
    try {
      await expect(f.app.get(AdminMutationService).run({
        actor: { id: f.actor.id, organizationId: f.organization.id, sessionId, accountType: 'INTERNAL' },
        organizationId: f.organization.id, key: randomUUID(), action: 'N1_REJECTION_TEST', payload: {}, permission: 'organization:manage', traceId: randomUUID(),
      }, async () => undefined)).rejects.toBe(failure);
      expect(audit).toHaveBeenCalledTimes(1);
    } finally { audit.mockRestore(); }
  });

  it('propagates failure of the fallback audit instead of silently accepting missing evidence', async () => {
    const audit = jest.spyOn(f.app.get(AuditLogService), 'record')
      .mockRejectedValueOnce(Object.assign(new Error('Deleted scope FK'), { code: 'P2003' }))
      .mockRejectedValueOnce(new Error('Fallback audit unavailable'));
    try {
      await expect(f.app.get(AdminMutationService).run({
        actor: { id: f.actor.id, organizationId: f.organization.id, sessionId, accountType: 'INTERNAL' },
        organizationId: randomUUID(), key: randomUUID(), action: 'N1_REJECTION_TEST', payload: {}, permission: 'organization:manage', traceId: randomUUID(),
      }, async () => undefined)).rejects.toThrow('Fallback audit unavailable');
      expect(audit).toHaveBeenCalledTimes(2);
    } finally { audit.mockRestore(); }
  });
});
