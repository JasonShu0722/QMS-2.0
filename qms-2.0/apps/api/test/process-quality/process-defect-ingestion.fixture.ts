import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { ProcessDefectCompletionService } from '../../src/modules/process-quality/process-defect-completion.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { ProcessDefectIngestionAdapter } from '../../src/modules/process-quality/process-defect-ingestion.adapter.js';
import { ProcessOperationSectorService } from '../../src/modules/process-quality/process-operation-sector.service.js';
import type { ProcessDefectIntegrationFields } from '../../src/common/integration-master-data.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

export async function processIngestionFixture() {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(databaseUrl)) throw new Error('Disposable PostgreSQL required; 55440 forbidden');
  const prisma = new PrismaService(databaseUrl);
  await prisma.$connect();
  const audit = new AuditLogService(prisma), mutations = new AdminMutationService(prisma, audit);
  const organizations = new OrganizationService(prisma, mutations, audit, new PositionOnboardingService(prisma, audit));
  const mappings = new ComponentProjectService(prisma, mutations, audit, organizations);
  const completion = new ProcessDefectCompletionService(prisma, audit, mappings);
  const ledger = new ProcessDefectLedgerService(prisma, mutations, audit, mappings, undefined, completion);
  const adapter = new ProcessDefectIngestionAdapter(audit, completion);
  const sectors = new ProcessOperationSectorService(prisma, mutations, audit);
  const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'S2 disposable scope', type: 'INTERNAL' } });
  const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), fullName: '真实登记人', passwordHash: 'test-only', accountType: 'INTERNAL' } });
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'S2 permissions' } });
  for (const code of ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:close', 'component-project:read', 'component-project:manage', 'configuration:read', 'configuration:manage', 'process-quality:configuration:read', 'process-quality:configuration:manage', 'ai:applications:read']) {
    const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
  const actor = { id: user.id, organizationId: organization.id, accountType: 'INTERNAL' as const, sessionId: session.id };
  const endpoint = await prisma.integrationEndpoint.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'S2 IMS', sourceCode: 'IMS', sourceName: 'IMS' } });
  const credential = await prisma.integrationCredential.create({ data: { organizationId: organization.id, endpointId: endpoint.id, name: 'test', secretHash: '0'.repeat(64) } });
  async function receipt() {
    return prisma.integrationReceipt.create({ data: { organizationId: organization.id, endpointId: endpoint.id, credentialId: credential.id, messageId: randomUUID(),
      configurationVersion: 1, configurationSnapshot: {}, bodyExpiresAt: new Date(Date.now() + 3600000), metadataExpiresAt: new Date(Date.now() + 7200000), payloadBytes: 2 } });
  }
  const received = await receipt();
  const fields = (input: Partial<ProcessDefectIntegrationFields> = {}): ProcessDefectIntegrationFields => ({ receiptId: received.id, rowIndex: 0, ...input });
  async function ingest(input: ProcessDefectIntegrationFields, confirmed = false) {
    return prisma.$transaction(async tx => {
      const current = await adapter.inspect(tx, actor, input);
      return adapter.write(tx, actor, input, current ? { id: current.id, version: current.version } : null, randomUUID(), confirmed);
    });
  }
  const manual = (input: Partial<Parameters<typeof ledger.create>[1]> = {}) => ledger.create(actor,
    { occurredAt: new Date('2026-11-16T00:30:00Z'), productCode: '00001', traceCode: randomUUID(), description: '不良事实', ...input }, randomUUID(), randomUUID());
  return { prisma, audit, mappings, completion, ledger, adapter, sectors, actor, role, receipt, fields, ingest, manual };
}

export type ProcessIngestionFixture = Awaited<ReturnType<typeof processIngestionFixture>>;
