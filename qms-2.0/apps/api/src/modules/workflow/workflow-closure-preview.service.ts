import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import { isSecurityConcurrencyConflict, mfaPolicy } from '../../common/security/session-security.js';
import { OrganizationResponsibilityService } from '../organization/organization-responsibility.service.js';
import type { ResolvedManagementResponsibilityDto } from '../organization/organization-responsibility.dto.js';
import { assertWorkflowFeature, canProcessWorkflowNode, type WorkflowActor } from './workflow-access-policy.js';
import { workflowError } from './workflow-runtime-policy.js';
import { planWorkflowClosure, type WorkflowClosureDuty } from './workflow-closure-policy.js';
import { WorkflowClosurePreviewInputDto, type WorkflowClosureParticipantDto, type WorkflowClosurePreviewDto, type WorkflowClosurePreviewIssueDto } from './workflow-closure-preview.dto.js';

@Injectable()
export class WorkflowClosurePreviewService {
  constructor(private readonly prisma: PrismaService, private readonly responsibilities: OrganizationResponsibilityService) {}

  async resolve(actor: WorkflowActor, input: WorkflowClosurePreviewInputDto): Promise<WorkflowClosurePreviewDto> {
    const body = plainToInstance(WorkflowClosurePreviewInputDto, input);
    if ((await validate(body, { whitelist: true, forbidNonWhitelisted: true })).length
      || body.policy === 'SUPPLIER' && body.ownerUserId !== undefined) throw new BadRequestException();
    if (actor.accountType !== 'INTERNAL') workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    try {
      return await this.prisma.$transaction(async tx => {
        await this.authorize(tx, actor);
        const section = await tx.department.findFirst({ where: { id: body.responsibleSectionDepartmentId, organizationId: actor.organizationId } });
        if (!section) workflowError('STRUCTURE_REFERENCE_INVALID', 409);
        // Resolve before acquiring any authentication/structure locks; this endpoint creates no execution authority.
        const management = await this.responsibilities.resolveManagementResponsibilities(tx, actor.organizationId, section.id);
        const at = management.at;
        const issues: WorkflowClosurePreviewIssueDto[] = [];
        const professional = await this.person(tx, actor.organizationId, body.professionalUserId, at, true);
        if (!professional) issues.push({ duty: 'PROFESSIONAL', code: 'PARTICIPANT_NOT_ELIGIBLE' });
        const ownerUserId = body.policy === 'INTERNAL' ? await this.owner(tx, actor.organizationId, body.ownerUserId!, section.id, at) : undefined;
        if (body.policy === 'INTERNAL' && !ownerUserId) issues.push({ duty: 'OWNER', code: 'PARTICIPANT_NOT_ELIGIBLE' });
        const required: Array<'SECTION_MANAGER' | 'MINISTER'> = body.policy === 'INTERNAL' && ['HIGH', 'CRITICAL'].includes(body.severity)
          ? ['MINISTER'] : body.policy === 'SUPPLIER' && ['HIGH', 'CRITICAL'].includes(body.severity) ? ['SECTION_MANAGER', 'MINISTER'] : ['SECTION_MANAGER'];
        const resolved: Partial<Record<WorkflowClosureDuty, WorkflowClosureParticipantDto>> = {};
        for (const duty of required) {
          const source = management.responsibilities.find(item => item.responsibility === duty);
          const missing = management.issues.filter(item => item.responsibility === duty);
          if (missing.length) { issues.push(...missing.map(item => ({ duty, code: item.code }))); continue; }
          const identity = source && await this.person(tx, actor.organizationId, source.userId, at);
          if (!identity) { issues.push({ duty, code: 'PARTICIPANT_NOT_ELIGIBLE' }); continue; }
          resolved[duty] = this.managementParticipant(identity, source!);
        }
        const plan = planWorkflowClosure({ policy: body.policy, severity: body.severity,
          ownerUserId: ownerUserId ?? undefined, professional,
          sectionManager: resolved.SECTION_MANAGER ?? null, minister: resolved.MINISTER ?? null });
        await this.authorize(tx, actor);
        return { ...plan, duties: plan.duties.map(item => ({ ...item, participant: item.participant as WorkflowClosureParticipantDto | null })),
          previewOnly: true, configurationReady: issues.length === 0, organizationId: actor.organizationId, sectionDepartmentId: section.id, at: at.toISOString(), issues };
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      if (isSecurityConcurrencyConflict(error)) workflowError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  private async authorize(tx: Prisma.TransactionClient, actor: WorkflowActor) {
    if (!actor.sessionId) workflowError('AUTH_SESSION_REQUIRED', 401);
    await assertWorkflowFeature(tx, actor, actor.organizationId, 'workflow:manage');
    const session = await tx.session.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() },
      user: { mustChangePassword: false } }, select: { securityVersion: true, mfaVerifiedAt: true, user: { select: { securityVersion: true, organization: { select: { type: true } } } } } });
    if (!session || session.securityVersion !== session.user.securityVersion) workflowError('AUTH_SESSION_REQUIRED', 401);
    if (session.user.organization.type !== 'INTERNAL') workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    if ((await mfaPolicy(tx, actor.id)).required && !session.mfaVerifiedAt) workflowError('AUTH_MFA_REQUIRED', 401);
  }

  private async owner(tx: Prisma.TransactionClient, organizationId: string, userId: string, sectionId: string, at: Date) {
    const assignment = await tx.userPosition.findFirst({ where: { organizationId, userId, ...effectivePositionAssignmentWhere(at),
      user: { organizationId, accountType: 'INTERNAL', status: 'ACTIVE' }, position: { organizationId, departmentId: sectionId, status: 'ACTIVE', department: { status: 'ACTIVE' } } }, select: { userId: true } });
    return assignment?.userId ?? null;
  }

  private async person(tx: Prisma.TransactionClient, organizationId: string, userId: string, at: Date, requireWorkflowAct = false): Promise<WorkflowClosureParticipantDto | null> {
    const user = await tx.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE', accountType: 'INTERNAL',
      positions: { some: { organizationId, ...effectivePositionAssignmentWhere(at) } } }, select: { id: true, username: true, fullName: true } });
    if (!user || requireWorkflowAct && !await canProcessWorkflowNode(tx, user.id, organizationId, { assigneeUserId: user.id })) return null;
    // Professional identity is the issuer, not an arbitrarily selected appointment when a user holds several positions.
    return { userId: user.id, username: user.username, fullName: user.fullName, assignmentId: null, positionId: null, departmentId: null,
      bindingId: null, scopeId: null, bindingVersion: null, scopeVersion: null };
  }

  private managementParticipant(identity: WorkflowClosureParticipantDto, source: ResolvedManagementResponsibilityDto): WorkflowClosureParticipantDto {
    return { ...identity, assignmentId: source.assignmentId, positionId: source.positionId, departmentId: source.departmentId,
      bindingId: source.bindingId, bindingVersion: source.bindingVersion, scopeId: source.scopeId, scopeVersion: source.scopeVersion };
  }
}
