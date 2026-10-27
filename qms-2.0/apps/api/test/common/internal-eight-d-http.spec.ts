import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { HttpException, RequestMethod, ValidationPipe } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DECORATORS } from '@nestjs/swagger/dist/constants.js';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';
import { ACCESS_CONTEXT_METADATA } from '../../src/modules/authorization/access.decorator.js';
import { AUTHENTICATED_SESSION } from '../../src/common/guards/authenticated.guard.js';
import { INTERNAL_EIGHT_D_DOMAINS } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { createCustomerEightDCore, createNewProductEightDCore, toCoreEightDIssue, toCoreEightDPreview, toCoreEightDSources,
  toHttpEightDPreview, toHttpEightDReport, type InternalEightDHttpCoreDependencies } from '../../src/common/eight-d/internal-eight-d-http.js';
import { CustomerEightDController } from '../../src/modules/customer-quality/customer-eight-d.controller.js';
import { CustomerEightDService } from '../../src/modules/customer-quality/customer-eight-d.service.js';
import * as customerDto from '../../src/modules/customer-quality/customer-eight-d.dto.js';
import { NewProductEightDController } from '../../src/modules/new-product-quality/new-product-eight-d.controller.js';
import { NewProductEightDService } from '../../src/modules/new-product-quality/new-product-eight-d.service.js';
import * as newProductDto from '../../src/modules/new-product-quality/new-product-eight-d.dto.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { ProcessEightDDocumentDto } from '../../src/modules/process-quality/process-eight-d-document.dto.js';
import type { ProcessEightDActor } from '../../src/modules/process-quality/process-eight-d.types.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { WorkflowClosureContext } from '../../src/modules/workflow/workflow-closure-round.types.js';

const sourceId = randomUUID(), problemId = randomUUID();
const confirmation = { sourceId, relatedProblemIds: [problemId], recurrence: 'RECURRENCE' as const, relatedSetToken: 'a'.repeat(64), reason: 'repeat' };
const issue = { sources: [{ sourceId, expectedVersion: 4 }], severity: 'HIGH' as const, ownerUserId: randomUUID(),
  responsibleSectionDepartmentId: randomUUID(), sourceConfirmations: [confirmation], analysisDueAt: new Date('2026-11-01') };
const actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL', sessionId: randomUUID() } as ProcessEightDActor;
const dependencies = Array.from({ length: 13 }, () => ({})) as InternalEightDHttpCoreDependencies;
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

describe('internal eight-d HTTP translation', () => {
  it('translates issue and confirmations without losing the opaque token, dates or mutating inputs', () => {
    const before = structuredClone(issue);
    const { sourceId: _sourceId, ...confirmationFacts } = confirmation;
    expect(toCoreEightDIssue(issue)).toEqual({ ...issue, sources: [{ defectId: sourceId, expectedVersion: 4 }],
      sourceConfirmations: [{ ...confirmationFacts, defectId: sourceId }] });
    expect(toCoreEightDIssue(issue).sourceConfirmations![0]).not.toHaveProperty('sourceId');
    expect(toCoreEightDIssue(issue).analysisDueAt).toBe(issue.analysisDueAt);
    expect(issue).toEqual(before);
    expect(toCoreEightDIssue({ ...issue, sourceConfirmations: undefined }).sourceConfirmations).toBeUndefined();
  });

  it('translates preview, removal, primary and confirmation IDs explicitly', () => {
    expect(toCoreEightDPreview({ sources: issue.sources, problemId })).toEqual({ sources: [{ defectId: sourceId, expectedVersion: 4 }], problemId });
    const input = { expectedVersion: 7, add: issue.sources, removeSourceIds: [randomUUID()], primarySourceId: sourceId,
      sourceConfirmations: [confirmation], confirmCancelApproval: true, reason: 'adjust' };
    const before = structuredClone(input);
    const translated = toCoreEightDSources(input);
    const { sourceId: _sourceId, ...confirmationFacts } = confirmation;
    expect(translated).toEqual({ expectedVersion: 7, add: [{ defectId: sourceId, expectedVersion: 4 }], removeDefectIds: input.removeSourceIds,
      primaryDefectId: sourceId, sourceConfirmations: [{ ...confirmationFacts, defectId: sourceId }], confirmCancelApproval: true, reason: 'adjust' });
    expect(translated).not.toHaveProperty('removeSourceIds');
    expect(translated).not.toHaveProperty('primarySourceId');
    expect(input).toEqual(before);
    expect(toCoreEightDSources({ expectedVersion: 1, add: [], removeSourceIds: [] })).toEqual({ expectedVersion: 1, add: [], removeDefectIds: [] });
  });

  it('translates only transport source identities, not evidence or document facts', () => {
    const preview = { defectId: sourceId, relatedProblems: [], hasHiddenRelations: true, relatedSetToken: 'b'.repeat(64) };
    expect(toHttpEightDPreview(preview)).toEqual({ sourceId, relatedProblems: [], hasHiddenRelations: true, relatedSetToken: 'b'.repeat(64) });
    const snapshot = { defectId: 'original-process-fact', sourceId: 'saved-selection-fact' };
    const model = { problemId, document: emptyProcessEightDDocument(), sources: [{ defectId: sourceId, sourceVersion: 4, snapshot, primary: true }], allowedActions: ['save'] };
    const before = structuredClone(model);
    const translated = toHttpEightDReport(model);
    expect(translated).toEqual({ ...model, sources: [{ sourceId, sourceVersion: 4, snapshot, primary: true }] });
    expect(translated.sources[0]).not.toHaveProperty('defectId');
    expect(translated.document).toBe(model.document);
    expect(translated.sources[0]!.snapshot).toBe(snapshot);
    expect(model).toEqual(before);
  });
});

const domains = [
  { path: 'customer-quality', sourceRead: 'customer-quality:complaints:read', Controller: CustomerEightDController, Service: CustomerEightDService,
    factory: createCustomerEightDCore, descriptor: INTERNAL_EIGHT_D_DOMAINS.CUSTOMER, dto: customerDto, name: 'Customer' },
  { path: 'new-product-quality', sourceRead: 'new-product-quality:projects:read', Controller: NewProductEightDController, Service: NewProductEightDService,
    factory: createNewProductEightDCore, descriptor: INTERNAL_EIGHT_D_DOMAINS.NEW_PRODUCT, dto: newProductDto, name: 'NewProduct' },
] as const;

describe.each(domains)('$name eight-d HTTP boundary', domain => {
  const methods = [
    ['binding', 'binding', RequestMethod.GET, 'configuration:read', 'query'],
    ['bind', 'binding', RequestMethod.PUT, 'configuration:manage', 'body'],
    ['activate', 'activation', RequestMethod.PUT, 'configuration:manage', 'body'],
    ['issue', '/', RequestMethod.POST, `${domain.path}:issues:issue`, 'body'],
    ['previewSources', 'sources/preview', RequestMethod.POST, domain.sourceRead, 'body'],
    ['assignmentOptions', 'assignment-options', RequestMethod.GET, `${domain.path}:issues:read`, 'query'],
    ['read', ':id', RequestMethod.GET, `${domain.path}:issues:read`, 'query'],
    ['save', ':id', RequestMethod.PUT, `${domain.path}:issues:work`, 'body'],
    ['analysis', ':id/analysis-complete', RequestMethod.POST, `${domain.path}:issues:work`, 'body'],
    ['submit', ':id/submit', RequestMethod.POST, `${domain.path}:issues:work`, 'body'],
    ['collaborators', ':id/collaborators', RequestMethod.PUT, `${domain.path}:issues:work`, 'body'],
    ['reassign', ':id/reassign', RequestMethod.PUT, `${domain.path}:issues:read`, 'body'],
    ['risk', ':id/risk', RequestMethod.PUT, `${domain.path}:issues:risk`, 'body'],
    ['sources', ':id/sources', RequestMethod.PUT, `${domain.path}:issues:sources`, 'body'],
    ['deadlines', ':id/deadlines', RequestMethod.PUT, `${domain.path}:issues:deadlines`, 'body'],
  ] as const;

  it('constructs a distinct core with all original 13 dependencies and the fixed server descriptor', () => {
    const core = domain.factory(...dependencies);
    expect(core.domain).toBe(domain.descriptor);
    const fields = ['prisma', 'ledger', 'domainIssues', 'links', 'runtime', 'problems', 'rounds', 'responsibilities', 'resources', 'audit', 'outbox', 'readRegistry', 'extensions'];
    fields.forEach((field, i) => expect((core as unknown as Record<string, unknown>)[field]).toBe(dependencies[i]));
    expect(new domain.Service(core).core).toBe(core);
    const otherCore = domain.name === 'Customer' ? createNewProductEightDCore(...dependencies) : createCustomerEightDCore(...dependencies);
    expect(() => new domain.Service(otherCore)).toThrow('INTERNAL_EIGHT_D_DOMAIN_INVALID');
  });

  it.each(methods)('%s keeps the parallel route, scope and least entry permission', (name, path, method, featurePermission, source) => {
    expect(Reflect.getMetadata(PATH_METADATA, domain.Controller)).toBe(`api/v1/${domain.path}/eight-d`);
    const handler = domain.Controller.prototype[name];
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(ACCESS_CONTEXT_METADATA, handler)).toEqual({ featurePermission, organizationScope: { source, field: 'organizationId', optional: true } });
    const headers = Reflect.getMetadata(DECORATORS.API_PARAMETERS, handler) as { name: string; required: boolean }[] | undefined;
    if (method !== RequestMethod.GET) expect(headers).toContainEqual(expect.objectContaining({ name: 'x-csrf-token', required: true }));
    if (source === 'body' && name !== 'previewSources') expect(headers).toContainEqual(expect.objectContaining({ name: 'Idempotency-Key', required: true }));
    if (['previewSources', 'analysis', 'submit'].includes(name)) expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
  });

  it('publishes sourceId DTOs, rejects core-only input names and reuses the exact document DTO', async () => {
    const types = domain.dto as Record<string, new () => object>;
    const Issue = types[`Issue${domain.name}EightDDto`]!;
    const Sources = types[`${domain.name}EightDSourcesDto`]!;
    const Save = types[`Save${domain.name}EightDDto`]!;
    const transformed = await pipe.transform(issue, { type: 'body', metatype: Issue });
    expect(transformed).toMatchObject(issue);
    await expect(pipe.transform({ ...issue, sources: [{ defectId: sourceId, expectedVersion: 4 }] }, { type: 'body', metatype: Issue })).rejects.toThrow();
    await expect(pipe.transform({ ...issue, sourceConfirmations: [{ ...confirmation, defectId: sourceId }] }, { type: 'body', metatype: Issue })).rejects.toThrow();
    await expect(pipe.transform({ expectedVersion: 1, add: [], removeSourceIds: [], primaryDefectId: sourceId }, { type: 'body', metatype: Sources })).rejects.toThrow();
    await expect(pipe.transform({ ...issue, sources: [{ sourceId: 'bad', expectedVersion: 0 }] }, { type: 'body', metatype: Issue })).rejects.toThrow();
    const saved = await pipe.transform({ expectedVersion: 1, document: {} }, { type: 'body', metatype: Save });
    expect(saved.document).toBeInstanceOf(ProcessEightDDocumentDto);
  });

  it('treats null sourceConfirmations as omitted after real Issue DTO validation', async () => {
    const types = domain.dto as Record<string, new () => object>;
    const metatype = types[`Issue${domain.name}EightDDto`]!;
    const input = await pipe.transform({ ...issue, sourceConfirmations: null }, { type: 'body', metatype });
    const omitted = await pipe.transform({ ...issue, sourceConfirmations: undefined }, { type: 'body', metatype });
    expect(input.sourceConfirmations).toBeNull();
    expect(toCoreEightDIssue(input)).toEqual(toCoreEightDIssue(omitted));
    expect(toCoreEightDIssue(input)).not.toHaveProperty('sourceConfirmations');
    expect(input.sourceConfirmations).toBeNull();
  });

  it('treats null sourceConfirmations as omitted after real Sources DTO validation', async () => {
    const types = domain.dto as Record<string, new () => object>;
    const metatype = types[`${domain.name}EightDSourcesDto`]!;
    const body = { expectedVersion: 1, add: issue.sources, removeSourceIds: [] };
    const input = await pipe.transform({ ...body, sourceConfirmations: null }, { type: 'body', metatype });
    const omitted = await pipe.transform(body, { type: 'body', metatype });
    expect(input.sourceConfirmations).toBeNull();
    expect(toCoreEightDSources(input)).toEqual(toCoreEightDSources(omitted));
    expect(toCoreEightDSources(input)).not.toHaveProperty('sourceConfirmations');
    expect(input.sourceConfirmations).toBeNull();
  });

  it('preserves explicit empty confirmations and still rejects malformed confirmations at the DTO boundary', async () => {
    const types = domain.dto as Record<string, new () => object>;
    const issueType = types[`Issue${domain.name}EightDDto`]!;
    const sourcesType = types[`${domain.name}EightDSourcesDto`]!;
    const body = { expectedVersion: 1, add: [], removeSourceIds: [] };
    const validatedIssue = await pipe.transform({ ...issue, sourceConfirmations: [] }, { type: 'body', metatype: issueType });
    const validatedSources = await pipe.transform({ ...body, sourceConfirmations: [] }, { type: 'body', metatype: sourcesType });
    expect(toCoreEightDIssue(validatedIssue).sourceConfirmations).toEqual([]);
    expect(toCoreEightDSources(validatedSources).sourceConfirmations).toEqual([]);
    for (const sourceConfirmations of [{}, '', 0, false, [null], [{ ...confirmation, relatedProblemIds: null }]]) {
      await expect(pipe.transform({ ...issue, sourceConfirmations }, { type: 'body', metatype: issueType })).rejects.toMatchObject({ status: 400 });
      await expect(pipe.transform({ ...body, sourceConfirmations }, { type: 'body', metatype: sourcesType })).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects null required source arrays before translation instead of treating them as optional', async () => {
    const types = domain.dto as Record<string, new () => object>;
    const cases = [
      [types[`Issue${domain.name}EightDDto`]!, { ...issue, sources: null }],
      [types[`${domain.name}EightDSourcePreviewInputDto`]!, { sources: null }],
      [types[`${domain.name}EightDSourcesDto`]!, { expectedVersion: 1, add: null, removeSourceIds: [] }],
      [types[`${domain.name}EightDSourcesDto`]!, { expectedVersion: 1, add: [], removeSourceIds: null }],
      [types[`${domain.name}EightDCollaboratorsDto`]!, { expectedVersion: 1, userIds: null }],
      [types[`Save${domain.name}EightDDto`]!, { expectedVersion: 1, document: { correctiveActions: null } }],
    ] as const;
    for (const [metatype, body] of cases) {
      await expect(pipe.transform(body, { type: 'body', metatype })).rejects.toMatchObject({ status: 400 });
    }
  });

  it('delegates the real actor, trace and key and translates every report-producing command', async () => {
    const core = domain.factory(...dependencies);
    const service = new domain.Service(core);
    const model = { sources: [{ defectId: sourceId, sourceVersion: 4, snapshot: {}, primary: true }], document: {} };
    for (const name of ['read', 'save', 'analysisComplete', 'submit', 'collaborators', 'reassign', 'risk', 'sources', 'deadlines'] as const) {
      const spy = jest.spyOn(core, name).mockResolvedValue(model as never);
      const input = name === 'sources' ? { expectedVersion: 1, add: issue.sources, removeSourceIds: [] } : { expectedVersion: 1 };
      const call = service[name] as (...args: unknown[]) => Promise<unknown>;
      expect(await call.call(service, actor, problemId, input, 'trace', 'key')).toEqual({ ...model, sources: [{ sourceId, sourceVersion: 4, snapshot: {}, primary: true }] });
      expect(spy.mock.calls[0]![0]).toBe(actor);
      if (name !== 'read') expect(spy.mock.calls[0]!.slice(3)).toEqual(['trace', 'key']);
      if (name === 'sources') expect(spy.mock.calls[0]![2]).toEqual({ expectedVersion: 1, add: [{ defectId: sourceId, expectedVersion: 4 }], removeDefectIds: [] });
    }
    const preview = jest.spyOn(core, 'previewSources').mockResolvedValue([{ defectId: sourceId, relatedProblems: [], hasHiddenRelations: false, relatedSetToken: 'token' }]);
    expect(await service.previewSources(actor, { sources: issue.sources })).toEqual([{ sourceId, relatedProblems: [], hasHiddenRelations: false, relatedSetToken: 'token' }]);
    expect(preview).toHaveBeenCalledWith(actor, { sources: [{ defectId: sourceId, expectedVersion: 4 }] });
    const issued = jest.spyOn(core, 'issue').mockResolvedValue({ replayed: false } as never);
    await service.issue(actor, issue, 'trace', 'key');
    expect(issued).toHaveBeenCalledWith(actor, toCoreEightDIssue(issue), 'trace', 'key');
    for (const name of ['complete', 'returnForChanges'] as const) {
      const spy = jest.spyOn(core, name).mockResolvedValue(undefined);
      const tx = {} as Prisma.TransactionClient, context = {} as WorkflowClosureContext;
      await service[name](tx, context, actor);
      expect(spy).toHaveBeenCalledWith(tx, context, actor);
    }
  });

  it('preserves configuration and assignment calls and propagates core denials unchanged', async () => {
    const core = domain.factory(...dependencies), service = new domain.Service(core);
    const binding = { organizationId: actor.organizationId, workflowDefinitionId: randomUUID(), workflowVersionId: randomUUID(), version: 1, enabled: false };
    const readBinding = jest.spyOn(core, 'binding').mockResolvedValue(binding);
    expect(await service.binding(actor)).toBe(binding);
    expect(readBinding).toHaveBeenCalledWith(actor);
    const bind = jest.spyOn(core, 'bind').mockResolvedValue(binding);
    const input = { expectedVersion: 0, workflowDefinitionId: binding.workflowDefinitionId, workflowVersionId: binding.workflowVersionId };
    expect(await service.bind(actor, input, 'key', 'trace')).toBe(binding);
    expect(bind).toHaveBeenCalledWith(actor, input, 'key', 'trace');
    const activate = jest.spyOn(core, 'activate').mockResolvedValue(binding);
    const activation = { expectedVersion: 1, enabled: false };
    expect(await service.activate(actor, activation, 'key', 'trace')).toBe(binding);
    expect(activate).toHaveBeenCalledWith(actor, activation, 'key', 'trace');
    const options = { users: [], departments: [], userTotal: 0, departmentTotal: 0, page: 1, pageSize: 20 };
    const assignments = jest.spyOn(core, 'assignmentOptions').mockResolvedValue(options);
    const query = { action: 'ISSUE' as const, page: 1, pageSize: 20 };
    expect(await service.assignmentOptions(actor, query)).toBe(options);
    expect(assignments).toHaveBeenCalledWith(actor, query);
    const denied = new HttpException({ code: 'FEATURE_PERMISSION_DENIED' }, 403);
    jest.spyOn(core, 'read').mockRejectedValue(denied);
    await expect(service.read(actor, problemId)).rejects.toBe(denied);
  });

  it('uses the authenticated request actor rather than body-provided identity', async () => {
    const service = new domain.Service(domain.factory(...dependencies));
    const controller = new domain.Controller(service);
    const spy = jest.spyOn(service, 'issue').mockResolvedValue({ replayed: false } as never);
    const request = { [AUTHENTICATED_SESSION]: { id: actor.sessionId, user: actor }, authorizedOrganizationId: actor.organizationId, headers: {} };
    await controller.issue(request as never, issue, 'idempotency-key');
    expect(spy.mock.calls[0]![0]).toEqual({ ...actor, scopeOrganizationId: actor.organizationId });
    expect(spy.mock.calls[0]![3]).toBe('idempotency-key');
  });

  it('generates domain routes and concrete source schemas without process HTTP paths', async () => {
    const module = await Test.createTestingModule({ controllers: [domain.Controller], providers: [{ provide: domain.Service, useValue: {} }] }).compile();
    const app = module.createNestApplication();
    try {
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
      expect(Object.keys(document.paths)).toHaveLength(13);
      expect(Object.keys(document.paths).every(path => path.startsWith(`/api/v1/${domain.path}/eight-d`))).toBe(true);
      const schemas = document.components!.schemas! as Record<string, SchemaObject>;
      const report = schemas[`${domain.name}EightDReportDto`]!;
      expect(report.properties!.document).toEqual({ $ref: '#/components/schemas/ProcessEightDDocumentDto' });
      const source = schemas.InternalEightDHttpSourceDto!;
      expect(source.properties).toHaveProperty('sourceId');
      expect(source.properties).not.toHaveProperty('defectId');
      for (const name of ['InternalEightDHttpSourceConfirmationDto', `${domain.name}EightDSourcePreviewDto`, 'InternalEightDHttpSourceSnapshotDto']) {
        expect(schemas[name]!.properties).toHaveProperty('sourceId');
        expect(schemas[name]!.properties).not.toHaveProperty('defectId');
      }
      expect(schemas[`${domain.name}EightDSourcesDto`]!.properties).not.toHaveProperty('removeDefectIds');
    } finally { await app.close(); }
  });
});
