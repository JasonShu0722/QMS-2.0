import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Configuration links require disposable loopback PostgreSQL, never preview 55440.');
}
const migration = new URL('../../prisma/migrations/20261028232000_administrative_configuration_links/migration.sql', import.meta.url);

describe('explicit administrative replacements preserve historical identity', () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => client.connect());
  afterAll(() => client.end());
  beforeEach(async () => {
    await client.query('BEGIN');
    if (!(await client.query("SELECT to_regclass('administrative_configuration_links') AS name")).rows[0].name) {
      const sql = await readFile(migration, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (sql) await client.query(sql);
    }
  });
  afterEach(() => client.query('ROLLBACK'));

  async function fixture() {
    const sourceOrg = randomUUID(), targetOrg = randomUUID(), actor = randomUUID();
    const sourceDepartment = randomUUID(), targetDepartment = randomUUID(), sourcePosition = randomUUID(), targetPosition = randomUUID();
    for (const id of [sourceOrg, targetOrg]) await client.query("INSERT INTO organizations(id,code,name,type,updated_at) VALUES($1::uuid,$1::text,'Scope','INTERNAL',now())", [id]);
    await client.query("INSERT INTO users(id,organization_id,username,password_hash,account_type,updated_at) VALUES($1::uuid,$2,$1::text,'unused','INTERNAL',now())", [actor, targetOrg]);
    for (const [id, org] of [[sourceDepartment, sourceOrg], [targetDepartment, targetOrg]]) {
      await client.query("INSERT INTO departments(id,organization_id,code,name,updated_at) VALUES($1::uuid,$2,$1::text,'Department',now())", [id, org]);
    }
    for (const [id, org, department] of [[sourcePosition, sourceOrg, sourceDepartment], [targetPosition, targetOrg, targetDepartment]]) {
      await client.query("INSERT INTO positions(id,organization_id,department_id,code,name,status,updated_at) VALUES($1::uuid,$2,$3,$1::text,'Position','DISABLED',now())", [id, org, department]);
    }
    await client.query("UPDATE organizations SET status='DISABLED',deleted_at=now() WHERE id=$1", [sourceOrg]);
    return { sourceOrg, targetOrg, actor, sourceDepartment, targetDepartment, sourcePosition, targetPosition };
  }

  it('provides the explicit replacement ledger without moving the original scope', async () => {
    expect((await client.query("SELECT to_regclass('administrative_configuration_links')::text AS name")).rows).toEqual([{ name: 'administrative_configuration_links' }]);
    const f = await fixture();
    for (const [kind, source, replacement] of [['DEPARTMENT', f.sourceDepartment, f.targetDepartment], ['POSITION', f.sourcePosition, f.targetPosition]]) {
      await client.query('INSERT INTO administrative_configuration_links(kind,source_id,source_orgid,replacement_id,replacement_orgid,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
        [kind, source, f.sourceOrg, replacement, f.targetOrg, f.actor]);
    }
    expect((await client.query('SELECT organization_id FROM departments WHERE id=$1', [f.sourceDepartment])).rows).toEqual([{ organization_id: f.sourceOrg }]);
    expect((await client.query('SELECT organization_id FROM positions WHERE id=$1', [f.sourcePosition])).rows).toEqual([{ organization_id: f.sourceOrg }]);
    expect((await client.query('SELECT count(*)::int AS count FROM administrative_configuration_links WHERE actor_id=$1', [f.actor])).rows[0].count).toBe(2);
  });

  it('rejects mismatched source or replacement scope and wrong entity kind', async () => {
    const f = await fixture();
    for (const [source, sourceOrg, replacement, targetOrg] of [
      [f.sourceDepartment, f.targetOrg, f.targetDepartment, f.targetOrg],
      [f.sourceDepartment, f.sourceOrg, f.targetDepartment, f.sourceOrg],
      [f.sourcePosition, f.sourceOrg, f.targetPosition, f.targetOrg],
    ]) {
      await client.query('SAVEPOINT invalid_link');
      await expect(client.query("INSERT INTO administrative_configuration_links(kind,source_id,source_orgid,replacement_id,replacement_orgid,actor_id) VALUES('DEPARTMENT',$1,$2,$3,$4,$5)",
        [source, sourceOrg, replacement, targetOrg, f.actor])).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_link');
    }
  });

  it('keeps a single immutable replacement per source', async () => {
    const f = await fixture();
    await client.query('DELETE FROM positions WHERE id IN ($1,$2)', [f.sourcePosition, f.targetPosition]);
    const sql = "INSERT INTO administrative_configuration_links(kind,source_id,source_orgid,replacement_id,replacement_orgid,actor_id) VALUES('DEPARTMENT',$1,$2,$3,$4,$5)";
    const values = [f.sourceDepartment, f.sourceOrg, f.targetDepartment, f.targetOrg, f.actor];
    await client.query(sql, values);
    await client.query('SAVEPOINT duplicate_link');
    await expect(client.query(sql, values)).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate_link');
    for (const query of ['UPDATE administrative_configuration_links SET created_at=clock_timestamp() WHERE source_id=$1', 'DELETE FROM administrative_configuration_links WHERE source_id=$1']) {
      await client.query('SAVEPOINT immutable_link');
      await expect(client.query(query, [f.sourceDepartment])).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT immutable_link');
    }
    for (const query of ['DELETE FROM departments WHERE id=$1', 'UPDATE departments SET organization_id=$2 WHERE id=$1']) {
      await client.query('SAVEPOINT referenced_identity');
      await expect(client.query(query, query.startsWith('DELETE') ? [f.targetDepartment] : [f.targetDepartment, f.sourceOrg])).rejects.toMatchObject({ code: '23001', constraint: 'acl_replacement_department_fk' });
      await client.query('ROLLBACK TO SAVEPOINT referenced_identity');
    }
  });

  it('cannot delete a mapped replacement using a snapshot predating the mapping', async () => {
    const schema = `replacement_${randomUUID().replaceAll('-', '')}`;
    const reader = new Client({ connectionString: process.env.DATABASE_URL });
    const writer = new Client({ connectionString: process.env.DATABASE_URL });
    await reader.connect();
    await writer.connect();
    try {
      await writer.query(`CREATE SCHEMA ${schema}`);
      for (const connection of [reader, writer]) await connection.query(`SET search_path TO ${schema}`);
      await writer.query(`CREATE TABLE organizations(id uuid PRIMARY KEY);
        CREATE TABLE users(id uuid PRIMARY KEY);
        CREATE TABLE departments(id uuid PRIMARY KEY,organization_id uuid NOT NULL,UNIQUE(organization_id,id));
        CREATE TABLE positions(id uuid PRIMARY KEY,organization_id uuid NOT NULL,UNIQUE(organization_id,id));`);
      await writer.query(await readFile(migration, 'utf8'));
      const org = randomUUID(), actor = randomUUID(), source = randomUUID(), replacement = randomUUID();
      await writer.query('INSERT INTO organizations VALUES($1)', [org]);
      await writer.query('INSERT INTO users VALUES($1)', [actor]);
      await writer.query('INSERT INTO positions VALUES($1,$3),($2,$3)', [source, replacement, org]);
      await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      expect((await reader.query('SELECT count(*)::int AS count FROM administrative_configuration_links')).rows[0].count).toBe(0);
      await writer.query("INSERT INTO administrative_configuration_links(kind,source_id,source_orgid,replacement_id,replacement_orgid,actor_id) VALUES('POSITION',$1,$3,$2,$3,$4)", [source, replacement, org, actor]);
      await expect(reader.query('DELETE FROM positions WHERE id=$1', [replacement])).rejects.toMatchObject({ code: '23001', constraint: 'acl_replacement_position_fk' });
    } finally {
      await reader.query('ROLLBACK');
      await writer.query('SET search_path TO public');
      await writer.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await Promise.all([reader.end(), writer.end()]);
    }
  });
});
