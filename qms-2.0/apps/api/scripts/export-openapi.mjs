import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { createOpenApiDocument } from '../dist/openapi.js';

const output = process.argv[2];
if (!output) throw new Error('An OpenAPI output path is required.');
const app = await NestFactory.create(AppModule, { logger: false });
try {
  await writeFile(output, JSON.stringify(createOpenApiDocument(app), null, 2));
} finally {
  await app.close();
}
