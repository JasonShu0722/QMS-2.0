import { expect, it } from 'vitest';
import { prepareImportBatches } from './import-batches';

it.each([101, 250, 1000])('preserves every original row across %i rows without a total batch cap', (count) => {
  const rows = Array.from({ length: count }, (_, i) => ({ rowNumber: i + 3, code: `00${i}`, name: '名称' }));
  const batches = prepareImportBatches(rows);
  expect(batches.map((batch) => batch.count)).toEqual(Array.from({ length: Math.ceil(count / 100) }, (_, i) => Math.min(100, count - i * 100)));
  expect(batches.flatMap((batch) => JSON.parse(batch.body).rows)).toEqual(rows);
});

it('preflights all rows and splits by both complete JSON UTF8 bytes and row count', () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ rowNumber: i + 2, code: `00${i}`, name: '中'.repeat(500) }));
  const batches = prepareImportBatches(rows, 'org-中文');
  const bodies = batches.map((batch) => JSON.parse(batch.body));
  expect(bodies.flatMap((body) => body.rows)).toEqual(rows);
  expect(bodies.every((body) => body.organizationId === 'org-中文' && body.rows.length <= 100)).toBe(true);
  expect(batches.every((batch) => new TextEncoder().encode(batch.body).length <= 96 * 1024)).toBe(true);
  expect(new Set(batches.map((batch) => batch.key)).size).toBe(batches.length);
});

it('accepts exactly the complete byte budget and identifies an oversized single Excel row', () => {
  const row = { rowNumber: 88, code: '0001', name: '' };
  const padding = 96 * 1024 - new TextEncoder().encode(JSON.stringify({ organizationId: 'org', rows: [row] })).length;
  const exact = { ...row, name: 'x'.repeat(padding) };
  expect(new TextEncoder().encode(prepareImportBatches([exact], 'org')[0]!.body).length).toBe(96 * 1024);
  expect(() => prepareImportBatches([{ ...row, name: 'valid' }, { ...exact, name: exact.name + 'x' }], 'org')).toThrow('88');
});
