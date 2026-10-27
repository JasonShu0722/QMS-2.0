import { HttpException } from '@nestjs/common';
import { parseComplaintDate } from './customer-complaint-derived.js';

export const LEDGER_PERMISSIONS = {
  read: 'customer-quality:complaints:read', write: 'customer-quality:complaints:write',
  close: 'customer-quality:complaints:close', closedEdit: 'customer-quality:complaints:closed-edit',
  reassign: 'customer-quality:complaints:reassign',
  project: 'new-product-quality:projects:write',
} as const;
export type LedgerOperation = 'read' | 'update' | 'analysis' | 'receiving' | 'close' | 'reopen' | 'closed-edit';
export type LedgerStatus = 'FOLLOWING' | 'CLOSED';
export type LedgerStage = 'NEW_PRODUCT' | 'MASS_PRODUCTION';
export const COMPLAINT_TEXT_LIMITS = {
  customerName: 200, terminalCustomerName: 200, componentCode: 100, productModel: 100,
  defectDescription: 10000, vin: 100, barcode: 200, batch: 200, occurredAtLocation: 200,
  occurredAtRegion: 200, investigation: 10000,
} as const;
export const COMPLAINT_DATE_FIELDS = ['occurredOn', 'productionOn', 'purchaseOn', 'vehicleDeliveryOn', 'vehicleOfflineOn', 'onlineOn'] as const;
export const COMPLAINT_OPTIONS = {
  complaintType: ['ZERO_KM', 'AFTER_SALES'],
  serviceMode: ['远程指导', '现场现调', '未接到通知'],
  interceptionStatus: ['是，已发备件', '否，索赔件', '否，不索赔'],
} as const;
export type ComplaintField = keyof typeof COMPLAINT_TEXT_LIMITS | typeof COMPLAINT_DATE_FIELDS[number] | keyof typeof COMPLAINT_OPTIONS | 'quantity' | 'mileage';
export type ComplaintFields = Partial<Record<ComplaintField, unknown>>;
export type ComplaintNormalized = Record<ComplaintField, string | number | null>;
export type ComplaintWarning = { field: string; code: string };
export const COMPLAINT_FIELDS: readonly string[] = [...Object.keys(COMPLAINT_TEXT_LIMITS), ...COMPLAINT_DATE_FIELDS, ...Object.keys(COMPLAINT_OPTIONS), 'quantity', 'mileage'];
export const RAW_ROW_MAX_BYTES = 64000;

export function ledgerFail(code: string, status = 400): never { throw new HttpException({ code, message: code }, status); }

// Raw spreadsheet cells are bounded JSON, not arbitrary objects or executable values.
export function boundedComplaintRaw(value: unknown): value is ComplaintFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some(key => !COMPLAINT_FIELDS.includes(key))) return false;
  let nodes = 0;
  const safe = (item: unknown, depth: number): boolean => {
    if (++nodes > 500 || depth > 4) return false;
    if (item == null || typeof item === 'boolean') return true;
    if (typeof item === 'string') return item.length <= 20000 && !item.includes('\u0000');
    if (typeof item === 'number') return Number.isFinite(item);
    if (Array.isArray(item)) return item.length <= 100 && item.every(child => safe(child, depth + 1));
    if (typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype) return false;
    return Object.entries(item).every(([key, child]) => key.length <= 100 && !['__proto__', 'prototype', 'constructor'].includes(key) && safe(child, depth + 1));
  };
  return Object.values(value).every(item => safe(item, 0)) && Buffer.byteLength(JSON.stringify(value), 'utf8') <= RAW_ROW_MAX_BYTES;
}

export function normalizeComplaintFields(input: ComplaintFields) {
  if (!boundedComplaintRaw(input)) ledgerFail('CUSTOMER_LEDGER_RAW_INVALID');
  const raw = JSON.parse(JSON.stringify(input)) as ComplaintFields;
  const normalized = {} as ComplaintNormalized;
  const warnings: ComplaintWarning[] = [];
  for (const field of COMPLAINT_FIELDS as ComplaintField[]) {
    const value = raw[field]; let result: string | number | null = null;
    const empty = value == null || (typeof value === 'string' && value.trim() === '');
    if (!empty) {
      if (field in COMPLAINT_TEXT_LIMITS) {
        const limit = COMPLAINT_TEXT_LIMITS[field as keyof typeof COMPLAINT_TEXT_LIMITS];
        if (typeof value === 'string' && value.trim().length <= limit) result = value.trim();
      } else if ((COMPLAINT_DATE_FIELDS as readonly string[]).includes(field)) result = parseComplaintDate(value);
      else if (field in COMPLAINT_OPTIONS) {
        if (typeof value === 'string') {
          const option = field === 'complaintType' && value.trim() === '零公里' ? 'ZERO_KM'
            : field === 'complaintType' && value.trim() === '售后' ? 'AFTER_SALES' : value.trim();
          if ((COMPLAINT_OPTIONS[field as keyof typeof COMPLAINT_OPTIONS] as readonly string[]).includes(option)) result = option;
        }
      } else {
        const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
        if (Number.isSafeInteger(number) && number >= (field === 'quantity' ? 1 : 0) && number <= 2147483647) result = number;
      }
      if (result === null) warnings.push({ field, code: 'INVALID_VALUE' });
    }
    normalized[field] = result;
  }
  if (normalized.productionOn && normalized.occurredOn && normalized.occurredOn < normalized.productionOn) warnings.push({ field: 'occurredOn', code: 'BEFORE_PRODUCTION' });
  if (!normalized.quantity) warnings.push({ field: 'quantity', code: 'QUANTITY_NOT_RECORDED' });
  if (!normalized.customerName) warnings.push({ field: 'customerName', code: 'CUSTOMER_NOT_RECORDED' });
  // A multi-piece row never claims a single vehicle's derived metrics for the whole lot.
  if (normalized.quantity !== 1 && (normalized.mileage !== null || normalized.productionOn || normalized.occurredOn)) warnings.push({ field: 'quantity', code: 'AGGREGATE_DERIVATION_NOT_APPLICABLE' });
  return { raw, normalized, warnings };
}

export function mergeComplaintSupplement(base: ComplaintFields, patch: ComplaintFields): ComplaintFields {
  if (!boundedComplaintRaw(patch)) ledgerFail('CUSTOMER_LEDGER_RAW_INVALID');
  const entries = Object.entries(patch).filter(([, value]) => value != null && !(typeof value === 'string' && !value.trim()));
  return { ...base, ...Object.fromEntries(entries) };
}

export function ledgerDisplayStatus(current: unknown, legacy: string): LedgerStatus {
  return current === 'FOLLOWING' || current === 'CLOSED' ? current : ['CLOSED', 'ARCHIVED'].includes(legacy) ? 'CLOSED' : 'FOLLOWING';
}

// Public locked source projection; consumers must not reinterpret client IDs as granted access.
export interface CustomerLedgerCase {
  id: string; organizationId: string; version: number; status: LedgerStatus; legacyStatus: string;
  registeredByUserId: string; qualityEngineerId: string | null; qualityEngineerAssignmentId: string | null;
  qualityEngineerSource: 'MANUAL' | 'MAPPING' | null; stage: LedgerStage | null;
}
