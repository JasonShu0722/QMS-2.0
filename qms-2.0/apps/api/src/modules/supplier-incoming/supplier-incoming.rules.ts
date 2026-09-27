import { HttpException } from '@nestjs/common';

export const READ_PERMISSION = 'supplier-incoming:inspections:read';
export const WRITE_PERMISSION = 'supplier-incoming:inspections:write';

export type IncomingConclusion = 'PENDING' | 'PASS' | 'NG';
export type IncomingStatus = 'DRAFT' | 'COMPLETED' | 'CORRECTED';

export function fail(code: string, status = 400): never {
  throw new HttpException({ code, message: code }, status);
}

export function text(value: string | undefined | null, max: number, code = 'SUPPLIER_INCOMING_INPUT_INVALID'): string {
  const result = value?.trim();
  if (!result || result.length > max) fail(code);
  return result;
}

export function positive(value: number, code = 'SUPPLIER_INCOMING_INPUT_INVALID'): number {
  if (!Number.isSafeInteger(value) || value <= 0) fail(code);
  return value;
}

export function normalizeItems(items: { order: number; name: string; measuredValue?: string; result: string }[]) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) fail('SUPPLIER_INCOMING_ITEMS_INVALID');
  const orders = new Set<number>();
  return items.map((item) => {
    const order = positive(item.order);
    if (orders.has(order)) fail('SUPPLIER_INCOMING_ITEMS_INVALID');
    orders.add(order);
    if (!['PASS', 'NG', 'NA'].includes(item.result)) fail('SUPPLIER_INCOMING_ITEMS_INVALID');
    return { order, name: text(item.name, 200), measuredValue: item.measuredValue?.trim() || null, result: item.result };
  });
}

export function assertQuantities(received: number, sampled: number) {
  positive(received); positive(sampled);
  if (sampled > received) fail('SUPPLIER_INCOMING_SAMPLE_EXCEEDS_RECEIPT');
}
