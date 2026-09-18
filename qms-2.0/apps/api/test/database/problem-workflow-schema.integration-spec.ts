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
});
