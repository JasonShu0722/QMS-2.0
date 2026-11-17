import { describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Application migration tests require disposable PostgreSQL');
describe('application migration preserves inline source and old jobs', () => {
  it('handles empty and populated sources preserving every source path, output, enablement and old task snapshot', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
    const migration = await readFile(new URL('../../prisma/migrations/20261117020000_ai_prompt_applications/migration.sql', import.meta.url), 'utf8');
    try {
      for (const populated of [false, true]) {
        const schema = `ai_application_migration_${randomUUID().replaceAll('-', '')}`;
        await client.query('BEGIN');
        await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`);
        await client.query('CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE integration_ingestion_rules(id uuid PRIMARY KEY,organization_id uuid NOT NULL,configuration jsonb NOT NULL,version integer NOT NULL,enabled boolean NOT NULL); CREATE TABLE integration_ai_description_tasks(id uuid PRIMARY KEY,prompt text NOT NULL,status text NOT NULL); CREATE TABLE integration_ingestion_jobs(id uuid PRIMARY KEY,rule_snapshot jsonb NOT NULL,status text NOT NULL);');
        const organizationId = randomUUID(), ruleId = randomUUID(), taskId = randomUUID();
        const ai = { connectionId: randomUUID(), connectionVersion: 7, model: 'model-v1', prompt: '整理{{zero}}与{{flag}}',
          inputFields: [{ path: 'source.zero', variable: 'zero', label: '数量：' }, { path: 'source.flag', variable: 'flag' }], output: { mode: 'JSON', field: '整理结果', target: 'description' } };
        const configuration = { name: '已有制程规则', enabled: false, target: 'PROCESS_DEFECT', aiDescription: ai, unrelated: { keep: true } };
        if (populated) {
          await client.query('INSERT INTO organizations VALUES($1)', [organizationId]);
          await client.query('INSERT INTO integration_ingestion_rules VALUES($1,$2,$3,9,false)', [ruleId, organizationId, configuration]);
          await client.query('INSERT INTO integration_ai_description_tasks VALUES($1,$2,$3)', [taskId, ai.prompt, 'PENDING']);
          await client.query('INSERT INTO integration_ingestion_jobs VALUES($1,$2,$3)', [taskId, configuration, 'PENDING']);
        }
        await client.query(migration);
        const applications = (await client.query('SELECT * FROM ai_prompt_applications')).rows;
        expect(applications).toHaveLength(populated ? 1 : 0);
        if (populated) {
          const after = (await client.query('SELECT * FROM integration_ingestion_rules WHERE id=$1', [ruleId])).rows[0];
          expect(after).toMatchObject({ version: 9, enabled: false, configuration: { ...configuration,
            aiApplication: { applicationId: applications[0].id, publishedVersion: 1, inputFields: ai.inputFields } } });
          expect(after.configuration.aiDescription).toEqual(ai);
          const revision = (await client.query('SELECT * FROM ai_prompt_application_revisions')).rows[0];
          expect(revision.configuration).toMatchObject({ connectionId: ai.connectionId, model: ai.model, prompt: ai.prompt, output: ai.output,
            variables: [{ variable: 'zero', label: '数量：' }, { variable: 'flag', label: '' }] });
          expect((await client.query('SELECT id,prompt,status,application_id,application_version FROM integration_ai_description_tasks')).rows).toEqual([{ id: taskId, prompt: ai.prompt, status: 'PENDING', application_id: null, application_version: null }]);
          expect((await client.query('SELECT * FROM integration_ingestion_jobs')).rows).toEqual([{ id: taskId, rule_snapshot: configuration, status: 'PENDING' }]);
        }
        await client.query('ROLLBACK');
      }
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });
});
