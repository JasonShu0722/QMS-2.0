import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Module, Inject, Injectable, Controller, Get, Post, Body, Headers, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, validateSync } from 'class-validator';
import { Prisma } from '../../dist/generated/prisma/client.js';
import { AppModule } from '../../dist/app.module.js';
import { DatabaseModule } from '../../dist/database/database.module.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { AuditLogModule } from '../../dist/modules/audit-log/audit-log.module.js';
import { AuditLogService } from '../../dist/modules/audit-log/audit-log.service.js';
import { AUTHENTICATED_SESSION } from '../../dist/common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../dist/common/contracts/error-response.js';
import { requestTraceId } from '../../dist/common/contracts/request-trace.js';
import { RequireAccess } from '../../dist/modules/authorization/access.decorator.js';
import { WorkflowModule } from '../../dist/modules/workflow/workflow.module.js';
import { WorkflowRuntimeService } from '../../dist/modules/workflow/workflow-runtime.service.js';
import { workflowError } from '../../dist/modules/workflow/workflow-runtime-policy.js';
import { FileManagementModule } from '../../dist/modules/file-management/file-management.module.js';
import { FileLifecycleService } from '../../dist/modules/file-management/file-lifecycle.service.js';

export const PROBLEM_BROWSER_DOMAIN = 'neutral-browser-test';
export const PROBLEM_BROWSER_SOURCE = 'neutral-browser-record';
export const PROBLEM_BROWSER_RESOURCE = 'NeutralProblemEvidence';
export const PROBLEM_BROWSER_REVISION = 'NeutralProblemRevision';

function property(type, key, decorators) {
  for (const decorator of decorators) decorator(type.prototype, key);
}

export class ProblemBrowserScopeDto {}
property(ProblemBrowserScopeDto, 'organizationId', [ApiPropertyOptional({ format: 'uuid' }), IsOptional(), IsUUID()]);

export class NeutralProblemProcessRequestDto {}
export class NeutralProblemReviewRequestDto {}
for (const type of [NeutralProblemProcessRequestDto, NeutralProblemReviewRequestDto]) {
  property(type, 'instanceId', [ApiProperty({ type: String, format: 'uuid' }), IsUUID()]);
  property(type, 'workflowVersionId', [ApiProperty({ type: String, format: 'uuid' }), IsUUID()]);
  property(type, 'currentNodeId', [ApiProperty({ type: String, format: 'uuid' }), IsUUID()]);
  property(type, 'expectedProblemVersion', [ApiProperty({ type: Number, minimum: 1 }), IsInt(), Min(1), Max(2147483647)]);
  property(type, 'expectedInstanceVersion', [ApiProperty({ type: Number, minimum: 1 }), IsInt(), Min(1), Max(2147483647)]);
  property(type, 'expectedDomainVersion', [ApiProperty({ type: Number, minimum: 1 }), IsInt(), Min(1), Max(2147483647)]);
}
property(NeutralProblemProcessRequestDto, 'resolution', [ApiProperty({ type: String, minLength: 1, maxLength: 1000 }), IsString(), Length(1, 1000)]);
property(NeutralProblemProcessRequestDto, 'evidenceFileIds', [ApiProperty({ type: [String], format: 'uuid', maxItems: 20, uniqueItems: true }), IsArray(), ArrayMaxSize(20), ArrayUnique(), IsUUID('4', { each: true })]);
property(NeutralProblemReviewRequestDto, 'note', [ApiProperty({ type: String, minLength: 1, maxLength: 1000 }), IsString(), Length(1, 1000)]);

export class NeutralProblemProcessResponseDto {}
for (const key of ['problemId', 'instanceId', 'workflowVersionId', 'currentNodeId', 'revisionId']) property(NeutralProblemProcessResponseDto, key, [ApiProperty({ type: String, format: 'uuid' })]);
for (const key of ['problemVersion', 'instanceVersion', 'domainVersion']) property(NeutralProblemProcessResponseDto, key, [ApiProperty({ type: Number, minimum: 1 })]);

export class NeutralProblemProjectionStatusDto {}
property(NeutralProblemProjectionStatusDto, 'outboxEventId', [ApiProperty({ type: String, format: 'uuid' })]);
property(NeutralProblemProjectionStatusDto, 'outboxStatus', [ApiProperty({ enum: ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'] })]);
for (const key of ['taskCount', 'notificationCount']) property(NeutralProblemProjectionStatusDto, key, [ApiProperty({ type: Number, minimum: 0 })]);

function sourceSummary(source) {
  const data = source.data ?? {};
  return {
    title: source.title,
    description: typeof data.resolution === 'string' && data.resolution ? data.resolution : source.description,
    domainUiKey: PROBLEM_BROWSER_DOMAIN,
  };
}

function sections(data) {
  return [{ key: 'neutral.findings', title: 'Neutral findings', fields: [
    { key: 'description', label: 'Description', value: typeof data.description === 'string' ? data.description : null },
    { key: 'resolution', label: 'Resolution', value: typeof data.resolution === 'string' ? data.resolution : null },
    { key: 'approvalNote', label: 'Approval', value: typeof data.approvalNote === 'string' ? data.approvalNote : null },
    { key: 'verificationNote', label: 'Verification', value: typeof data.verificationNote === 'string' ? data.verificationNote : null },
    { key: 'kind', label: 'Response form', value: typeof data.kind === 'string' ? data.kind : null },
  ] }];
}

async function sourceFor(tx, problem) {
  const [source] = await tx.$queryRaw(Prisma.sql`SELECT * FROM problem_browser_test.sources WHERE id = ${problem.sourceId}::uuid`);
  return source;
}

async function revisionFor(tx, sourceId, instanceId) {
  const [revision] = await tx.$queryRaw(Prisma.sql`SELECT * FROM problem_browser_test.revisions
    WHERE source_id = ${sourceId}::uuid AND instance_id = ${instanceId}::uuid ORDER BY instance_version DESC LIMIT 1`);
  return revision;
}

function reportFrom(revision, source) {
  if (!revision) return null;
  return {
    revisionId: revision.id,
    instanceId: revision.instance_id,
    instanceVersion: revision.instance_version,
    recordedAt: revision.recorded_at.toISOString(),
    summary: { title: revision.title, description: revision.description, domainUiKey: PROBLEM_BROWSER_DOMAIN },
    snapshot: revision.snapshot,
    sections: sections(revision.data),
  };
}

export class NeutralProblemBrowserAdapter {
  domainCode = PROBLEM_BROWSER_DOMAIN;
  sourceType = PROBLEM_BROWSER_SOURCE;
  revisionResourceType = PROBLEM_BROWSER_REVISION;

  visibilityPredicate(actor, organizationId) {
    return Prisma.sql`EXISTS (SELECT 1 FROM problem_browser_test.sources source WHERE source.id = p.source_id
      AND source.problem_id = p.id AND source.organization_id = ${organizationId}::uuid AND source.owner_id = ${actor.id}::uuid AND source.active)`;
  }

  async authorizeRead(tx, context) {
    const [source] = await tx.$queryRaw(Prisma.sql`SELECT id FROM problem_browser_test.sources WHERE id = ${context.problem.sourceId}::uuid
      AND problem_id = ${context.problem.id}::uuid AND organization_id = ${context.problem.organizationId}::uuid
      AND owner_id = ${context.actor.id}::uuid AND active FOR SHARE`);
    if (!source) workflowError('PROBLEM_NOT_FOUND', 404);
  }

  async readSummaries(tx, actor, problems) {
    const rows = await tx.$queryRaw(Prisma.sql`SELECT * FROM problem_browser_test.sources WHERE id IN (${Prisma.join(problems.map((problem) => Prisma.sql`${problem.sourceId}::uuid`))})
      AND owner_id = ${actor.id}::uuid AND active FOR SHARE`);
    return new Map(problems.flatMap((problem) => {
      const source = rows.find((row) => row.id === problem.sourceId && row.problem_id === problem.id);
      return source ? [[problem.id, sourceSummary(source)]] : [];
    }));
  }

  async readWorkspace(tx, context, instance) {
    const source = await sourceFor(tx, context.problem);
    if (!source) return null;
    if (instance && context.problem.workflowInstanceId !== instance.id) {
      const report = reportFrom(await revisionFor(tx, source.id, instance.id), source);
      return report ? { domainVersion: report.instanceVersion, revisionId: report.revisionId, summary: report.summary, sections: report.sections } : null;
    }
    return { domainVersion: source.version, revisionId: source.current_revision_id, summary: sourceSummary(source), sections: sections(source.data) };
  }

  async readReport(tx, context, instance) {
    const source = await sourceFor(tx, context.problem);
    return source ? reportFrom(await revisionFor(tx, source.id, instance.id), source) : null;
  }

  async listEvidenceReferences(tx, context, revisionId) {
    const source = await sourceFor(tx, context.problem);
    if (!source) return [];
    const revision = revisionId
      ? (await tx.$queryRaw(Prisma.sql`SELECT evidence_ids FROM problem_browser_test.revisions WHERE id = ${revisionId}::uuid AND source_id = ${source.id}::uuid`))[0]
      : null;
    const ids = revisionId ? revision?.evidence_ids ?? [] : source.evidence_ids;
    return ids.map((fileId) => ({ fileId, resourceType: PROBLEM_BROWSER_RESOURCE, resourceId: source.id }));
  }

  async listRevisionIds(tx, context) {
    const rows = await tx.$queryRaw(Prisma.sql`SELECT id FROM problem_browser_test.revisions WHERE source_id = ${context.problem.sourceId}::uuid`);
    return rows.map((row) => row.id);
  }

  async describeActions(tx, context) {
    const source = await sourceFor(tx, context.problem);
    return [
      { actionKey: 'neutral.process', label: 'Record resolution', enabled: !!source && source.kind === 'BRIEF' && !source.processed, reasonCode: source?.processed ? 'NEUTRAL_ALREADY_PROCESSED' : null },
      { actionKey: 'neutral.approve', label: 'Approve resolution', enabled: !!source && source.kind === 'BRIEF' && source.processed && !source.approved, reasonCode: source?.approved ? 'NEUTRAL_ALREADY_APPROVED' : 'NEUTRAL_PROCESS_REQUIRED' },
      { actionKey: 'neutral.verify', label: 'Verify resolution', enabled: !!source && source.kind === 'BRIEF' && source.processed && source.approved && !source.verified, reasonCode: source?.verified ? 'NEUTRAL_ALREADY_VERIFIED' : 'NEUTRAL_APPROVAL_REQUIRED' },
      { actionKey: 'platform.upgrade', label: 'Upgrade to 8D', enabled: !!source && source.kind === 'BRIEF' && source.verified, reasonCode: source?.verified ? null : 'NEUTRAL_VERIFICATION_REQUIRED' },
    ];
  }

  async authorizeAndLock(tx, actor, problem) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM problem_browser_test.sources WHERE id = ${problem.sourceId}::uuid FOR UPDATE`);
    const source = await sourceFor(tx, problem);
    if (!source || !source.active || source.owner_id !== actor.id || source.organization_id !== problem.organizationId || source.problem_id !== problem.id) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
  }

  async prepare(tx, context) {
    const source = await sourceFor(tx, context.problem);
    if (!source || source.kind !== 'BRIEF' || !source.verified) workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    const data = { ...source.target_draft };
    const mappingSummary = ['title', 'description', 'resolution', 'approvalNote', 'verificationNote'].map((fieldId) => {
      if (Object.hasOwn(data, fieldId)) return { fieldId, outcome: 'PRESERVED' };
      if (!Object.hasOwn(source.data, fieldId)) return { fieldId, outcome: 'UNMAPPED' };
      data[fieldId] = source.data[fieldId];
      return { fieldId, outcome: 'COPIED' };
    });
    return { domainVersion: source.version, targetDefinitionId: source.target_definition_id, targetVersionId: source.target_version_id,
      targetProblemType: '8D', allowedNodeIds: [context.node.id], mappingVersion: 'neutral-browser-v1', beforeDomainRevisionId: source.current_revision_id,
      mappingSummary, evidenceFileIds: source.evidence_ids };
  }

  async apply(tx, context, plan, target) {
    const source = await sourceFor(tx, context.problem);
    if (!source || source.kind !== 'BRIEF' || !source.verified || source.version !== target.expectedDomainVersion) workflowError('CONCURRENCY_CONFLICT', 409);
    const data = { ...source.target_draft };
    for (const key of ['title', 'description', 'resolution', 'approvalNote', 'verificationNote']) if (!Object.hasOwn(data, key) && Object.hasOwn(source.data, key)) data[key] = source.data[key];
    data.kind = '8D';
    const revisionId = randomUUID();
    const recordedAt = new Date();
    await tx.$executeRaw(Prisma.sql`INSERT INTO problem_browser_test.revisions
      (id, source_id, instance_id, instance_version, domain_version, recorded_at, title, description, snapshot, data, evidence_ids)
      VALUES (${revisionId}::uuid, ${source.id}::uuid, ${target.instanceId}::uuid, 1, ${source.version + 1}, ${recordedAt}, ${source.title},
        ${String(data.resolution ?? source.description)}, ${JSON.stringify({ problemType: '8D', severity: 'LOW', status: 'IN_PROGRESS', responsibleParty: null, ownerId: source.owner_id, dueAt: null })}::jsonb,
        ${JSON.stringify(data)}::jsonb, ${source.evidence_ids}::uuid[])`);
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE problem_browser_test.sources SET kind = '8D', version = version + 1,
      current_revision_id = ${revisionId}::uuid, data = ${JSON.stringify(data)}::jsonb WHERE id = ${source.id}::uuid AND version = ${source.version}`);
    if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    await tx.auditEvent.create({ data: { organizationId: source.organization_id, actorUserId: context.actor.id, action: 'NEUTRAL_REVISION_RECORDED',
      resourceType: PROBLEM_BROWSER_REVISION, resourceId: revisionId, outcome: 'SUCCESS', traceId: randomUUID(), metadata: { resourceVersion: source.version + 1, reasonCode: 'BRIEF_TO_8D' } } });
    return { domainVersion: source.version + 1, beforeDomainRevisionId: plan.beforeDomainRevisionId, afterDomainRevisionId: revisionId,
      mappingSummary: plan.mappingSummary, evidenceFileIds: source.evidence_ids };
  }
}

export class NeutralProblemFileAdapter {
  resourceType = PROBLEM_BROWSER_RESOURCE;
  async authorizeAndLock(tx, actor, resource) {
    const [source] = await tx.$queryRaw(Prisma.sql`SELECT organization_id AS "organizationId", version FROM problem_browser_test.sources
      WHERE id = ${resource.resourceId}::uuid AND owner_id = ${actor.id}::uuid AND active FOR SHARE`);
    if (!source) workflowError('FILE_RESOURCE_DENIED', 403);
    return source;
  }
}

class NeutralProblemActionService {
  constructor(prisma, runtime, audit, files) {
    this.prisma = prisma;
    this.runtime = runtime;
    this.audit = audit;
    this.files = files;
  }

  async process(actor, organizationId, problemId, input, key, traceId) {
    input = plainToInstance(NeutralProblemProcessRequestDto, input);
    if (validateSync(input, { whitelist: true, forbidNonWhitelisted: true }).length || !input.resolution.trim()) throw new BadRequestException();
    return this.submit(actor, organizationId, problemId, input, key, traceId, {
      runtimeAction: 'SUBMIT', domainAction: 'neutral.process', noteKey: 'resolution', reasonCode: 'NEUTRAL_PROCESSED',
    });
  }

  async approve(actor, organizationId, problemId, input, key, traceId) {
    return this.review(actor, organizationId, problemId, input, key, traceId, {
      runtimeAction: 'APPROVE', domainAction: 'neutral.approve', noteKey: 'approvalNote', reasonCode: 'NEUTRAL_APPROVED',
    });
  }

  async verify(actor, organizationId, problemId, input, key, traceId) {
    return this.review(actor, organizationId, problemId, input, key, traceId, {
      runtimeAction: 'VERIFY', domainAction: 'neutral.verify', noteKey: 'verificationNote', reasonCode: 'NEUTRAL_VERIFIED',
    });
  }

  async review(actor, organizationId, problemId, input, key, traceId, action) {
    input = plainToInstance(NeutralProblemReviewRequestDto, input);
    if (validateSync(input, { whitelist: true, forbidNonWhitelisted: true }).length || !input.note.trim()) throw new BadRequestException();
    return this.submit(actor, organizationId, problemId, input, key, traceId, action);
  }

  async submit(actor, organizationId, problemId, input, key, traceId, action) {
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(key ?? '')) workflowError('IDEMPOTENCY_KEY_REQUIRED', 400);
    return this.prisma.$transaction(async (tx) => {
      let revisionId = null;
      let lockedSource = null;
      const result = await this.runtime.submitAction({ organizationId, actor, problemIndexId: problemId, workflowVersionId: input.workflowVersionId,
        expectedProblemVersion: input.expectedProblemVersion, idempotencyKey: key, traceId, instanceId: input.instanceId,
        currentNodeId: input.currentNodeId, expectedVersion: input.expectedInstanceVersion, action: action.runtimeAction,
        commandPayload: { schemaVersion: 1, domainAction: action.domainAction, expectedDomainVersion: input.expectedDomainVersion,
          ...(action.noteKey === 'resolution' ? { resolution: input.resolution.trim(), evidenceFileIds: [...input.evidenceFileIds].sort() } : { note: input.note.trim() }) } }, tx, async (transaction) => {
          const source = lockedSource;
          if (!source) throw new Error('NEUTRAL_SOURCE_LOCK_REQUIRED');
          revisionId = randomUUID();
          const note = action.noteKey === 'resolution' ? input.resolution.trim() : input.note.trim();
          const data = { ...source.data, [action.noteKey]: note, kind: 'BRIEF' };
          const evidenceFileIds = action.noteKey === 'resolution' ? [...input.evidenceFileIds].sort() : source.evidence_ids;
          const domainVersion = source.version + 1;
          const snapshotStatus = action.noteKey === 'verificationNote' ? 'RESOLVED' : 'PENDING';
          await transaction.$executeRaw(Prisma.sql`INSERT INTO problem_browser_test.revisions
            (id, source_id, instance_id, instance_version, domain_version, recorded_at, title, description, snapshot, data, evidence_ids)
            VALUES (${revisionId}::uuid, ${source.id}::uuid, ${input.instanceId}::uuid, ${input.expectedInstanceVersion + 1}, ${domainVersion}, ${new Date()},
              ${source.title}, ${String(data.resolution ?? source.description)}, ${JSON.stringify({ problemType: 'BRIEF', severity: 'LOW', status: snapshotStatus, responsibleParty: null, ownerId: source.owner_id, dueAt: null })}::jsonb,
              ${JSON.stringify(data)}::jsonb, ${evidenceFileIds}::uuid[])`);
          const changed = action.noteKey === 'resolution'
            ? await transaction.$executeRaw(Prisma.sql`UPDATE problem_browser_test.sources SET processed = true, version = version + 1,
                current_revision_id = ${revisionId}::uuid, data = ${JSON.stringify(data)}::jsonb, evidence_ids = ${evidenceFileIds}::uuid[]
                WHERE id = ${source.id}::uuid AND version = ${input.expectedDomainVersion} AND processed = false`)
            : action.noteKey === 'approvalNote'
              ? await transaction.$executeRaw(Prisma.sql`UPDATE problem_browser_test.sources SET approved = true, version = version + 1,
                  current_revision_id = ${revisionId}::uuid, data = ${JSON.stringify(data)}::jsonb
                  WHERE id = ${source.id}::uuid AND version = ${input.expectedDomainVersion} AND processed = true AND approved = false`)
              : await transaction.$executeRaw(Prisma.sql`UPDATE problem_browser_test.sources SET verified = true, version = version + 1,
                  current_revision_id = ${revisionId}::uuid, data = ${JSON.stringify(data)}::jsonb
                  WHERE id = ${source.id}::uuid AND version = ${input.expectedDomainVersion} AND processed = true AND approved = true AND verified = false`);
          if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
          await this.audit.record({ organizationId, actorUserId: actor.id, action: 'NEUTRAL_REVISION_RECORDED', resourceType: PROBLEM_BROWSER_REVISION,
            resourceId: revisionId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: domainVersion, reasonCode: action.reasonCode } }, transaction);
        }, async (transaction, context) => {
          const [source] = await transaction.$queryRaw(Prisma.sql`SELECT * FROM problem_browser_test.sources WHERE problem_id = ${problemId}::uuid FOR UPDATE`);
          if (!source || !source.active || source.organization_id !== organizationId || source.owner_id !== actor.id) workflowError('PROBLEM_NOT_FOUND', 404);
          const stageAllowed = action.noteKey === 'resolution' ? !source.processed
            : action.noteKey === 'approvalNote' ? source.processed && !source.approved
              : source.processed && source.approved && !source.verified;
          if (!context.replay && (source.version !== input.expectedDomainVersion || source.kind !== 'BRIEF' || !stageAllowed)) workflowError('CONCURRENCY_CONFLICT', 409);
          const resource = { resourceType: PROBLEM_BROWSER_RESOURCE, resourceId: source.id };
          const evidenceFileIds = action.noteKey === 'resolution' ? [...input.evidenceFileIds].sort() : source.evidence_ids;
          if (context.replay) await this.files.readEvidence(transaction, actor, [{ resource, fileIds: evidenceFileIds }]);
          else await this.files.assertAttachable(transaction, actor, resource, evidenceFileIds);
          lockedSource = source;
        });
      if (!lockedSource) throw new Error('NEUTRAL_SOURCE_LOCK_REQUIRED');
      const [revision] = await tx.$queryRaw(Prisma.sql`SELECT id, domain_version FROM problem_browser_test.revisions
        WHERE source_id = ${lockedSource.id}::uuid AND instance_id = ${input.instanceId}::uuid
          AND instance_version = ${input.expectedInstanceVersion + 1}`);
      if (!revision) throw new Error('NEUTRAL_REVISION_RECEIPT_MISSING');
      return { problemId, instanceId: result.instanceId, workflowVersionId: result.workflowVersionId, currentNodeId: result.currentNodeId,
        problemVersion: result.problemVersion, instanceVersion: result.version, domainVersion: revision.domain_version, revisionId: revision.id };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
Inject(PrismaService)(NeutralProblemActionService, undefined, 0);
Inject(WorkflowRuntimeService)(NeutralProblemActionService, undefined, 1);
Inject(AuditLogService)(NeutralProblemActionService, undefined, 2);
Inject(FileLifecycleService)(NeutralProblemActionService, undefined, 3);
Injectable()(NeutralProblemActionService);

export class NeutralProblemProcessController {
  constructor(processor) { this.processor = processor; }
  actor(request) {
    const session = request[AUTHENTICATED_SESSION];
    return { ...session.user, sessionId: session.id };
  }
  process(id, _query, body, key, request) {
    return this.processor.process(this.actor(request), request.authorizedOrganizationId, id, body, key, requestTraceId(request));
  }
  approve(id, _query, body, key, request) {
    return this.processor.approve(this.actor(request), request.authorizedOrganizationId, id, body, key, requestTraceId(request));
  }
  verify(id, _query, body, key, request) {
    return this.processor.verify(this.actor(request), request.authorizedOrganizationId, id, body, key, requestTraceId(request));
  }
}
Inject(NeutralProblemActionService)(NeutralProblemProcessController, undefined, 0);
Controller('api/v1/test/neutral-problems')(NeutralProblemProcessController);
RequireAccess({ featurePermission: 'workflow:act', organizationScope: { source: 'query', field: 'organizationId', optional: true } })(NeutralProblemProcessController);
ApiCookieAuth('qms_session')(NeutralProblemProcessController);
ApiResponse({ status: 'default', type: ErrorResponse })(NeutralProblemProcessController);
for (const [method, requestType] of [['process', NeutralProblemProcessRequestDto], ['approve', NeutralProblemReviewRequestDto], ['verify', NeutralProblemReviewRequestDto]]) {
  const descriptor = Object.getOwnPropertyDescriptor(NeutralProblemProcessController.prototype, method);
  Post(`:id/${method}`)(NeutralProblemProcessController.prototype, method, descriptor);
  ApiHeader({ name: 'Idempotency-Key', required: true })(NeutralProblemProcessController.prototype, method, descriptor);
  ApiHeader({ name: 'x-csrf-token', required: true })(NeutralProblemProcessController.prototype, method, descriptor);
  ApiParam({ name: 'id', type: String, format: 'uuid' })(NeutralProblemProcessController.prototype, method, descriptor);
  ApiQuery({ name: 'organizationId', required: false, type: String, format: 'uuid' })(NeutralProblemProcessController.prototype, method, descriptor);
  ApiBody({ type: requestType })(NeutralProblemProcessController.prototype, method, descriptor);
  ApiResponse({ status: 201, type: NeutralProblemProcessResponseDto })(NeutralProblemProcessController.prototype, method, descriptor);
  Param('id', ParseUUIDPipe)(NeutralProblemProcessController.prototype, method, 0);
  Query()(NeutralProblemProcessController.prototype, method, 1);
  Body()(NeutralProblemProcessController.prototype, method, 2);
  Headers('idempotency-key')(NeutralProblemProcessController.prototype, method, 3);
  Req()(NeutralProblemProcessController.prototype, method, 4);
}

class NeutralProblemProjectionService {
  constructor(prisma) { this.prisma = prisma; }
  async status(actor, organizationId, problemId) {
    return this.prisma.$transaction(async (tx) => {
      const [scope] = await tx.$queryRaw(Prisma.sql`SELECT problem.workflow_instance_id AS "instanceId"
        FROM problem_indexes problem JOIN problem_browser_test.sources source
          ON source.problem_id = problem.id AND source.id = problem.source_id AND source.organization_id = problem.organization_id
        WHERE problem.id = ${problemId}::uuid AND problem.organization_id = ${organizationId}::uuid
          AND problem.domain_code = ${PROBLEM_BROWSER_DOMAIN} AND problem.source_type = ${PROBLEM_BROWSER_SOURCE}
          AND source.owner_id = ${actor.id}::uuid AND source.active FOR SHARE OF source`);
      if (!scope?.instanceId) workflowError('PROBLEM_NOT_FOUND', 404);
      const [event] = await tx.$queryRaw(Prisma.sql`SELECT id, status FROM outbox_events
        WHERE event_key = ${`workflow:${scope.instanceId}:1`} AND aggregate_type = 'WorkflowInstance'
          AND aggregate_id = ${scope.instanceId} AND event_type = 'WORKFLOW_STARTED'`);
      if (!event) workflowError('PROBLEM_NOT_FOUND', 404);
      const [tasks] = await tx.$queryRaw(Prisma.sql`SELECT count(*) AS count FROM workflow_tasks WHERE workflow_instance_id = ${scope.instanceId}::uuid`);
      const [notifications] = await tx.$queryRaw(Prisma.sql`SELECT count(*) AS count FROM notifications notification
        JOIN workflow_tasks task ON task.id = notification.workflow_task_id
        WHERE task.workflow_instance_id = ${scope.instanceId}::uuid`);
      return { outboxEventId: event.id, outboxStatus: event.status, taskCount: Number(tasks.count), notificationCount: Number(notifications.count) };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
Inject(PrismaService)(NeutralProblemProjectionService, undefined, 0);
Injectable()(NeutralProblemProjectionService);

export class NeutralProblemProjectionController {
  constructor(projection) { this.projection = projection; }
  status(id, _query, request) {
    const session = request[AUTHENTICATED_SESSION];
    return this.projection.status({ ...session.user, sessionId: session.id }, request.authorizedOrganizationId, id);
  }
}
Inject(NeutralProblemProjectionService)(NeutralProblemProjectionController, undefined, 0);
Controller('api/v1/test/neutral-problems')(NeutralProblemProjectionController);
RequireAccess({ featurePermission: 'outbox:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })(NeutralProblemProjectionController);
ApiCookieAuth('qms_session')(NeutralProblemProjectionController);
ApiResponse({ status: 'default', type: ErrorResponse })(NeutralProblemProjectionController);
const statusDescriptor = Object.getOwnPropertyDescriptor(NeutralProblemProjectionController.prototype, 'status');
Get(':id/projection-status')(NeutralProblemProjectionController.prototype, 'status', statusDescriptor);
ApiParam({ name: 'id', type: String, format: 'uuid' })(NeutralProblemProjectionController.prototype, 'status', statusDescriptor);
ApiQuery({ name: 'organizationId', required: false, type: String, format: 'uuid' })(NeutralProblemProjectionController.prototype, 'status', statusDescriptor);
ApiResponse({ status: 200, type: NeutralProblemProjectionStatusDto })(NeutralProblemProjectionController.prototype, 'status', statusDescriptor);
Param('id', ParseUUIDPipe)(NeutralProblemProjectionController.prototype, 'status', 0);
Query()(NeutralProblemProjectionController.prototype, 'status', 1);
Req()(NeutralProblemProjectionController.prototype, 'status', 2);

export class ProblemBrowserTestModule {}
Module({ imports: [AppModule, DatabaseModule, AuditLogModule, WorkflowModule, FileManagementModule],
  controllers: [NeutralProblemProcessController, NeutralProblemProjectionController], providers: [NeutralProblemActionService, NeutralProblemProjectionService] })(ProblemBrowserTestModule);

export async function prepareProblemBrowserSchema(prisma) {
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS problem_browser_test');
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS problem_browser_test.sources (
    id uuid PRIMARY KEY, organization_id uuid NOT NULL, problem_id uuid NOT NULL UNIQUE, owner_id uuid NOT NULL, active boolean NOT NULL DEFAULT true,
    title text NOT NULL, description text NOT NULL, kind text NOT NULL, version integer NOT NULL,
    processed boolean NOT NULL DEFAULT false, approved boolean NOT NULL DEFAULT false, verified boolean NOT NULL DEFAULT false,
    target_definition_id uuid NOT NULL, target_version_id uuid NOT NULL, current_revision_id uuid,
    data jsonb NOT NULL, target_draft jsonb NOT NULL, evidence_ids uuid[] NOT NULL DEFAULT '{}')`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS problem_browser_test.revisions (
    id uuid PRIMARY KEY, source_id uuid NOT NULL, instance_id uuid NOT NULL, instance_version integer NOT NULL, domain_version integer NOT NULL,
    recorded_at timestamptz NOT NULL, title text NOT NULL, description text NOT NULL, snapshot jsonb NOT NULL, data jsonb NOT NULL,
    evidence_ids uuid[] NOT NULL DEFAULT '{}', UNIQUE(instance_id, instance_version))`);
  await prisma.$executeRawUnsafe("CREATE OR REPLACE FUNCTION problem_browser_test.reject_revision_changes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'NEUTRAL_REVISION_IMMUTABLE'; END $$");
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS immutable_revision ON problem_browser_test.revisions');
  await prisma.$executeRawUnsafe('CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON problem_browser_test.revisions FOR EACH ROW EXECUTE FUNCTION problem_browser_test.reject_revision_changes()');
}
