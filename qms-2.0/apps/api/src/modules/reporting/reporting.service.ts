import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ProblemQueryService } from '../problem-index/problem-query.service.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import type { ProblemIndexQueryDto } from '../problem-index/problem-index.dto.js';
import { isUUID } from 'class-validator';
import { ProblemWorkspaceService, instanceProjection } from '../problem-index/problem-workspace.service.js';
import type { ProblemWorkspaceQueryDto } from '../problem-index/problem-workspace.dto.js';
import { domainText, sectionProjection, summaryProjection } from '../problem-index/problem-domain-projection.js';
import { ProblemReportDto, ProblemReportSnapshotDto } from './reporting.dto.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService, private readonly problems: ProblemQueryService, private readonly workspaces: ProblemWorkspaceService) {}
  list(actor: WorkflowActor, query: ProblemIndexQueryDto) { return this.problems.list(actor, query); }
  async report(actor: WorkflowActor, organizationId: string, id: string, query: ProblemWorkspaceQueryDto): Promise<ProblemReportDto> {
    return this.prisma.$transaction(async (tx) => {
      const { problem, adapter, context } = await this.problems.authorized(tx, actor, organizationId, id, 'report');
      const instance = await this.workspaces.selectInstance(tx, organizationId, id, query.instanceId ?? problem.workflowInstanceId);
      if (instance && instance.id !== problem.workflowInstanceId) await adapter.authorizeRead(tx, { ...context, purpose: 'history' });
      const report = instance ? await adapter.readReport(tx, context, instance) : null;
      if (report && (!isUUID(report.revisionId) || report.instanceId !== instance!.id || !Number.isSafeInteger(report.instanceVersion)
        || report.instanceVersion < 1 || report.instanceVersion > instance!.version || !Number.isFinite(Date.parse(report.recordedAt)))) throw new Error('PROBLEM_REPORT_REVISION_INVALID');
      let snapshotInstance = instance;
      if (report && instance) {
        const receipt = await tx.workflowMutation.findFirst({ where: { organizationId, instanceId: instance.id, workflowVersionId: instance.workflowVersionId, instanceVersion: report.instanceVersion } });
        const state = jsonObject(receipt?.response);
        if (!receipt || state.instanceId !== instance.id || state.workflowVersionId !== instance.workflowVersionId || state.version !== report.instanceVersion
          || typeof state.currentNodeId !== 'string' || !isUUID(state.currentNodeId) || !['RUNNING', 'COMPLETED'].includes(String(state.status))) throw new Error('PROBLEM_REPORT_REVISION_INVALID');
        const node = await tx.workflowNode.findFirst({ where: { id: state.currentNodeId, organizationId, workflowVersionId: instance.workflowVersionId } });
        if (!node) throw new Error('PROBLEM_REPORT_REVISION_INVALID');
        snapshotInstance = { ...instance, version: report.instanceVersion, currentNodeId: node.id, status: state.status as 'RUNNING' | 'COMPLETED' };
      }
      const fields = ['problemType', 'severity', 'status', 'responsibleParty', 'ownerId', 'dueAt'] as const;
      const unavailableFields = fields.filter((field) => !report || report.snapshot[field] === undefined || ['problemType', 'severity', 'status'].includes(field) && report.snapshot[field] === null);
      const snapshot = report ? Object.fromEntries(fields.map((field) => [field, report.snapshot[field] == null ? null : domainText(report.snapshot[field]!, 200)])) as unknown as ProblemReportSnapshotDto : null;
      if (snapshot?.ownerId && !isUUID(snapshot.ownerId) || snapshot?.dueAt && !Number.isFinite(Date.parse(snapshot.dueAt))) throw new Error('PROBLEM_REPORT_REVISION_INVALID');
      const history = await this.workspaces.history(tx, organizationId, id, problem.workflowInstanceId);
      const facts = await this.workspaces.nodeFacts(tx, snapshotInstance, report?.instanceVersion);
      const evidence = report ? await this.workspaces.evidence(tx, adapter, context, report.revisionId) : [];
      await this.problems.authenticate(tx, actor, organizationId);
      return { generatedAt: new Date().toISOString(), problem: { id: problem.id, reportNumber: problem.reportNumber, domainCode: problem.domainCode, sourceType: problem.sourceType, sourceId: problem.sourceId! },
        instance: snapshotInstance ? instanceProjection(snapshotInstance, problem.workflowInstanceId) : null,
        revision: report ? { id: report.revisionId, instanceVersion: report.instanceVersion, recordedAt: new Date(report.recordedAt).toISOString() } : null,
        summary: report ? summaryProjection(report.summary) : null, snapshot, sections: report ? sectionProjection(report.sections) : [],
        ...facts, evidence, upgrades: history.upgrades, dataAvailability: report ? unavailableFields.length ? 'PARTIAL' : 'AVAILABLE' : 'UNAVAILABLE', unavailableFields };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
