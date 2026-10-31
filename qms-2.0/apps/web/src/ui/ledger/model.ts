export type Fixed = 'left' | 'right' | false;
export type Preferences = { order: string[]; visible: string[]; widths: Record<string, number>; fixed: Record<string, Fixed> };
export type Scope = { sessionScope?: string; organizationId?: string; portal?: 'business' | 'supplier' | 'console' };
export const MIN_WIDTH = 64;
export const MAX_WIDTH = 800;
export const DEFAULT_WIDTH = 180;
const validKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export function columnKey(column: { key?: unknown; dataIndex?: unknown; title?: unknown }): string | undefined {
  if (typeof column.key === 'number' && Number.isFinite(column.key)) return String(column.key);
  if (validKey(column.key)) return column.key;
  if (validKey(column.dataIndex)) return column.dataIndex;
  if (Array.isArray(column.dataIndex) && column.dataIndex.length && column.dataIndex.every(part => validKey(part) || typeof part === 'number' && Number.isFinite(part))) {
    const key = `data:${JSON.stringify(column.dataIndex)}`;
    return validKey(key) ? key : undefined;
  }
  return undefined;
}
export function preferenceKey(scope: Scope, ledgerId: string, kind: 'columns' | 'pageSize', viewId = 'default'): string | undefined {
  const session = scope.sessionScope?.split(':');
  if (!session || session.length !== 3 || !['INTERNAL', 'SUPPLIER'].includes(session[0]) || !session.every(validKey) || !validKey(ledgerId) || !validKey(viewId)) return undefined;
  const organization = scope.organizationId ?? session[1];
  if (!validKey(organization)) return undefined;
  return `qms:ledger:v1:${JSON.stringify([scope.sessionScope, organization, scope.portal ?? (session[0] === 'SUPPLIER' ? 'supplier' : 'business'), ledgerId, kind, ...(kind === 'columns' ? [viewId] : [])])}`;
}
export function boundedWidth(value: unknown, fallback = DEFAULT_WIDTH, minimum = MIN_WIDTH) {
  const width = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(MAX_WIDTH, Math.round(width)));
}
const objectValue = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
export function normalizePreferences(input: unknown, keys: string[]): Preferences {
  const allowed = [...new Set(keys.filter(validKey))].slice(0, 200);
  const value = objectValue(input);
  const list = (candidate: unknown) => Array.isArray(candidate) ? [...new Set(candidate.slice(0, 200).filter((key): key is string => typeof key === 'string' && allowed.includes(key)))] : [];
  const priorOrder = list(value.order);
  const order = [...priorOrder, ...allowed.filter(key => !priorOrder.includes(key))];
  const visible = Array.isArray(value.visible) ? [...list(value.visible), ...allowed.filter(key => !priorOrder.includes(key) && !list(value.visible).includes(key))] : allowed;
  const widths = objectValue(value.widths);
  const fixed = objectValue(value.fixed);
  return {
    order, visible,
    widths: Object.fromEntries(allowed.filter(key => typeof widths[key] === 'number' && Number.isFinite(widths[key])).map(key => [key, boundedWidth(widths[key])])),
    fixed: Object.fromEntries(allowed.filter(key => ['left', 'right', false].includes(fixed[key] as Fixed)).map(key => [key, fixed[key] as Fixed])),
  };
}
export function moveColumn(order: string[], source: string, target: string, fixed: Record<string, Fixed>, locked: string[]) {
  const sourceIndex = order.indexOf(source);
  const targetIndex = order.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex || (fixed[source] || false) !== (fixed[target] || false) || order.slice(Math.min(sourceIndex, targetIndex), Math.max(sourceIndex, targetIndex) + 1).some(key => locked.includes(key) || (fixed[key] || false) !== (fixed[source] || false))) return order;
  const next = [...order]; next.splice(sourceIndex, 1); next.splice(targetIndex, 0, source);
  return next;
}
export function normalizePageSize(input: unknown, maxPageSize = 100) {
  const limit = Number.isFinite(maxPageSize) ? Math.max(10, maxPageSize) : 100;
  const options = [10, 20, 50, 100].filter(size => size <= limit);
  return typeof input === 'number' && options.includes(input) ? input : options.includes(20) ? 20 : options[0];
}
