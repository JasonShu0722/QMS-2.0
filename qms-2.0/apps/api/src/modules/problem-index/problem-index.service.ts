import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ProblemIndex } from '../../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { NumberingService } from './numbering.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';

type ProblemStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' | 'ARCHIVED';

export interface CreateProblemIndexInput {
  organizationId: string;
  domainCode: string;
  problemType: string;
  sourceType: string;
  sourceId?: string;
  severity: string;
  responsibleParty?: string;
  ownerId?: string;
  dueAt?: Date;
  createdById?: string;
  traceId?: string;
}

export interface UpdateDomainSummaryInput {
  organizationId: string;
  id: string;
  expectedVersion: number;
  problemType?: string;
  severity?: string;
  responsibleParty?: string | null;
  ownerId?: string | null;
  dueAt?: Date | null;
  status?: ProblemStatus;
  updatedById?: string;
  traceId?: string;
}

export interface ProblemIndexPageInput {
  organizationId: string;
  page?: number;
  pageSize?: number;
  domainCode?: string;
  problemType?: string;
  status?: ProblemStatus;
  severity?: string;
  search?: string;
}

interface ProblemIndexClient {
  $executeRaw?: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  problemIndex: {
    findFirst(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

function codeForNumbering(value: string): string {
  const code = value.trim().replace(/[^A-Za-z0-9_-]/g, '-').toUpperCase();
  return code.slice(0, 64) || 'PROBLEM';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

@Injectable()
export class ProblemIndexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditLogService,
    private readonly outbox: OutboxService,
  ) {}

  async lockForWorkflow(transaction: Prisma.TransactionClient, organizationId: string, id: string): Promise<ProblemIndex> {
    await transaction.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    const problem = await transaction.problemIndex.findFirst({ where: { organizationId, id, archivedAt: null } });
    if (!problem) throw new HttpException({ code: 'PROBLEM_NOT_FOUND' }, 404);
    return problem;
  }

  async applyWorkflowState(transaction: Prisma.TransactionClient, input: {
    organizationId: string; id: string; expectedVersion: number; expectedInstanceId: string | null;
    instanceId: string; status: 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED'; actorUserId: string;
    problemType?: string;
  }): Promise<number> {
    const updated = await transaction.problemIndex.updateMany({
      where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, workflowInstanceId: input.expectedInstanceId, archivedAt: null },
      data: { workflowInstanceId: input.instanceId, status: input.status, ...(input.problemType ? { problemType: input.problemType } : {}), closedAt: input.status === 'CLOSED' ? new Date() : null, version: { increment: 1 }, updatedById: input.actorUserId },
    });
    if (updated.count !== 1) throw new HttpException({ code: 'CONCURRENCY_CONFLICT' }, 409);
    return input.expectedVersion + 1;
  }

  async createFromDomain(
    transaction: ProblemIndexClient,
    input: CreateProblemIndexInput,
  ): Promise<Record<string, unknown>> {
    this.assertCreateInput(input);
    if (input.sourceId && transaction.$executeRaw) {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${input.organizationId}:${input.sourceType}:${input.sourceId}`}, 0)
        )
      `;
    }
    const existing = input.sourceId
      ? await transaction.problemIndex.findFirst({
        where: { organizationId: input.organizationId, sourceType: input.sourceType, sourceId: input.sourceId },
      })
      : null;
    if (existing) return existing;

    const allocated = await this.numbering.allocateReportNumber(transaction as never, {
      organizationId: input.organizationId,
      ruleCode: 'PROBLEM',
      classificationCode: codeForNumbering(input.domainCode),
      createdById: input.createdById,
    });
    try {
      const created = await transaction.problemIndex.create({
        data: {
          id: randomUUID(), organizationId: input.organizationId, reportNumber: allocated.reportNumber,
          domainCode: input.domainCode.trim(), problemType: input.problemType.trim(),
          sourceType: input.sourceType.trim(), sourceId: input.sourceId ?? null,
          severity: input.severity.trim(), responsibleParty: input.responsibleParty?.trim() ?? null,
          ownerId: input.ownerId ?? null, dueAt: input.dueAt ?? null,
          status: 'OPEN', version: 1, createdById: input.createdById ?? null, updatedById: input.createdById ?? null,
        },
      });
      const traceId = input.traceId ?? randomUUID();
      await this.audit.record({
        organizationId: input.organizationId, actorUserId: input.createdById, action: 'PROBLEM_INDEX_CREATED',
        resourceType: 'ProblemIndex', resourceId: String(created.id), outcome: 'SUCCESS', traceId,
        metadata: { organizationId: input.organizationId, status: 'OPEN' },
      }, transaction as never);
      await this.outbox.enqueue({
        eventKey: `problem-index:${created.id}:created`, aggregateType: 'ProblemIndex', aggregateId: String(created.id),
        eventType: 'PROBLEM_INDEX_CREATED', payload: {
          organizationId: input.organizationId, problemIndexId: String(created.id), reportNumber: String(created.reportNumber),
        },
      }, transaction as never);
      return created;
    } catch (error) {
      if (!isUniqueViolation(error) || !input.sourceId) throw error;
      const duplicate = await transaction.problemIndex.findFirst({
        where: { organizationId: input.organizationId, sourceType: input.sourceType, sourceId: input.sourceId },
      });
      if (duplicate) return duplicate;
      throw error;
    }
  }

  async updateDomainSummary(
    transaction: ProblemIndexClient,
    input: UpdateDomainSummaryInput,
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = { version: { increment: 1 }, updatedById: input.updatedById ?? null };
    for (const field of ['problemType', 'severity', 'responsibleParty', 'ownerId', 'dueAt', 'status'] as const) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    const updated = await transaction.problemIndex.updateMany({
      where: { organizationId: input.organizationId, id: input.id, version: input.expectedVersion, archivedAt: null }, data,
    });
    if (updated.count !== 1) throw new Error('PROBLEM_VERSION_CONFLICT');
    const result = await this.findById(input.id, input.organizationId, transaction);
    await this.audit.record({
      organizationId: input.organizationId, actorUserId: input.updatedById, action: 'PROBLEM_INDEX_UPDATED',
      resourceType: 'ProblemIndex', resourceId: input.id, outcome: 'SUCCESS', traceId: input.traceId ?? randomUUID(),
      metadata: { organizationId: input.organizationId, status: String(result.status ?? '') },
    }, transaction as never);
    return result;
  }

  async findIndexPage(input: ProblemIndexPageInput, client: ProblemIndexClient = this.prisma as unknown as ProblemIndexClient): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 20)));
    const where: Record<string, unknown> = { organizationId: input.organizationId };
    for (const field of ['domainCode', 'problemType', 'status', 'severity'] as const) {
      if (input[field]) where[field] = input[field];
    }
    if (input.search?.trim()) {
      const search = input.search.trim();
      where.OR = [
        { reportNumber: { contains: search, mode: 'insensitive' } },
        { responsibleParty: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      client.problemIndex.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      client.problemIndex.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findById(id: string, organizationId: string, client: ProblemIndexClient = this.prisma as unknown as ProblemIndexClient): Promise<Record<string, unknown>> {
    const result = await client.problemIndex.findFirst({ where: { organizationId, id } });
    if (!result) throw new NotFoundException('PROBLEM_INDEX_NOT_FOUND');
    return result;
  }

  async archive(transaction: ProblemIndexClient, organizationId: string, id: string, expectedVersion: number, actorUserId?: string): Promise<Record<string, unknown>> {
    const result = await transaction.problemIndex.updateMany({
      where: { organizationId, id, version: expectedVersion, archivedAt: null },
      data: { status: 'ARCHIVED', archivedAt: new Date(), version: { increment: 1 }, updatedById: actorUserId ?? null },
    });
    if (result.count !== 1) throw new Error('PROBLEM_VERSION_CONFLICT');
    return this.findById(id, organizationId, transaction);
  }

  private assertCreateInput(input: CreateProblemIndexInput): void {
    for (const [name, value] of Object.entries(input)) {
      if (['sourceId', 'responsibleParty', 'ownerId', 'dueAt', 'createdById', 'traceId'].includes(name)) continue;
      if (typeof value !== 'string' || !value.trim()) throw new Error(`PROBLEM_${name.toUpperCase()}_REQUIRED`);
    }
  }
}
