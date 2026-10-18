import 'reflect-metadata';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditQueryService } from '../../src/modules/audit-log/audit-query.service.js';
import { auditActionLabel } from '../../src/modules/audit-log/audit-event-read-model.js';

describe('audit summary projection (unit, not PostgreSQL evidence)', () => {
  it.each([['LOGIN_FAILED', '登录失败'], ['ACTION_REJECTED', '操作被拒绝'], ['AUDIT_EXPORT_DENIED', '审计导出被拒绝'], ['MFA_VERIFICATION_REJECTED', 'MFA 验证被拒绝'], ['USER_ROLES_CHANGED', '变更用户角色']])('preserves the actual meaning of %s', (action, label) => {
    expect(auditActionLabel(action)).toBe(label);
  });
  const organizationId = 'organization-a';
  const actor = { id: 'reader', organizationId, sessionId: 'session', accountType: 'INTERNAL' as const };
  const person = { username: 'disabled-reader', accountType: 'INTERNAL', organizationId, organization: { name: 'Organization A' }, status: 'DISABLED', passwordHash: 'never-project', email: 'never-project' };
  async function read(eventActor: typeof person | null, action = 'USER_UPDATED') {
    let selection: unknown;
    const entry = { id: 'event', organizationId, actorUserId: eventActor ? 'person' : null, actor: eventActor, action, resourceType: 'User', resourceId: null, outcome: 'DENIED', traceId: 'trace', createdAt: new Date('2026-01-01'), metadata: { password: 'never-project', reasonCode: 'DENIED' } };
    const transaction = {
      user: { findUnique: async () => ({ status: 'ACTIVE', accountType: 'INTERNAL', organizationId, organization: { status: 'ACTIVE' } }) },
      userRole: { findMany: async () => [{ role: { permissions: [{ permission: { code: 'audit:read' } }] } }] },
      organization: { findUnique: async () => ({ status: 'ACTIVE' }) },
      auditEvent: { count: async () => 1, findMany: async (query: unknown) => { selection = query; return [entry]; } },
    };
    const service = new AuditQueryService({ $transaction: async (work: (tx: unknown) => unknown) => work(transaction) } as never, new AuditLogService({} as never));
    return { result: await service.list(actor, {}), selection };
  }

  it('returns only the safe same-organization summary, including disabled actors, and keeps outcome separate', async () => {
    const { result, selection } = await read(person);
    expect(result.items[0]).toMatchObject({ action: 'USER_UPDATED', actionLabel: '更新用户', outcome: 'DENIED', actorSummary: { username: person.username, accountType: 'INTERNAL', organizationName: 'Organization A' } });
    expect(Object.keys(result.items[0]!.actorSummary!)).toEqual(['username', 'accountType', 'organizationName']);
    expect(JSON.stringify(result)).not.toContain('never-project');
    expect(selection).toMatchObject({ select: { actor: { select: { username: true, accountType: true, organizationId: true, organization: { select: { name: true } } } } } });
    expect((selection as { select: { actor: { select: object } } }).select.actor.select).toEqual({ username: true, accountType: true, organizationId: true, organization: { select: { name: true } } });
  });

  it('does not project a foreign actor or a missing actor and preserves unknown action codes', async () => {
    const foreign = await read({ ...person, organizationId: 'organization-b', organization: { name: 'Private organization B' } }, 'UNKNOWN_ACTION');
    expect(foreign.result.items[0]).toMatchObject({ actorUserId: 'person', actorSummary: null, actionLabel: 'UNKNOWN_ACTION' });
    expect(JSON.stringify(foreign.result)).not.toContain('Private organization B');
    expect((await read(null)).result.items[0]).toMatchObject({ actorUserId: null, actorSummary: null });
  });
});
