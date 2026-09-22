import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { writeFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../dist/app.module.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { PasswordHasherService } from '../../dist/common/security/password-hasher.service.js';
import { GlobalExceptionFilter } from '../../dist/common/contracts/global-exception.filter.js';
import { configureHttpProxy } from '../../dist/http-proxy.js';
import { FILE_RESOURCE_ADAPTERS } from '../../dist/modules/file-management/file-resource-access.js';
import { workflowError } from '../../dist/modules/workflow/workflow-runtime-policy.js';

const database = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (!['127.0.0.1', '[::1]'].includes(database.hostname) || database.port === '55440' || !/^\/qms_file_browser_[a-f0-9]+$/.test(database.pathname) || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') throw new Error('Disposable browser database required');
const port = Number(process.env.QMS_FILE_BROWSER_PORT);
const output = process.env.QMS_FILE_BROWSER_FIXTURE_PATH;
if (!Number.isInteger(port) || port < 1024 || !output || !isAbsolute(output) || !process.env.QMS_FILE_BROWSER_PASSWORD) throw new Error('Browser fixture configuration required');
const relation = relative(resolve(process.cwd(), '../../..'), await realpath(dirname(output)));
if (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)) throw new Error('Fixture data must remain outside Git');

const allowed = new Set();
const adapter = {
  resourceType: 'NeutralEvidence',
  async authorizeAndLock(transaction, actor, resource) {
    if (!allowed.has(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    await transaction.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${resource.resourceId}::uuid FOR UPDATE`;
    const problem = await transaction.problemIndex.findUnique({ where: { id: resource.resourceId } });
    if (!problem || problem.domainCode !== 'neutral-test' || problem.ownerId !== actor.id || problem.organizationId !== actor.organizationId || problem.archivedAt || ['CLOSED', 'ARCHIVED'].includes(problem.status)) workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: problem.organizationId, version: problem.version };
  },
};
const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(FILE_RESOURCE_ADAPTERS).useValue([adapter]).compile();
const prisma = module.get(PrismaService);
const passwordHash = await new PasswordHasherService().hash(process.env.QMS_FILE_BROWSER_PASSWORD);
const fixtures = [];
for (const accountType of ['INTERNAL', 'SUPPLIER']) {
  const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'File browser fixture', type: accountType } });
  const user = await prisma.user.create({ data: { organizationId: organization.id, username: `file_${randomUUID()}`, passwordHash, accountType } });
  const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, ownerId: user.id, reportNumber: randomUUID(), domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
  allowed.add(problem.id);
  fixtures.push({ username: user.username, accountType, resource: { resourceType: 'NeutralEvidence', resourceId: problem.id } });
}
const app = module.createNestApplication();
configureHttpProxy(app);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.useGlobalFilters(new GlobalExceptionFilter());
await app.listen(port, '127.0.0.1');
await writeFile(output, JSON.stringify({ fixtures }), { flag: 'wx', mode: 0o600 });
console.info('FILE_BROWSER_READY');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
