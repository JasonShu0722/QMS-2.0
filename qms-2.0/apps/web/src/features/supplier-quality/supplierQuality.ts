import type { components, operations } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';

export type SupplierProblem = components['schemas']['SupplierProblemDto'];
export type ProblemDraft = components['schemas']['SupplierProblemDraftDto'];
export type ResponseContent = components['schemas']['SupplierResponseContentDto'];
export type ProfileInput = components['schemas']['CreateSupplierProfileDto'];
export type SupplierProfile = components['schemas']['SupplierProfileDto'];
export type ProblemQuery = NonNullable<operations['SupplierQualityController_list']['parameters']['query']>;
export type ProblemPage = components['schemas']['SupplierProblemPageDto'];
export type ProfilePage = components['schemas']['SupplierProfilePageDto'];
export type ReferenceOptions = components['schemas']['SupplierReferenceOptionsDto'];
export type ReferenceOption = components['schemas']['SupplierReferenceOptionDto'];
export type SupplierWorkflowActionBody = Omit<components['schemas']['SupplierWorkflowActionDto'], 'accepted'> & Partial<Pick<components['schemas']['SupplierWorkflowActionDto'], 'accepted'>>;
type MutationBody = ProblemDraft | components['schemas']['UpdateSupplierProblemDraftDto'] | components['schemas']['IssueSupplierProblemDto'] | components['schemas']['SaveSupplierResponseDraftDto'] | components['schemas']['SubmitSupplierResponseDto'] | SupplierWorkflowActionBody | ProfileInput | components['schemas']['UpdateSupplierProfileDto'];

export const supplierApi = (portal: boolean) => `/api/v1/${portal ? 'supplier-portal' : 'supplier-quality'}`;
export const supplierPath = (portal: boolean) => portal ? '/supplier/corrections' : '/app/supplier-quality';
export const severityLabels = { LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '紧急' };
export const statusLabels = { OPEN: '待处理', IN_PROGRESS: '处理中', PENDING: '等待处理', RESOLVED: '已解决', CLOSED: '已关闭', ARCHIVED: '已归档' };

export function supplierError(cause: unknown): string {
  if (cause instanceof ApiError) {
    const messages: Record<string, string> = {
      SUPPLIER_INPUT_INVALID: '请检查必填资料、回复身份及完成时间',
      SUPPLIER_RECORD_NOT_FOUND: '记录不存在或当前账号无权查看',
      SUPPLIER_DRAFT_LOCKED: '当前问题已禁止编辑，请重新加载查看最新状态',
      SUPPLIER_PROFILE_DUPLICATE: '供应商或业务编码已存在',
      CONCURRENCY_CONFLICT: '内容已被其他人修改。已保留当前填写内容，请复制后重新加载再编辑',
      IDEMPOTENCY_REPLAY: '本次提交内容与已处理请求不一致。已保留填写内容，请重新加载核对',
      SUPPLIER_RESPONSE_INVALID: '请检查回复必填项和完成时间，当前填写内容已保留',
      SUPPLIER_EVIDENCE_INVALID: '证据不可用于当前问题，请检查附件状态后重试',
      WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED: '关闭前需要当前修订由另一名内部人员验证，请重新加载确认',
      WORKFLOW_ACTION_INVALID: '当前流程节点不允许此操作，请重新加载确认',
      SUPPLIER_WORKFLOW_CONFIGURATION_REQUIRED: '尚未配置可用的供应商回复流程，无法发单',
    };
    return messages[cause.code] ?? safeAccountError(cause);
  }
  return '加载或保存失败，请重试';
}

export function createSupplierMutation() {
  let pending: { signature: string; key: string } | undefined;
  return async function mutate<Result>(path: string, method: 'POST' | 'PUT', body: MutationBody): Promise<Result> {
    const signature = JSON.stringify([path, method, body]);
    if (pending?.signature !== signature) pending = { signature, key: crypto.randomUUID() };
    const attempt = pending;
    const token = await csrfToken();
    const result = await apiRequest<Result>(path, { method, headers: { 'x-csrf-token': token, 'Idempotency-Key': attempt.key }, body: JSON.stringify(body) });
    if (pending === attempt) pending = undefined;
    return result;
  };
}
