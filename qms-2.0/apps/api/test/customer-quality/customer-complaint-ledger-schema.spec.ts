import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('extends the sole customer fact table without backfilling invented history or another ledger', () => {
  const migration = readFileSync(resolve('prisma/migrations/20261026230000_customer_complaint_ledger/migration.sql'), 'utf8');
  const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8').split('model CustomerQualityComplaint {')[1]!.split('\n}')[0]!;
  expect(migration).not.toMatch(/CREATE TABLE|UPDATE customer_quality_complaints|DEFAULT '(?:FOLLOWING|CLOSED|LOW)'/i);
  expect(migration).toContain('ALTER COLUMN customer_id DROP NOT NULL');
  expect(schema).toMatch(/customerId\s+String\?/);
  expect(schema).toMatch(/severity\s+String\?/);
  expect(schema).toMatch(/ledgerStatus\s+String\?/);
});
