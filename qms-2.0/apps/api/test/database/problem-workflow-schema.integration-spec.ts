import { PrismaService } from '../../src/database/prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('PostgreSQL integration requires DATABASE_URL; skipping and SQLite fallback are forbidden.');
}

const tables = [
  'problem_indexes',
  'number_rule_versions',
  'number_sequences',
  'workflow_definitions',
  'workflow_versions',
  'workflow_nodes',
  'workflow_transitions',
  'workflow_instances',
  'workflow_tasks',
  'notifications',
] as const;

describe('problem and workflow PostgreSQL schema', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl!);
    await prisma.$connect();
  });

  afterAll(async () => prisma?.$disconnect());

  it('creates every platform table', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${tables}::text[])
    `;
    expect(rows.map(({ table_name }) => table_name).sort()).toEqual([...tables].sort());
  });

  it('enforces report number, rule version and workflow instance version uniqueness', async () => {
    const suffix = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const workflowVersionId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO organizations (id, code, name, type, updated_at)
      VALUES (${organizationId}::uuid, ${`SCHEMA-${suffix}`}, 'Schema test', 'INTERNAL', CURRENT_TIMESTAMP)
    `;
    try {
      await prisma.$executeRaw`
        INSERT INTO problem_indexes
          (id, organization_id, report_number, domain_code, problem_type, source_type, status, severity, version, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationId}::uuid, ${`PR-${suffix}`}, 'TEST', 'TEST', 'MANUAL', 'OPEN', 'LOW', 1, CURRENT_TIMESTAMP)
      `;
      await expect(prisma.$executeRaw`
        INSERT INTO problem_indexes
          (id, organization_id, report_number, domain_code, problem_type, source_type, status, severity, version, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationId}::uuid, ${`PR-${suffix}`}, 'TEST', 'TEST', 'MANUAL', 'OPEN', 'LOW', 1, CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });

      await prisma.$executeRaw`
        INSERT INTO number_rule_versions
          (id, organization_id, rule_code, version, pattern, active, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationId}::uuid, ${`PROBLEM-${suffix}`}, 1, '{YYYY}-{SEQ}', true, CURRENT_TIMESTAMP)
      `;
      await expect(prisma.$executeRaw`
        INSERT INTO number_rule_versions
          (id, organization_id, rule_code, version, pattern, active, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationId}::uuid, ${`PROBLEM-${suffix}`}, 1, '{YYYY}-{SEQ}', true, CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });

      await prisma.$executeRaw`
        INSERT INTO workflow_definitions
          (id, organization_id, code, name, version, updated_at)
        VALUES (${definitionId}::uuid, ${organizationId}::uuid, ${`WF-${suffix}`}, 'Schema workflow', 1, CURRENT_TIMESTAMP)
      `;
      await prisma.$executeRaw`
        INSERT INTO workflow_versions
          (id, organization_id, workflow_definition_id, version, status, updated_at)
        VALUES (${workflowVersionId}::uuid, ${organizationId}::uuid, ${definitionId}::uuid, 1, 'DRAFT', CURRENT_TIMESTAMP)
      `;
      await expect(prisma.$executeRaw`
        INSERT INTO workflow_versions
          (id, organization_id, workflow_definition_id, version, status, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationId}::uuid, ${definitionId}::uuid, 1, 'DRAFT', CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });
      await prisma.$executeRaw`
        INSERT INTO workflow_instances
          (id, organization_id, workflow_definition_id, workflow_version_id, instance_key, status, version, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationId}::uuid, ${definitionId}::uuid, ${workflowVersionId}::uuid, ${`INSTANCE-${suffix}`}, 'RUNNING', 1, CURRENT_TIMESTAMP)
      `;
      await expect(prisma.$executeRaw`
        INSERT INTO workflow_instances
          (id, organization_id, workflow_definition_id, workflow_version_id, instance_key, status, version, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationId}::uuid, ${definitionId}::uuid, ${workflowVersionId}::uuid, ${`INSTANCE-${suffix}`}, 'RUNNING', 1, CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });
    } finally {
      await prisma.$executeRaw`DELETE FROM workflow_instances WHERE organization_id = ${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM workflow_versions WHERE organization_id = ${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM workflow_definitions WHERE organization_id = ${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM number_rule_versions WHERE organization_id = ${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM problem_indexes WHERE organization_id = ${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
    }
  });

  it('enforces source idempotency only when a source id is present', async () => {
    const suffix = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO organizations (id, code, name, type, updated_at)
      VALUES (${organizationId}::uuid, ${`SOURCE-${suffix}`}, 'Source test', 'INTERNAL', CURRENT_TIMESTAMP)
    `;
    try {
      const insert = (id: string, source: string | null) => prisma.$executeRaw`
        INSERT INTO problem_indexes
          (id, organization_id, report_number, domain_code, problem_type, source_type, source_id, status, severity, version, updated_at)
        VALUES (${id}::uuid, ${organizationId}::uuid, ${`PR-${id}`}, 'TEST', 'TEST', 'DOMAIN', ${source}::uuid, 'OPEN', 'LOW', 1, CURRENT_TIMESTAMP)
      `;
      await insert(crypto.randomUUID(), sourceId);
      await expect(insert(crypto.randomUUID(), sourceId)).rejects.toMatchObject({ code: 'P2010' });
      await insert(crypto.randomUUID(), null);
      await insert(crypto.randomUUID(), null);
    } finally {
      await prisma.$executeRaw`DELETE FROM problem_indexes WHERE organization_id = ${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
    }
  });

  it('rejects cross organization and cross workflow version references', async () => {
    const suffix = crypto.randomUUID();
    const organizationA = crypto.randomUUID();
    const organizationB = crypto.randomUUID();
    const definitionA = crypto.randomUUID();
    const definitionB = crypto.randomUUID();
    const versionA = crypto.randomUUID();
    const versionA2 = crypto.randomUUID();
    const versionB = crypto.randomUUID();
    const nodeA = crypto.randomUUID();
    const nodeA2 = crypto.randomUUID();
    const nodeB = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO organizations (id, code, name, type, updated_at) VALUES
        (${organizationA}::uuid, ${`ORG-A-${suffix}`}, 'Org A', 'INTERNAL', CURRENT_TIMESTAMP),
        (${organizationB}::uuid, ${`ORG-B-${suffix}`}, 'Org B', 'INTERNAL', CURRENT_TIMESTAMP)
    `;
    try {
      await prisma.$executeRaw`
        INSERT INTO workflow_definitions (id, organization_id, code, name, version, updated_at)
        VALUES (${definitionA}::uuid, ${organizationA}::uuid, ${`WF-A-${suffix}`}, 'Workflow A', 1, CURRENT_TIMESTAMP),
               (${definitionB}::uuid, ${organizationB}::uuid, ${`WF-B-${suffix}`}, 'Workflow B', 1, CURRENT_TIMESTAMP)
      `;
      await prisma.$executeRaw`
        INSERT INTO workflow_versions (id, organization_id, workflow_definition_id, version, status, updated_at)
        VALUES (${versionA}::uuid, ${organizationA}::uuid, ${definitionA}::uuid, 1, 'DRAFT', CURRENT_TIMESTAMP),
               (${versionA2}::uuid, ${organizationA}::uuid, ${definitionA}::uuid, 2, 'DRAFT', CURRENT_TIMESTAMP),
               (${versionB}::uuid, ${organizationB}::uuid, ${definitionB}::uuid, 1, 'DRAFT', CURRENT_TIMESTAMP)
      `;
      await expect(prisma.$executeRaw`
        INSERT INTO workflow_versions (id, organization_id, workflow_definition_id, version, status, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationB}::uuid, ${definitionA}::uuid, 2, 'DRAFT', CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });
      await prisma.$executeRaw`
        INSERT INTO workflow_nodes (id, organization_id, workflow_version_id, node_key, type, name, updated_at)
        VALUES (${nodeA}::uuid, ${organizationA}::uuid, ${versionA}::uuid, 'A', 'ACTION', 'Node A', CURRENT_TIMESTAMP),
               (${nodeA2}::uuid, ${organizationA}::uuid, ${versionA2}::uuid, 'A2', 'ACTION', 'Node A2', CURRENT_TIMESTAMP),
               (${nodeB}::uuid, ${organizationB}::uuid, ${versionB}::uuid, 'B', 'ACTION', 'Node B', CURRENT_TIMESTAMP)
      `;
      await expect(prisma.$executeRaw`
        INSERT INTO workflow_transitions
          (id, organization_id, workflow_version_id, transition_key, from_node_id, to_node_id, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationA}::uuid, ${versionA}::uuid, 'CROSS', ${nodeB}::uuid, ${nodeA}::uuid, CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });
      await expect(prisma.$executeRaw`
        INSERT INTO workflow_transitions
          (id, organization_id, workflow_version_id, transition_key, from_node_id, to_node_id, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationA}::uuid, ${versionA}::uuid, 'WRONG-VERSION', ${nodeA2}::uuid, ${nodeA}::uuid, CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });
      await expect(prisma.$executeRaw`
        INSERT INTO workflow_instances
          (id, organization_id, workflow_definition_id, workflow_version_id, instance_key, status, current_node_id, version, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationA}::uuid, ${definitionA}::uuid, ${versionA}::uuid, ${`WRONG-NODE-${suffix}`}, 'RUNNING', ${nodeA2}::uuid, 1, CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });
    } finally {
      await prisma.$executeRaw`DELETE FROM workflow_transitions WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM workflow_instances WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM workflow_nodes WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM workflow_versions WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM workflow_definitions WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM organizations WHERE id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
    }
  });

  it('enforces workflow instance version uniqueness and user audit scope', async () => {
    const suffix = crypto.randomUUID();
    const organizationA = crypto.randomUUID();
    const organizationB = crypto.randomUUID();
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    const definitionA = crypto.randomUUID();
    const versionA = crypto.randomUUID();
    const nodeA = crypto.randomUUID();
    const instanceA = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO organizations (id, code, name, type, updated_at) VALUES
        (${organizationA}::uuid, ${`USER-A-${suffix}`}, 'User Org A', 'INTERNAL', CURRENT_TIMESTAMP),
        (${organizationB}::uuid, ${`USER-B-${suffix}`}, 'User Org B', 'INTERNAL', CURRENT_TIMESTAMP)
    `;
    try {
      await prisma.$executeRaw`
        INSERT INTO users (id, organization_id, username, password_hash, account_type, updated_at) VALUES
          (${userA}::uuid, ${organizationA}::uuid, ${`owner-a-${suffix}`}, 'test', 'INTERNAL', CURRENT_TIMESTAMP),
          (${userB}::uuid, ${organizationB}::uuid, ${`owner-b-${suffix}`}, 'test', 'INTERNAL', CURRENT_TIMESTAMP)
      `;
      await prisma.$executeRaw`
        INSERT INTO workflow_definitions (id, organization_id, code, name, version, updated_at)
        VALUES (${definitionA}::uuid, ${organizationA}::uuid, ${`WF-${suffix}`}, 'Workflow', 1, CURRENT_TIMESTAMP)
      `;
      await prisma.$executeRaw`
        INSERT INTO workflow_versions (id, organization_id, workflow_definition_id, version, status, updated_at)
        VALUES (${versionA}::uuid, ${organizationA}::uuid, ${definitionA}::uuid, 1, 'DRAFT', CURRENT_TIMESTAMP)
      `;
      await prisma.$executeRaw`
        INSERT INTO workflow_nodes (id, organization_id, workflow_version_id, node_key, type, name, updated_at)
        VALUES (${nodeA}::uuid, ${organizationA}::uuid, ${versionA}::uuid, 'A', 'ACTION', 'Node A', CURRENT_TIMESTAMP)
      `;
      await prisma.$executeRaw`
        INSERT INTO workflow_instances
          (id, organization_id, workflow_definition_id, workflow_version_id, instance_key, status, version, updated_at)
        VALUES (${instanceA}::uuid, ${organizationA}::uuid, ${definitionA}::uuid, ${versionA}::uuid, ${`INSTANCE-${suffix}`}, 'RUNNING', 1, CURRENT_TIMESTAMP)
      `;
      await expect(prisma.$executeRaw`
        INSERT INTO workflow_instances
          (id, organization_id, workflow_definition_id, workflow_version_id, instance_key, status, version, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationA}::uuid, ${definitionA}::uuid, ${versionA}::uuid, ${`INSTANCE-2-${suffix}`}, 'RUNNING', 1, CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });
      await expect(prisma.$executeRaw`
        INSERT INTO problem_indexes
          (id, organization_id, report_number, domain_code, problem_type, source_type, status, severity, owner_id, version, updated_at)
        VALUES (${crypto.randomUUID()}::uuid, ${organizationA}::uuid, ${`PR-OWNER-${suffix}`}, 'TEST', 'TEST', 'DOMAIN', 'OPEN', 'LOW', ${userB}::uuid, 1, CURRENT_TIMESTAMP)
      `).rejects.toMatchObject({ code: 'P2010' });
      const problemId = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO problem_indexes
          (id, organization_id, report_number, domain_code, problem_type, source_type, status, severity, owner_id, version, updated_at)
        VALUES (${problemId}::uuid, ${organizationA}::uuid, ${`PR-OWNER-${suffix}`}, 'TEST', 'TEST', 'DOMAIN', 'OPEN', 'LOW', ${userA}::uuid, 1, CURRENT_TIMESTAMP)
      `;
      await expect(prisma.$executeRaw`
        DELETE FROM users WHERE id = ${userA}::uuid
      `).rejects.toMatchObject({ code: 'P2010' });
    } finally {
      await prisma.$executeRaw`DELETE FROM problem_indexes WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM workflow_instances WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM workflow_nodes WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM workflow_versions WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM workflow_definitions WHERE organization_id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM users WHERE id IN (${userA}::uuid, ${userB}::uuid)`;
      await prisma.$executeRaw`DELETE FROM organizations WHERE id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
    }
  });

  it('runs on PostgreSQL 18 with integrity indexes and foreign keys', async () => {
    const [version] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(version!.server_version_num)).toBeGreaterThanOrEqual(180000);
    expect(Number(version!.server_version_num)).toBeLessThan(190000);
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND (
        indexname = 'problem_indexes_organization_id_source_type_source_id_key'
        OR indexname LIKE 'workflow_instances_organization_id_workflow_definition_id_v%'
      )
    `;
    expect(indexes.map(({ indexname }) => indexname)).toEqual(expect.arrayContaining([
      'problem_indexes_organization_id_source_type_source_id_key',
    ]));
    expect(indexes.some(({ indexname }) => indexname.startsWith('workflow_instances_organization_id_workflow_definition_id_v'))).toBe(true);
    const foreignKeys = await prisma.$queryRaw<{ constraint_name: string }[]>`
      SELECT DISTINCT constraint_name
      FROM information_schema.referential_constraints
      WHERE constraint_schema = 'public'
        AND (constraint_name = 'problem_indexes_organization_id_owner_id_fkey'
          OR constraint_name LIKE 'workflow_transitions_organization_id_workflow_version_id_from_n%')
    `;
    expect(foreignKeys.map(({ constraint_name }) => constraint_name)).toEqual(expect.arrayContaining([
      'problem_indexes_organization_id_owner_id_fkey',
    ]));
    expect(foreignKeys.some(({ constraint_name }) => constraint_name.startsWith(
      'workflow_transitions_organization_id_workflow_version_id_from_n',
    ))).toBe(true);
  });
});
