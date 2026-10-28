import 'reflect-metadata';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditQueryService } from '../../src/modules/audit-log/audit-query.service.js';
import { auditActionLabel } from '../../src/modules/audit-log/audit-event-read-model.js';

describe('audit summary projection (unit, not PostgreSQL evidence)', () => {
  it.each([
    ['ANNOUNCEMENT_CREATED', '创建公告'],
    ['CUSTOMER_MASTER_UPDATED', '更新客户主数据'],
    ['MATERIAL_MASTER_UPDATED', '更新物料主数据'],
    ['POSITION_ROLES_CHANGED', '调整岗位角色'],
    ['PLATFORM_ADMINISTRATOR_GRANTED', '授予平台管理员'],
    ['PLATFORM_ADMINISTRATOR_REVOKED', '撤销平台管理员'],
    ['SUPPLIER_PROFILE_UPDATED', '更新供应商档案'],
    ['SUPPLIER_EIGHT_D_ISSUE', '发起供应商8D'],
    ['SUPPLIER_EIGHT_D_SAVE', '保存供应商8D正文或补充'],
    ['SUPPLIER_EIGHT_D_ANALYSIS_COMPLETE', '完成供应商8D原因与对策阶段'],
    ['SUPPLIER_EIGHT_D_DEADLINES', '设置供应商8D阶段期限'],
    ['SUPPLIER_EIGHT_D_SUBMIT', '提交供应商8D完整报告'],
    ['SUPPLIER_EIGHT_D_CLOSED', '关闭供应商8D'],
    ['SUPPLIER_EIGHT_D_REPORT_READ', '读取供应商8D受控报告'],
    ['SUPPLIER_EIGHT_D_REPORT_PDF', '导出供应商8D受控PDF'],
    ['SUPPLIER_EIGHT_D_DEADLINE_REQUESTED', '申请供应商8D延期'],
    ['SUPPLIER_EIGHT_D_DEADLINE_MANAGER_PENDING', '供应商8D延期待经理审批'],
    ['SUPPLIER_EIGHT_D_DEADLINE_APPROVED', '批准供应商8D延期'],
    ['SUPPLIER_EIGHT_D_DEADLINE_RETURNED', '退回供应商8D延期'],
    ['SUPPLIER_EIGHT_D_DEADLINE_CANCELLED', '取消供应商8D延期'],
    ['SUPPLIER_PPAP_EVIDENCE_BOUND', '绑定供应商 PPAP 项目证据'],
    ['SUPPLIER_PPAP_ACCEPTED', '接受供应商 PPAP 项目'],
    ['SUPPLIER_PCN_NEEDS_CHANGES', '退回供应商变更通知修改'],
    ['WORKFLOW_ACTION_COMPLETED', '完成流程动作'],
    ['AUDIT_NC_REJECTED', '退回审核不符合项整改'],
    ['AUDIT_IMPORT_REJECTED', '拒绝外部审核导入行'],
    ['SUPPLIER_ADMISSION_ACCEPTED', '接受供应商准入文档'],
    ['SUPPLIER_ASN_EVIDENCE_UPDATED', '更新供应商到货预告证据'],
    ['SUPPLIER_AUDIT_RECORD_CHECKLIST_UPDATED', '更新供应商审核检查表'],
    ['SUPPLIER_BARCODE_SCANNED', '扫描供应商条码'],
    ['SUPPLIER_CONCESSION_RELEASED', '放行供应商让步接收'],
    ['SUPPLIER_INSPECTION_STANDARD_ITEM_CREATED', '创建供应商检验标准项目'],
    ['SUPPLIER_MEETING_ACTION_COMPLETED', '完成供应商会议行动项'],
    ['SUPPLIER_PERFORMANCE_APPEAL_ACCEPTED', '接受供应商绩效申诉'],
    ['SUPPLIER_RESPONSE_RETURN', '退回供应商回复'],
  ])('explains the emitted business action %s in Chinese', (action, label) => {
    expect(auditActionLabel(action)).toBe(label);
  });

  it.each(['UNKNOWN_ACTION', 'SUPPLIER_PPAP_ITEM_EVIDENCE_BOUND', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])('preserves the unrecognized action %s verbatim', (action) => {
    expect(auditActionLabel(action)).toBe(action);
  });

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
      userRole: { findMany: async () => [{ organizationId, role: { id: 'audit-reader', organizationId, code: 'AUDIT_READER', name: 'Audit reader', mfaRequired: false, permissions: [{ permission: { id: 'audit-read', code: 'audit:read', name: 'Read audit' } }] } }] },
      userPosition: { findMany: async () => [] },
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
