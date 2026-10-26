import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, getSession, type SessionView } from '../../api/client';

export type CustomerAnalysis = components['schemas']['CustomerAnalysisDto'];
export type CustomerAnalysisSummary = components['schemas']['CustomerAnalysisSummaryDto'];
export type CustomerAnalysisCandidate = components['schemas']['CustomerAnalysisCandidateDto'];
export type CustomerAnalysisHistory = components['schemas']['CustomerAnalysisHistoryDto'];
export type CustomerAnalysisSection = CustomerAnalysis['section'];
export type CustomerFaeDraft = components['schemas']['SaveCustomerFaeAnalysisDto'];
export type CustomerSupplierDraft = components['schemas']['SaveCustomerSupplierAnalysisDto'];
export type CustomerAnalysisBody = components['schemas']['AssignCustomerAnalysisDto'] | components['schemas']['TransferCustomerAnalysisDto'] | CustomerFaeDraft | CustomerSupplierDraft;
export const customerAnalysisBase = '/api/v1/customer-quality/analysis';
export const customerAnalysisDenied = (cause: unknown): cause is ApiError => cause instanceof ApiError && (cause.status === 401 || cause.status === 403);

export function customerFaeDraft(record: CustomerAnalysis): CustomerFaeDraft {
  return { organizationId: record.organizationId, expectedVersion: record.version, text: record.text, completedOn: record.completedOn,
    failedPart: record.failedPart, failedMaterialCode: record.failedMaterialCode, supplierAnalysisRequired: record.supplierAnalysisRequired, fileIds: [...record.fileIds] };
}
export function customerSupplierDraft(record: CustomerAnalysis): CustomerSupplierDraft {
  return { organizationId: record.organizationId, expectedVersion: record.version, progress: record.progress, result: record.result, fileIds: [...record.fileIds] };
}

// Unknown outcomes freeze the entire private request, not just its idempotency key.
export function createCustomerAnalysisWrite(actor: SessionView, isCurrent: () => boolean) {
  let pending: { path: string; method: 'POST' | 'PUT'; body: string; key: string } | undefined;
  let uncertain = false;
  let inFlight = false;
  function current(signal: AbortSignal) {
    signal.throwIfAborted();
    if (!isCurrent()) throw new DOMException('Stale analysis scope', 'AbortError');
  }
  return {
    get uncertain() { return uncertain; },
    async run(path: string, method: 'POST' | 'PUT', body: CustomerAnalysisBody, signal: AbortSignal): Promise<CustomerAnalysis> {
      current(signal);
      if (inFlight) throw new Error('Analysis mutation already in flight');
      inFlight = true;
      const encoded = JSON.stringify(body);
      if (!pending || (!uncertain && (pending.path !== path || pending.method !== method || pending.body !== encoded))) pending = { path, method, body: encoded, key: crypto.randomUUID() };
      const attempt = pending;
      let dispatched = false;
      try {
        const session = await getSession();
        current(signal);
        if (session.userId !== actor.userId || session.organizationId !== actor.organizationId || session.accountType !== actor.accountType) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
        const token = await csrfToken(signal);
        current(signal);
        dispatched = true;
        const result = await apiRequest<CustomerAnalysis>(attempt.path, { method: attempt.method, body: attempt.body, signal,
          headers: { 'x-csrf-token': token, 'Idempotency-Key': attempt.key } }, { replayAfterReauthentication: false });
        current(signal);
        pending = undefined; uncertain = false;
        return result;
      } catch (cause) {
        if (customerAnalysisDenied(cause)) { pending = undefined; uncertain = false; }
        else if (cause instanceof ApiError && cause.status === 409) uncertain = false;
        else if (dispatched) uncertain ||= !(cause instanceof ApiError && cause.code !== 'CLIENT_REAUTHENTICATION_COMPLETED' && cause.status !== undefined && cause.status < 500 && ![408, 425].includes(cause.status));
        throw cause;
      } finally { inFlight = false; }
    },
  };
}
