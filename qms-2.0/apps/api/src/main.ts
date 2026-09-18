import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/contracts/global-exception.filter.js';

@Module({})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
