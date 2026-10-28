import { PrismaService } from '../../src/database/prisma.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Supplier 8D storage requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('supplier complete 8D storage', () => {
  const db = new PrismaService();
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => { await db.$disconnect(); });

  it('has subordinate controls and immutable origins without a second supplier problem ledger', async () => {
    await expect(db.$queryRaw`SELECT supplier_problem_id, organization_id, problem_index_id,
      sqe_user_id, sqe_assignment_id, responsible_section_department_id, row_version,
      analysis_due_at, analysis_completed_at, submission_due_at, closure_due_at,
      submitted_revision_id, approved_revision_id, closed_at FROM supplier_eight_d_controls LIMIT 0`).resolves.toEqual([]);
    await expect(db.$queryRaw`SELECT revision_id, supplier_problem_id, organization_id,
      submitted_by, submitted_organization_id, snapshot FROM supplier_eight_d_submission_origins LIMIT 0`).resolves.toEqual([]);
    const [parallel] = await db.$queryRaw<{ present: string | null }[]>`SELECT to_regclass('supplier_eight_d_problems')::text AS present`;
    expect(parallel.present).toBeNull();
  });
});
