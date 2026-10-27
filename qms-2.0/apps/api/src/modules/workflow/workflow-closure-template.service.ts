import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { assertWorkflowFeature, type WorkflowActor } from './workflow-access-policy.js';
import { workflowError } from './workflow-runtime-policy.js';
import { WorkflowDefinitionService } from './workflow-definition.service.js';
import { CreateWorkflowClosureTemplateDto, type WorkflowClosureTemplatesDto } from './workflow-closure-template.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { WorkflowDefinitionResponseDto } from './workflow.dto.js';
import type { WorkflowDraft } from './workflow-validation.service.js';

@Injectable()
export class WorkflowClosureTemplateService {
  constructor(private readonly prisma: PrismaService, private readonly definitions: WorkflowDefinitionService, private readonly mutations: AdminMutationService) {}

  async list(actor: WorkflowActor): Promise<WorkflowClosureTemplatesDto> {
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      await this.authorize(tx, actor);
      return { items: [{ policy: 'INTERNAL', name: '内部问题关闭审核' }, { policy: 'SUPPLIER', name: '供应商问题关闭审核' }] };
    });
  }

  async initialize(actor: WorkflowActor, input: CreateWorkflowClosureTemplateDto, key: string | undefined, traceId: string): Promise<WorkflowDefinitionResponseDto> {
    const body = plainToInstance(CreateWorkflowClosureTemplateDto, input);
    if ((await validate(body, { whitelist: true, forbidNonWhitelisted: true })).length) throw new BadRequestException();
    return this.mutations.run({ actor, organizationId: actor.organizationId, key, action: 'WORKFLOW_CLOSURE_TEMPLATE_INITIALIZED', payload: body,
      permission: 'workflow:manage', traceId, isolationLevel: 'ReadCommitted' }, tx => this.definitions.createDraft({
      actor, organizationId: actor.organizationId, userId: actor.id, traceId, code: body.code, name: body.name, draft: this.graph(body),
    }, tx), tx => this.authorize(tx, actor));
  }

  private async authorize(tx: Prisma.TransactionClient, actor: WorkflowActor): Promise<void> {
    if (actor.accountType !== 'INTERNAL') workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, actor.organizationId, 'workflow:manage');
    const organization = await tx.organization.findUnique({ where: { id: actor.organizationId }, select: { type: true } });
    if (organization?.type !== 'INTERNAL') workflowError('ORGANIZATION_SCOPE_DENIED', 403);
  }

  private graph(body: CreateWorkflowClosureTemplateDto): WorkflowDraft {
    const supplierEightD = body.policy === 'SUPPLIER' && body.domainCode === 'supplier-quality';
    return {
      nodes: [
        { id: 'owner', type: 'ACTION', name: '负责人处理', config: { isStart: true, assignment: { permission: supplierEightD ? 'supplier-quality:responses:write' : 'workflow:act' },
          ...(supplierEightD ? { supplierEightD: { schemaVersion: 1, reminderEveryHours: null } } : {}),
          ...(body.policy === 'INTERNAL' && ['process-quality', 'customer-quality', 'new-product-quality'].includes(body.domainCode) ? { processEightD: {
            schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null,
          } } : {}) } },
        { id: 'closure', type: 'APPROVAL', name: '关闭审核', config: { closureReview: { schemaVersion: 1, policy: body.policy, domainCode: body.domainCode } } },
        { id: 'close', type: 'CLOSE', name: '关闭', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
      ],
      transitions: [
        { id: 'submit', from: 'owner', to: 'closure', action: 'SUBMIT' },
        { id: 'approve', from: 'closure', to: 'close', action: 'APPROVE' },
        { id: 'return', from: 'closure', to: 'owner', action: 'RETURN' },
      ],
    };
  }
}
