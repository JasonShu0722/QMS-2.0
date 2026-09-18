import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { AuthenticatedGuard } from '../../src/common/guards/authenticated.guard.js';
import { ACCESS_CONTEXT_METADATA } from '../../src/modules/authorization/access.decorator.js';
import { WorkflowController } from '../../src/modules/workflow/workflow.controller.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';

const draft = {
  nodes: [
    { id: 'start', type: 'ACTION', name: '处理', config: { isStart: true, assignment: { roleCode: 'QUALITY' } } },
    { id: 'close', type: 'CLOSE', name: '关闭', config: { isEnd: true, assignment: { roleCode: 'QUALITY' } } },
  ],
  transitions: [{ id: 'finish', from: 'start', to: 'close' }],
};

function fakePrisma() {
  const definitions: any[] = [];
  const versions: any[] = [];
  const nodes: any[] = [];
  const transitions: any[] = [];
  const tx: any = {
    workflowDefinition: {
      create: async ({ data }: any) => { const value = { id: 'definition-1', ...data }; definitions.push(value); return value; },
      findFirst: async ({ where, include }: any) => { const value = definitions.find((entry) => Object.entries(where).every(([key, expected]) => entry[key] === expected)); return value && include ? { ...value, versions: versions.filter((entry) => entry.workflowDefinitionId === value.id).sort((a, b) => b.version - a.version) } : value ?? null; },
      update: async ({ where, data }: any) => Object.assign(definitions.find((value) => value.id === where.id), data),
    },
    workflowVersion: {
      create: async ({ data }: any) => { const value = { id: `version-${versions.length + 1}`, ...data }; versions.push(value); return value; },
      findFirst: async ({ where, include }: any) => { const value = versions.find((entry) => Object.entries(where).every(([key, expected]) => valueOrUndefined(entry, key) === expected)); if (!value) return null; return include ? { ...value, nodes: nodes.filter((node) => node.workflowVersionId === value.id), transitions: transitions.filter((entry) => entry.workflowVersionId === value.id) } : value; },
      findUnique: async ({ where }: any) => versions.find((value) => value.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(versions.find((value) => value.id === where.id), data),
      aggregate: async () => ({ _max: { version: Math.max(0, ...versions.map((value) => value.version)) } }),
    },
    workflowNode: {
      create: async ({ data }: any) => { nodes.push(data); return data; },
      deleteMany: async ({ where }: any) => { for (let index = nodes.length - 1; index >= 0; index -= 1) if (nodes[index].workflowVersionId === where.workflowVersionId) nodes.splice(index, 1); },
    },
    workflowTransition: {
      create: async ({ data }: any) => { transitions.push(data); return data; },
      deleteMany: async ({ where }: any) => { for (let index = transitions.length - 1; index >= 0; index -= 1) if (transitions[index].workflowVersionId === where.workflowVersionId) transitions.splice(index, 1); },
    },
  };
  return { $transaction: async (work: (value: any) => Promise<unknown>) => work(tx), ...tx };
}

function valueOrUndefined(value: any, key: string) { return value[key]; }

describe('workflow version release', () => {
  it('publishes an immutable version and refuses draft mutation afterward', async () => {
    const prisma = fakePrisma();
    const service = new WorkflowDefinitionService(prisma as never, new WorkflowValidationService(), { record: jest.fn() } as never);
    await service.createDraft({ organizationId: 'org-1', userId: 'user-1', code: 'QMS', name: 'QMS', draft });
    const published = await service.publishVersion({ organizationId: 'org-1', userId: 'user-1', definitionId: 'definition-1', changeNote: 'initial' });
    expect(published.status).toBe('PUBLISHED');
    expect(published.version).toBe(1);
    await expect(service.updateDraft({ organizationId: 'org-1', userId: 'user-1', definitionId: 'definition-1', draft })).rejects.toBeInstanceOf(ConflictException);
  });

  it('copies a published version to a new draft while keeping the published snapshot', async () => {
    const prisma = fakePrisma();
    const service = new WorkflowDefinitionService(prisma as never, new WorkflowValidationService(), { record: jest.fn() } as never);
    await service.createDraft({ organizationId: 'org-1', userId: 'user-1', code: 'QMS', name: 'QMS', draft });
    const published = await service.publishVersion({ organizationId: 'org-1', userId: 'user-1', definitionId: 'definition-1' });
    const copied = await service.copyPublishedVersion({ organizationId: 'org-1', userId: 'user-1', definitionId: 'definition-1' });
    expect((copied.version as any).status).toBe('DRAFT');
    expect((copied.version as any).version).toBe(2);
    expect(published.status).toBe('PUBLISHED');
    expect(published.version).toBe(1);
  });

  it('rejects a workflow route without the workflow permission with a stable 403 code', async () => {
    const session = { id: 'session-1', user: { id: 'user-1', organizationId: 'org-1', accountType: 'INTERNAL' as const } };
    const sessions = { resolve: jest.fn().mockResolvedValue(session) };
    const scopes = { fromSession: jest.fn() };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const authorization = new AuthorizationService({ userRole: { count: jest.fn().mockResolvedValue(0) } } as never);
    const guard = new AuthenticatedGuard(new Reflector(), sessions as never, scopes as never, authorization, audit as never);
    const request = { method: 'POST', headers: { cookie: 'qms_session=session-token' } } as any;
    const context = {
      getHandler: () => WorkflowController.prototype.create,
      getClass: () => WorkflowController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    const requirement = new Reflector().getAllAndOverride(ACCESS_CONTEXT_METADATA, [WorkflowController.prototype.create, WorkflowController]);
    expect(requirement).toMatchObject({ featurePermission: 'workflow:manage' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(scopes.fromSession).not.toHaveBeenCalled();
  });
});
