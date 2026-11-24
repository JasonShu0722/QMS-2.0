import { describe, expect, it } from 'vitest';
import { authRedirect, readReturnTo } from './return-to';

it('preserves exactly one safe graph locator only on the internal workbench', () => {
  const target = '/app/workbench?graphRelation=api-ingestion-to-operation-master';
  expect(readReturnTo({ returnTo: target }, 'INTERNAL')).toBe(target);
  expect(readReturnTo({ returnTo: target }, 'SUPPLIER')).toBeUndefined();
  expect(readReturnTo({ returnTo: '/app/workbench?graphNode=workbench&graphRelation=ambiguous' })).toBeUndefined();
  expect(readReturnTo({ returnTo: '/app/workbench?graphNode=%2Fconsole' })).toBeUndefined();
  expect(readReturnTo({ returnTo: '/app/account?graphNode=workbench' })).toBe('/app/account');
});

it.each(['graphNode', 'graphRelation'])('accepts only graph IDs of up to 128 characters for %s', (key) => {
  const valid = `/app/workbench?${key}=${'a'.repeat(128)}`;
  expect(readReturnTo({ returnTo: valid }, 'INTERNAL')).toBe(valid);
  expect(readReturnTo({ returnTo: `${valid}a` }, 'INTERNAL')).toBeUndefined();
});

const id = '2c7b3607-1d6d-4304-9a72-f595c8467d88';
const audit = `/console/audit-log?organizationId=${id}&section=audit-log&resourceType=USER&resourceId=${id}`;
const internal = { accountType: 'INTERNAL', landingPath: '/app/workbench', securityState: 'AUTHENTICATED' } as const;

it.each(['/app/workflow-designer', `/app/workflow-designer/${id}/${id}`, `/console/workflows/${id}/${id}`])('drops the retired workflow target %s', returnTo => {
  expect(readReturnTo({ returnTo }, 'INTERNAL')).toBeUndefined();
});

describe('controlled authentication return target', () => {
  it.each([
    '/console', '/console/users', '/console/organizations', '/console/configuration', '/console/workflows', '/console/eight-d-bindings',
    '/console/master-data/suppliers', '/console/master-data/customers', '/console/master-data/materials', '/console/master-data/component-projects',
    '/console/audit-log', '/console/outbox', '/console/reconfiguration', '/console/problem-reconfiguration', '/console/supplier-accounts',
    '/console/api-monitoring', '/console/data-exchanges', '/console/services',
    `/app/problem-workspace/${id}`,
    '/app', '/app/admin', '/app/workbench', '/app/customer-quality/problems', '/supplier/inbox', '/supplier/account',
    '/app/supplier-quality/new', '/app/supplier-quality/profiles', `/app/supplier-quality/problems/${id}`, `/supplier/corrections/problems/${id}`,
    `/app/supplier-quality/eight-d/${id}`,
  ])('accepts only a known application target: %s', target => {
    expect(readReturnTo({ returnTo: target })).toBe(target);
  });

  it('preserves audit and user query locators and strips unknown or sensitive fields', () => {
    expect(readReturnTo({ from: `${audit}&token=secret&password=private&secret=private&body=private&redirect=https://evil.test` })).toBe(audit);
    const user = `/app/admin?organizationId=${id}&section=users&userId=${id}`;
    expect(readReturnTo({ returnTo: user })).toBe(user);
    expect(readReturnTo({ returnTo: `/app/problem-workspace/${id}?organizationId=${id}&instanceId=${id}&view=report` })).toBe(`/app/problem-workspace/${id}?organizationId=${id}&instanceId=${id}&view=report`);
    expect(readReturnTo({ returnTo: `/app/process-quality?organizationId=${id}&defectId=${id}` })).toBe(`/app/process-quality?organizationId=${id}&defectId=${id}`);
    expect(readReturnTo({ returnTo: `/app/customer-quality?organizationId=${id}&complaintId=${id}` })).toBe(`/app/customer-quality?organizationId=${id}&complaintId=${id}`);
  });

  it.each([
    'https://evil.test/console', 'http://localhost/console', '//evil.test/console', '/\\evil.test/console', 'javascript:alert(1)',
    '/console/../users', '/console/users#token=secret', '/console/users\n', '/console/users?section=users%0A', '/console/users?section=%5cfoo',
    '/%63onsole/users', '/console/%2fusers', '/console/users?section=%252f%252fevil.test', '/console/users?section=%E0%A4%A',
    '/console/users?section=%', '/console/users?section=users&section=audit-log', '/console/users?organizationId=not-a-uuid',
    '/console/users?section=users?token=secret',
    '/console/users?userId=not-a-uuid', '/console/users?instanceId=not-a-uuid', '/console/users?view=private-body',
    '/console/not-registered', '/console/users/unknown', '/console-evil/users', '/app/not-registered', '/supplier/not-registered',
    '/login', '/mfa', '/change-password', '/password-recovery', '/reset-password',
    `/console/workflows/${id}/invalid`, `/app/workflow-designer/${id}/invalid`, '/console/users?section=' + 's'.repeat(129),
    '/app/supplier-quality/eight-d', '/app/supplier-quality/eight-d/not-a-uuid', `/app/supplier-quality/eight-d/${id}/extra`, `/supplier/corrections/eight-d/${id}`,
  ])('rejects an unsafe or unknown target: %s', returnTo => {
    expect(readReturnTo({ returnTo })).toBeUndefined();
  });

  it.each([undefined, null, 7, [], '/console/users', { returnTo: 7 }, { returnTo: {} }, { returnTo: null }, { from: {} }, { returnTo: '//evil.test', from: '/console/users' }])('rejects malformed router state without a fallback bypass: %j', state => {
    expect(readReturnTo(state)).toBeUndefined();
  });

  it('bounds target length and ignores inherited router-state targets', () => {
    expect(readReturnTo({ returnTo: '/console/users?unknown=' + 'x'.repeat(2048) })).toBeUndefined();
    expect(readReturnTo(Object.create({ returnTo: '/console/users' }))).toBeUndefined();
  });

  it('enforces the account portal without replacing final route authorization', () => {
    expect(readReturnTo({ returnTo: '/console/users' }, 'SUPPLIER')).toBeUndefined();
    expect(readReturnTo({ returnTo: '/app/admin' }, 'SUPPLIER')).toBeUndefined();
    expect(readReturnTo({ returnTo: `/app/supplier-quality/eight-d/${id}` }, 'SUPPLIER')).toBeUndefined();
    expect(readReturnTo({ returnTo: '/supplier/inbox' }, 'INTERNAL')).toBeUndefined();
    expect(authRedirect({ ...internal, accountType: 'SUPPLIER', landingPath: '/supplier/inbox' }, { returnTo: audit })).toEqual({ to: '/supplier/inbox', state: null });
    expect(authRedirect(internal, { returnTo: '/supplier/account' })).toEqual({ to: '/app/workbench', state: null });
    expect(authRedirect(internal, { returnTo: audit })).toEqual({ to: audit, state: null });
  });

  it.each(['MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'] as const)('retains the target but never bypasses %s', securityState => {
    const landingPath = securityState === 'PASSWORD_CHANGE_REQUIRED' ? '/change-password' : '/mfa';
    expect(authRedirect({ ...internal, landingPath, securityState }, { from: audit })).toEqual({ to: landingPath, state: { returnTo: audit } });
    expect(authRedirect({ ...internal, securityState }, { returnTo: audit })).toEqual({ to: landingPath, state: { returnTo: audit } });
  });

  it('does not bypass a server challenge landing even if securityState is absent', () => {
    expect(authRedirect({ accountType: 'INTERNAL', landingPath: '/mfa' }, { returnTo: audit })).toEqual({ to: '/mfa', state: { returnTo: audit } });
    expect(authRedirect(internal, { returnTo: '//evil.test' })).toEqual({ to: '/app/workbench', state: null });
  });
});
