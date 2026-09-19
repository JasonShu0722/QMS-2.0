import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProblemIndexService, type CreateProblemIndexInput } from '../../src/modules/problem-index/problem-index.service.js';

export interface NeutralProblemFixture {
  organizationId: string;
  sourceId?: string;
  problemType?: string;
  severity?: string;
  createdById?: string;
}

export class NeutralDomainAdapter {
  constructor(private readonly prisma: PrismaService, private readonly problems: ProblemIndexService) {}

  async createProblem(fixture: NeutralProblemFixture) {
    const input: CreateProblemIndexInput = {
      organizationId: fixture.organizationId,
      domainCode: 'neutral-test', problemType: fixture.problemType ?? 'NEUTRAL_DEMO',
      sourceType: 'neutral-test', sourceId: fixture.sourceId ?? randomUUID(),
      severity: fixture.severity ?? 'LOW', createdById: fixture.createdById,
    };
    return this.prisma.$transaction((transaction) => this.problems.createFromDomain(transaction as never, input));
  }
}
