import { Prisma, type ProblemIndex, type WorkflowInstance } from '../../src/generated/prisma/client.js';
import type { ProblemDomainReadAdapter, ProblemDomainReadContext, ProblemDomainReport } from '../../src/modules/problem-index/problem-domain-registry.js';
import type { WorkflowActor } from '../../src/modules/workflow/workflow-access-policy.js';
import { workflowError } from '../../src/modules/workflow/workflow-runtime-policy.js';
import type { FileResourceAccessAdapter, FileResourceAction, FileResourceRef } from '../../src/modules/file-management/file-resource-access.js';

export class NeutralReadAdapter implements ProblemDomainReadAdapter {
  readonly domainCode = 'neutral-read-test';
  readonly sourceType = 'neutral-read-record';
  readonly revisionResourceType = 'NeutralProblemRevision';
  async listRevisionIds(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM p4_read_fixture.revisions WHERE resource_id = ${context.problem.sourceId}::uuid`;
    return rows.map((row) => row.id);
  }
  readonly summaryBatches: string[][] = [];
  visibilityPredicate(actor: WorkflowActor, organizationId: string) {
    return Prisma.sql`EXISTS (SELECT 1 FROM p4_read_fixture.records record WHERE record.id = p.source_id AND record.organization_id = ${organizationId}::uuid AND record.reader_user_id = ${actor.id}::uuid)`;
  }
  async authorizeRead(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    const [record] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM p4_read_fixture.records WHERE id = ${context.problem.sourceId}::uuid AND organization_id = ${context.problem.organizationId}::uuid AND reader_user_id = ${context.actor.id}::uuid AND (${context.purpose} <> 'report' OR report_allowed) FOR SHARE`;
    if (!record) workflowError('PROBLEM_NOT_FOUND', 404);
  }
  async readSummaries(tx: Prisma.TransactionClient, _actor: WorkflowActor, problems: readonly ProblemIndex[]) {
    this.summaryBatches.push(problems.map((problem) => problem.id));
    const rows = await tx.$queryRaw<{ id: string; title: string; description: string }[]>(Prisma.sql`SELECT id, title, description FROM p4_read_fixture.records WHERE id IN (${Prisma.join(problems.map((problem) => Prisma.sql`${problem.sourceId}::uuid`))}) FOR SHARE`);
    return new Map(problems.map((problem) => {
      const record = rows.find((row) => row.id === problem.sourceId)!;
      return [problem.id, { title: record.title, description: record.description, domainUiKey: 'neutral-read-test' }];
    }));
  }
  async readWorkspace(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance | null) {
    if (instance && context.problem.workflowInstanceId !== instance.id) {
      const report = await this.readReport(tx, context, instance);
      return report ? { domainVersion: report.instanceVersion, revisionId: report.revisionId, summary: report.summary, sections: report.sections } : null;
    }
    const [record] = await tx.$queryRaw<{ title: string; description: string; version: number }[]>`SELECT title, description, version FROM p4_read_fixture.records WHERE id = ${context.problem.sourceId}::uuid`;
    return { domainVersion: record!.version, revisionId: null, summary: { title: record!.title, description: record!.description, domainUiKey: 'neutral-read-test' }, sections: [{ key: 'facts', title: 'Facts', fields: [{ key: 'description', label: 'Description', value: record!.description }] }] };
  }
  async readReport(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance): Promise<ProblemDomainReport | null> {
    const [revision] = await tx.$queryRaw<{ report: ProblemDomainReport }[]>`SELECT report FROM p4_read_fixture.revisions WHERE resource_id = ${context.problem.sourceId}::uuid AND instance_id = ${instance.id}::uuid ORDER BY instance_version DESC LIMIT 1`;
    return revision?.report ?? null;
  }
  async listEvidenceReferences(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, revisionId: string | null) {
    return tx.$queryRaw<{ fileId: string; resourceType: string; resourceId: string }[]>`SELECT file_id AS "fileId", resource_type AS "resourceType", resource_id AS "resourceId" FROM p4_read_fixture.evidence WHERE source_id = ${context.problem.sourceId}::uuid AND (${revisionId}::uuid IS NULL OR revision_id = ${revisionId}::uuid)`;
  }
  async describeActions() {
    return [
      { actionKey: 'neutral-submit', label: 'Submit', enabled: true, reasonCode: null },
      { actionKey: 'platform.upgrade', label: 'Upgrade', enabled: true, reasonCode: null },
    ];
  }
}

export class NeutralReadFileAdapter implements FileResourceAccessAdapter {
  readonly resourceType = 'NeutralReadEvidence';
  private readBarrier?: { remaining: number; promise: Promise<void>; release: () => void };

  synchronizeNextReads(participants = 2) {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    this.readBarrier = { remaining: participants, promise, release };
  }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: WorkflowActor, resource: FileResourceRef, action: FileResourceAction) {
    const barrier = action === 'read' ? this.readBarrier : undefined;
    if (barrier) {
      barrier.remaining -= 1;
      if (barrier.remaining === 0) {
        this.readBarrier = undefined;
        barrier.release();
      }
      await barrier.promise;
    }
    const rows = action === 'read'
      ? await tx.$queryRaw<{ organizationId: string; version: number }[]>`SELECT organization_id AS "organizationId", version FROM p4_read_fixture.records WHERE id = ${resource.resourceId}::uuid AND reader_user_id = ${actor.id}::uuid FOR SHARE`
      : await tx.$queryRaw<{ organizationId: string; version: number }[]>`SELECT organization_id AS "organizationId", version FROM p4_read_fixture.records WHERE id = ${resource.resourceId}::uuid AND reader_user_id = ${actor.id}::uuid FOR UPDATE`;
    const [record] = rows;
    if (!record) workflowError('FILE_RESOURCE_DENIED', 403);
    return record;
  }
}
