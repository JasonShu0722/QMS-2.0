import 'reflect-metadata';
import { jest } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';

describe('application database lifecycle', () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('registers PrismaService and runs its connection lifecycle at startup', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/qms_unit_test';
    // Unit test only: verify Nest lifecycle wiring without opening a socket.
    const initialize = jest.spyOn(PrismaService.prototype, 'onModuleInit').mockResolvedValue();
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
    try {
      expect(app.get(PrismaService)).toBeDefined();
      expect(initialize).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('delegates initialization to the real Prisma connection method', async () => {
    const prisma = new PrismaService('postgresql://localhost/qms_unit_test');
    const connect = jest.spyOn(prisma, '$connect').mockResolvedValue();
    await prisma.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
    await prisma.$disconnect();
  });

  it('fails startup explicitly when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    await expect(NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }))
      .rejects.toThrow('DATABASE_URL is required; SQLite fallback is forbidden');
  });
});
