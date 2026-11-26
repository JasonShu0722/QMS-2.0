import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { jest } from '@jest/globals';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminUserBatchService } from '../../src/modules/identity/admin-user-batch.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';

describe('account batch PostgreSQL partial commit and replay', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => { f = await accountDeliveryFixture(); });
  afterAll(async () => { await f?.close(); });

  async function workflowActor() {
    const session = await f.prisma.session.findFirstOrThrow({ where: { userId: f.actor.id, revokedAt: null } });
    return { id: f.actor.id, sessionId: session.id, accountType: f.actor.accountType, organizationId: f.organization.id };
  }

  async function waitForConfirmationLock(lock: 'target' | 'staged row') {
    const query = lock === 'target' ? '%FROM organizations%FOR SHARE%' : '%FROM account_batch_rows%FOR UPDATE%';
    for (let attempt = 0; attempt < 80; attempt++) {
      const [state] = await f.prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${query}) AS blocked`;
      if (state?.blocked) return;
      await delay(50);
    }
    throw new Error(`Confirmation did not wait for the ${lock} lock`);
  }

  it('rejects nested array rows in both batch request formats before storing a receipt', async () => {
    for (const path of ['/admin/users/batch/preview', '/admin/users/batch']) {
      const key = randomUUID();
      await f.post(path, { organizationId: f.organization.id, rows: [[]] }, key).expect(400);
      expect(await f.prisma.accountBatch.count({ where: { key } })).toBe(0);
    }
  });

  it('previews five columns, creates across authorized scopes, and keeps password and pending configuration private', async () => {
    const platformPermission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    const membership = await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } });
    const grant = { roleId: membership.roleId, permissionId: platformPermission.id };
    const other = await f.prisma.organization.create({ data: { code: `BATCH-${randomUUID()}`, name: 'Second internal organization', type: 'INTERNAL' } });
    await f.prisma.rolePermission.create({ data: grant });
    const password = `initial-bound-${randomUUID()}`;
    const first = { rowNumber: 2, username: `batch-${randomUUID()}`, fullName: '批量用户', accountType: 'INTERNAL', organizationCode: f.organization.code, password };
    const second = { ...first, rowNumber: 3, username: `batch-${randomUUID()}`, organizationCode: other.code };
    try {
      const body = { organizationId: f.organization.id, rows: [first, second,
        { ...second, rowNumber: 4, username: second.username.toUpperCase() }, { ...first, rowNumber: 5, username: '', fullName: '', password: '' },
        { ...first, rowNumber: 6, fullName: 42 }] };
      const previewKey = randomUUID();
      const previewResponse = await f.post('/admin/users/batch/preview', body, previewKey).expect(201).expect('Cache-Control', 'no-store');
      const preview = previewResponse.body;
      expect((await f.post('/admin/users/batch/preview', body, previewKey).expect(201)).body).toEqual(preview);
      expect(preview.rows).toMatchObject([
        { rowNumber: 2, status: 'READY', organizationName: f.organization.name },
        { rowNumber: 3, status: 'READY', organizationName: other.name },
        { rowNumber: 4, status: 'SKIPPED', code: 'ADMIN_USER_DUPLICATE' },
        { rowNumber: 5, status: 'SKIPPED', code: 'ADMIN_BATCH_ROW_INVALID' },
        { rowNumber: 6, status: 'SKIPPED', code: 'ADMIN_BATCH_ROW_INVALID' },
      ]);
      expect(JSON.stringify(preview)).not.toContain(password);
      expect(await f.prisma.user.count({ where: { username: { in: [first.username, second.username] } } })).toBe(0);
      const key = randomUUID();
      const confirm = { organizationId: f.organization.id, previewId: preview.previewId };
      const result = (await f.post('/admin/users/batch/confirm', confirm, key).expect(201).expect('Cache-Control', 'no-store')).body;
      expect(result.rows).toMatchObject([
        { rowNumber: 2, status: 'SUCCESS', configurationRequired: true },
        { rowNumber: 3, status: 'SUCCESS', configurationRequired: true },
        { rowNumber: 4, status: 'SKIPPED', code: 'ADMIN_USER_DUPLICATE' },
        { rowNumber: 5, status: 'SKIPPED', code: 'ADMIN_BATCH_ROW_INVALID' },
        { rowNumber: 6, status: 'SKIPPED', code: 'ADMIN_BATCH_ROW_INVALID' },
      ]);
      expect((await f.post('/admin/users/batch/confirm', confirm, key).expect(201)).body).toEqual(result);
      await f.post('/admin/users/batch/confirm', confirm).expect(409);
      const created = await f.prisma.user.findMany({ where: { username: { in: [first.username, second.username] } }, include: { positions: true, userRoles: true } });
      expect(created).toHaveLength(2);
      for (const user of created) {
        expect(user).toMatchObject({ fullName: first.fullName, status: 'DISABLED', configurationRequired: true, positions: [], userRoles: [] });
        expect(await f.app.get(PasswordService).verify(user.passwordHash, password)).toBe(true);
      }
      expect(created.find(({ username }) => username === second.username)?.organizationId).toBe(other.id);
      const receipts = await f.prisma.accountBatchRow.findMany({ where: { batch: { actorId: f.actor.id } } });
      const audit = await f.prisma.auditEvent.findMany({ where: { action: 'USER_CREATED', resourceId: { in: created.map(({ id }) => id) } } });
      expect(audit).toHaveLength(2);
      for (const value of [result, receipts, audit]) expect(JSON.stringify(value)).not.toContain(password);
      expect(JSON.stringify(receipts)).not.toContain('sealedHash');

      await f.prisma.rolePermission.delete({ where: { roleId_permissionId: grant } });
      const replayPreview = (await f.post('/admin/users/batch/preview', body, previewKey).expect(201)).body;
      expect(replayPreview.rows[0]).toEqual(preview.rows[0]);
      expect(replayPreview.rows[1]).toEqual({ rowNumber: second.rowNumber, username: second.username,
        fullName: second.fullName, accountType: second.accountType, organizationCode: second.organizationCode,
        status: 'SKIPPED', code: 'FEATURE_PERMISSION_DENIED', message: expect.any(String) });
      const replay = (await f.post('/admin/users/batch/confirm', confirm, key).expect(201)).body;
      expect(replay).toEqual({ ...result, rows: [result.rows[0], { rowNumber: second.rowNumber, username: second.username,
        status: 'SKIPPED', code: 'FEATURE_PERMISSION_DENIED' }, ...result.rows.slice(2)] });
      await f.prisma.rolePermission.create({ data: grant });
      const renamedTarget = { ...second, username: `rename-${randomUUID()}` };
      const validNeighbor = { ...first, username: `neighbor-${randomUUID()}` };
      const pending = (await f.post('/admin/users/batch/preview', { rows: [validNeighbor, renamedTarget] }).expect(201)).body;
      expect(pending.rows).toMatchObject([{ status: 'READY' }, { status: 'READY' }]);
      await f.prisma.organization.update({ where: { id: other.id }, data: { code: `RENAMED-${randomUUID()}` } });
      expect((await f.post('/admin/users/batch/preview', body, previewKey).expect(201)).body).toEqual(preview);
      expect((await f.post('/admin/users/batch/confirm', confirm, key).expect(201)).body).toEqual(result);
      const afterRename = (await f.post('/admin/users/batch/confirm', { previewId: pending.previewId }).expect(201)).body;
      expect(afterRename.rows).toMatchObject([{ status: 'SUCCESS' }, { status: 'SKIPPED', code: 'ORGANIZATION_NOT_FOUND' }]);
      expect(await f.prisma.user.count({ where: { username: renamedTarget.username } })).toBe(0);
      expect(await f.prisma.auditEvent.count({ where: { action: 'USER_CREATED', resourceId: { in: created.map(({ id }) => id) } } })).toBe(2);
    } finally {
      await f.prisma.rolePermission.deleteMany({ where: grant });
      await f.prisma.auditEvent.deleteMany({ where: { organizationId: other.id } });
      await f.prisma.user.deleteMany({ where: { organizationId: other.id } });
      await f.prisma.organization.delete({ where: { id: other.id } });
    }
  });

  it('skips an invalid character cell without losing a valid neighboring preview row', async () => {
    const valid = { rowNumber: 3, username: `valid-${randomUUID()}`, fullName: 'Valid neighbor', accountType: 'INTERNAL',
      organizationCode: f.organization.code, password: `initial-${randomUUID()}` };
    const invalid = { ...valid, rowNumber: 2, username: `invalid-${randomUUID()}`, fullName: 'Invalid\u0000name' };
    const { body } = await f.post('/admin/users/batch/preview', { rows: [invalid, valid] }).expect(201);
    expect(body.rows).toMatchObject([
      { rowNumber: 2, status: 'SKIPPED', code: 'ADMIN_BATCH_ROW_INVALID' },
      { rowNumber: 3, status: 'READY' },
    ]);
    expect(body.rows[0].fullName).not.toContain('\u0000');
  });

  it('expires an unconfirmed preview and clears its staged hash while preserving live previews and receipts', async () => {
    const service = f.app.get(AdminUserBatchService);
    const actor = await workflowActor();
    const row = { rowNumber: 2, username: `expired-${randomUUID()}`, fullName: 'Expired preview', accountType: 'INTERNAL',
      organizationCode: f.organization.code, password: `initial-${randomUUID()}` };
    const expired = await service.preview(actor, { rows: [row] }, randomUUID(), randomUUID());
    const live = await service.preview(actor, { rows: [row] }, randomUUID(), randomUUID());
    const confirmed = await service.preview(actor, { rows: [{ ...row, username: `confirmed-${randomUUID()}` }] }, randomUUID(), randomUUID());
    const confirmedKey = randomUUID();
    const receipt = await service.confirm(actor, { previewId: confirmed.previewId }, randomUUID(), confirmedKey);
    await f.prisma.accountBatch.updateMany({ where: { id: { in: [expired.previewId, confirmed.previewId] } }, data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) } });
    const staged = (batchId: string) => f.prisma.accountBatchRow.findUniqueOrThrow({ where: { batchId_rowNumber: { batchId, rowNumber: row.rowNumber } } });
    expect((await staged(expired.previewId)).result).toHaveProperty('sealedHash');
    await expect(service.confirm(actor, { previewId: expired.previewId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await f.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT row_number FROM account_batch_rows WHERE batch_id = ${expired.previewId}::uuid FOR UPDATE`;
      expect(await service.purgeExpired()).toBe(0);
    });
    expect(await service.purgeExpired()).toBe(1);
    expect(await service.purgeExpired()).toBe(0);
    expect((await staged(expired.previewId)).result).toEqual({ preview: expired.rows[0] });
    expect((await staged(live.previewId)).result).toHaveProperty('sealedHash');
    expect(await service.confirm(actor, { previewId: confirmed.previewId }, randomUUID(), confirmedKey)).toEqual(receipt);
    expect(await f.prisma.user.count({ where: { username: row.username } })).toBe(0);
  });

  it('skips an ungranted supplier scope and creates only within the authorized enterprise', async () => {
    const supplier = await f.prisma.organization.create({ data: { code: `VENDOR-${randomUUID()}`, name: 'Supplier enterprise', type: 'SUPPLIER' } });
    const service = f.app.get(AdminUserBatchService);
    const actor = await workflowActor();
    const row = { rowNumber: 2, username: `supplier-${randomUUID()}`, fullName: '供应商用户', accountType: 'SUPPLIER', organizationCode: supplier.code, password: `initial-vendor-${randomUUID()}` };
    try {
      const denied = await service.preview(actor, { rows: [row] }, randomUUID(), randomUUID());
      expect(denied.rows[0]).toMatchObject({ status: 'SKIPPED', code: 'FEATURE_PERMISSION_DENIED' });
      expect(denied.rows[0]).not.toHaveProperty('organizationName');
      await expect(service.confirm(actor, { previewId: denied.previewId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
      const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:create' } });
      const role = await f.prisma.role.create({ data: { organizationId: supplier.id, code: 'BATCH_CARETAKER', name: 'Caretaker', permissions: { create: { permissionId: permission.id } } } });
      await f.prisma.userRole.create({ data: { userId: actor.id, roleId: role.id, organizationId: supplier.id } });
      const preview = await service.preview(actor, { rows: [row, { ...row, rowNumber: 3, accountType: 'INTERNAL' }] }, randomUUID(), randomUUID());
      expect(preview.rows).toMatchObject([
        { status: 'READY', organizationName: supplier.name },
        { status: 'SKIPPED', code: 'ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH' },
      ]);
      const result = await service.confirm(actor, { previewId: preview.previewId }, randomUUID(), randomUUID());
      expect(result.rows).toMatchObject([{ status: 'SUCCESS', configurationRequired: false }, { status: 'SKIPPED' }]);
      const user = await f.prisma.user.findUniqueOrThrow({ where: { id: result.rows[0]!.userId }, include: { userRoles: { include: { role: true } } } });
      expect(user).toMatchObject({ organizationId: supplier.id, fullName: row.fullName, accountType: 'SUPPLIER', status: 'ACTIVE', userRoles: [{ organizationId: supplier.id, role: { code: 'SUPPLIER_PORTAL_STAFF' } }] });
      expect((await f.login(row.username, row.password).expect(200)).body).not.toHaveProperty('temporaryPassword');
    } finally {
      await f.prisma.auditEvent.deleteMany({ where: { organizationId: supplier.id } });
      await f.prisma.userRole.deleteMany({ where: { organizationId: supplier.id } });
      await f.prisma.user.deleteMany({ where: { organizationId: supplier.id } });
      await f.prisma.organization.delete({ where: { id: supplier.id } });
    }
  });

  it.each(['target', 'staged row'] as const)('skips a target revoked during the %s lock wait, rolls back a failed row, and commits a valid neighbor', async (lock) => {
    const service = f.app.get(AdminUserBatchService);
    const actor = await workflowActor();
    const other = await f.prisma.organization.create({ data: { code: `BATCH-${randomUUID()}`, name: 'Revocable scope', type: 'INTERNAL' } });
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:create' } });
    const role = await f.prisma.role.create({ data: { organizationId: other.id, code: 'BATCH_ADMIN', name: 'Batch administrator', permissions: { create: { permissionId: permission.id } } } });
    const grant = await f.prisma.userRole.create({ data: { userId: actor.id, roleId: role.id, organizationId: other.id } });
    const rows = [2, 3, 4].map((rowNumber) => ({ rowNumber, username: `recheck-${randomUUID()}`, fullName: 'Recheck', accountType: 'INTERNAL',
      organizationCode: rowNumber === 2 ? other.code : f.organization.code, password: `initial-${randomUUID()}` }));
    const audit = f.app.get(AuditLogService);
    const original = audit.record.bind(audit);
    try {
      const preview = await service.preview(actor, { rows }, randomUUID(), randomUUID());
      expect(preview.rows.map(({ status }) => status)).toEqual(['READY', 'READY', 'READY']);
      const spy = jest.spyOn(audit, 'record').mockImplementation(async (...args) => {
        if (args[0].action === 'USER_CREATED' && args[0].metadata?.rowNumber === 3) throw new Error('audit unavailable');
        return original(...args);
      });
      const key = randomUUID();
      const confirm = { previewId: preview.previewId };
      let pending: ReturnType<AdminUserBatchService['confirm']> | undefined;
      try {
        await f.prisma.$transaction(async (tx) => {
          if (lock === 'target') await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${other.id}::uuid FOR UPDATE`;
          else await tx.$queryRaw`SELECT row_number FROM account_batch_rows WHERE batch_id = ${preview.previewId}::uuid AND row_number = 2 FOR UPDATE`;
          pending = service.confirm(actor, confirm, randomUUID(), key);
          void pending.catch(() => undefined);
          await waitForConfirmationLock(lock);
          await tx.userRole.delete({ where: { userId_roleId_organizationId: { userId: grant.userId, organizationId: grant.organizationId, roleId: grant.roleId } } });
        });
      } finally {
        await pending?.catch(() => undefined);
        spy.mockRestore();
      }
      const result = await pending!;
      expect(result.rows).toMatchObject([{ status: 'SKIPPED', code: 'FEATURE_PERMISSION_DENIED' }, { status: 'FAILED', code: 'INTERNAL_ERROR' }, { status: 'SUCCESS' }]);
      expect(await service.confirm(actor, confirm, randomUUID(), key)).toEqual(result);
      const created = await f.prisma.user.findMany({ where: { username: { in: rows.map(({ username }) => username) } }, select: { username: true } });
      expect(created).toEqual([{ username: rows[2]!.username }]);
    } finally {
      await f.prisma.userRole.deleteMany({ where: { organizationId: other.id } });
      await f.prisma.organization.delete({ where: { id: other.id } });
    }
  });

  it.each(['target', 'staged row'] as const)('rejects confirmation when management permission is revoked during the %s lock wait', async (lock) => {
    const service = f.app.get(AdminUserBatchService);
    const actor = await workflowActor();
    const other = await f.prisma.organization.create({ data: { code: `BATCH-${randomUUID()}`, name: 'Authorized target', type: 'INTERNAL' } });
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:create' } });
    const membership = await f.prisma.userRole.findFirstOrThrow({ where: { userId: actor.id, organizationId: f.organization.id } });
    const managementGrant = { roleId: membership.roleId, permissionId: permission.id };
    const role = await f.prisma.role.create({ data: { organizationId: other.id, code: 'BATCH_ADMIN', name: 'Batch administrator', permissions: { create: { permissionId: permission.id } } } });
    await f.prisma.userRole.create({ data: { userId: actor.id, roleId: role.id, organizationId: other.id } });
    const row = { rowNumber: 2, username: `scope-recheck-${randomUUID()}`, fullName: 'Scope recheck', accountType: 'INTERNAL',
      organizationCode: other.code, password: `initial-${randomUUID()}` };
    const key = randomUUID();
    let pending: ReturnType<AdminUserBatchService['confirm']> | undefined;
    try {
      const preview = await service.preview(actor, { rows: [row] }, randomUUID(), randomUUID());
      expect(preview.rows[0]?.status).toBe('READY');
      const confirm = { previewId: preview.previewId };
      await f.prisma.$transaction(async (tx) => {
        if (lock === 'target') await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${other.id}::uuid FOR UPDATE`;
        else await tx.$queryRaw`SELECT row_number FROM account_batch_rows WHERE batch_id = ${preview.previewId}::uuid AND row_number = ${row.rowNumber} FOR UPDATE`;
        pending = service.confirm(actor, confirm, randomUUID(), key);
        void pending.catch(() => undefined);
        await waitForConfirmationLock(lock);
        await tx.rolePermission.delete({ where: { roleId_permissionId: managementGrant } });
      });
      await expect(pending).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
      await expect(service.confirm(actor, confirm, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
      expect(await f.prisma.user.count({ where: { username: row.username } })).toBe(0);
    } finally {
      await pending?.catch(() => undefined);
      await f.prisma.rolePermission.upsert({ where: { roleId_permissionId: managementGrant }, create: managementGrant, update: {} });
      await f.prisma.auditEvent.deleteMany({ where: { organizationId: other.id } });
      await f.prisma.user.deleteMany({ where: { organizationId: other.id } });
      await f.prisma.userRole.deleteMany({ where: { organizationId: other.id } });
      await f.prisma.organization.delete({ where: { id: other.id } });
    }
  });

  it('commits a valid row and records duplicate and invalid email errors without persisting secrets', async () => {
    const initial = await f.onboarding();
    const username = `batch-${randomUUID()}`;
    const body = { organizationId: f.organization.id, rows: [
      { rowNumber: 2, username, accountType: 'INTERNAL', ...initial },
      { rowNumber: 3, username, accountType: 'INTERNAL', ...initial },
      { rowNumber: 4, username: `bad-${randomUUID()}`, email: 'invalid-email', accountType: 'INTERNAL', ...initial },
    ] };
    const key = randomUUID();
    const first = await f.post('/admin/users/batch', body, key).expect(201);
    expect(first.body.rows.map((row: { status: string }) => row.status)).toEqual(['SUCCESS', 'ERROR', 'ERROR']);
    expect(first.body.rows[0].temporaryPassword).toMatchObject({ status: 'AVAILABLE', temporaryPassword: expect.any(String) });
    expect(first.body.rows[1].code).toBe('ADMIN_USER_DUPLICATE');
    expect(first.body.rows[2].code).toBe('ADMIN_BATCH_ROW_INVALID');
    const replay = await f.post('/admin/users/batch', body, key).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(await f.prisma.user.count({ where: { organizationId: f.organization.id, username } })).toBe(1);
    const raw = await f.prisma.$queryRaw<Array<{ result: unknown }>>`SELECT result FROM account_batch_rows WHERE batch_id = ${first.body.batchId}::uuid`;
    expect(JSON.stringify(raw)).not.toContain(first.body.rows[0].temporaryPassword.temporaryPassword);
    await f.post('/admin/users/batch', { ...body, rows: body.rows.slice(0, 1) }, key).expect(409);
    const result = first.body.rows[0];
    const login = await f.login(username, result.temporaryPassword.temporaryPassword).expect(200);
    await f.post('/auth/password-change/complete', { newPassword: 'permanent-after-batch-password' }, undefined, f.challengeCookie(login)).expect(200);
    const after = await f.post('/admin/users/batch', body, key).expect(201);
    expect(after.body.rows[0].temporaryPassword).not.toHaveProperty('temporaryPassword');
  });

  it('rejects batch limits and cross organization requests before creating any rows', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ rowNumber: index + 2, username: `limit-${randomUUID()}`, accountType: 'INTERNAL' }));
    await f.post('/admin/users/batch', { organizationId: f.organization.id, rows }).expect(400);
    await f.post('/admin/users/batch', { organizationId: randomUUID(), rows: rows.slice(0, 1) }).expect(403);
    expect(await f.prisma.user.count({ where: { username: { in: rows.map((row) => row.username) } } })).toBe(0);
  });

  it('keeps unsupported account types and invalid usernames as row errors without rejecting valid neighbors', async () => {
    const initial = await f.onboarding();
    const username = `mixed-${randomUUID()}`;
    const response = await f.post('/admin/users/batch', { organizationId: f.organization.id, rows: [
      { rowNumber: 2, username, accountType: 'INTERNAL', ...initial },
      { rowNumber: 3, username: 'bad username', accountType: 'INTERNAL' },
      { rowNumber: 4, username: `supplier-${randomUUID()}`, accountType: 'SUPPLIER' },
      { rowNumber: 5, username: `unknown-${randomUUID()}`, accountType: 'UNKNOWN' },
    ] }).expect(201);
    expect(response.body.rows.map((row: { status: string }) => row.status)).toEqual(['SUCCESS', 'ERROR', 'ERROR', 'ERROR']);
    expect(response.body.rows.slice(1).every((row: { code: string }) => row.code === 'ADMIN_BATCH_ROW_INVALID')).toBe(true);
    expect(await f.prisma.user.count({ where: { username } })).toBe(1);
  });

  it('lets account creators with explicit position grants create without reset-protected temporary passwords', async () => {
    const initial = await f.onboarding();
    const assignment = await f.prisma.rolePermission.findFirstOrThrow({ where: { roleId: (await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } })).roleId, permission: { code: 'account:users:reset' } } });
    await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: assignment.roleId, permissionId: assignment.permissionId } } });
    try {
      const username = `create-only-${randomUUID()}`;
      const response = await f.post('/admin/users/batch', { organizationId: f.organization.id, rows: [{ rowNumber: 2, username, accountType: 'INTERNAL', ...initial }] }).expect(201);
      expect(response.body.rows[0]).toMatchObject({ username, status: 'SUCCESS', temporaryPassword: { status: 'UNAVAILABLE' } });
      expect(response.body.rows[0].temporaryPassword).not.toHaveProperty('temporaryPassword');
      expect(await f.prisma.user.count({ where: { username } })).toBe(1);
    } finally { await f.prisma.rolePermission.create({ data: { roleId: assignment.roleId, permissionId: assignment.permissionId } }); }
  });

  it('resumes after a later row audit failure without duplicating previously committed users', async () => {
    const initial = await f.onboarding();
    const rows = [2, 3, 4].map((rowNumber) => ({ rowNumber, username: `resume-${randomUUID()}`, accountType: 'INTERNAL', ...initial }));
    const body = { organizationId: f.organization.id, rows };
    const key = randomUUID();
    const audit = f.app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (...args) => {
      if (args[0].action === 'USER_CREATED' && args[0].metadata?.rowNumber === 3) throw new Error('audit unavailable');
      return original(...args);
    });
    try { await f.post('/admin/users/batch', body, key).expect(500); }
    finally { spy.mockRestore(); }
    expect(await f.prisma.user.count({ where: { username: { in: rows.map((row) => row.username) } } })).toBe(1);
    const replay = await f.post('/admin/users/batch', body, key).expect(201);
    expect(replay.body.rows.every((row: { status: string }) => row.status === 'SUCCESS')).toBe(true);
    expect(await f.prisma.user.count({ where: { username: { in: rows.map((row) => row.username) } } })).toBe(3);
  });
});
