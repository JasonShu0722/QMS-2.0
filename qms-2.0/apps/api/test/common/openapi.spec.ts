import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { setupOpenApi } from '../../src/openapi.js';

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
      expect(response.body.paths['/api/v1/organizations/current'].get.parameters[0].name).toBe('organizationId');
      expect(response.body.paths['/api/v1/system/permissions'].get.responses['200'].content['application/json'].schema)
        .toEqual({ $ref: '#/components/schemas/PermissionsResponseDto' });
    } finally {
      await app.close();
    }
  });
});
