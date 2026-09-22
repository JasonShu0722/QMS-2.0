import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ProblemBrowserTestModule } from './problem-browser-fixture.mjs';

const output = process.argv[2];
if (!output) throw new Error('An OpenAPI output path is required.');
const app = await NestFactory.create(ProblemBrowserTestModule, { logger: false });
try {
  const configuration = new DocumentBuilder().setTitle('QMS neutral problem browser test API').setVersion('1.0')
    .addCookieAuth('qms_session', { type: 'apiKey', in: 'cookie' }, 'qms_session').build();
  const document = SwaggerModule.createDocument(app, configuration, { include: [ProblemBrowserTestModule] });
  await writeFile(output, JSON.stringify(document, null, 2));
} finally {
  await app.close();
}
