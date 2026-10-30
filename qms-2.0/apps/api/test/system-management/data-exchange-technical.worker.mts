// This technical fixture is never imported by the production application or Worker.
import { PrismaService } from '../../src/database/prisma.service.js';
import { ConsoleContextService } from '../../src/modules/identity/console-context.service.js';
import { DataExchangeRegistryService } from '../../src/modules/system-management/data-exchange-registry.service.js';
import { DataExchangeObservationService, type DataExchangeStageEvent } from '../../src/modules/system-management/data-exchange-observation.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Disposable technical Worker only.');
const scopeKey = process.env.QMS_EXCHANGE_FIXTURE_SCOPE!;
const event = JSON.parse(process.env.QMS_EXCHANGE_FIXTURE_EVENT!) as DataExchangeStageEvent;
const prisma = new PrismaService();
try {
  const registry = new DataExchangeRegistryService();
  const handle = registry.register({ key: 'TECHNICAL_TEST', label: '技术验证来源', directions: ['INBOUND', 'OUTBOUND'], objectTypes: ['FIXTURE'], authorizeScope: async (id, identity) => id === scopeKey && (!identity || identity.batchId === event.batchId) && !!await prisma.organization.findUnique({ where: { id }, select: { id: true } }) });
  registry.onApplicationBootstrap();
  const scope = await registry.bindScope(handle, scopeKey);
  await new DataExchangeObservationService(prisma, registry, new ConsoleContextService(prisma)).recordStageResult(handle, scope, event);
  console.log('TECHNICAL_EXCHANGE_WORKER_RECORDED');
} finally { await prisma.$disconnect(); }
