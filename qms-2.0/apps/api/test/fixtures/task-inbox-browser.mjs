import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { PasswordHasherService } from '../../dist/common/security/password-hasher.service.js';
import { AuditLogService } from '../../dist/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../dist/modules/task-notification/outbox.service.js';
import { OutboxWorkerService } from '../../dist/modules/task-notification/outbox-worker.service.js';
import { WorkflowEventHandler } from '../../dist/modules/task-notification/workflow-event.handler.js';
import { WorkflowDefinitionService } from '../../dist/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../dist/modules/workflow/workflow-validation.service.js';
import { WorkflowRuntimeService } from '../../dist/modules/workflow/workflow-runtime.service.js';
import { ProblemIndexService } from '../../dist/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../dist/modules/problem-index/numbering.service.js';

const database = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.port === '55440' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') throw new Error('An explicitly disposable local PostgreSQL database is required');
const prisma = new PrismaService();
const [action, identifier] = process.argv.slice(2);
try {
  if (action === 'setup') {
    if (!process.env.QMS_INBOX_FIXTURE_PASSWORD) throw new Error('Fixture password required');
    const suffix = randomUUID();
    const organization = await prisma.organization.create({ data: { code: `INBOX_E2E_${suffix}`, name: 'Inbox browser fixture', type: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'INBOX_HANDLER', name: 'Inbox handler' } });
    for (const code of ['workflow:start', 'workflow:act', 'problem-index:read', 'task:read', 'task:claim', 'notification:read']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    const passwordHash = await new PasswordHasherService().hash(process.env.QMS_INBOX_FIXTURE_PASSWORD);
    const users = [];
    for (const position of ['first', 'second']) {
      const user = await prisma.user.create({ data: { username: `inbox_${position}_${suffix}`, passwordHash, organizationId: organization.id, accountType: 'INTERNAL' } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
      users.push({ id: user.id, username: user.username });
    }
    const audit = new AuditLogService(prisma);
    const outbox = new OutboxService(prisma);
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
    const definition = await definitions.createDraft({ organizationId: organization.id, userId: users[0].id, code: suffix, name: 'Inbox browser workflow', draft: {
      nodes: [
        { id: 'handle', name: '浏览器领取验证', type: 'ACTION', config: { isStart: true, assignment: 'INBOX_HANDLER' } },
        { id: 'close', name: '关闭', type: 'CLOSE', config: { isEnd: true, assignment: 'INBOX_HANDLER' } },
      ], transitions: [{ id: 'submit', from: 'handle', to: 'close' }],
    } });
    const version = await definitions.publishVersion({ organizationId: organization.id, userId: users[0].id, definitionId: definition.id });
    const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, reportNumber: `INBOX-${suffix}`, domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
    const runtime = new WorkflowRuntimeService(prisma, audit, outbox, new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox));
    const started = await runtime.startInstance({ organizationId: organization.id, actor: { id: users[0].id, organizationId: organization.id, accountType: 'INTERNAL' }, problemIndexId: problem.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: problem.id, expectedProblemVersion: 1, idempotencyKey: randomUUID(), traceId: randomUUID() });
    const worker = new OutboxWorkerService(prisma);
    const result = await worker.processAtomicDue(100, new WorkflowEventHandler());
    if (result.failed) throw new Error('Real worker failed during fixture projection');
    const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: started.instanceId } });
    process.stdout.write(JSON.stringify({ organizationId: organization.id, users, taskId: task.id, reportNumber: problem.reportNumber }));
  } else if (action === 'revoke') {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: identifier }, include: { organization: true } });
    if (!user.organization.code.startsWith('INBOX_E2E_')) throw new Error('Not an owned fixture');
    await prisma.userRole.deleteMany({ where: { userId: user.id, organizationId: user.organizationId } });
  } else if (action === 'cleanup') {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: identifier } });
    if (!organization.code.startsWith('INBOX_E2E_')) throw new Error('Not an owned fixture');
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: identifier }, data: { status: 'DISABLED' } });
      await tx.user.updateMany({ where: { organizationId: identifier }, data: { status: 'DISABLED' } });
      await tx.workflowInstance.updateMany({ where: { organizationId: identifier }, data: { status: 'CANCELLED' } });
      await tx.workflowTask.updateMany({ where: { organizationId: identifier }, data: { status: 'CANCELLED' } });
    });
  } else throw new Error('Unknown fixture action');
} finally { await prisma.$disconnect(); }
