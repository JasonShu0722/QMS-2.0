import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Administrative lifecycle requires real disposable loopback PostgreSQL, never preview 55440.');
}
const migration = new URL('../../prisma/migrations/20261028230000_administrative_lifecycle/migration.sql', import.meta.url);
const identityGuardMigration = new URL('../../prisma/migrations/20261028231000_administrative_identity_history/migration.sql', import.meta.url);
const referenceContractMigration = new URL('../../prisma/migrations/20261029010000_administrative_reference_error_contract/migration.sql', import.meta.url);

describe('administrative deleted identities preserve historical relations', () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let grantsBeforeMigration: { role_id: string; permission_id: string }[];
  beforeAll(() => client.connect());
  afterAll(() => client.end());
  beforeEach(async () => {
    await client.query('BEGIN');
    grantsBeforeMigration = (await client.query('SELECT role_id,permission_id FROM role_permissions ORDER BY role_id,permission_id')).rows;
    const applied = await client.query("SELECT to_regclass('administrative_deletions') AS name");
    const source = await readFile(migration, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (source && !applied.rows[0].name) await client.query(source);
    const guards = await readFile(identityGuardMigration, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const history = await client.query("SELECT to_regclass('user_organization_history') AS name");
    if (guards && !history.rows[0].name) await client.query(guards);
    await client.query(await readFile(referenceContractMigration, 'utf8'));
  });
  afterEach(async () => { await client.query('ROLLBACK'); });

  it('records deleted and pending-configuration facts for all four existing identity tables', async () => {
    const rows = await client.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('organizations','departments','positions','users')
      AND column_name IN ('deleted_at','configuration_required') ORDER BY table_name,column_name`);
    expect(rows.rows).toEqual(['departments', 'organizations', 'positions', 'users'].flatMap(table_name =>
      ['configuration_required', 'deleted_at'].map(column_name => ({ table_name, column_name }))));
    expect((await client.query("SELECT to_regclass('administrative_deletions')::text AS name")).rows).toEqual([{ name: 'administrative_deletions' }]);
  });

  it('does not change existing history or grant deletion permissions to an existing role', async () => {
    const roles = await client.query('SELECT role_id,permission_id FROM role_permissions ORDER BY role_id,permission_id');
    expect(roles.rows.some(row => !row.role_id || !row.permission_id)).toBe(false);
    expect(roles.rows).toEqual(grantsBeforeMigration);
    const sql = await readFile(migration, 'utf8');
    expect(sql).toMatch(/INSERT INTO permissions\s*\(/);
    expect(sql).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(?:role_permissions|user_roles|position_roles)\b/i);
  });

  it('keeps user and organization historical UUIDs while refusing activation or physical removal of deleted identities', async () => {
    const organization = randomUUID(), user = randomUUID(), department = randomUUID(), position = randomUUID();
    await client.query(`INSERT INTO organizations (id,code,name,type,updated_at) VALUES ($1,$2,'Original organization','INTERNAL',now())`, [organization, randomUUID()]);
    await client.query(`INSERT INTO users (id,organization_id,username,password_hash,account_type,updated_at) VALUES ($1,$2,$3,'unused','INTERNAL',now())`, [user, organization, randomUUID()]);
    await client.query(`INSERT INTO departments (id,organization_id,code,name,updated_at) VALUES ($1,$2,$3,'Original department',now())`, [department, organization, randomUUID()]);
    await client.query(`INSERT INTO positions (id,organization_id,department_id,code,name,updated_at) VALUES ($1,$2,$3,$4,'Original position',now())`, [position, organization, department, randomUUID()]);
    for (const [table, id] of [['positions', position], ['departments', department], ['users', user], ['organizations', organization]]) {
      await client.query(`UPDATE ${table} SET deleted_at=now(), status='DISABLED' WHERE id=$1`, [id]);
      await client.query('SAVEPOINT activation');
      await expect(client.query(`UPDATE ${table} SET status='ACTIVE' WHERE id=$1`, [id])).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT activation');
      await client.query('SAVEPOINT resurrection');
      await expect(client.query(`UPDATE ${table} SET deleted_at=NULL WHERE id=$1`, [id])).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT resurrection');
      await client.query('SAVEPOINT removal');
      await expect(client.query(`DELETE FROM ${table} WHERE id=$1`, [id])).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT removal');
    }
    expect((await client.query('SELECT organization_id FROM users WHERE id=$1', [user])).rows).toEqual([{ organization_id: organization }]);
    expect((await client.query('SELECT department_id FROM positions WHERE id=$1', [position])).rows).toEqual([{ department_id: department }]);
  });

  it('prevents pending configuration from being activated until it is explicitly completed', async () => {
    const organization = randomUUID();
    await client.query(`INSERT INTO organizations (id,code,name,type,status,configuration_required,updated_at)
      VALUES ($1,$2,'Pending configuration','INTERNAL','DISABLED',true,now())`, [organization, randomUUID()]);
    await client.query('SAVEPOINT configuration');
    await expect(client.query("UPDATE organizations SET status='ACTIVE' WHERE id=$1", [organization])).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO SAVEPOINT configuration');
    await client.query("UPDATE organizations SET configuration_required=false,status='ACTIVE' WHERE id=$1", [organization]);
    expect((await client.query('SELECT status FROM organizations WHERE id=$1', [organization])).rows).toEqual([{ status: 'ACTIVE' }]);
  });

  it('does not allow a deleted historical identity to change UUID, tenant or identity type', async () => {
    const organization = randomUUID(), other = randomUUID(), user = randomUUID();
    await client.query(`INSERT INTO organizations (id,code,name,type,status,deleted_at,updated_at)
      VALUES ($1,$2,'Historical organization','INTERNAL','DISABLED',now(),now()),($3,$4,'Other','INTERNAL','ACTIVE',NULL,now())`, [organization, randomUUID(), other, randomUUID()]);
    for (const [column, value] of [['id', randomUUID()], ['type', 'SUPPLIER']]) {
      await client.query('SAVEPOINT identity_guard');
      await expect(client.query(`UPDATE organizations SET ${column}=$1 WHERE id=$2`, [value, organization])).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT identity_guard');
    }
    await client.query(`INSERT INTO users (id,organization_id,username,password_hash,account_type,status,deleted_at,updated_at)
      VALUES ($1,$2,$3,'unused','INTERNAL','DISABLED',now(),now())`, [user, organization, randomUUID()]);
    for (const [column, value] of [['id', randomUUID()], ['organization_id', other], ['account_type', 'SUPPLIER']]) {
      await client.query('SAVEPOINT identity_guard');
      await expect(client.query(`UPDATE users SET ${column}=$1 WHERE id=$2`, [value, user])).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT identity_guard');
    }
  });

  it('keeps historical business scope when a pending account is explicitly reconfigured to a new current organization', async () => {
    const home = randomUUID(), target = randomUUID(), user = randomUUID(), problem = randomUUID();
    await client.query(`INSERT INTO organizations (id,code,name,type,updated_at) VALUES
      ($1,$2,'Historical scope','INTERNAL',now()),($3,$4,'New current scope','INTERNAL',now())`, [home, randomUUID(), target, randomUUID()]);
    await client.query(`INSERT INTO users (id,organization_id,username,password_hash,account_type,status,configuration_required,updated_at)
      VALUES ($1,$2,$3,'unused','INTERNAL','DISABLED',true,now())`, [user, home, randomUUID()]);
    await client.query(`INSERT INTO problem_indexes (id,organization_id,report_number,domain_code,source_type,problem_type,severity,owner_id,updated_at)
      VALUES ($1,$2,$3,'test','test','test','LOW',$4,now())`, [problem, home, randomUUID(), user]);
    await client.query('SAVEPOINT ordinary_transfer');
    await expect(client.query('UPDATE users SET organization_id=$1,configuration_required=false WHERE id=$2', [target, user])).rejects.toMatchObject({ code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT ordinary_transfer');
    await client.query("SELECT set_config('qms.administrative_reconfiguration','approved',true)");
    await client.query('UPDATE users SET organization_id=$1,configuration_required=false WHERE id=$2', [target, user]);
    expect((await client.query('SELECT organization_id,owner_id FROM problem_indexes WHERE id=$1', [problem])).rows)
      .toEqual([{ organization_id: home, owner_id: user }]);
    expect((await client.query('SELECT organization_id FROM user_organization_history WHERE user_id=$1 ORDER BY organization_id', [user])).rows)
      .toEqual([home, target].sort().map(organization_id => ({ organization_id })));
    await client.query('SAVEPOINT current_reference');
    await expect(client.query(`INSERT INTO problem_indexes (id,organization_id,report_number,domain_code,source_type,problem_type,severity,owner_id,updated_at)
      VALUES ($1,$2,$3,'test','test','test','LOW',$4,now())`, [randomUUID(), home, randomUUID(), user])).rejects.toMatchObject({ code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT current_reference');
    await client.query(`INSERT INTO problem_indexes (id,organization_id,report_number,domain_code,source_type,problem_type,severity,owner_id,updated_at)
      VALUES ($1,$2,$3,'test','test','test','LOW',$4,now())`, [randomUUID(), target, randomUUID(), user]);
    await client.query('SAVEPOINT immutable_scope');
    await expect(client.query('DELETE FROM user_organization_history WHERE user_id=$1', [user])).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO SAVEPOINT immutable_scope');
  });

  it('retains the prior physical cleanup of genuinely unreferenced accounts but never their referenced history', async () => {
    const organization = randomUUID(), empty = randomUUID(), referenced = randomUUID();
    await client.query("INSERT INTO organizations(id,code,name,type,updated_at) VALUES($1,$2,'Scope','INTERNAL',now())", [organization, randomUUID()]);
    for (const id of [empty, referenced]) await client.query(`INSERT INTO users(id,organization_id,username,password_hash,account_type,updated_at)
      VALUES($1,$2,$3,'unused','INTERNAL',now())`, [id, organization, randomUUID()]);
    await client.query('DELETE FROM users WHERE id=$1', [empty]);
    expect((await client.query('SELECT * FROM user_organization_history WHERE user_id=$1', [empty])).rows).toEqual([]);
    await client.query(`INSERT INTO problem_indexes(id,organization_id,report_number,domain_code,source_type,problem_type,severity,owner_id,updated_at)
      VALUES($1,$2,$3,'test','test','test','LOW',$4,now())`, [randomUUID(), organization, randomUUID(), referenced]);
    await client.query('SAVEPOINT referenced_identity');
    await expect(client.query('DELETE FROM users WHERE id=$1', [referenced])).rejects.toMatchObject({ code: '23001', constraint: 'problem_indexes_organization_id_owner_id_fkey' });
    await client.query('ROLLBACK TO SAVEPOINT referenced_identity');
    expect((await client.query('SELECT user_id FROM user_organization_history WHERE user_id=$1', [referenced])).rows).toEqual([{ user_id: referenced }]);
  });
});
