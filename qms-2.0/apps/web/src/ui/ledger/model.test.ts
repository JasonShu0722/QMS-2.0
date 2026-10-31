import { describe, expect, it } from 'vitest';
import { columnKey, normalizePreferences, preferenceKey, normalizePageSize, moveColumn } from './model';

describe('ledger preference model', () => {
  it('uses stable keys and never titles or array positions', () => {
    expect(columnKey({ title: '名称' })).toBeUndefined();
    expect(columnKey({ dataIndex: ['supplier', 'name'] })).toBe('data:["supplier","name"]');
    expect(columnKey({ key: 'name', dataIndex: 'other' })).toBe('name');
  });
  it('isolates identity, actual target, portal, ledger and view without ambiguous delimiters', () => {
    const scope = { sessionScope: 'INTERNAL:home:user', organizationId: 'target', portal: 'console' as const };
    expect(preferenceKey(scope, 'main', 'columns', 'view')).not.toBe(preferenceKey({ ...scope, organizationId: 'other' }, 'main', 'columns', 'view'));
    expect(preferenceKey(scope, 'main', 'columns', 'view')).not.toBe(preferenceKey(scope, 'main', 'pageSize'));
    expect(preferenceKey({ ...scope, sessionScope: undefined }, 'main', 'columns')).toBeUndefined();
    expect(preferenceKey({ ...scope, sessionScope: 'bad' }, 'main', 'columns')).toBeUndefined();
  });
  it('whitelists permitted columns and bounds malformed values while new columns retain defaults', () => {
    expect(normalizePreferences({ order: ['secret', 'b', 'b', 'a'], visible: ['secret', 'b'], widths: { b: Infinity, a: 9000, secret: 400 }, fixed: { a: 'left', b: 'evil' }, body: 'sensitive' }, ['a', 'b', 'new'])).toEqual({
      order: ['b', 'a', 'new'], visible: ['b', 'new'], widths: { a: 800 }, fixed: { a: 'left' },
    });
    expect(normalizePreferences('broken', ['a']).visible).toEqual(['a']);
  });
  it('moves only within the same fixed region and does not cross locked columns', () => {
    expect(moveColumn(['a', 'b', 'c'], 'a', 'c', {}, [])).toEqual(['b', 'c', 'a']);
    expect(moveColumn(['a', 'b'], 'a', 'b', { a: 'left' }, [])).toEqual(['a', 'b']);
    expect(moveColumn(['a', 'b', 'c'], 'a', 'c', {}, ['b'])).toEqual(['a', 'b', 'c']);
  });
  it('accepts only legal bounded page sizes', () => {
    expect(normalizePageSize(undefined)).toBe(20);
    expect(normalizePageSize(50, 30)).toBe(20);
    expect(normalizePageSize(100, 10)).toBe(10);
    expect(normalizePageSize(200)).toBe(20);
    expect(normalizePageSize(NaN)).toBe(20);
  });
});
