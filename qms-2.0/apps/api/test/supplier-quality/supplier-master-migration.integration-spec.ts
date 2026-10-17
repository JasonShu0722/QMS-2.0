import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Supplier upgrade acceptance requires real PostgreSQL.');
const connection = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Supplier upgrade acceptance requires explicitly disposable loopback PostgreSQL, never preview 55440.');
}

const migration = '20261018040000_supplier_master_independent';
const tables = [
  'supplier_quality_problems', 'supplier_incoming_inspections', 'supplier_performance_cards',
  'supplier_concession_requests', 'supplier_audit_plans', 'supplier_audit_records',
  'supplier_quality_targets', 'supplier_meetings', 'supplier_ppap_packages',
  'supplier_inspection_standards', 'supplier_barcode_rules', 'supplier_asn_records',
];

describe('supplier master upgrade from the complete populated pre-F1 migration chain', () => {
  const database = `qms_p0p1_upgrade_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString: connection.toString() });
  let client: Client;
  let created = false;
  const owner = randomUUID();
  const otherOwner = randomUUID();
  const supplier = randomUUID();
  const otherSupplier = randomUUID();
  const user = randomUUID();
  const recipient = randomUUID();
  const profile = randomUUID();
  const independentProfile = randomUUID();
  const ids = Object.fromEntries(tables.map((table) => [table, randomUUID()]));
  const now = new Date('2026-10-18T00:00:00Z');
  const snapshotTables = [
    'organizations', 'users', 'supplier_business_profiles', ...tables, 'problem_indexes',
    'file_objects', 'supplier_evidence_references', 'workflow_definitions', 'workflow_versions',
    'workflow_nodes', 'workflow_instances', 'workflow_tasks', 'supplier_portal_notifications',
  ];
  let before: Record<string, unknown>;

  async function insert(table: string, data: Record<string, unknown>) {
    const columns = Object.keys(data);
    await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(data));
  }

  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const table of snapshotTables) {
      result[table] = (await client.query(`SELECT to_jsonb(t) AS fact FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return result;
  }

  // Each probe rolls back, including probes expected to succeed on the old schema.
  async function probe(sql: string, values: unknown[], expectedError?: { code: string; constraint?: string }) {
    await client.query('BEGIN');
    try {
      const operation = client.query(sql, values);
      if (expectedError) await expect(operation).rejects.toMatchObject(expectedError);
      else await operation;
    } finally {
      await client.query('ROLLBACK');
    }
  }

  beforeAll(async () => {
    await admin.connect();
    if (!/^qms_p0p1_upgrade_[a-f0-9]{32}$/.test(database)) throw new Error('Unsafe upgrade database target.');
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const target = new URL(connection);
    target.pathname = `/${database}`;
    client = new Client({ connectionString: target.toString() });
    await client.connect();
    expect((await client.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
    const directories = (await readdir('prisma/migrations', { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name < migration).map((entry) => entry.name).sort();
    expect(directories.at(-1)).toBe('20261018030000_material_master');
    for (const directory of directories) {
      await client.query(await readFile(`prisma/migrations/${directory}/migration.sql`, 'utf8'));
    }
    for (const [id, type, code] of [[owner, 'INTERNAL', 'OWNER'], [otherOwner, 'INTERNAL', 'OTHER-OWNER'], [supplier, 'SUPPLIER', 'SUPPLIER'], [otherSupplier, 'SUPPLIER', 'OTHER-SUPPLIER']]) {
      await insert('organizations', { id, type, code, name: 'Same name must not infer a binding', updated_at: now });
    }
    for (const [id, organization_id, account_type] of [[user, owner, 'INTERNAL'], [recipient, supplier, 'SUPPLIER']]) {
      await insert('users', { id, organization_id, account_type, username: id, password_hash: 'migration-fixture-not-a-login', updated_at: now });
    }
    await insert('supplier_business_profiles', {
      id: profile, owner_organization_id: owner, supplier_organization_id: supplier,
      business_code: '00042', display_name: 'Legacy commercial name, not enterprise name',
      contact_name: 'Legacy contact', contact_email: 'legacy@example.invalid', version: 7, updated_at: now,
    });
    const base = { owner_organization_id: owner, supplier_organization_id: supplier, profile_id: profile, created_by_id: user };
    await insert('supplier_quality_problems', {
      ...base, id: ids.supplier_quality_problems, title: 'Legacy released problem', material_code: 'MAT-001',
      defect_description: 'Legacy defect', defect_quantity: 2, severity: 'HIGH', response_form: 'BRIEF',
      reply_mode: 'SUPPLIER', version: 4, updated_at: now,
    });
    await insert('supplier_incoming_inspections', {
      ...base, id: ids.supplier_incoming_inspections, supplier_business_code: '00042', supplier_name: 'Historical name',
      material_code: 'MAT-001', incoming_batch: 'BATCH-001', received_quantity: 10, sampled_quantity: 2, inspector_id: user,
    });
    await insert('supplier_performance_cards', {
      ...base, id: ids.supplier_performance_cards, supplier_name: 'Historical name', score_month: '2026-10-01',
      inspection_count: 1, pass_count: 1, incoming_score: 100, cooperation_score: 100, incoming_weight: 60,
      cooperation_weight: 40, cooperation_note: 'Legacy score', total_score: 100, source_inspections: '[]',
    });
    await insert('supplier_concession_requests', {
      owner_organization_id: owner, supplier_organization_id: supplier, profile_id: profile,
      id: ids.supplier_concession_requests, inspection_id: ids.supplier_incoming_inspections,
      inspection_version: 1, supplier_name: 'Historical name', material_code: 'MAT-001', incoming_batch: 'BATCH-001',
      received_quantity: 10, quantity: 1, reason: 'Legacy concession', expires_at: '2027-01-01', requested_by_id: user,
    });
    await insert('supplier_audit_plans', {
      ...base, id: ids.supplier_audit_plans, audit_year: 2026, audit_type: 'ANNUAL', title: 'Legacy audit', planned_start: now, planned_end: now,
    });
    await insert('supplier_audit_records', {
      ...base, id: ids.supplier_audit_records, plan_id: ids.supplier_audit_plans, audit_date: '2026-10-18', auditor: 'Legacy auditor', summary: 'Legacy audit summary',
    });
    await insert('supplier_quality_targets', {
      ...base, id: ids.supplier_quality_targets, period_type: 'ANNUAL', target_year: 2026, title: 'Legacy target', metrics: '{}',
    });
    await insert('supplier_meetings', { ...base, id: ids.supplier_meetings, title: 'Legacy meeting', scheduled_start: now, scheduled_end: now });
    await insert('supplier_ppap_packages', { ...base, id: ids.supplier_ppap_packages, level: 3, title: 'Legacy PPAP', part_number: 'PART-001' });
    await insert('supplier_inspection_standards', { ...base, id: ids.supplier_inspection_standards, material_code: 'MAT-001', title: 'Legacy standard' });
    await insert('supplier_barcode_rules', { ...base, id: ids.supplier_barcode_rules, material_code: 'MAT-001', title: 'Legacy barcode', prefix: 'QMS', code_length: 12 });
    await insert('supplier_asn_records', { ...base, id: ids.supplier_asn_records, asn_number: 'ASN-001', material_code: 'MAT-001', planned_arrival_date: '2026-10-18', quantity: 10 });

    const problemIndex = randomUUID();
    await insert('problem_indexes', {
      id: problemIndex, organization_id: owner, report_number: 'LEGACY-001', domain_code: 'supplier-quality',
      source_type: 'supplier-quality', source_id: ids.supplier_quality_problems, problem_type: 'BRIEF', severity: 'HIGH', updated_at: now,
    });
    await client.query('UPDATE supplier_quality_problems SET problem_index_id = $1, released_to_supplier_at = $2 WHERE id = $3', [problemIndex, now, ids.supplier_quality_problems]);
    const definition = randomUUID();
    const version = randomUUID();
    const node = randomUUID();
    const instance = randomUUID();
    const task = randomUUID();
    await insert('workflow_definitions', { id: definition, organization_id: owner, code: 'LEGACY-FLOW', name: 'Legacy workflow', updated_at: now });
    await insert('workflow_versions', { id: version, organization_id: owner, workflow_definition_id: definition, version: 1, status: 'PUBLISHED', published_by_id: user, published_at: now, updated_at: now });
    await insert('workflow_nodes', { id: node, organization_id: owner, workflow_version_id: version, node_key: 'reply', type: 'ACTION', name: 'Supplier reply', updated_at: now });
    await insert('workflow_instances', { id: instance, organization_id: owner, problem_index_id: problemIndex, workflow_definition_id: definition, workflow_version_id: version, instance_key: 'legacy-instance', current_node_id: node, updated_at: now });
    await insert('workflow_tasks', { id: task, organization_id: owner, workflow_instance_id: instance, workflow_version_id: version, workflow_node_id: node, entry_instance_version: 1, updated_at: now });
    await insert('supplier_portal_notifications', {
      id: randomUUID(), event_key: 'legacy-assignment', supplier_organization_id: supplier, recipient_user_id: recipient,
      owner_organization_id: owner, workflow_task_id: task, supplier_problem_id: ids.supplier_quality_problems,
      kind: 'TASK_ASSIGNED', body: 'Legacy supplier notification', version: 3,
    });
    const file = randomUUID();
    // Database evidence fixture only: this test does not claim object-storage or scanner execution.
    await insert('file_objects', {
      id: file, organization_id: supplier, object_key: 'legacy/evidence/fixed-version', original_name: 'legacy.txt',
      content_type: 'text/plain', size_bytes: 4, sha256: 'a'.repeat(64), status: 'AVAILABLE', version: 2,
      resource_type: 'supplier-quality', resource_id: ids.supplier_quality_problems, resource_version: 4,
      uploaded_by_id: recipient, updated_at: now, verified_sha256: 'a'.repeat(64), object_version_id: 'legacy-object-version-1',
      verified_content_type: 'text/plain', verified_size_bytes: 4, upload_completed_at: now,
      scan_status: 'CLEAN', scanned_at: now, scanner_engine: 'legacy-fixture-engine',
    });
    await insert('supplier_evidence_references', { problem_id: ids.supplier_quality_problems, file_id: file, purpose: 'Legacy defect evidence' });

    before = await snapshot();
    await probe('UPDATE supplier_business_profiles SET supplier_organization_id = NULL WHERE id = $1', [profile], { code: '23514' });
    expect((await client.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conname LIKE '%_profile_owner_fkey'")).rows[0].count).toBe(0);
    console.info(`Pre-F1 baseline: ${directories.length} actual migrations, 12 nonempty supplier tables and legacy file/notification references.`);
    await client.query(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
  }, 120000);

  afterAll(async () => {
    await client?.end();
    try {
      if (created) {
        if (!/^qms_p0p1_upgrade_[a-f0-9]{32}$/.test(database) || connection.port === '55440') throw new Error('Unsafe upgrade database cleanup target.');
        await admin.query(`DROP DATABASE "${database}"`);
      }
    } finally {
      await admin.end();
    }
  });

  it('preserves every legacy field, identity, version and file/workflow/notification reference', async () => {
    expect(await snapshot()).toEqual(before);
  });

  it('permits independent commercial-name maintenance without guessing a same-name enterprise', async () => {
    await client.query('BEGIN');
    try {
      await insert('supplier_business_profiles', { id: independentProfile, owner_organization_id: owner, supplier_organization_id: null, business_code: '00043', display_name: 'Same name must not infer a binding', updated_at: now });
      await client.query('UPDATE supplier_business_profiles SET display_name = $1, version = version + 1 WHERE id = $2 AND version = 1', ['Independent edited name', independentProfile]);
      expect((await client.query('SELECT business_code, display_name, supplier_organization_id, version FROM supplier_business_profiles WHERE id = $1', [independentProfile])).rows).toEqual([
        { business_code: '00043', display_name: 'Independent edited name', supplier_organization_id: null, version: 2 },
      ]);
      expect((await client.query('SELECT count(*)::int AS count FROM organizations')).rows[0].count).toBe(4);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('installs all twelve mandatory owner/profile keys independently of the nullable enterprise', async () => {
    const rows = (await client.query(`SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype = 'f' AND conname LIKE '%_profile_owner_fkey' ORDER BY table_name`)).rows;
    expect(rows.map((row) => row.table_name)).toEqual([...tables].sort());
    expect(rows.every((row) => row.definition === 'FOREIGN KEY (profile_id, owner_organization_id) REFERENCES supplier_business_profiles(id, owner_organization_id) ON DELETE RESTRICT')).toBe(true);
  });

  it.each(tables)('%s accepts a null enterprise but rejects foreign owner and missing profile', async (table) => {
    // Keep the released legacy problem intact; probe only an internal draft inside a rollback.
    const draft = table === 'supplier_quality_problems' ? ', released_to_supplier_at = NULL, problem_index_id = NULL' : '';
    await probe(`UPDATE ${table} SET supplier_organization_id = NULL${draft} WHERE id = $1`, [ids[table]]);
    await probe(`UPDATE ${table} SET supplier_organization_id = NULL, owner_organization_id = $2${draft} WHERE id = $1`, [ids[table], otherOwner], { code: '23503' });
    await probe(`UPDATE ${table} SET supplier_organization_id = NULL, profile_id = $2${draft} WHERE id = $1`, [ids[table], randomUUID()], { code: '23503' });
  });

  it.each(tables)('%s still rejects a non-null enterprise inconsistent with its profile', async (table) => {
    await probe(`UPDATE ${table} SET supplier_organization_id = $2 WHERE id = $1`, [ids[table], otherSupplier], { code: '23503' });
  });

  it('rejects released problems without an enterprise through the dedicated collaboration CHECK', async () => {
    await probe('UPDATE supplier_quality_problems SET supplier_organization_id = NULL WHERE id = $1', [ids.supplier_quality_problems], { code: '23514', constraint: 'supplier_quality_problems_collaboration_check' });
  });

  it('rejects published performance cards without an enterprise through the dedicated collaboration CHECK', async () => {
    await probe("UPDATE supplier_performance_cards SET supplier_organization_id = NULL, status = 'PUBLISHED', published_by_id = $2, published_at = $3 WHERE id = $1", [ids.supplier_performance_cards, user, now], { code: '23514', constraint: 'supplier_performance_cards_collaboration_check' });
  });
});
