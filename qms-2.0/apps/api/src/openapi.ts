import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PlatformTypesDto } from './common/contracts/platform-types.dto.js';

export function createOpenApiDocument(app: INestApplication) {
  const configuration = new DocumentBuilder()
    .setTitle('QMS 2.0 Foundation API')
    .setVersion('2.0')
    .addCookieAuth('qms_session', { type: 'apiKey', in: 'cookie' }, 'qms_session')
    .build();
  return SwaggerModule.createDocument(app, configuration, { extraModels: [PlatformTypesDto] });
}

export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('api/v1/docs', app, createOpenApiDocument(app), {
    jsonDocumentUrl: '/api/v1/openapi.json',
    ui: false,
    raw: ['json'],
  });
}
