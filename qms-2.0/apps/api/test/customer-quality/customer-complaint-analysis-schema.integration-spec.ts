import { PrismaService } from '../../src/database/prisma.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

const url = process.env.DATABASE_URL;
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(url)) throw new Error('Customer analysis requires an explicitly disposable loopback PostgreSQL database');

describe('SQL-owned customer analysis schema on real PostgreSQL', () => {
  const prisma = new PrismaService(url);
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  it('has a unique stable section resource, tenant FKs, and immutable version snapshots', async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('customer_complaint_analyses', 'customer_complaint_analysis_history')`;
    expect(tables).toHaveLength(2);
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('customer_complaint_analyses', 'customer_complaint_analysis_history')`;
    expect(indexes.some(row => row.indexdef.includes('UNIQUE') && row.indexdef.includes('(organization_id, complaint_id, section)'))).toBe(true);
    expect(indexes.some(row => row.indexdef.includes('UNIQUE') && row.indexdef.includes('(analysis_id, version)'))).toBe(true);
    const triggers = await prisma.$queryRaw<{ action_statement: string }[]>`SELECT action_statement FROM information_schema.triggers WHERE event_object_table = 'customer_complaint_analysis_history' AND event_manipulation IN ('UPDATE', 'DELETE')`;
    expect(triggers).toHaveLength(2);
    const foreignKeys = await prisma.$queryRaw<{ definition: string }[]>`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'customer_complaint_analyses'::regclass AND contype = 'f'`;
    expect(foreignKeys.some(row => row.definition.includes('FOREIGN KEY (organization_id, complaint_id)'))).toBe(true);
    expect(foreignKeys.some(row => row.definition.includes('FOREIGN KEY (organization_id, assignee_user_id)'))).toBe(true);
  });
});
