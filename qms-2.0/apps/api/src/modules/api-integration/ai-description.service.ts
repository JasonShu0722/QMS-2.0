import { HttpException, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { validateAiDescription, type AiDescriptionField, type AiDescriptionOutput } from '../../common/ai-description.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { aiGenerationDataTooLarge } from '../ai-configuration/ai-connection.policy.js';
import { AiConnectionService } from '../ai-configuration/ai-connection.service.js';
import { AiApplicationService, type AiApplicationBinding } from '../ai-configuration/ai-application.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ProcessDefectIngestionAdapter } from '../process-quality/process-defect-ingestion.adapter.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import { assertIntegrationOrganization, integrationScope } from './integration-types.js';
import { ingestionError, type IngestionRule } from './ingestion.policy.js';
import type { AiDescriptionTaskActionDto, AiDescriptionTaskDto, AiDescriptionTaskListDto } from './ai-description.dto.js';

type TaskRow = { id: string; organization_id: string; defect_id: string; rule_id: string; rule_version: number; connection_id: string; connection_version: number;
  input_fields: AiDescriptionField[]; prompt: string; model: string; output_configuration: AiDescriptionOutput; actor_snapshot: AdminActor; expected_description: string; input_revision: number;
  status: string; result: string | null; error_code: string | null; attempts: number; version: number; updated_at: Date; claim_token: string | null; application_id: string | null; application_version: number | null; manual_generation: boolean };
type CurrentRule = { version: number; configuration: IngestionRule };
type Generation = { connectionId: string; model: string; prompt: string; output: AiDescriptionOutput; connectionVersion: number };
type DescriptionInput = { ruleId: string; ruleVersion: number; rule: IngestionRule; defectId: string; fields: AiDescriptionField[]; direct: string | null; invalidDirect?: boolean };
const taskDto = (row: TaskRow): AiDescriptionTaskDto => ({ id: row.id, defectId: row.defect_id, ruleId: row.rule_id, ruleVersion: row.rule_version,
  connectionVersion: row.connection_version, status: row.status, attempts: row.attempts, version: row.version, result: row.result, errorCode: row.error_code, updatedAt: row.updated_at.toISOString() });
const inputIdentity = (fields: AiDescriptionField[]) => JSON.stringify(fields.map(field => [field.path, field.label, field.variable ?? null, field.value]));
const hasDescriptionInput = (fields: AiDescriptionField[]) => fields.some(field => String(field.value ?? '').trim());
const emptyInputCode = 'AI_DESCRIPTION_INPUT_EMPTY';
const invalidInputCode = 'AI_DESCRIPTION_INPUT_INVALID';
const oversizedInputCode = 'AI_DESCRIPTION_INPUT_TOO_LARGE';
const terminalInputCodes: readonly string[] = [emptyInputCode, invalidInputCode, oversizedInputCode];
const taskApplication = (task: TaskRow, rule: CurrentRule | undefined) => task.application_id
  ? { applicationId: task.application_id, publishedVersion: task.application_version! }
  : rule?.version === task.rule_version ? rule.configuration.aiApplication : undefined;
const canRun = (task: TaskRow, rule: CurrentRule | undefined) => rule && (task.manual_generation && task.application_id
  ? !!rule.configuration.aiDescription : rule.version === task.rule_version);
export const failureCode = (error: unknown): string => {
  const value = error instanceof HttpException ? (error.getResponse() as { code?: unknown }).code : undefined;
  return typeof value === 'string' && [...terminalInputCodes,'AI_APPLICATION_INVALID','AI_APPLICATION_NOT_FOUND','AI_APPLICATION_UNAVAILABLE','AI_APPLICATION_VERSION_CONFLICT','AI_CONNECTION_INVALID','AI_CONNECTION_NOT_FOUND','AI_CONNECTION_UNAVAILABLE','AI_CONNECTION_VERSION_CONFLICT','AI_CONNECTION_TARGET_DENIED','AI_CONNECTION_REQUEST_FAILED','AI_CONNECTION_TIMEOUT','AI_CONNECTION_RESPONSE_INVALID','AI_CONNECTION_RESPONSE_TOO_LARGE','ORGANIZATION_DISABLED','AUTH_SESSION_REQUIRED','FEATURE_PERMISSION_DENIED'].includes(value) ? value : 'AI_CONNECTION_REQUEST_FAILED';
};

function rejectedDescriptionInput(input: Pick<DescriptionInput, 'invalidDirect' | 'direct' | 'fields'>, bindings?: AiApplicationBinding['inputFields']) {
  if (input.invalidDirect || (input.direct?.length ?? 0) > 10000) return invalidInputCode;
  if (Buffer.byteLength(JSON.stringify(input.fields)) > 32768) return oversizedInputCode;
  if (input.fields.some(field => typeof field.value === 'string' && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(field.value))) return invalidInputCode;
  if (hasDescriptionInput(input.fields) && aiGenerationDataTooLarge(providerSelectedData(input.fields, bindings))) return oversizedInputCode;
  return null;
}

function providerSelectedData(fields: AiDescriptionField[], bindings: AiApplicationBinding['inputFields'] = []) {
  if (!hasDescriptionInput(fields)) ingestionError(emptyInputCode);
  const selected = fields.map(field => {
    const value = String(field.value ?? '');
    return { label: field.label || field.path, variable: field.variable, value: value.trim() ? value : '' };
  });
  const provided = new Set(fields.map(field => field.variable));
  for (const binding of bindings) {
    if (!provided.has(binding.variable)) selected.push({ label: binding.label || binding.path, variable: binding.variable, value: '' });
  }
  return selected;
}

@Injectable()
export class AiDescriptionService {
  private readonly applications: AiApplicationService;
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly connections: AiConnectionService,
    private readonly defects: ProcessDefectIngestionAdapter, private readonly audit: AuditLogService, @Optional() applications?: AiApplicationService) {
    this.applications = applications ?? new AiApplicationService(prisma, mutations, connections, audit);
  }

  async resolveApplication(tx: AdminTransaction, actor: AdminActor, binding: AiApplicationBinding) {
    try { return await this.applications.resolveBinding(tx, actor, binding); }
    catch (error) {
      if (error instanceof HttpException && (error.getResponse() as { code?: string }).code === 'AI_APPLICATION_INVALID') ingestionError('INGESTION_RULE_INVALID');
      throw error;
    }
  }
  async importApplication(tx: AdminTransaction, actor: AdminActor, name: string, ai: NonNullable<IngestionRule['aiDescription']>) {
    try { return await this.applications.importLegacy(tx, actor, name, ai); }
    catch (error) {
      if (error instanceof HttpException && (error.getResponse() as { code?: string }).code === 'AI_APPLICATION_INVALID') ingestionError('INGESTION_RULE_INVALID');
      throw error;
    }
  }
  latestApplicationVersion(tx: AdminTransaction, actor: AdminActor, id: string) { return this.applications.latestPublishedVersion(tx, actor, id); }

  private async access(tx: AdminTransaction, actor: AdminActor, read = false) {
    const organizationId = integrationScope(actor);
    await assertIntegrationOrganization(tx, organizationId);
    await assertAdminAccess(tx, actor, organizationId, [read ? 'ingestion:read' : 'ingestion:run', read ? 'process-quality:defects:read' : 'process-quality:defects:write']);
    return organizationId;
  }

  async validateConnection(tx: AdminTransaction, actor: AdminActor, connectionId: string) {
    const organizationId = integrationScope(actor);
    return this.connections.resolve(organizationId, connectionId, tx);
  }

  async difference(tx: AdminTransaction, actor: AdminActor, input: DescriptionInput): Promise<{ field: string; before: string | null; after: string } | null> {
    const ai = input.rule.aiDescription;
    if (!ai) return null;
    const state = await this.defects.aiDescriptionState(tx, actor, input.defectId);
    const existing = await this.ingestionBaseline(tx, integrationScope(actor), input.defectId, state);
    const rejected = rejectedDescriptionInput(input, ai.inputFields);
    if (rejected) {
      if (existing?.error_code === rejected && existing.rule_id === input.ruleId && existing.rule_version === input.ruleVersion) return null;
      return { field: 'aiDescription', before: null, after: JSON.stringify({ errorCode: rejected }) };
    }
    const direct = input.direct ?? state.descriptionDirect ?? state.description;
    let connectionVersion = ai.connectionVersion ?? 1;
    if (hasDescriptionInput(input.fields)) {
      try { connectionVersion = (await this.connections.resolve(integrationScope(actor), ai.connectionId, tx)).version; } catch {}
    }
    if (existing && existing.rule_id === input.ruleId && existing.rule_version === input.ruleVersion && existing.connection_version === connectionVersion
      && existing.error_code !== invalidInputCode && existing.error_code !== oversizedInputCode
      && inputIdentity(existing.input_fields) === inputIdentity(input.fields) && existing.expected_description === direct) return null;
    const before = existing ? JSON.stringify({ ruleId: existing.rule_id, ruleVersion: existing.rule_version, connectionId: existing.connection_id,
      connectionVersion: existing.connection_version, model: existing.model, prompt: existing.prompt, fields: existing.input_fields, output: existing.output_configuration, direct: existing.expected_description }) : null;
    return { field: 'aiDescription', before, after: JSON.stringify({ ruleId: input.ruleId, ruleVersion: input.ruleVersion, connectionId: ai.connectionId,
      connectionVersion, model: ai.model, prompt: ai.prompt, fields: input.fields, output: ai.output, direct }) };
  }

  async enqueue(tx: AdminTransaction, actor: AdminActor, input: DescriptionInput) {
    if (!input.rule.aiDescription) return;
    const organizationId = integrationScope(actor), ai = input.rule.aiDescription;
    const rejected = rejectedDescriptionInput(input, ai.inputFields);
    const fields = rejected ? [] : input.fields;
    let application = input.rule.aiApplication;
    if (!application) {
      const [currentRule] = await tx.$queryRaw<{ configuration: IngestionRule }[]>`SELECT configuration FROM integration_ingestion_rules WHERE organization_id=${organizationId}::uuid AND id=${input.ruleId}::uuid AND version=${input.ruleVersion}`;
      application = currentRule?.configuration.aiApplication;
    }
    const terminalInputCode = rejected ?? (hasDescriptionInput(fields) ? null : emptyInputCode);
    let connectionVersion = ai.connectionVersion ?? 1, unavailable: string | null = terminalInputCode;
    if (!terminalInputCode) {
      try {
        if (application) await this.applications.assertAvailable(tx, organizationId, application.applicationId, application.publishedVersion);
        connectionVersion = (await this.connections.resolve(organizationId, ai.connectionId, tx)).version;
      } catch (error) { unavailable = failureCode(error); }
    }
    const selectedIdentity = inputIdentity(fields);
    const identity = `${organizationId}:${input.defectId}:ai-description`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity},0))::text`;
    const state = await this.defects.aiDescriptionState(tx, actor, input.defectId);
    const direct = (rejected ? null : input.direct) ?? state.descriptionDirect ?? state.description;
    const expectedDescription = rejected ? '' : direct;
    const existing = await this.ingestionBaseline(tx, organizationId, input.defectId, state);
    if (existing && existing.rule_id === input.ruleId && existing.rule_version === input.ruleVersion && existing.connection_version === connectionVersion
      && (terminalInputCodes.includes(existing.error_code ?? '') ? existing.error_code : null) === terminalInputCode
      && inputIdentity(existing.input_fields) === selectedIdentity && existing.expected_description === expectedDescription) return state.version;
    const prepared = await this.insertTask(tx, actor, input, { ...ai, connectionVersion }, fields, direct, expectedDescription, application, unavailable, false);
    return prepared.version;
  }

  private async ingestionBaseline(tx: AdminTransaction, organizationId: string, defectId: string,
    state: { descriptionTaskId: string | null; descriptionInputVersion: number }) {
    const [current] = await tx.$queryRaw<TaskRow[]>`SELECT * FROM integration_ai_description_tasks WHERE organization_id=${organizationId}::uuid AND defect_id=${defectId}::uuid AND id=${state.descriptionTaskId}::uuid AND input_revision=${state.descriptionInputVersion}`;
    return current?.manual_generation ? this.previousIngestionTask(tx, current) : current;
  }

  private async previousIngestionTask(tx: AdminTransaction, task: TaskRow) {
    const [baseline] = await tx.$queryRaw<TaskRow[]>`SELECT * FROM integration_ai_description_tasks WHERE organization_id=${task.organization_id}::uuid AND defect_id=${task.defect_id}::uuid AND input_revision<${task.input_revision} AND NOT manual_generation ORDER BY input_revision DESC LIMIT 1`;
    return baseline;
  }

  private async insertTask(tx: AdminTransaction, actor: AdminActor, input: Pick<DescriptionInput, 'ruleId' | 'ruleVersion' | 'defectId'>,
    generation: Generation, fields: AiDescriptionField[], direct: string, expectedDescription: string,
    application: Pick<AiApplicationBinding, 'applicationId' | 'publishedVersion'> | undefined, unavailable: string | null, manual: boolean) {
    const organizationId = integrationScope(actor);
    const id = randomUUID();
    const prepared = await this.defects.prepareAiDescription(tx, actor, input.defectId, id, fields, direct, manual);
    if (prepared.version !== prepared.previousVersion) await this.syncSourceVersion(tx, { organization_id: organizationId, defect_id: input.defectId }, prepared.previousVersion, prepared.version);
    const digest = createHash('sha256').update(inputIdentity(fields)).digest('hex');
    const savedActor = { id: actor.id, organizationId: actor.organizationId, accountType: actor.accountType, sessionId: '', scopeOrganizationId: organizationId };
    await tx.$executeRaw`INSERT INTO integration_ai_description_tasks(id,organization_id,defect_id,rule_id,rule_version,connection_id,connection_version,input_digest,input_fields,prompt,model,output_configuration,actor_snapshot,expected_description,input_revision,status,error_code,application_id,application_version,manual_generation)
      VALUES(${id}::uuid,${organizationId}::uuid,${input.defectId}::uuid,${input.ruleId}::uuid,${input.ruleVersion},${generation.connectionId}::uuid,${generation.connectionVersion},${digest},${JSON.stringify(fields)}::jsonb,${generation.prompt},${generation.model},${JSON.stringify(generation.output)}::jsonb,${JSON.stringify(savedActor)}::jsonb,${expectedDescription},${prepared.revision},${unavailable ? 'FAILED' : 'PENDING'},${unavailable},${application?.applicationId ?? null}::uuid,${application?.publishedVersion ?? null},${manual})`;
    if (unavailable) await this.defects.markAiDescription(tx, actor, input.defectId, prepared.revision, 'FAILED');
    return { id, version: prepared.version };
  }

  async preview(actor: AdminActor, input: { connectionId: string; model: string; prompt: string; fields: AiDescriptionField[]; inputFields?: AiApplicationBinding['inputFields']; output: AiDescriptionOutput; application?: AiApplicationBinding; invalidDirect?: boolean }): Promise<string> {
    const rejected = rejectedDescriptionInput({ ...input, direct: null }, input.inputFields);
    if (rejected) ingestionError(rejected);
    let applicationAvailability: number | undefined;
    const connection = await this.prisma.$transaction(async tx => {
      await this.access(tx, actor);
      if (input.application) applicationAvailability = await this.applications.assertAvailable(tx, integrationScope(actor), input.application.applicationId, input.application.publishedVersion);
      return this.validateConnection(tx, actor, input.connectionId);
    });
    const result = await this.connections.generate(integrationScope(actor), input.connectionId, connection.version, { prompt: input.prompt, model: input.model, output: input.output,
      selectedData: providerSelectedData(input.fields, input.inputFields) });
    await this.prisma.$transaction(async tx => {
      await this.access(tx, actor);
      if (input.application) await this.applications.assertAvailable(tx, integrationScope(actor), input.application.applicationId, input.application.publishedVersion, applicationAvailability);
    });
    return validateAiDescription(result.text);
  }

  async list(actor: AdminActor, defectId: string): Promise<AiDescriptionTaskListDto> {
    return this.prisma.$transaction(async tx => {
      const organizationId = await this.access(tx, actor, true);
      const rows = await tx.$queryRaw<TaskRow[]>`SELECT * FROM integration_ai_description_tasks WHERE organization_id=${organizationId}::uuid AND defect_id=${defectId}::uuid ORDER BY created_at DESC,id LIMIT 20`;
      return { items: rows.map(taskDto) };
    });
  }

  private async task(tx: AdminTransaction, organizationId: string, id: string) {
    const [row] = await tx.$queryRaw<TaskRow[]>`SELECT * FROM integration_ai_description_tasks WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid FOR UPDATE`;
    if (!row) ingestionError('INGESTION_NOT_FOUND', 404);
    return row;
  }

  async action(actor: AdminActor, id: string, input: AiDescriptionTaskActionDto, operation: boolean | 'regenerate', traceId: string, key?: string): Promise<AiDescriptionTaskDto> {
    const organizationId = integrationScope(actor);
    const adopt = operation === true, regenerate = operation === 'regenerate';
    const action = adopt ? 'AI_DESCRIPTION_ADOPTED' : regenerate ? 'AI_DESCRIPTION_REGENERATED' : 'AI_DESCRIPTION_RETRIED';
    return this.mutations.run({ actor, organizationId, key, traceId, action, payload: { id, ...input }, permission: ['ingestion:run','process-quality:defects:write'], isolationLevel: 'ReadCommitted' }, async tx => {
      const task = await this.task(tx, organizationId, id);
      if (task.version !== input.expectedVersion) ingestionError('CONCURRENCY_CONFLICT', 409);
      const state = await this.defects.aiDescriptionState(tx, actor, task.defect_id, true);
      const rule = await this.currentRule(tx, task);
      if (state.archivedAt || state.descriptionInputVersion !== task.input_revision || state.descriptionTaskId !== id || !rule) ingestionError('CONCURRENCY_CONFLICT', 409);
      let responseId = id;
      if (adopt) {
        if (!canRun(task, rule) || task.status !== 'SUGGESTED' || !task.result) ingestionError('CONCURRENCY_CONFLICT', 409);
        const application = taskApplication(task, rule);
        if (application) await this.applications.assertAvailable(tx, organizationId, application.applicationId, application.publishedVersion);
        const applied = await this.defects.applyAiDescription(tx, actor, task.defect_id, task.input_revision, task.expected_description, task.result, traceId, 'adopt');
        if (applied !== 'APPLIED') ingestionError('CONCURRENCY_CONFLICT', 409);
        const appliedState = await this.defects.aiDescriptionState(tx, actor, task.defect_id);
        await this.syncSourceVersion(tx, task, appliedState.version - 1, appliedState.version);
        await tx.$executeRaw`UPDATE integration_ai_description_tasks SET status='APPLIED',version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`;
      } else {
        if (!(regenerate ? ['APPLIED', 'SUGGESTED'].includes(task.status) : task.status === 'FAILED')) ingestionError('CONCURRENCY_CONFLICT', 409);
        if (task.error_code && terminalInputCodes.includes(task.error_code)) ingestionError(task.error_code, 409);
        if (!rule.configuration.aiDescription) ingestionError('AI_APPLICATION_UNAVAILABLE', 409);
        const application = taskApplication(task, rule) ?? await this.historicalApplication(tx, task);
        if (!application && (regenerate || rule.version !== task.rule_version)) ingestionError('AI_APPLICATION_NOT_FOUND', 404);
        responseId = await this.refresh(tx, actor, task, application, state.descriptionDirect ?? task.expected_description, state.description);
      }
      const response = await this.task(tx, organizationId, responseId);
      await this.audit.record({ organizationId, actorUserId: actor.id, action, resourceType: 'AiDescriptionTask', resourceId: responseId, outcome: 'SUCCESS', traceId, metadata: { ruleVersion: task.rule_version, resourceVersion: response.version } }, tx);
      return taskDto(response);
    }, async tx => {
      await assertIntegrationOrganization(tx, organizationId, true);
      if (adopt) await this.defects.assertAiDescriptionRegistrationAccess(tx, actor);
    });
  }

  private async historicalApplication(tx: AdminTransaction, task: TaskRow) {
    const matches = await tx.$queryRaw<Pick<AiApplicationBinding, 'applicationId' | 'publishedVersion'>[]>`
      SELECT DISTINCT rule_snapshot->'aiApplication'->>'applicationId' AS "applicationId",
        (rule_snapshot->'aiApplication'->>'publishedVersion')::int AS "publishedVersion"
      FROM integration_ingestion_jobs WHERE organization_id=${task.organization_id}::uuid AND rule_id=${task.rule_id}::uuid
        AND rule_version=${task.rule_version} AND rule_snapshot->'aiApplication'->>'applicationId' IS NOT NULL
      LIMIT 2`;
    return matches.length === 1 ? matches[0] : undefined;
  }

  private async refresh(tx: AdminTransaction, actor: AdminActor, task: TaskRow, application: ReturnType<typeof taskApplication>, direct: string, currentText: string) {
    const organizationId = integrationScope(actor);
    const latest = application && await this.applications.resolveLatestForTask(tx, organizationId, application.applicationId);
    const baseline = latest && task.manual_generation ? await this.previousIngestionTask(tx, task) : undefined;
    const originalFields = baseline?.rule_id === task.rule_id && baseline.rule_version === task.rule_version
      && (!baseline.application_id || baseline.application_id === task.application_id) ? baseline.input_fields : [];
    const fields = latest ? latest.configuration.variables.map(({ variable, label }) => {
      const prior = task.input_fields.find(field => field.variable === variable) ?? originalFields.find(field => field.variable === variable);
      return { variable, path: prior?.path ?? variable, label, value: prior ? prior.value : '' };
    }) : task.input_fields;
    const rejected = rejectedDescriptionInput({ fields, direct });
    if (rejected) ingestionError(rejected, 409);
    if (!hasDescriptionInput(fields)) ingestionError(emptyInputCode, 409);
    const generation = latest ? { ...latest.configuration, connectionVersion: latest.connectionVersion } : {
      connectionId: task.connection_id, connectionVersion: (await this.connections.resolve(organizationId, task.connection_id, tx)).version,
      model: task.model, prompt: task.prompt, output: task.output_configuration,
    };
    const prepared = await this.insertTask(tx, actor, { ruleId: task.rule_id, ruleVersion: task.rule_version, defectId: task.defect_id },
      generation, fields, direct, currentText, latest, null, true);
    return prepared.id;
  }

  private async currentRule(tx: AdminTransaction, task: TaskRow): Promise<CurrentRule | undefined> {
    const [rule] = await tx.$queryRaw<CurrentRule[]>`SELECT version,configuration FROM integration_ingestion_rules WHERE organization_id=${task.organization_id}::uuid AND id=${task.rule_id}::uuid`;
    return rule;
  }

  private async syncSourceVersion(tx: AdminTransaction, task: Pick<TaskRow, 'organization_id' | 'defect_id'>, previousVersion: number, version: number) {
    await tx.$executeRaw`UPDATE integration_ingestion_target_versions SET target_version=${version} WHERE organization_id=${task.organization_id}::uuid AND target='PROCESS_DEFECT' AND target_id=${task.defect_id}::uuid AND target_version=${previousVersion}`;
  }

  private async claim(): Promise<TaskRow | null> {
    return this.prisma.$transaction(async tx => {
      const expired = await tx.$queryRaw<Pick<TaskRow, 'organization_id' | 'defect_id' | 'id' | 'input_revision'>[]>`UPDATE integration_ai_description_tasks SET status='FAILED',error_code='AI_CONNECTION_TIMEOUT',claim_token=NULL,claimed_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE status='PROCESSING' AND attempts>=3 AND claimed_at<clock_timestamp()-interval '2 minutes' RETURNING organization_id,defect_id,id,input_revision`;
      for (const task of expired) await this.defects.expireAiDescription(tx, task.organization_id, task.defect_id, task.id, task.input_revision);
      const [task] = await tx.$queryRaw<TaskRow[]>`SELECT * FROM integration_ai_description_tasks WHERE (status IN ('PENDING','RETRY') AND next_attempt_at<=clock_timestamp() OR status='PROCESSING' AND claimed_at<clock_timestamp()-interval '2 minutes') AND attempts<3 ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!task) return null;
      const token = randomUUID();
      const [claimed] = await tx.$queryRaw<TaskRow[]>`UPDATE integration_ai_description_tasks SET status='PROCESSING',claim_token=${token}::uuid,claimed_at=clock_timestamp(),attempts=attempts+1,version=version+1,updated_at=clock_timestamp() WHERE id=${task.id}::uuid RETURNING *`;
      return claimed!;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async processDue(limit = 1) {
    const processed = Math.min(Math.max(limit, 1), 2);
    for (let index = 0; index < processed; index += 1) {
      const task = await this.claim();
      if (!task) break;
      let text: string | null = null, errorCode: string | null = null, applicationAvailability: number | undefined;
      try {
        const fresh = await this.prisma.$transaction(async tx => {
          await this.access(tx, task.actor_snapshot);
          const state = await this.defects.aiDescriptionState(tx, task.actor_snapshot, task.defect_id);
          const rule = await this.currentRule(tx, task);
          const application = taskApplication(task, rule);
          if (application) applicationAvailability = await this.applications.assertAvailable(tx, task.organization_id, application.applicationId, application.publishedVersion);
          if (!canRun(task, rule) || state.descriptionInputVersion !== task.input_revision || state.archivedAt) return null;
          return { bindings: task.manual_generation && task.application_id ? undefined : rule!.configuration.aiDescription?.inputFields };
        });
        if (fresh) {
          const rejected = rejectedDescriptionInput({ fields: task.input_fields, direct: task.expected_description }, fresh.bindings);
          if (rejected) ingestionError(rejected);
          const result = await this.connections.generate(task.organization_id, task.connection_id, task.connection_version, { prompt: task.prompt, model: task.model, output: task.output_configuration,
            selectedData: providerSelectedData(task.input_fields, fresh.bindings) });
          text = validateAiDescription(result.text);
        }
      } catch (error) { errorCode = failureCode(error); }
      await this.prisma.$transaction(async tx => {
        await readOrganizationRuntime(tx, task.organization_id, true);
        let suggestionOnly = false;
        let registrationFailure: { cause: unknown } | undefined;
        if (task.manual_generation && text !== null) {
          try {
            await this.defects.assertAiDescriptionRegistrationAccess(tx, task.actor_snapshot);
          } catch (error) {
            if (failureCode(error) === 'FEATURE_PERMISSION_DENIED') suggestionOnly = true;
            else registrationFailure = { cause: error };
          }
        }
        const [current] = await tx.$queryRaw<TaskRow[]>`SELECT * FROM integration_ai_description_tasks WHERE organization_id=${task.organization_id}::uuid AND id=${task.id}::uuid FOR UPDATE`;
        if (!current || current.claim_token !== task.claim_token || current.status !== 'PROCESSING') return;
        let status: string = 'FAILED';
        try {
          if (registrationFailure) throw registrationFailure.cause;
          await this.access(tx, task.actor_snapshot);
          const state = await this.defects.aiDescriptionState(tx, task.actor_snapshot, task.defect_id, true);
          const rule = await this.currentRule(tx, task);
          if (state.archivedAt || !canRun(task, rule) || state.descriptionInputVersion !== task.input_revision) status = 'STALE';
          else if (text !== null) {
            const application = taskApplication(task, rule);
            if (application) await this.applications.assertAvailable(tx, task.organization_id, application.applicationId, application.publishedVersion, applicationAvailability);
            status = await this.defects.applyAiDescription(tx, task.actor_snapshot, task.defect_id, task.input_revision, task.expected_description, text, randomUUID(), suggestionOnly ? 'suggestion' : 'automatic');
            if (status === 'APPLIED') {
              const applied = await this.defects.aiDescriptionState(tx, task.actor_snapshot, task.defect_id);
              await this.syncSourceVersion(tx, task, applied.version - 1, applied.version);
            }
          } else {
            status = task.attempts < 3 && ['AI_CONNECTION_REQUEST_FAILED','AI_CONNECTION_TIMEOUT'].includes(errorCode ?? '') ? 'RETRY' : 'FAILED';
            await this.defects.markAiDescription(tx, task.actor_snapshot, task.defect_id, task.input_revision, status as 'FAILED' | 'RETRY');
          }
        } catch (error) {
          errorCode = failureCode(error); text = null;
          try { await this.defects.markAiDescription(tx, task.actor_snapshot, task.defect_id, task.input_revision, 'FAILED'); } catch {}
        }
        await tx.$executeRaw`UPDATE integration_ai_description_tasks SET status=${status},result=${text},error_code=${errorCode},claim_token=NULL,claimed_at=NULL,next_attempt_at=clock_timestamp()+interval '30 seconds',version=version+1,updated_at=clock_timestamp() WHERE id=${task.id}::uuid AND claim_token=${task.claim_token}::uuid`;
      }, { isolationLevel: 'ReadCommitted' });
    }
  }
}
