import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';

const organizationId = '20000000-0000-4000-8000-000000000001';
const otherOrganizationId = '20000000-0000-4000-8000-000000000002';
const userId = '10000000-0000-4000-8000-000000000001';

describe('thin problem index', () => {
  const tx = {
    problemIndex: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
    problemIndex: tx.problemIndex,
  };
  const numbering = { allocateReportNumber: jest.fn() };
  const audit = { record: jest.fn() };
  const outbox = { enqueue: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.problemIndex.findFirst.mockResolvedValue(null);
    tx.problemIndex.create.mockResolvedValue({
      id: 'problem-id', organizationId, reportNumber: 'PROBLEM-2609-001',
      domainCode: 'neutral-test', problemType: 'DEMO', sourceType: 'NEUTRAL', sourceId: '30000000-0000-4000-8000-000000000001',
      status: 'OPEN', severity: 'LOW', version: 1,
    });
    numbering.allocateReportNumber.mockResolvedValue({ reportNumber: 'PROBLEM-2609-001', ruleVersionId: 'rule-id', ruleVersion: 1, sequence: 1 });
    audit.record.mockResolvedValue({ id: 'audit-id' });
    outbox.enqueue.mockResolvedValue({ id: 'outbox-id' });
  });

  it('creates a numbered index, audit event and outbox entry in one transaction', async () => {
    const service = new ProblemIndexService(prisma as never, numbering as never, audit as never, outbox as never);
    const result = await service.createFromDomain(tx as never, {
      organizationId, domainCode: 'neutral-test', problemType: 'DEMO', sourceType: 'NEUTRAL',
      sourceId: '30000000-0000-4000-8000-000000000001', severity: 'LOW', createdById: userId,
    });
    expect(result.reportNumber).toBe('PROBLEM-2609-001');
    expect(numbering.allocateReportNumber).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'ProblemIndex' }), tx);
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PROBLEM_INDEX_CREATED' }), tx);
  });

  it('returns the existing index for a duplicate source reference without consuming a number', async () => {
    tx.problemIndex.findFirst.mockResolvedValueOnce({ id: 'existing', reportNumber: 'PROBLEM-2609-001', organizationId });
    const service = new ProblemIndexService(prisma as never, numbering as never, audit as never, outbox as never);
    const result = await service.createFromDomain(tx as never, {
      organizationId, domainCode: 'neutral-test', problemType: 'DEMO', sourceType: 'NEUTRAL',
      sourceId: '30000000-0000-4000-8000-000000000001', severity: 'LOW', createdById: userId,
    });
    expect(result.id).toBe('existing');
    expect(numbering.allocateReportNumber).not.toHaveBeenCalled();
    expect(tx.problemIndex.create).not.toHaveBeenCalled();
  });

  it('scopes page and detail queries to the authorized organization', async () => {
    tx.problemIndex.findMany.mockResolvedValue([{ id: 'problem-id', organizationId }]);
    tx.problemIndex.count.mockResolvedValue(1);
    tx.problemIndex.findFirst.mockResolvedValue({ id: 'problem-id', organizationId });
    const service = new ProblemIndexService(prisma as never, numbering as never, audit as never, outbox as never);
    await service.findIndexPage({ organizationId, page: 1, pageSize: 20 });
    await service.findById('problem-id', organizationId);
    expect(tx.problemIndex.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId }) }));
    expect(tx.problemIndex.findFirst).toHaveBeenCalledWith({ where: { organizationId, id: 'problem-id' } });
    expect(otherOrganizationId).not.toBe(organizationId);
  });

  it('does not expose a generic problem index create route', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/api/v1/problem-index').send({}).expect(404);
    await app.close();
  });
});
