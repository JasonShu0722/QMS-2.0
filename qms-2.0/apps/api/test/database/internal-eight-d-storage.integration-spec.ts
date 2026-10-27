import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Internal 8D storage requires explicitly disposable loopback PostgreSQL, never preview 55440.');
}

describe('independent internal 8D storage on PostgreSQL', () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  it.each(['customer_eight_d', 'new_product_eight_d'])('enforces %s tenant references and immutable revisions', async prefix => {
    const org = randomUUID(), user = randomUUID(), problem = randomUUID(), section = randomUUID(), revision = randomUUID();
    await db.query('BEGIN');
    try {
      await db.query("INSERT INTO organizations (id,code,name,type,updated_at) VALUES ($1::uuid,$1::text,'Storage fixture','INTERNAL',CURRENT_TIMESTAMP)", [org]);
      await db.query("INSERT INTO users (id,organization_id,username,password_hash,account_type,updated_at) VALUES ($1::uuid,$2,$1::text,'unused','INTERNAL',CURRENT_TIMESTAMP)", [user, org]);
      await db.query("INSERT INTO departments (id,organization_id,code,name,updated_at) VALUES ($1::uuid,$2,$1::text,'Section',CURRENT_TIMESTAMP)", [section, org]);
      await db.query(`INSERT INTO problem_indexes (id,organization_id,report_number,domain_code,problem_type,source_type,severity,created_by_id,updated_at)
        VALUES ($1::uuid,$2,$1::text,$3,$4,$6,'LOW',$5,CURRENT_TIMESTAMP)`, [problem, org, prefix === 'customer_eight_d' ? 'customer-quality' : 'new-product-quality', prefix === 'customer_eight_d' ? 'CUSTOMER_COMPLAINT' : 'NEW_PRODUCT_ISSUE', user, prefix === 'customer_eight_d' ? 'customer-complaint' : 'new-product-defect-selection']);
      await db.query(`INSERT INTO ${prefix}_reports (problem_id,organization_id,responsible_section_department_id,professional_user_id,document,created_by,updated_by)
        VALUES ($1,$2,$3,$4,'{}',$4,$4)`, [problem, org, section, user]);
      await db.query(`INSERT INTO ${prefix}_revisions (id,organization_id,problem_id,content_version,snapshot) VALUES ($1,$2,$3,1,'{}')`, [revision, org, problem]);
      await db.query(`UPDATE ${prefix}_reports SET closed_revision_id=$1 WHERE problem_id=$2`, [revision, problem]);
      for (const statement of [`UPDATE ${prefix}_revisions SET snapshot='{"changed":true}' WHERE id=$1`, `DELETE FROM ${prefix}_revisions WHERE id=$1`]) {
        await db.query('SAVEPOINT immutable');
        await expect(db.query(statement, [revision])).rejects.toMatchObject({ code: '23514' });
        await db.query('ROLLBACK TO SAVEPOINT immutable');
      }
      await db.query('SAVEPOINT tenant');
      await expect(db.query(`INSERT INTO ${prefix}_receipts (organization_id,actor_user_id,key,digest,response) VALUES ($1,$2,'foreign',$3,'{}')`, [randomUUID(), user, 'a'.repeat(64)])).rejects.toMatchObject({ code: '23503' });
      await db.query('ROLLBACK TO SAVEPOINT tenant');
      const triggers = await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal`, [`${prefix}_source_confirmations`]);
      expect(triggers.rows).toContainEqual({ tgname: `${prefix}_confirmation_immutable` });
      expect((await db.query(`SELECT * FROM ${prefix}_bindings WHERE organization_id=$1`, [org])).rows).toEqual([]);
      expect((await db.query('SELECT * FROM user_roles WHERE user_id=$1', [user])).rows).toEqual([]);
      const other = prefix === 'customer_eight_d' ? 'new_product_eight_d' : 'customer_eight_d';
      expect((await db.query(`SELECT * FROM ${other}_reports WHERE problem_id=$1`, [problem])).rows).toEqual([]);
    } finally { await db.query('ROLLBACK'); }
  });
});
