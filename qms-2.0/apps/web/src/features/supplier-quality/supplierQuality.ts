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
type MutationBody = ProblemDraft | components['schemas']['UpdateSupplierProblemDraftDto'] | components['schemas']['SaveSupplierResponseDraftDto'] | ProfileInput | components['schemas']['UpdateSupplierProfileDto'];

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
