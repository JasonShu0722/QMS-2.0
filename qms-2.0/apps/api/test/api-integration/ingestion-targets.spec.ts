import 'reflect-metadata';
import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import type { AdminActor, AdminTransaction } from '../../src/common/security/admin-mutation.service.js';
import type { IntegrationFields, IntegrationMasterDataAdapter } from '../../src/common/integration-master-data.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { MaterialMasterIngestionAdapter } from '../../src/modules/material-master/material-master-ingestion.adapter.js';
import { SupplierProfileIngestionAdapter } from '../../src/modules/supplier-quality/supplier-profile-ingestion.adapter.js';
import { CustomerMasterIngestionAdapter } from '../../src/modules/customer-quality/customer-master-ingestion.adapter.js';
import { ComponentProjectIngestionAdapter } from '../../src/modules/platform-configuration/component-project-ingestion.adapter.js';
import { IngestionTargetsService } from '../../src/modules/api-integration/ingestion-targets.service.js';

const actor: AdminActor = { id: '06c979dd-c747-4870-98a8-9adf088bd050', organizationId: '0bd33b08-88ef-4133-9840-74d7ddbfda28', sessionId: 'ingestion-worker', accountType: 'INTERNAL' };
const fields: IntegrationFields = { code: '0001-A', name: '档案' };
const permissions = ['material-master:write', 'supplier-quality:profiles:write', 'customer-quality:complaints:write', 'component-project:manage'];

function fixture(permissionCodes = permissions, organizationType = 'INTERNAL') {
  const raw = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
  const transaction = {
    user: { findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({ status: 'ACTIVE', accountType: 'INTERNAL', organizationId: actor.organizationId, organization: { status: 'ACTIVE', type: 'INTERNAL' } }) },
    userRole: { findMany: async () => [{ organizationId: actor.organizationId, role: { id: 'role', organizationId: actor.organizationId, code: 'TARGET_WRITER', name: 'Writer', mfaRequired: false, permissions: permissionCodes.map(code => ({ permission: { id: code, code, name: code } })) } }] },
    userPosition: { findMany: async () => [] },
    organization: { findUnique: async () => ({ type: organizationType, status: 'ACTIVE' }) },
    $queryRaw: raw,
    auditEvent: { create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}) },
  };
  const audit = new AuditLogService(transaction as never);
  return { transaction, tx: transaction as unknown as AdminTransaction, raw, audit };
}

const adapters: [string, new (audit: AuditLogService) => IntegrationMasterDataAdapter][] = [
  ['MATERIAL', MaterialMasterIngestionAdapter], ['SUPPLIER', SupplierProfileIngestionAdapter],
  ['CUSTOMER', CustomerMasterIngestionAdapter], ['COMPONENT', ComponentProjectIngestionAdapter],
];

describe.each(adapters)('%s owned transactional ingress boundary', (target, Adapter) => {
  it('rejects supplier actors before reading business data', async () => {
    const current = fixture();
    await expect(new Adapter(current.audit).inspect(current.tx, { ...actor, accountType: 'SUPPLIER' }, fields)).rejects.toThrow(HttpException);
    expect(current.raw).not.toHaveBeenCalled();
  });

  it('rechecks current actor identity and target permission on every call', async () => {
    const current = fixture([]);
    await expect(new Adapter(current.audit).inspect(current.tx, actor, fields)).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(current.raw).not.toHaveBeenCalled();
    current.transaction.user.findUnique.mockResolvedValue({ status: 'DISABLED', accountType: 'INTERNAL', organizationId: actor.organizationId, organization: { status: 'ACTIVE' } });
    await expect(new Adapter(current.audit).write(current.tx, actor, fields, null, 'trace')).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
  });

  it('rejects supplier scopes even when an internal actor has the target permission', async () => {
    const current = fixture(permissions, 'SUPPLIER');
    await expect(new Adapter(current.audit).inspect(current.tx, actor, fields)).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
    expect(current.raw).not.toHaveBeenCalled();
  });

  it.each([{ code: '', name: '名称' }, { code: 'A', name: ' ' }, { code: 'A\u0000', name: '名称' }, { code: 'A', name: '\uD800' }, { code: '\uD800', name: '\uDC00' }, { code: 42, name: '名称' }, { code: 'A'.repeat(101), name: '名称' }, { code: 'A', name: '名称', projectRecordId: 'manual-field' }])('rejects invalid or unowned fields before business reads: %j', async input => {
    const current = fixture();
    await expect(new Adapter(current.audit).inspect(current.tx, actor, input as IntegrationFields)).rejects.toMatchObject({ response: { code: 'INTEGRATION_INPUT_INVALID' } });
    expect(current.raw).not.toHaveBeenCalled();
  });

  it('does not increment a version or audit a no-op; stale and insert-only expectations conflict', async () => {
    const current = fixture();
    const id = 'e8cb82c3-c027-40c6-8bfe-e7cdcde65881';
    current.raw.mockResolvedValue([{ id, version: 3, ...fields, contactName: null, contactEmail: null }]);
    const adapter = new Adapter(current.audit);
    expect(await adapter.write(current.tx, actor, fields, { id, version: 3 }, 'trace')).toEqual({ id, version: 3, values: fields });
    expect(current.raw).toHaveBeenCalledTimes(1);
    expect(current.transaction.auditEvent.create).not.toHaveBeenCalled();
    await expect(adapter.write(current.tx, actor, fields, { id, version: 2 }, 'trace')).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    await expect(adapter.write(current.tx, actor, fields, null, 'trace')).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
  });

  it('keeps the existing target-specific code normalization', async () => {
    const current = fixture();
    await new Adapter(current.audit).inspect(current.tx, actor, { code: ' ab.01 ', name: ' 名称 ' });
    const queryArguments = current.raw.mock.calls[0]!;
    expect(queryArguments).toContain(target === 'CUSTOMER' ? 'AB.01' : 'ab.01');
  });
});

it('rejects customer codes that exceed the existing limit after uppercase normalization', async () => {
  const current = fixture();
  await expect(new CustomerMasterIngestionAdapter(current.audit).inspect(current.tx, actor, { code: 'ß'.repeat(100), name: '名称' })).rejects.toMatchObject({ response: { code: 'INTEGRATION_INPUT_INVALID' } });
  expect(current.raw).not.toHaveBeenCalled();
});

it('rejects invalid supplier contact data while retaining omitted or null contact values', async () => {
  const current = fixture();
  const adapter = new SupplierProfileIngestionAdapter(current.audit);
  await expect(adapter.inspect(current.tx, actor, { ...fields, contactEmail: 'not-an-email' })).rejects.toMatchObject({ response: { code: 'INTEGRATION_INPUT_INVALID' } });
  const id = 'e8cb82c3-c027-40c6-8bfe-e7cdcde65881';
  current.raw.mockResolvedValue([{ id, version: 3, ...fields, contactName: '保留联系人', contactEmail: 'kept@example.com' }]);
  expect(await adapter.write(current.tx, actor, { ...fields, contactName: null, contactEmail: ' ' } as unknown as IntegrationFields, { id, version: 3 }, 'trace')).toEqual({ id, version: 3, values: { ...fields, contactName: '保留联系人', contactEmail: 'kept@example.com' } });
  expect(current.transaction.auditEvent.create).not.toHaveBeenCalled();
});

it('routes the facade through public owner adapters and rejects unknown targets', async () => {
  const current = fixture();
  const targets = new IngestionTargetsService(new SupplierProfileIngestionAdapter(current.audit), new CustomerMasterIngestionAdapter(current.audit), new MaterialMasterIngestionAdapter(current.audit), new ComponentProjectIngestionAdapter(current.audit));
  for (const [target] of adapters) expect(await targets.inspect(current.tx, actor, target as never, fields)).toBeNull();
  await expect(targets.inspect(current.tx, actor, 'UNKNOWN' as never, fields)).rejects.toMatchObject({ response: { code: 'INTEGRATION_INPUT_INVALID' } });
});
