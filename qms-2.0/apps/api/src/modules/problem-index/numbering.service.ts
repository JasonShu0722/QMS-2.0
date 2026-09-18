import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

const DEFAULT_PATTERN = '{CODE}-{YYMM}-{SEQ3}';
const MAX_SEQUENCE = 999n;
const CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/;

interface NumberRuleVersion {
  id: string;
  version: number;
  pattern: string;
}

interface NumberingClient {
  $transaction<T>(work: (tx: NumberingClient) => Promise<T>): Promise<T>;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  numberRuleVersion: {
    findFirst(args: { where: Record<string, unknown>; orderBy: Record<string, unknown> }): Promise<NumberRuleVersion | null>;
    findUnique(args: { where: Record<string, unknown> }): Promise<NumberRuleVersion | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    create(args: { data: Record<string, unknown> }): Promise<NumberRuleVersion>;
  };
}

export interface PublishRuleVersionInput {
  organizationId: string;
  ruleCode: string;
  pattern?: string;
  createdById?: string;
}

export interface AllocateReportNumberInput {
  organizationId: string;
  ruleCode: string;
  classificationCode: string;
  ruleVersionId?: string;
  at?: Date;
  createdById?: string;
}

export interface AllocatedReportNumber {
  reportNumber: string;
  ruleVersionId: string;
  ruleVersion: number;
  sequence: number;
}

@Injectable()
export class NumberingService {
  constructor(private readonly prisma: NumberingClient | PrismaService) {}

  async publishRuleVersion(input: PublishRuleVersionInput): Promise<NumberRuleVersion> {
    this.assertCode(input.ruleCode, 'NUMBER_RULE_CODE_INVALID');
    const pattern = input.pattern ?? DEFAULT_PATTERN;
    this.assertPattern(pattern);

    const client = this.prisma as NumberingClient;
    return client.$transaction(async (tx) => {
      const previous = await tx.numberRuleVersion.findFirst({
        where: { organizationId: input.organizationId, ruleCode: input.ruleCode },
        orderBy: { version: 'desc' },
      });
      const version = (previous?.version ?? 0) + 1;
      await tx.numberRuleVersion.updateMany({
        where: { organizationId: input.organizationId, ruleCode: input.ruleCode },
        data: { active: false },
      });
      return tx.numberRuleVersion.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          ruleCode: input.ruleCode,
          version,
          pattern,
          active: true,
          createdById: input.createdById ?? null,
          updatedById: input.createdById ?? null,
        },
      });
    });
  }

  async allocateReportNumber(
    tx: NumberingClient,
    input: AllocateReportNumberInput,
  ): Promise<AllocatedReportNumber> {
    this.assertCode(input.ruleCode, 'NUMBER_RULE_CODE_INVALID');
    this.assertCode(input.classificationCode, 'NUMBER_CLASSIFICATION_INVALID');
    const at = input.at ?? new Date();
    const period = `${String(at.getUTCFullYear()).slice(-2)}${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
    const rule = input.ruleVersionId
      ? await tx.numberRuleVersion.findUnique({ where: { id: input.ruleVersionId } })
      : await tx.numberRuleVersion.findFirst({
        where: { organizationId: input.organizationId, ruleCode: input.ruleCode, active: true },
        orderBy: { version: 'desc' },
      });
    if (!rule) throw new Error('NUMBER_RULE_NOT_FOUND');
    this.assertPattern(rule.pattern);

    const scopeKey = `${input.classificationCode}:${period}`;
    const rows = await tx.$queryRaw<Array<{ allocated: bigint }>>`
      INSERT INTO number_sequences
        (id, organization_id, rule_code, scope_key, next_value, version, created_by_id, updated_by_id, created_at, updated_at)
      VALUES
        (${randomUUID()}::uuid, ${input.organizationId}::uuid, ${input.ruleCode}, ${scopeKey}, 2, 1,
         ${input.createdById ?? null}::uuid, ${input.createdById ?? null}::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (organization_id, rule_code, scope_key)
      DO UPDATE SET next_value = number_sequences.next_value + 1,
                    version = number_sequences.version + 1,
                    updated_by_id = EXCLUDED.updated_by_id,
                    updated_at = CURRENT_TIMESTAMP
      WHERE number_sequences.next_value <= ${MAX_SEQUENCE}
      RETURNING next_value - 1 AS allocated
    `;
    if (rows.length !== 1) throw new Error('NUMBER_SEQUENCE_EXHAUSTED');
    const sequence = Number(rows[0].allocated);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > Number(MAX_SEQUENCE)) {
      throw new Error('NUMBER_SEQUENCE_EXHAUSTED');
    }
    const reportNumber = this.render(rule.pattern, input.classificationCode, period, sequence);
    return {
      reportNumber,
      ruleVersionId: rule.id,
      ruleVersion: rule.version,
      sequence,
    };
  }

  assertImmutable(original: string, candidate: string): void {
    if (original !== candidate) throw new Error('NUMBER_IMMUTABLE');
  }

  private assertCode(value: string, code: string): void {
    if (!CODE_PATTERN.test(value)) throw new Error(code);
  }

  private assertPattern(pattern: string): void {
    if (!pattern.includes('{CODE}') || !pattern.includes('{YYMM}') || !pattern.includes('{SEQ3}')) {
      throw new Error('NUMBER_PATTERN_INVALID');
    }
  }

  private render(pattern: string, code: string, period: string, sequence: number): string {
    return pattern
      .replaceAll('{CODE}', code)
      .replaceAll('{YYMM}', period)
      .replaceAll('{SEQ3}', String(sequence).padStart(3, '0'));
  }
}
