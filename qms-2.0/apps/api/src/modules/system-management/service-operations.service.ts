import { HttpException, Injectable } from '@nestjs/common';
import { adminError, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { ConsoleContextService } from '../identity/console-context.service.js';
import { MailOperationsReadService } from '../identity/mail-operations-read.service.js';
import { FileOperationsReadService } from '../file-management/file-operations-read.service.js';
import { OutboxAdministrationService } from '../task-notification/outbox-administration.service.js';
import { ServiceOperationReceiptService } from '../task-notification/service-operation-receipt.service.js';
import { ServiceOperationsPageDto, ServiceOperationsQueryDto, ServiceOperationsResultDto, ServiceOperationsSourceDto } from './service-operations.dto.js';

@Injectable()
export class ServiceOperationsService {
  constructor(private readonly contexts: ConsoleContextService, private readonly outbox: OutboxAdministrationService,
    private readonly files: FileOperationsReadService, private readonly mail: MailOperationsReadService, private readonly receipts: ServiceOperationReceiptService) {}

  async read(actor: AdminActor, query: ServiceOperationsQueryDto): Promise<ServiceOperationsPageDto> {
    const context = await this.contexts.context(actor, query.organizationId);
    const organizationId = context.targetOrganization.id;
    if (!context.modules.some(module => module.key === 'services' && module.organizationId === organizationId && module.permissions.includes('console:services:read'))) adminError('FEATURE_PERMISSION_DENIED', 403);
    const scope = query.scope ?? 'ORGANIZATION';
    if (scope === 'PLATFORM' && !context.hasPlatformAdministrator) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const source = async (key: ServiceOperationsSourceDto['key'], read: () => Promise<Partial<ServiceOperationsSourceDto>>, coverage: ServiceOperationsSourceDto['coverage'] = 'ORGANIZATION'): Promise<ServiceOperationsSourceDto> => {
      try { return { key, coverage, organizationId, asOf: new Date().toISOString(), status: 'UNKNOWN', ...await read() }; }
      catch (error) {
        if (error instanceof HttpException && [401, 403].includes(error.getStatus())) throw error;
        return { key, coverage, organizationId, asOf: new Date().toISOString(), status: 'UNAVAILABLE', reasonCode: 'SOURCE_UNAVAILABLE' };
      }
    };
    const latestStatus = (results: ServiceOperationsResultDto[], ttl: number) => !results.length ? 'UNKNOWN' as const
      : Date.now() - new Date(results[0]!.observedAt).getTime() > ttl ? 'STALE' as const : 'RECENT_RESULT' as const;
    const receiptRows = () => this.receipts.read(actor, organizationId, scope === 'PLATFORM');
    const sources = await Promise.all([
      source('outbox', async () => ({ counts: await this.outbox.operationsSummary(actor, organizationId) })),
      source('files', async () => {
        const facts = await this.files.read(actor, organizationId);
        const results = facts.latest ? [facts.latest] : [];
        return { configured: facts.configured, scannerConfigured: facts.scannerConfigured, storageConfigured: facts.storageConfigured, counts: facts.counts, results,
          status: latestStatus(results, 86400000), ...(!facts.configured ? { reasonCode: 'NOT_CONFIGURED' as const } : !results.length ? { reasonCode: 'NO_RECEIPT' as const } : {}) };
      }),
      source('mail', async () => {
        const facts = await this.mail.read(actor, organizationId); const results = facts.latest ? [facts.latest] : [];
        return { configured: facts.configured, counts: facts.counts, results, status: latestStatus(results, 86400000),
          ...(!facts.configured ? { reasonCode: 'NOT_CONFIGURED' as const } : !results.length ? { reasonCode: 'NO_RECEIPT' as const } : {}) };
      }),
      source('pdf', async () => {
        const results = (await receiptRows()).filter(row => row.operation === 'PDF').slice(0, 4).map(row => this.project(row));
        return { results, status: latestStatus(results, 86400000), ...(!results.length ? { reasonCode: 'NO_RECEIPT' as const } : {}) };
      }),
      source('worker', async () => {
        if (scope !== 'PLATFORM') return { reasonCode: 'GLOBAL_SCOPE_REQUIRED' as const };
        const results = (await receiptRows()).filter(row => row.operation === 'WORKER').slice(0, 1).map(row => this.project(row));
        return { results, status: latestStatus(results, 60000), ...(!results.length ? { reasonCode: 'NO_RECEIPT' as const } : {}) };
      }, 'PLATFORM'),
    ]);
    return { scope, organizationId, asOf: new Date().toISOString(), sources };
  }

  private project(row: Awaited<ReturnType<ServiceOperationReceiptService['read']>>[number]): ServiceOperationsResultDto {
    return { status: row.status, observedAt: row.observedAt.toISOString(), startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
      durationMs: row.durationMs, ...(row.domainCode ? { domainCode: row.domainCode } : {}),
      ...(['PDF_RENDER_FAILED', 'WORKER_EXECUTION_FAILED'].includes(row.reasonCode ?? '') ? { reasonCode: row.reasonCode! } : {}),
      ...(row.operation === 'WORKER' ? { counts: { ...(row.processed !== null ? { processed: row.processed } : {}), ...(row.failed !== null ? { failed: row.failed } : {}), ...(row.retried !== null ? { retried: row.retried } : {}) } } : {}) };
  }
}
