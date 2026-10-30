import type { Location } from 'react-router-dom';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuidPattern = new RegExp(`^${uuid}$`, 'i');
const workflowDetail = new RegExp(`^/app/workflow-designer/(${uuid})/(${uuid})$`, 'i');
const sections: Record<string, string> = {
  users: '/console/users', roles: '/console/organizations', organizations: '/console/organizations',
  configuration: '/console/configuration', 'audit-log': '/console/audit-log', failures: '/console/outbox',
  reconfiguration: '/console/reconfiguration', 'problem-reconfiguration': '/console/problem-reconfiguration',
  'supplier-accounts': '/console/supplier-accounts', 'component-project': '/console/master-data/component-projects',
  'supplier-master': '/console/master-data/suppliers', 'customer-master': '/console/master-data/customers', 'material-master': '/console/master-data/materials',
};

export function legacyConsoleTarget({ pathname, search, hash }: Pick<Location, 'pathname' | 'search' | 'hash'>): string | undefined {
  if (hash || pathname.length + search.length > 2048) return undefined;
  try {
    if (/[\u0000-\u001f\u007f]/.test(decodeURIComponent(search))) return undefined;
  } catch { return undefined; }
  const query = new URLSearchParams(search);
  if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return undefined;
  const organizationId = query.get('organizationId');
  if (organizationId !== null && !uuidPattern.test(organizationId)) return undefined;
  if (organizationId !== null) query.set('organizationId', organizationId.toLowerCase());
  const detail = workflowDetail.exec(pathname);
  if (pathname === '/app/workflow-designer' || detail) {
    if ([...query.keys()].some(key => key !== 'organizationId')) return undefined;
    const path = detail ? `/console/workflows/${detail[1]}/${detail[2]}` : '/console/workflows';
    return path + (query.size ? `?${query}` : '');
  }
  if (pathname !== '/app/admin') return undefined;
  if (!query.size) return '/console';
  const keys = ['organizationId', 'section', 'userId', 'resourceType', 'resourceId'];
  const section = query.get('section') ?? '';
  if (!organizationId || !Object.hasOwn(sections, section) || [...query.keys()].some(key => !keys.includes(key))) return undefined;
  if (query.has('userId') && (section !== 'users' || !uuidPattern.test(query.get('userId')!))) return undefined;
  if (query.has('resourceType') || query.has('resourceId')) {
    const type = query.get('resourceType') ?? ''; const id = query.get('resourceId') ?? '';
    if (section !== 'audit-log' || !type.trim() || type.length > 100 || !id.trim() || id.length > 128) return undefined;
  }
  query.delete('section');
  return `${sections[section]}?${query}`;
}
