import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { jest } from '@jest/globals';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditQueryService } from '../../src/modules/audit-log/audit-query.service.js';
import { AuditExportService } from '../../src/modules/audit-log/audit-export.service.js';
import { auditActionLabel } from '../../src/modules/audit-log/audit-event-read-model.js';

describe('audit keyword query/export filters (unit, not PostgreSQL evidence)', () => {
  const organizationId = 'organization-a';
  const actor = { id: 'reader', organizationId, sessionId: 'session', accountType: 'INTERNAL' as const };
  const createdAt = new Date('2026-01-01T12:00:00.000Z');
  const entry = { id: '00000000-0000-4000-8000-000000000001', organizationId, actorUserId: actor.id, actor: null, action: 'USER_UPDATED', resourceType: 'User', resourceId: 'target', outcome: 'SUCCESS', traceId: 'trace', createdAt, metadata: {} };
  const originalKey = process.env.QMS_SECURITY_CURRENT_KEY_ID;
  const originalKeyring = process.env.QMS_SECURITY_KEYRING;

  beforeAll(() => {
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'audit-keyword-test';
    process.env.QMS_SECURITY_KEYRING = JSON.stringify({ 'audit-keyword-test': randomBytes(32).toString('base64') });
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.QMS_SECURITY_CURRENT_KEY_ID; else process.env.QMS_SECURITY_CURRENT_KEY_ID = originalKey;
    if (originalKeyring === undefined) delete process.env.QMS_SECURITY_KEYRING; else process.env.QMS_SECURITY_KEYRING = originalKeyring;
  });

  function setup(rows = [entry]) {
    const transaction = {
      $queryRaw: async () => [],
      user: { findUnique: async () => ({ id: actor.id, status: 'ACTIVE', accountType: 'INTERNAL', organizationId, organization: { status: 'ACTIVE' }, mfaEnabled: false, mfaPreference: 'DISABLED' }) },
      session: { findFirst: jest.fn(async () => ({ reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() })) },
      userRole: { findMany: jest.fn(async () => [{ organizationId, role: { id: 'audit-reader', organizationId, code: 'AUDIT_READER', name: 'Audit reader', mfaRequired: false, permissions: ['audit:read', 'audit:export'].map((code) => ({ permission: { id: code, code, name: code } })) } }]) },
      userPosition: { findMany: async () => [] },
      organization: { findUnique: async () => ({ status: 'ACTIVE' }) },
      auditEvent: { count: jest.fn(async (_query: unknown) => 3), findMany: jest.fn(async (_query: unknown) => rows), create: jest.fn(async () => ({})) },
      platformSettings: { findUnique: async () => ({ exportRetentionMinutes: 5 }) },
      exportArtifact: { create: jest.fn(async () => ({})) },
    };
    const prisma = { $transaction: async (work: (tx: unknown) => unknown) => work(transaction) };
    const audit = new AuditLogService(transaction);
    return { transaction, queries: new AuditQueryService(prisma as never, audit), exports: new AuditExportService(prisma as never, audit) };
  }

  it.each([
    ['更新用户', '更新用户', ['USER_UPDATED']],
    ['组织', '组织', ['ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'ORGANIZATION_DELETED']],
    ['uSeR_upD', 'uSeR\\_upD', []],
    ['legacy_Unknown', 'legacy\\_Unknown', []],
    ['mFa', 'mFa', ['USER_MFA_POLICY_CHANGED', 'MFA_ENABLED', 'MFA_LOGIN_SUCCEEDED']],
    ['%', '\\%', []],
    ['_', '\\_', []],
    ['\\', '\\\\', []],
  ])('uses the same code/label keyword predicate for total, rows and export: %s', async (keyword, contains, labelCodes) => {
    const { transaction, queries, exports } = setup();
    await queries.list(actor, { action: keyword });
    await exports.create(actor, { action: keyword }, 'keyword-export');
    const countWhere = (transaction.auditEvent.count.mock.calls[0]![0] as { where: object }).where;
    const listWhere = (transaction.auditEvent.findMany.mock.calls[0]![0] as { where: { AND: object[] } }).where;
    const exportWhere = (transaction.auditEvent.findMany.mock.calls[1]![0] as { where: object }).where;
    expect(countWhere).toMatchObject({
      organizationId,
      OR: [
        { action: { contains, mode: 'insensitive' } },
        { action: { in: expect.arrayContaining(labelCodes) } },
      ],
    });
    expect(countWhere).not.toHaveProperty('action');
    const codes = (countWhere as { OR: [unknown, { action: { in: string[] } }] }).OR[1].action.in;
    expect(codes.every((code) => auditActionLabel(code).toLowerCase().includes(keyword.toLowerCase()))).toBe(true);
    if (labelCodes.length === 0) expect(codes).toEqual([]);
    expect(listWhere.AND).toEqual([countWhere]);
    expect(exportWhere).toEqual(countWhere);
    expect(transaction.auditEvent.findMany.mock.calls[1]![0]).toMatchObject({ take: 5001 });
  });

  it('ANDs exact filters with the keyword and keeps the cursor out of total and export', async () => {
    const { transaction, queries, exports } = setup([entry, { ...entry, id: '00000000-0000-4000-8000-000000000002' }]);
    const filters = { action: '用户', actorUserId: actor.id, resourceType: 'User', resourceId: 'target', outcome: 'SUCCESS', from: createdAt.toISOString(), to: createdAt.toISOString() };
    const cursor = Buffer.from(JSON.stringify([createdAt.toISOString(), entry.id])).toString('base64url');
    const result = await queries.list(actor, { ...filters, pageSize: 1, cursor });
    await exports.create(actor, filters, 'keyword-cursor-export');
    const countWhere = (transaction.auditEvent.count.mock.calls[0]![0] as { where: object }).where;
    expect(countWhere).toMatchObject({ organizationId, actorUserId: actor.id, resourceType: 'User', resourceId: 'target', outcome: 'SUCCESS', createdAt: { gte: createdAt, lte: createdAt } });
    expect(transaction.auditEvent.findMany.mock.calls[0]![0]).toMatchObject({
      where: { AND: [countWhere, { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: entry.id } }] }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2,
    });
    expect((transaction.auditEvent.findMany.mock.calls[1]![0] as { where: object }).where).toEqual(countWhere);
    expect(result).toMatchObject({ total: 3, items: [{ id: entry.id, actionLabel: '更新用户' }], nextCursor: cursor });
  });

  it.each([undefined, ''])('does not add an action predicate for an absent/empty keyword: %s', async (action) => {
    const { transaction, queries, exports } = setup();
    await queries.list(actor, { action });
    await exports.create(actor, { action }, 'keyword-empty');
    const where = (transaction.auditEvent.count.mock.calls[0]![0] as { where: object }).where;
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('action');
    expect((transaction.auditEvent.findMany.mock.calls[1]![0] as { where: object }).where).toEqual(where);
  });

  it('rejects 5001 rows before storing any export artifact', async () => {
    const { transaction, exports } = setup(Array.from({ length: 5001 }, () => entry));
    await expect(exports.create(actor, { action: '用户' }, 'keyword-limit')).rejects.toMatchObject({ status: 422 });
    expect(transaction.exportArtifact.create).not.toHaveBeenCalled();
  });

  it('requires recent authentication before querying export rows', async () => {
    const { transaction, exports } = setup();
    transaction.session.findFirst.mockResolvedValueOnce({ reauthenticatedAt: new Date(0), mfaVerifiedAt: new Date() });
    await expect(exports.create(actor, { action: '用户' }, 'keyword-stale')).rejects.toMatchObject({ status: 403 });
    expect(transaction.auditEvent.findMany).not.toHaveBeenCalled();
    expect(transaction.exportArtifact.create).not.toHaveBeenCalled();
  });

  it('still rejects missing audit permission before reading/counting keyword matches', async () => {
    const { transaction, queries, exports } = setup();
    transaction.userRole.findMany.mockResolvedValue([]);
    await expect(queries.list(actor, { action: '用户' })).rejects.toMatchObject({ status: 403 });
    await expect(exports.create(actor, { action: '用户' }, 'keyword-denied')).rejects.toMatchObject({ status: 403 });
    expect(transaction.auditEvent.count).not.toHaveBeenCalled();
    expect(transaction.auditEvent.findMany).not.toHaveBeenCalled();
  });
});
