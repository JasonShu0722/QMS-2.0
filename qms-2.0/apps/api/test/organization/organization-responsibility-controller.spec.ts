import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import type { Request } from 'express';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ACCESS_CONTEXT_METADATA } from '../../src/modules/authorization/access.decorator.js';
import { AUTHENTICATED_SESSION } from '../../src/common/guards/authenticated.guard.js';
import { OrganizationResponsibilityController } from '../../src/modules/organization/organization-responsibility.controller.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';

describe('management responsibility HTTP boundary metadata', () => {
  it('uses organizationId exclusively from the UUID-scoped URL', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OrganizationResponsibilityController)).toBe('api/v1/organizations/:organizationId');
  });

  it.each([
    ['listManagementBindings', RequestMethod.GET, 'management-bindings', 'read'],
    ['createManagementBinding', RequestMethod.POST, 'management-bindings', 'manage'],
    ['updateManagementBinding', RequestMethod.PATCH, 'management-bindings/:bindingId', 'manage'],
    ['listMinisterScopes', RequestMethod.GET, 'minister-scopes', 'read'],
    ['createMinisterScope', RequestMethod.POST, 'minister-scopes', 'manage'],
    ['updateMinisterScope', RequestMethod.PATCH, 'minister-scopes/:scopeId', 'manage'],
    ['managementResponsibilities', RequestMethod.GET, 'management-responsibilities', 'read'],
    ['responsibilityAssignments', RequestMethod.GET, 'responsibility-assignments', 'read'],
  ])('%s exposes the approved verb, path, scope and permission', (name, method, path, access) => {
    const handler = (OrganizationResponsibilityController.prototype as unknown as Record<string, object>)[name];
    expect(handler).toEqual(expect.any(Function));
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(ACCESS_CONTEXT_METADATA, handler)).toEqual({
      featurePermission: `organization:structure:${access}`,
      organizationScope: { source: 'params', field: 'organizationId', optional: false },
    });
    if (access === 'manage') {
      expect(Reflect.getMetadata('swagger/apiParameters', handler)).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        expect.objectContaining({ name: 'x-csrf-token', required: true }),
      ]));
    }
  });

  it('passes the authenticated actor and server trace, never an actor from request data', async () => {
    const response = { id: randomUUID() };
    const service = Object.create(OrganizationResponsibilityService.prototype) as OrganizationResponsibilityService;
    const methods = ['createManagementBinding', 'updateManagementBinding', 'createMinisterScope', 'updateMinisterScope'] as const;
    const calls = methods.map((method) => jest.spyOn(service, method).mockResolvedValue(response as never));
    const controller = new OrganizationResponsibilityController(service);
    const organizationId = randomUUID();
    const id = randomUUID();
    const user = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL' as const };
    const sessionId = randomUUID();
    const key = randomUUID();
    const get = jest.fn<(name: string) => string>().mockReturnValue(key);
    const request = { get, authorizedOrganizationId: organizationId, [AUTHENTICATED_SESSION]: { id: sessionId, user } } as unknown as Request;
    const binding = { departmentId: randomUUID(), positionId: randomUUID(), responsibility: 'SECTION_MANAGER' as const };
    const ministerScope = { departmentId: randomUUID(), sectionDepartmentId: randomUUID(), ministerAssignmentId: randomUUID() };
    const update = { expectedVersion: 1, status: 'DISABLED' as const };
    expect(await controller.createManagementBinding(organizationId, binding, request)).toEqual(response);
    expect(await controller.updateManagementBinding(organizationId, id, update, request)).toEqual(response);
    expect(await controller.createMinisterScope(organizationId, ministerScope, request)).toEqual(response);
    expect(await controller.updateMinisterScope(organizationId, id, update, request)).toEqual(response);
    const actor = { ...user, sessionId, scopeOrganizationId: organizationId };
    expect(calls[0]).toHaveBeenCalledWith(actor, organizationId, binding, expect.any(String), key);
    expect(calls[1]).toHaveBeenCalledWith(actor, organizationId, id, update, expect.any(String), key);
    expect(calls[2]).toHaveBeenCalledWith(actor, organizationId, ministerScope, expect.any(String), key);
    expect(calls[3]).toHaveBeenCalledWith(actor, organizationId, id, update, expect.any(String), key);
    expect(new Set(calls.map((call) => call.mock.calls[0]!.at(-2))).size).toBe(1);
    expect(get).toHaveBeenCalledWith('Idempotency-Key');
  });

  it('publishes all request and evidence DTOs in real Nest Swagger without database initialization', async () => {
    const app = (await Test.createTestingModule({
      controllers: [OrganizationResponsibilityController],
      providers: [{ provide: OrganizationResponsibilityService, useValue: Object.create(OrganizationResponsibilityService.prototype) }],
    }).compile()).createNestApplication();
    try {
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Responsibilities').setVersion('1').build());
      const schemas = document.components!.schemas!;
      expect(schemas.CreateManagementBindingDto).toMatchObject({ required: ['departmentId', 'responsibility', 'positionId'] });
      expect(schemas.ResolvedManagementResponsibilityDto).toMatchObject({
        properties: {
          responsibility: { enum: ['SECTION_MANAGER', 'MINISTER'] },
          bindingId: { format: 'uuid' }, bindingVersion: { type: 'number' },
          scopeId: { nullable: true }, scopeVersion: { nullable: true },
          assignmentId: { format: 'uuid' }, positionId: { format: 'uuid' },
          positionVersion: { type: 'number' }, organizationVersion: { type: 'number' },
        },
      });
      const preview = document.paths['/api/v1/organizations/{organizationId}/management-responsibilities'].get!;
      expect(preview.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'organizationId', in: 'path', required: true }),
        expect.objectContaining({ name: 'sectionDepartmentId', in: 'query', required: true }),
      ]));
      expect(document.paths['/api/v1/organizations/{organizationId}/responsibility-assignments'].get!.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'departmentId', in: 'query', required: true }),
        expect.objectContaining({ name: 'search', in: 'query', required: false }),
        expect.objectContaining({ name: 'limit', in: 'query', required: false }),
      ]));
    } finally {
      await app.close();
    }
  });
});
