import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { writeFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { Prisma } from '../../dist/generated/prisma/client.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { PasswordHasherService } from '../../dist/common/security/password-hasher.service.js';
import { GlobalExceptionFilter } from '../../dist/common/contracts/global-exception.filter.js';
import { configureHttpProxy } from '../../dist/http-proxy.js';
import { PROBLEM_DOMAIN_READ_ADAPTERS } from '../../dist/modules/problem-index/problem-domain-registry.js';
import { WORKFLOW_UPGRADE_ADAPTERS } from '../../dist/modules/workflow/workflow-upgrade.registry.js';
import { FILE_RESOURCE_ADAPTERS } from '../../dist/modules/file-management/file-resource-access.js';
import { WorkflowDefinitionService } from '../../dist/modules/workflow/workflow-definition.service.js';
import { WorkflowRuntimeService } from '../../dist/modules/workflow/workflow-runtime.service.js';
import { OutboxWorkerService } from '../../dist/modules/task-notification/outbox-worker.service.js';
import { WorkflowEventHandler } from '../../dist/modules/task-notification/workflow-event.handler.js';
import {
  NeutralProblemBrowserAdapter,
  NeutralProblemFileAdapter,
  PROBLEM_BROWSER_DOMAIN,
  PROBLEM_BROWSER_RESOURCE,
  PROBLEM_BROWSER_SOURCE,
  ProblemBrowserTestModule,
  prepareProblemBrowserSchema,
} from './problem-browser-fixture.mjs';

const database = new URL(process.env.QMS_PROBLEM_BROWSER_DATABASE_URL ?? process.env.DATABASE_URL ?? 'http://invalid');
if (!['127.0.0.1', '[::1]'].includes(database.hostname) || database.port === '55440'
  || !/^\/qms_problem_browser_[a-f0-9]+$/.test(database.pathname) || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Disposable problem browser database required');
}
if (process.env.DATABASE_URL !== database.toString()) throw new Error('DATABASE_URL must match QMS_PROBLEM_BROWSER_DATABASE_URL');
const port = Number(process.env.QMS_PROBLEM_BROWSER_PORT);
const output = process.env.QMS_PROBLEM_BROWSER_FIXTURE_PATH;
const password = process.env.QMS_PROBLEM_BROWSER_PASSWORD;
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !output || !isAbsolute(output) || !password) throw new Error('Problem browser fixture configuration required');
const repository = await realpath(resolve(process.cwd(), '../..'));
const outputDirectory = await realpath(dirname(output));
const outputRelation = relative(repository, outputDirectory);
if (!outputRelation.startsWith(`..${sep}`) && outputRelation !== '..') throw new Error('Fixture data must remain outside Git');

const readAdapter = new NeutralProblemBrowserAdapter();
const fileAdapter = new NeutralProblemFileAdapter();
const module = await Test.createTestingModule({ imports: [ProblemBrowserTestModule] })
  .overrideProvider(PROBLEM_DOMAIN_READ_ADAPTERS).useValue([readAdapter])
  .overrideProvider(WORKFLOW_UPGRADE_ADAPTERS).useValue([readAdapter])
  .overrideProvider(FILE_RESOURCE_ADAPTERS).useValue([fileAdapter])
  .compile();
const prisma = module.get(PrismaService);
await prepareProblemBrowserSchema(prisma);

async function grant(roleId, codes) {
  for (const code of codes) {
    const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
    await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
  }
}

async function definition(organizationId, userId, code, name, firstName) {
  const definitions = module.get(WorkflowDefinitionService);
  const draft = await definitions.createDraft({ organizationId, userId, code, name, draft: {
    nodes: [
      { id: 'handle', type: 'ACTION', name: firstName, config: { isStart: true, assignment: 'HANDLER' } },
      { id: 'approve', type: 'APPROVAL', name: `${name} approval`, config: { assignment: 'HANDLER' } },
      { id: 'verify', type: 'VERIFICATION', name: `${name} verification`, config: { assignment: 'HANDLER' } },
      { id: 'close', type: 'CLOSE', name: `${name} close`, config: { isEnd: true, assignment: 'HANDLER' } },
    ],
    transitions: [
      { id: 'submit', from: 'handle', to: 'approve' },
      { id: 'approve', from: 'approve', to: 'verify' },
      { id: 'verify', from: 'verify', to: 'close' },
    ],
  } });
  const version = await definitions.publishVersion({ organizationId, userId, definitionId: String(draft.id) });
  return { definitionId: String(draft.id), versionId: String(version.id) };
}

async function seed() {
  const passwordHash = await new PasswordHasherService().hash(password);
  const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Problem browser organization', type: 'INTERNAL' } });
  const user = await prisma.user.create({ data: { organizationId: organization.id, username: `problem_${randomUUID()}`, passwordHash, accountType: 'INTERNAL' } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'HANDLER', name: 'Problem handler' } });
  await grant(role.id, ['workflow:start', 'workflow:act', 'problem-index:read', 'task:read', 'task:claim', 'notification:read', 'outbox:read', 'outbox:retry']);
  await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
  const current = await definition(organization.id, user.id, randomUUID(), 'Neutral brief workflow', 'Investigate neutral problem');
  const target = await definition(organization.id, user.id, randomUUID(), 'Neutral 8D workflow', 'Execute neutral 8D');
  const sourceId = randomUUID();
  const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, ownerId: user.id, reportNumber: `PBR-${randomUUID()}`,
    domainCode: PROBLEM_BROWSER_DOMAIN, sourceType: PROBLEM_BROWSER_SOURCE, sourceId, problemType: 'BRIEF', severity: 'LOW' } });
  const runtime = module.get(WorkflowRuntimeService);
  const actor = { id: user.id, organizationId: organization.id, accountType: 'INTERNAL' };
  const started = await runtime.startInstance({ organizationId: organization.id, actor, problemIndexId: problem.id, workflowDefinitionId: current.definitionId,
    workflowVersionId: current.versionId, expectedProblemVersion: 1, instanceKey: problem.id, idempotencyKey: randomUUID(), traceId: randomUUID() });
  const revisionId = randomUUID();
  const initial = { title: 'Neutral browser problem', description: 'Investigate the browser acceptance issue', kind: 'BRIEF' };
  await prisma.$executeRaw(Prisma.sql`INSERT INTO problem_browser_test.sources
    (id, organization_id, problem_id, owner_id, title, description, kind, version, processed, approved, verified, target_definition_id, target_version_id, current_revision_id, data, target_draft)
    VALUES (${sourceId}::uuid, ${organization.id}::uuid, ${problem.id}::uuid, ${user.id}::uuid, ${initial.title}, ${initial.description}, 'BRIEF', 1, false, false, false,
      ${target.definitionId}::uuid, ${target.versionId}::uuid, ${revisionId}::uuid, ${JSON.stringify(initial)}::jsonb, ${JSON.stringify({ eightDiscipline: true })}::jsonb)`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO problem_browser_test.revisions
    (id, source_id, instance_id, instance_version, domain_version, recorded_at, title, description, snapshot, data)
    VALUES (${revisionId}::uuid, ${sourceId}::uuid, ${started.instanceId}::uuid, 1, 1, ${new Date()}, ${initial.title}, ${initial.description},
      ${JSON.stringify({ problemType: 'BRIEF', severity: 'LOW', status: 'OPEN', responsibleParty: null, ownerId: user.id, dueAt: null })}::jsonb, ${JSON.stringify(initial)}::jsonb)`);
  await module.get(OutboxWorkerService).processAtomicDue(100, new WorkflowEventHandler());
  const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: started.instanceId, entryInstanceVersion: 1 } });
  const failedOutbox = await prisma.outboxEvent.update({ where: { eventKey: `workflow:${started.instanceId}:1` }, data: {
    status: 'FAILED', attempts: 5, lastError: 'NEUTRAL_BROWSER_RETRY_FIXTURE', processedAt: null, processingAt: null,
  } });

  const outsiderOrganization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Foreign problem browser organization', type: 'INTERNAL' } });
  const outsider = await prisma.user.create({ data: { organizationId: outsiderOrganization.id, username: `foreign_${randomUUID()}`, passwordHash, accountType: 'INTERNAL' } });
  const outsiderRole = await prisma.role.create({ data: { organizationId: outsiderOrganization.id, code: 'FOREIGN_READER', name: 'Foreign reader' } });
  await grant(outsiderRole.id, ['problem-index:read']);
  await prisma.userRole.create({ data: { organizationId: outsiderOrganization.id, userId: outsider.id, roleId: outsiderRole.id } });
  return {
    owner: { username: user.username, userId: user.id, organizationId: organization.id },
    outsider: { username: outsider.username, userId: outsider.id, organizationId: outsiderOrganization.id },
    problem: { id: problem.id, sourceId, reportNumber: problem.reportNumber, organizationId: organization.id,
      instanceId: started.instanceId, workflowVersionId: started.workflowVersionId, currentNodeId: started.currentNodeId,
      problemVersion: started.problemVersion, instanceVersion: started.version, domainVersion: 1, revisionId },
    task: { id: task.id, version: task.version },
    failedOutbox: { id: failedOutbox.id, eventKey: failedOutbox.eventKey },
    evidenceResource: { resourceType: PROBLEM_BROWSER_RESOURCE, resourceId: sourceId },
  };
}

const fixture = await seed();
const app = module.createNestApplication();
configureHttpProxy(app);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.useGlobalFilters(new GlobalExceptionFilter());
await app.listen(port, '127.0.0.1');
await writeFile(output, JSON.stringify(fixture), { flag: 'w', mode: 0o600 });
console.info('PROBLEM_BROWSER_READY');

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
