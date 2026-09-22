import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../src/common/security/password-hasher.service.js';
import { workflowError } from '../../src/modules/workflow/workflow-runtime-policy.js';
import type { FileActor, FileResourceAccessAdapter, FileResourceRef } from '../../src/modules/file-management/file-resource-access.js';

export class NeutralFileResourceAdapter implements FileResourceAccessAdapter {
  readonly resourceType = 'NeutralEvidence';
  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef) {
    await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${resource.resourceId}::uuid FOR UPDATE`;
    const problem = await tx.problemIndex.findUnique({ where: { id: resource.resourceId } });
    if (!problem || problem.organizationId !== actor.organizationId || problem.ownerId !== actor.id || problem.archivedAt || ['CLOSED', 'ARCHIVED'].includes(problem.status)) workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: problem.organizationId, version: problem.version };
  }
}

export async function neutralFileFixture(prisma: PrismaService, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL', password?: string) {
  const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Attachment fixture', type: accountType } });
  const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: password ? await new PasswordHasherService().hash(password) : 'fixture', accountType } });
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, ownerId: user.id, reportNumber: randomUUID(), domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
  const actor: FileActor = { id: user.id, organizationId: organization.id, accountType, sessionId: session.id };
  const resource = { resourceType: 'NeutralEvidence', resourceId: problem.id };
  return { organization, user, session, problem, actor, resource };
}
