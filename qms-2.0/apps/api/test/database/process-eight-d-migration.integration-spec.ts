import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { jest } from '@jest/globals';
import { Client } from 'pg';

const connection = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(connection.hostname) || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Process migration validation requires disposable loopback PostgreSQL.');
}
jest.setTimeout(180_000);
const migrations = new URL('../../prisma/migrations/', import.meta.url);
const firstNew = '20261025130000_process_manual_ledger';

it.each([false, true])('applies the entire N3 chain with populated previous schema = %s', async populated => {
  const database = `qms_n3_upgrade_${randomUUID().replaceAll('-', '')}`;
  const control = new Client({ connectionString: connection.toString() });
  let client: Client | undefined; let created = false;
  const organization = randomUUID(), supplier = randomUUID(), user = randomUUID(), defect = randomUUID(), role = randomUUID();
  try {
    await control.connect();
    await control.query(`CREATE DATABASE "${database}"`); created = true;
    const target = new URL(connection); target.pathname = `/${database}`;
    client = new Client({ connectionString: target.toString() }); await client.connect();
    const names = (await readdir(migrations)).filter(name => /^\d{14}_/.test(name)).sort();
    const before = names.filter(name => name < firstNew), additions = names.filter(name => name >= firstNew);
    expect(before).toHaveLength(110); expect(additions.length).toBeGreaterThanOrEqual(4);
    for (const name of before) await client.query(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
    let original: Record<string, unknown> | undefined;
    if (populated) {
      await client.query("INSERT INTO organizations (id, code, name, type, updated_at) VALUES ($1,'N3_OWNER','Historical owner','INTERNAL',CURRENT_TIMESTAMP),($2,'N3_SUPPLIER','Historical supplier','SUPPLIER',CURRENT_TIMESTAMP)", [organization, supplier]);
      await client.query("INSERT INTO users (id, organization_id, username, password_hash, account_type, updated_at) VALUES ($1,$2,'historical','unused','INTERNAL',CURRENT_TIMESTAMP)", [user, organization]);
      await client.query("INSERT INTO roles (id, organization_id, code, name) VALUES ($1,$2,'OLD_ROLE','Historical role')", [role, organization]);
      await client.query('INSERT INTO user_roles (user_id, role_id, organization_id) VALUES ($1,$2,$3)', [user, role, organization]);
      await client.query("INSERT INTO process_defect_types (id, organization_id, code, name, created_by_id, updated_at) VALUES ($1,$2,'HISTORICAL','Historical type',$3,CURRENT_TIMESTAMP)", [randomUUID(), organization, user]);
      await client.query(`INSERT INTO process_defects (id, organization_id, defect_type_code, description, defect_quantity, occurred_at,
        material_code, supplier_organization_id, responsibility_category, version, created_by_id, updated_by_id, updated_at)
        VALUES ($1,$2,'HISTORICAL','Saved historical fact',3,'2026-09-24T08:00:00Z','M-OLD',$3,'MATERIAL',7,$4,$4,CURRENT_TIMESTAMP)`, [defect, organization, supplier, user]);
      original = (await client.query('SELECT * FROM process_defects WHERE id=$1', [defect])).rows[0];
    }
    for (const name of additions) await client.query(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
    expect((await client.query("SELECT to_regclass('process_eight_d_reports')::text AS name")).rows[0].name).toBe('process_eight_d_reports');
    expect((await client.query("SELECT to_regclass('workflow_deadline_extensions')::text AS name")).rows[0].name).toBe('workflow_deadline_extensions');
    expect((await client.query("SELECT enabled FROM process_eight_d_bindings")).rows).toEqual([]);
    expect((await client.query("SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='process_eight_d_receipts'::regclass AND conname='process_eight_d_receipts_organization_id_fkey' AND contype='f'")).rows)
      .toEqual([{ target: 'organizations' }]);
    if (populated) {
      const updated = (await client.query('SELECT * FROM process_defects WHERE id=$1', [defect])).rows[0];
      expect(updated).toMatchObject(original!);
      expect(updated).toMatchObject({ version: 7, ledger_status: 'FOLLOWING', closed_by_id: null, closed_at: null });
      expect((await client.query('SELECT material_code,supplier_organization_id,verification FROM process_defect_material_items WHERE defect_id=$1', [defect])).rows)
        .toEqual([{ material_code: 'M-OLD', supplier_organization_id: supplier, verification: 'UNREVIEWED' }]);
      expect((await client.query('SELECT * FROM role_permissions WHERE role_id=$1', [role])).rows).toEqual([]);
      expect((await client.query('SELECT role_id FROM user_roles WHERE user_id=$1', [user])).rows).toEqual([{ role_id: role }]);
      await expect(client.query('INSERT INTO process_eight_d_receipts (organization_id,actor_user_id,key,digest,response) VALUES ($1,$2,$3,$4,$5)',
        [randomUUID(), user, 'foreign-organization', 'a'.repeat(64), '{}'])).rejects.toMatchObject({ code: '23503' });
      await client.query("UPDATE process_defects SET defect_type_code=NULL,defect_quantity=NULL,occurred_at=NULL,responsibility_category='FALSE_POSITIVE',description='' WHERE id=$1", [defect]);
      expect((await client.query('SELECT defect_quantity,occurred_at FROM process_defects WHERE id=$1', [defect])).rows).toEqual([{ defect_quantity: null, occurred_at: null }]);
    }
  } finally {
    await client?.end();
    try { if (created) await control.query(`DROP DATABASE "${database}"`); }
    finally { await control.end(); }
  }
});
