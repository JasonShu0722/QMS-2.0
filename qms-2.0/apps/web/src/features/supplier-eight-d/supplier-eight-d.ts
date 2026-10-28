import type { components } from '@qms/contracts';

export type SupplierReport = components['schemas']['SupplierEightDReportDto'];
export type SupplierWriteBody = components['schemas']['SaveSupplierEightDDto']
  | components['schemas']['SupplierEightDVersionDto'] | components['schemas']['SupplierEightDAnalysisCompleteDto']
  | components['schemas']['SupplierEightDDeadlinesDto'] | components['schemas']['SupplierDisclosurePreviewDto']
  | components['schemas']['SupplierDisclosureReleaseDto'] | components['schemas']['SupplierEightDDeadlineRequestDto']
  | components['schemas']['SupplierEightDDeadlineDecisionDto'] | components['schemas']['SupplierEightDDeadlineCancelDto'];
export type SupplierCommand = (path: string, method: 'POST' | 'PUT', body: SupplierWriteBody,
  options?: { receive?: (result: unknown) => void; keepOpen?: boolean; refresh?: boolean }) => Promise<boolean>;
export const supplierEightDPath = (id: string, portal: boolean) => `/api/v1/${portal ? 'supplier-portal' : 'supplier-quality'}/eight-d/${encodeURIComponent(id)}`;
