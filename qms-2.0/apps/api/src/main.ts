import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/contracts/global-exception.filter.js';
import { setupOpenApi } from './openapi.js';
import { configureHttpProxy } from './http-proxy.js';
import { configureHttpBodyParser } from './http-body-parser.js';
import { installApiObservation } from './modules/system-management/api-observation.middleware.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  installApiObservation(app);
  configureHttpBodyParser(app);
  configureHttpProxy(app);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  setupOpenApi(app);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
