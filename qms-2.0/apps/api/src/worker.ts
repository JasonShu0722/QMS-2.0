import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { APPLICATION_OUTBOX_HANDLER, OutboxWorkerService, type OutboxHandler } from './modules/task-notification/outbox-worker.service.js';
import { parseWorkerOptions, runWorkerLoop } from './worker-runner.js';
import { AuditExportService } from './modules/audit-log/audit-export.service.js';
import { RecoveryMailService } from './modules/identity/recovery-mail.service.js';
import { FileScanWorkerService } from './modules/file-management/file-scan-worker.service.js';
import { TemporaryPasswordService } from './modules/identity/temporary-password.service.js';
import { ProcessEightDReminderService } from './modules/process-quality/process-eight-d-reminder.service.js';
import { SupplierEightDReminderService } from './modules/supplier-quality/supplier-eight-d-reminder.service.js';
import { CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from './common/eight-d/internal-eight-d-runtime.js';
import { randomUUID } from 'node:crypto';
import { ServiceOperationReceiptService } from './modules/task-notification/service-operation-receipt.service.js';
import { DataExchangeObservationService } from './modules/system-management/data-exchange-observation.service.js';

async function bootstrap(): Promise<void> {
  const options = parseWorkerOptions(process.argv.slice(2), process.env);
  const logCyclesSetting = process.env.QMS_WORKER_LOG_CYCLES;
  if (logCyclesSetting !== undefined && !['true', 'false'].includes(logCyclesSetting)) throw new Error('WORKER_CONFIGURATION_INVALID');
  const logCycles = logCyclesSetting === 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const receipts = app.get(ServiceOperationReceiptService);
  const producerId = randomUUID(), startedAt = new Date();
  let lastCycle = { processed: 0, failed: 0, retried: 0 };
  let failed = false;
  await receipts.recordWorker(producerId, 'STARTED', startedAt);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const handler = app.get<OutboxHandler | null>(APPLICATION_OUTBOX_HANDLER);
    if (!handler) throw new Error('WORKER_HANDLER_REQUIRED');
    const mailEnabled = process.env.QMS_RECOVERY_MAIL_ENABLED === 'true';
    if (process.env.QMS_RECOVERY_MAIL_ENABLED && !['true', 'false'].includes(process.env.QMS_RECOVERY_MAIL_ENABLED)) throw new Error('WORKER_CONFIGURATION_INVALID');
    if (mailEnabled) app.get(RecoveryMailService).configuration();
    console.info('QMS_WORKER_READY');
    let nextMaintenance = 0;
    await runWorkerLoop(app.get(OutboxWorkerService), handler, options, controller.signal, async () => {
      await app.get(FileScanWorkerService).processDue(options.batchSize);
      if (Date.now() < nextMaintenance) return;
      await app.get(FileScanWorkerService).expireUploads();
      await app.get(AuditExportService).purgeExpired();
      await app.get(TemporaryPasswordService).purgeExpired();
      await app.get(ProcessEightDReminderService).poll(options.batchSize);
      await app.get<InternalEightDRuntime>(CUSTOMER_EIGHT_D_RUNTIME).reminders.poll(options.batchSize);
      await app.get<InternalEightDRuntime>(NEW_PRODUCT_EIGHT_D_RUNTIME).reminders.poll(options.batchSize);
      await app.get(SupplierEightDReminderService).poll(options.batchSize);
      if (mailEnabled) await app.get(RecoveryMailService).dispatchPending(options.batchSize);
      try { await app.get(DataExchangeObservationService).purgeExpired(); await receipts.purgeExpired(); }
      catch { console.warn('SERVICE_OBSERVATION_RETENTION_UNAVAILABLE'); }
      nextMaintenance = Date.now() + 60000;
    }, async result => {
      lastCycle = result;
      await receipts.recordWorker(producerId, 'SUCCEEDED', startedAt, result);
      if (logCycles) console.info(`QMS_WORKER_CYCLE ${JSON.stringify({ ...result, observedAt: new Date().toISOString() })}`);
    });
  } catch (error) {
    failed = true;
    await receipts.recordWorker(producerId, 'FAILED', startedAt, lastCycle);
    throw error;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (!failed) await receipts.recordWorker(producerId, 'STOPPED', startedAt, lastCycle);
    await app.close();
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error && error.message.startsWith('WORKER_') ? error.message : 'QMS_WORKER_FAILED');
  process.exitCode = 1;
});
