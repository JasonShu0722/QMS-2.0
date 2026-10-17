import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { setupOpenApi } from '../../src/openapi.js';
import { PROBLEM_STATUSES, RESPONSE_FORMS } from '../../src/modules/problem-index/problem.types.js';
import { WORKFLOW_NODE_TYPES, WORKFLOW_VERSION_STATUSES } from '../../src/modules/workflow/workflow.types.js';
import { TASK_STATUSES, NOTIFICATION_STATUSES } from '../../src/modules/task-notification/task.types.js';
import { PLATFORM_ERROR_CODES } from '../../src/common/contracts/platform-error.js';

describe('OpenAPI HTTP contract', () => {
  it('serves concrete auth, organization, permission and safe error schemas', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({}).compile();
    const app = moduleRef.createNestApplication();
    setupOpenApi(app);
    await app.init();
    try {
      const response = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
      expect(response.body.paths['/api/v1/auth/login'].post.requestBody.content['application/json'].schema)
        .toEqual({ $ref: '#/components/schemas/LoginDto' });
      expect(response.body.paths['/api/v1/auth/session'].get.responses['200'].content['application/json'].schema)
        .toEqual({ $ref: '#/components/schemas/SessionResponseDto' });
      expect(response.body.components.schemas.LoginResponseDto.properties.accountType.enum).toEqual(['INTERNAL', 'SUPPLIER']);
      expect(response.body.components.schemas.ErrorResponse.required).toEqual(['code', 'message', 'fields', 'traceId']);
      const schemas = response.body.components.schemas;
      for (const [name, values] of Object.entries({ ProblemStatus: PROBLEM_STATUSES, ResponseForm: RESPONSE_FORMS,
        WorkflowNodeType: WORKFLOW_NODE_TYPES, WorkflowVersionStatus: WORKFLOW_VERSION_STATUSES,
        TaskStatus: TASK_STATUSES, NotificationStatus: NOTIFICATION_STATUSES, PlatformErrorCode: PLATFORM_ERROR_CODES })) {
        expect(schemas[name]).toEqual({ type: 'string', enum: [...values] });
      }
      expect(schemas.PlatformTypesDto.properties.problemDomainCode).toMatchObject({ type: 'string', example: 'neutral-test' });
      expect(schemas.PlatformTypesDto.properties.problemDomainCode.enum).toBeUndefined();
      expect(response.body.paths['/api/v1/organizations/current'].get.parameters[0].name).toBe('organizationId');
      expect(response.body.paths['/api/v1/system/permissions'].get.responses['200'].content['application/json'].schema)
        .toEqual({ $ref: '#/components/schemas/PermissionsResponseDto' });
      expect(response.body.paths['/api/v1/supplier-incoming/inspections'].get.responses['200'].content['application/json'].schema)
        .toEqual({ $ref: '#/components/schemas/IncomingInspectionPageDto' });
      expect(schemas.IncomingInspectionDto.properties.supplierOrganizationId).toMatchObject({ type: 'string', nullable: true });
    } finally {
      await app.close();
    }
  });
});
