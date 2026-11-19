import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError, assertAdminAccess, AdminMutationService, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import type { AiDescriptionOutput } from '../../common/ai-description.js';
import { aiDescriptionRuntimeRecords } from '../api-integration/ai-description-runtime.read-model.js';
import { aiApplicationTestMetadata, aiApplicationTestRecords } from '../audit-log/ai-application-test.read-model.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import { AiConnectionService } from './ai-connection.service.js';
import { aiApplicationError, applicationIdentifiers, applicationSamples, applicationVersion, normalizeAiApplication } from './ai-application.policy.js';
import type { AiApplicationDto, AiApplicationInvocationDto, AiApplicationInvocationPageDto, AiApplicationPageDto, AiApplicationQueryDto, AiApplicationRevisionDto, AiApplicationSettingsDto, AiApplicationTestResultDto, TestAiApplicationDto, UpdateAiApplicationDto } from './ai-application.dto.js';
import type { AiConnectionVersionDto } from './ai-connection.dto.js';

export type AiApplicationBinding = { applicationId: string; publishedVersion: number; inputFields: { path: string; variable: string; label?: string }[] };
export type ApplicationDescriptionSnapshot = { connectionId: string; connectionVersion?: number; model: string; prompt: string; inputFields: AiApplicationBinding['inputFields']; output: AiDescriptionOutput };
type BindingResult = { binding: AiApplicationBinding; aiDescription: ApplicationDescriptionSnapshot };
type ApplicationRow = { id: string; organization_id: string; configuration: AiApplicationSettingsDto; enabled: boolean; version: number; availability_version: number; published_version: number | null; created_at: Date; updated_at: Date };
type RevisionRow = { application_id: string; organization_id: string; published_version: number; configuration: AiApplicationSettingsDto; created_at: Date };
type InvocationRow = Omit<AiApplicationInvocationDto, 'organizationId' | 'applicationVersion' | 'recordedAt'> & { version: string | null; recordedAt: Date; testMetadata: Prisma.JsonValue };
export const aiApplicationInvocationPermissions = ['ai:applications:read', 'audit:read', 'ingestion:read', 'process-quality:defects:read'];
const connectionFailureCode = /^AI_CONNECTION_(INVALID|NOT_FOUND|UNAVAILABLE|VERSION_CONFLICT|TARGET_DENIED|REQUEST_FAILED|TIMEOUT|RESPONSE_INVALID|RESPONSE_TOO_LARGE)$/;
function applicationPaging(query: AiApplicationQueryDto) {
  const page = query.page ?? 1, limit = query.limit ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) aiApplicationError('AI_APPLICATION_INVALID');
  return { page, limit };
}
const dto = (row: ApplicationRow): AiApplicationDto => ({ ...row.configuration, enabled: row.enabled, id: row.id, organizationId: row.organization_id, version: row.version,
  publishedVersion: row.published_version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const revisionDto = (row: RevisionRow): AiApplicationRevisionDto => ({ applicationId: row.application_id, organizationId: row.organization_id,
  publishedVersion: row.published_version, configuration: row.configuration, createdAt: row.created_at.toISOString() });

@Injectable()
export class AiApplicationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly connections: AiConnectionService, private readonly audit: AuditLogService) {}

  async list(actor: AdminActor, organizationId: string, query: AiApplicationQueryDto): Promise<AiApplicationPageDto> {
    applicationIdentifiers(organizationId);
    const { page, limit } = applicationPaging(query);
    return this.prisma.$transaction(async tx => {
      await this.access(tx, actor, organizationId);
      const rows = await tx.$queryRaw<ApplicationRow[]>`SELECT * FROM ai_prompt_applications WHERE organization_id=${organizationId}::uuid ORDER BY configuration->>'name',id LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
      const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM ai_prompt_applications WHERE organization_id=${organizationId}::uuid`;
      return { items: rows.map(dto), total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async read(actor: AdminActor, organizationId: string, id: string): Promise<AiApplicationDto> {
    applicationIdentifiers(organizationId, id);
    return this.prisma.$transaction(async tx => { await this.access(tx, actor, organizationId); return dto(await this.row(tx, organizationId, id)); });
  }

  async readRevision(actor: AdminActor, organizationId: string, id: string, publishedVersion: number): Promise<AiApplicationRevisionDto> {
    applicationIdentifiers(organizationId, id); applicationVersion(publishedVersion);
    return this.prisma.$transaction(async tx => { await this.access(tx, actor, organizationId); return revisionDto(await this.revision(tx, organizationId, id, publishedVersion)); });
  }

  async listInvocations(actor: AdminActor, organizationId: string, id: string, query: AiApplicationQueryDto): Promise<AiApplicationInvocationPageDto> {
    applicationIdentifiers(organizationId, id);
    const { page, limit } = applicationPaging(query);
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor, 'SHARE');
      await this.access(tx, actor, organizationId, aiApplicationInvocationPermissions);
      await this.row(tx, organizationId, id);
      const records = Prisma.sql`(${aiApplicationTestRecords(organizationId, id)} UNION ALL ${aiDescriptionRuntimeRecords(organizationId, id)}) AS records`;
      const rows = await tx.$queryRaw<InvocationRow[]>`SELECT * FROM ${records} ORDER BY "recordedAt" DESC, source, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
      const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM ${records}`;
      const items = rows.map(({ version, recordedAt, testMetadata, ...record }) => {
        const parsedVersion = Number(version);
        const applicationVersion = Number.isInteger(parsedVersion) && parsedVersion >= 1 && parsedVersion <= 2147483647 ? parsedVersion : null;
        return { ...record, ...(record.source === 'APPLICATION_TEST' ? aiApplicationTestMetadata(testMetadata) : {}), organizationId, applicationVersion, recordedAt: recordedAt.toISOString(),
          errorCode: record.source === 'RUNTIME_TASK' || record.status === 'FAILED' && connectionFailureCode.test(record.errorCode ?? '') ? record.errorCode : null };
      });
      return { items, total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async create(actor: AdminActor, organizationId: string, input: AiApplicationSettingsDto, traceId: string, key?: string): Promise<AiApplicationDto> {
    const configuration = normalizeAiApplication(input);
    return this.mutate(actor, organizationId, 'AI_APPLICATION_CREATED', configuration, traceId, key, async tx => {
      await this.connection(tx, organizationId, configuration);
      const row = await this.insert(tx, organizationId, configuration);
      await this.record(tx, actor, row, 'AI_APPLICATION_CREATED', traceId);
      return dto(row);
    });
  }

  async update(actor: AdminActor, organizationId: string, id: string, input: UpdateAiApplicationDto, traceId: string, key?: string): Promise<AiApplicationDto> {
    applicationIdentifiers(organizationId, id); applicationVersion(input.expectedVersion);
    const configuration = normalizeAiApplication(input);
    return this.mutate(actor, organizationId, 'AI_APPLICATION_UPDATED', { id, expectedVersion: input.expectedVersion, ...configuration }, traceId, key, async tx => {
      const current = await this.row(tx, organizationId, id, true); this.match(current, input.expectedVersion, true);
      if (current.configuration.connectionId !== configuration.connectionId || current.configuration.model !== configuration.model) await this.connection(tx, organizationId, configuration);
      if (current.enabled !== configuration.enabled && current.availability_version === 2147483647) aiApplicationError('AI_APPLICATION_VERSION_CONFLICT', 409);
      const [row] = await tx.$queryRaw<ApplicationRow[]>`UPDATE ai_prompt_applications SET configuration=${JSON.stringify(configuration)}::jsonb,enabled=${configuration.enabled},availability_version=availability_version+CASE WHEN enabled<>${configuration.enabled} THEN 1 ELSE 0 END,version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid AND organization_id=${organizationId}::uuid AND version=${input.expectedVersion} RETURNING *`;
      if (!row) aiApplicationError('AI_APPLICATION_VERSION_CONFLICT', 409);
      await this.record(tx, actor, row, 'AI_APPLICATION_UPDATED', traceId);
      if (row.enabled !== current.enabled) await this.record(tx, actor, row, row.enabled ? 'AI_APPLICATION_ENABLED' : 'AI_APPLICATION_DISABLED', traceId);
      return dto(row);
    });
  }

  async publish(actor: AdminActor, organizationId: string, id: string, input: AiConnectionVersionDto, traceId: string, key?: string): Promise<AiApplicationDto> {
    applicationIdentifiers(organizationId, id); applicationVersion(input.expectedVersion);
    return this.mutate(actor, organizationId, 'AI_APPLICATION_PUBLISHED', { id, expectedVersion: input.expectedVersion }, traceId, key, async tx => {
      const current = await this.row(tx, organizationId, id, true); this.match(current, input.expectedVersion, true);
      const configuration = normalizeAiApplication(current.configuration);
      await this.connection(tx, organizationId, configuration);
      const publishedVersion = (current.published_version ?? 0) + 1;
      applicationVersion(publishedVersion);
      await tx.$executeRaw`INSERT INTO ai_prompt_application_revisions(application_id,organization_id,published_version,configuration) VALUES(${id}::uuid,${organizationId}::uuid,${publishedVersion},${JSON.stringify(configuration)}::jsonb)`;
      const [row] = await tx.$queryRaw<ApplicationRow[]>`UPDATE ai_prompt_applications SET published_version=${publishedVersion},version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid AND organization_id=${organizationId}::uuid RETURNING *`;
      await this.record(tx, actor, row!, 'AI_APPLICATION_PUBLISHED', traceId);
      return dto(row!);
    });
  }

  async test(actor: AdminActor, organizationId: string, id: string, input: TestAiApplicationDto, traceId: string, key?: string): Promise<AiApplicationTestResultDto> {
    applicationIdentifiers(organizationId, id); applicationVersion(input.expectedVersion);
    const preparation = await this.mutate(actor, organizationId, 'AI_APPLICATION_TESTED', { id, ...input }, traceId, key, async tx => {
      const row = await this.row(tx, organizationId, id); this.match(row, input.expectedVersion);
      if (!row.enabled) aiApplicationError('AI_APPLICATION_UNAVAILABLE', 409);
      applicationSamples(row.configuration, input.samples);
      const connection = await this.connection(tx, organizationId, row.configuration);
      return { applicationId: id, version: row.version, connectionVersion: connection.version };
    });
    const configuration = await this.prisma.$transaction(async tx => {
      await this.access(tx, actor, organizationId, 'ai:applications:test'); await assertActiveAuthentication(tx, actor);
      const row = await this.row(tx, organizationId, id); this.match(row, preparation.version);
      return row.configuration;
    });
    const selectedData = applicationSamples(configuration, input.samples);
    let text: string | null = null, code = 'AI_APPLICATION_OK';
    try { text = (await this.connections.generate(organizationId, configuration.connectionId, preparation.connectionVersion,
      { model: configuration.model, prompt: configuration.prompt, output: configuration.output, selectedData })).text; }
    catch (error) {
      const reason = error instanceof HttpException ? (error.getResponse() as { code?: string }).code : undefined;
      code = typeof reason === 'string' && connectionFailureCode.test(reason) ? reason : 'AI_CONNECTION_REQUEST_FAILED';
    }
    await this.prisma.$transaction(async tx => {
      await this.access(tx, actor, organizationId, 'ai:applications:test'); await assertActiveAuthentication(tx, actor);
      const row = await this.row(tx, organizationId, id); this.match(row, preparation.version);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'AI_APPLICATION_TESTED', resourceType: 'AiApplication', resourceId: id,
        outcome: text === null ? 'FAILURE' : 'SUCCESS', traceId, metadata: { resourceVersion: row.version, reasonCode: code,
          connectionId: configuration.connectionId, connectionVersion: preparation.connectionVersion, model: configuration.model, outputMode: configuration.output.mode } }, tx);
    });
    return { applicationId: id, version: preparation.version, status: text === null ? 'FAILED' : 'SUCCESS', code, text };
  }

  async resolveBinding(tx: AdminTransaction, actor: AdminActor, binding: AiApplicationBinding): Promise<BindingResult> {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    applicationIdentifiers(organizationId, binding.applicationId); applicationVersion(binding.publishedVersion);
    await this.access(tx, actor, organizationId);
    const row = await this.row(tx, organizationId, binding.applicationId);
    if (!row.enabled) aiApplicationError('AI_APPLICATION_UNAVAILABLE', 409);
    const revision = await this.revision(tx, organizationId, binding.applicationId, binding.publishedVersion);
    const configuration = normalizeAiApplication(revision.configuration);
    if (!Array.isArray(binding.inputFields) || binding.inputFields.length < 1 || binding.inputFields.length > configuration.variables.length || binding.inputFields.some(field => !field)
      || new Set(binding.inputFields.map(field => field.variable)).size !== binding.inputFields.length) aiApplicationError('AI_APPLICATION_INVALID');
    const referenced = new Set([...configuration.prompt.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(match => match[1]!.trim()));
    const inputFields = configuration.variables.flatMap(variable => {
      const field = binding.inputFields.find(input => input.variable === variable.variable);
      if (!field) {
        if (referenced.has(variable.variable)) aiApplicationError('AI_APPLICATION_INVALID');
        return [];
      }
      if (typeof field.path !== 'string' || field.path.length > 200 || field.path.split('.').length > 8
        || field.path.split('.').some(part => !/^[A-Za-z0-9_-]{1,64}$/.test(part) || ['__proto__', 'constructor', 'prototype'].includes(part))
        || field.label !== undefined && (typeof field.label !== 'string' || field.label.length > 100 || /[\u0000]/u.test(field.label))) aiApplicationError('AI_APPLICATION_INVALID');
      return { path: field.path, variable: variable.variable, label: field.label ?? variable.label };
    });
    if (inputFields.length !== binding.inputFields.length) aiApplicationError('AI_APPLICATION_INVALID');
    const connection = await this.connection(tx, organizationId, configuration);
    return { binding: { applicationId: row.id, publishedVersion: binding.publishedVersion, inputFields },
      aiDescription: { connectionId: configuration.connectionId, connectionVersion: connection.version, model: configuration.model, prompt: configuration.prompt, inputFields, output: configuration.output } };
  }

  async latestPublishedVersion(tx: AdminTransaction, actor: AdminActor, applicationId: string): Promise<number | null> {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await this.access(tx, actor, organizationId);
    return (await this.row(tx, organizationId, applicationId)).published_version;
  }

  async resolveLatestForTask(tx: AdminTransaction, organizationId: string, applicationId: string) {
    applicationIdentifiers(organizationId, applicationId);
    await this.organization(tx, organizationId);
    const row = await this.row(tx, organizationId, applicationId);
    if (!row.enabled || row.published_version === null) aiApplicationError('AI_APPLICATION_UNAVAILABLE', 409);
    const revision = await this.revision(tx, organizationId, applicationId, row.published_version);
    const configuration = normalizeAiApplication(revision.configuration);
    const connection = await this.connection(tx, organizationId, configuration);
    return { applicationId, publishedVersion: row.published_version, configuration, connectionVersion: connection.version };
  }

  async assertAvailable(tx: AdminTransaction, organizationId: string, applicationId: string, publishedVersion: number, expectedAvailabilityVersion?: number): Promise<number> {
    applicationIdentifiers(organizationId, applicationId); applicationVersion(publishedVersion);
    await this.organization(tx, organizationId);
    const row = await this.row(tx, organizationId, applicationId);
    if (!row.enabled) aiApplicationError('AI_APPLICATION_UNAVAILABLE', 409);
    if (expectedAvailabilityVersion !== undefined && row.availability_version !== expectedAvailabilityVersion) aiApplicationError('AI_APPLICATION_VERSION_CONFLICT', 409);
    await this.revision(tx, organizationId, applicationId, publishedVersion);
    return row.availability_version;
  }

  async importLegacy(tx: AdminTransaction, actor: AdminActor, name: string, ai: ApplicationDescriptionSnapshot): Promise<BindingResult> {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await this.access(tx, actor, organizationId);
    const configuration = normalizeAiApplication({ name: name.trim().slice(0, 120), domain: 'PROCESS_QUALITY', scene: 'PROCESS_DEFECT_DESCRIPTION', enabled: true,
      variables: ai.inputFields.map(field => ({ variable: field.variable, label: field.label ?? '' })), connectionId: ai.connectionId, model: ai.model, prompt: ai.prompt, output: ai.output, fallback: 'DIRECT' });
    const lock = `ai-application-import:${organizationId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))::text`;
    const [existing] = await tx.$queryRaw<{ application_id: string; published_version: number }[]>`SELECT r.application_id,r.published_version FROM ai_prompt_application_revisions r JOIN ai_prompt_applications a ON a.id=r.application_id AND a.organization_id=r.organization_id WHERE r.organization_id=${organizationId}::uuid AND r.configuration=${JSON.stringify(configuration)}::jsonb AND a.enabled ORDER BY r.created_at,r.application_id LIMIT 1`;
    let applicationId = existing?.application_id, publishedVersion = existing?.published_version;
    if (!applicationId) {
      await this.connection(tx, organizationId, configuration);
      const row = await this.insert(tx, organizationId, configuration);
      applicationId = row.id; publishedVersion = 1;
      await tx.$executeRaw`INSERT INTO ai_prompt_application_revisions(application_id,organization_id,published_version,configuration) VALUES(${applicationId}::uuid,${organizationId}::uuid,1,${JSON.stringify(configuration)}::jsonb)`;
      await tx.$executeRaw`UPDATE ai_prompt_applications SET published_version=1 WHERE id=${applicationId}::uuid AND organization_id=${organizationId}::uuid`;
      await this.record(tx, actor, { ...row, published_version: 1 }, 'AI_APPLICATION_IMPORTED', randomUUID());
    }
    return this.resolveBinding(tx, actor, { applicationId, publishedVersion: publishedVersion!, inputFields: ai.inputFields });
  }

  private async insert(tx: AdminTransaction, organizationId: string, configuration: AiApplicationSettingsDto) {
    const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM ai_prompt_applications WHERE organization_id=${organizationId}::uuid`;
    if (count!.total >= 1000) aiApplicationError('AI_APPLICATION_INVALID');
    const [row] = await tx.$queryRaw<ApplicationRow[]>`INSERT INTO ai_prompt_applications(id,organization_id,configuration,enabled) VALUES(${randomUUID()}::uuid,${organizationId}::uuid,${JSON.stringify(configuration)}::jsonb,${configuration.enabled}) RETURNING *`;
    return row!;
  }
  private async connection(tx: AdminTransaction, organizationId: string, configuration: AiApplicationSettingsDto) {
    const connection = await this.connections.resolve(organizationId, configuration.connectionId, tx);
    if (!connection.models.includes(configuration.model)) aiApplicationError('AI_APPLICATION_INVALID');
    return connection;
  }
  private async row(tx: AdminTransaction, organizationId: string, id: string, lock = false) {
    const [row] = await tx.$queryRaw<ApplicationRow[]>(Prisma.sql`SELECT * FROM ai_prompt_applications WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    if (!row) aiApplicationError('AI_APPLICATION_NOT_FOUND', 404);
    return row;
  }
  private async revision(tx: AdminTransaction, organizationId: string, id: string, publishedVersion: number) {
    const [row] = await tx.$queryRaw<RevisionRow[]>`SELECT * FROM ai_prompt_application_revisions WHERE application_id=${id}::uuid AND organization_id=${organizationId}::uuid AND published_version=${publishedVersion}`;
    if (!row) aiApplicationError('AI_APPLICATION_NOT_FOUND', 404);
    return row;
  }
  private match(row: ApplicationRow, expectedVersion: number, increment = false) { if (row.version !== expectedVersion || increment && row.version === 2147483647) aiApplicationError('AI_APPLICATION_VERSION_CONFLICT', 409); }
  private async organization(tx: AdminTransaction, organizationId: string, lock = false) {
    const organization = await readOrganizationRuntime(tx, organizationId, lock);
    if (!organization || organization.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    if (organization.status !== 'ACTIVE' || organization.deletedAt || organization.configurationRequired) adminError('ORGANIZATION_DISABLED', 403);
  }
  private async access(tx: AdminTransaction, actor: AdminActor, organizationId: string, permission: string | string[] = 'ai:applications:read') {
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertAdminAccess(tx, actor, organizationId, permission); await this.organization(tx, organizationId);
  }
  private mutate<Result>(actor: AdminActor, organizationId: string, action: string, payload: object, traceId: string, key: string | undefined, work: (tx: AdminTransaction) => Promise<Result>) {
    applicationIdentifiers(organizationId);
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const permission = action === 'AI_APPLICATION_PUBLISHED' ? 'ai:applications:publish' : action === 'AI_APPLICATION_TESTED' ? 'ai:applications:test' : 'ai:applications:manage';
    return this.mutations.run({ actor, organizationId, action, payload: { organizationId, ...payload }, permission, traceId, key }, work, tx => this.organization(tx, organizationId, true));
  }
  private record(tx: AdminTransaction, actor: AdminActor, row: ApplicationRow, action: string, traceId: string) {
    return this.audit.record({ organizationId: row.organization_id, actorUserId: actor.id, action, resourceType: 'AiApplication', resourceId: row.id, outcome: 'SUCCESS', traceId,
      metadata: { resourceVersion: row.version, publishedVersion: row.published_version, enabled: row.enabled } }, tx);
  }
}
