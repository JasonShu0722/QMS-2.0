import type { AccountType, LoginResponse } from '@qms/contracts';
import { internalNavigation, supplierNavigation } from '../navigation/navigation';
import { legacyConsoleTarget } from '../navigation/legacy-console-route';

const uuidSource = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuid = new RegExp(`^${uuidSource}$`, 'i');
const paths = new Set([
  ...internalNavigation.map(item => item.path), ...supplierNavigation.map(item => item.path),
  '/app', '/app/workbench', '/app/admin', '/app/workflow-designer',
  '/app/supplier-quality/new', '/app/supplier-quality/profiles',
  '/console', '/console/users', '/console/organizations', '/console/configuration', '/console/workflows',
  '/console/master-data/suppliers', '/console/master-data/customers', '/console/master-data/materials', '/console/master-data/component-projects',
  '/console/audit-log', '/console/outbox', '/console/reconfiguration', '/console/problem-reconfiguration', '/console/supplier-accounts',
  '/console/api-monitoring', '/console/data-exchanges', '/console/services',
]);
const detailPath = new RegExp(`^(?:(?:/app/workflow-designer|/console/workflows)/${uuidSource}/${uuidSource}|/app/problem-workspace/${uuidSource}|(?:/app/supplier-quality/(?:problems|eight-d)|/supplier/corrections/problems)/${uuidSource})$`, 'i');
const queryRules: Record<string, RegExp> = {
  organizationId: uuid, userId: uuid, instanceId: uuid, defectId: uuid, complaintId: uuid,
  section: /^[a-z][a-z0-9-]{0,127}$/,
  resourceType: /^[A-Za-z0-9_.:-]{1,100}$/, resourceId: /^[A-Za-z0-9_.:-]{1,128}$/,
  view: /^(overview|report)$/,
};

export function readReturnTo(state: unknown, accountType?: AccountType): string | undefined {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  const key = Object.hasOwn(state, 'returnTo') ? 'returnTo' : 'from';
  const target: unknown = Object.hasOwn(state, key) ? (state as Record<string, unknown>)[key] : undefined;
  if (typeof target !== 'string' || target.length > 2048 || !target.startsWith('/') || target.startsWith('//') || target.includes('#')) return undefined;
  // Reject ambiguous encodings before parsing; only non-sensitive locator query keys survive.
  try {
    if (/[\\\u0000-\u0020\u007f]/.test(target) || /[\\\u0000-\u001f\u007f%]/.test(decodeURIComponent(target))) return undefined;
  } catch { return undefined; }
  const separator = target.indexOf('?');
  const pathname = separator < 0 ? target : target.slice(0, separator);
  const search = separator < 0 ? '' : target.slice(separator + 1);
  if (!pathname || pathname.includes('%') || !(paths.has(pathname) || detailPath.test(pathname))) return undefined;
  if ((pathname === '/app/admin' || pathname.startsWith('/app/workflow-designer'))
    && !legacyConsoleTarget({ pathname, search: search ? `?${search}` : '', hash: '' })) return undefined;
  if (accountType === 'SUPPLIER' && !pathname.startsWith('/supplier/') || accountType === 'INTERNAL' && pathname.startsWith('/supplier/')) return undefined;
  const query = new URLSearchParams(search);
  const accepted = new URLSearchParams();
  for (const [key, value] of query) {
    if (!Object.hasOwn(queryRules, key)) continue;
    if (query.getAll(key).length !== 1 || !queryRules[key]!.test(value)) return undefined;
    accepted.set(key, value);
  }
  return `${pathname}${accepted.size ? `?${accepted}` : ''}`;
}

export function authRedirect(result: Pick<LoginResponse, 'accountType' | 'landingPath'> & Partial<Pick<LoginResponse, 'securityState'>>, state: unknown): { to: string; state: { returnTo: string } | null } {
  const returnTo = result.accountType === 'INTERNAL' || result.accountType === 'SUPPLIER' ? readReturnTo(state, result.accountType) : undefined;
  const landingPath = result.securityState === 'PASSWORD_CHANGE_REQUIRED' ? '/change-password'
    : result.securityState === 'MFA_REQUIRED' || result.securityState === 'MFA_ENROLLMENT_REQUIRED' ? '/mfa' : result.landingPath;
  if (landingPath === '/mfa' || landingPath === '/change-password') return { to: landingPath, state: returnTo ? { returnTo } : null };
  return { to: returnTo ?? landingPath, state: null };
}
