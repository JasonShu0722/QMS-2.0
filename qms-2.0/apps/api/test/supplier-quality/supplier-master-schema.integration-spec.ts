import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { jest } from '@jest/globals';

if (!process.env.DATABASE_URL) throw new Error('Supplier master integration requires real PostgreSQL.');

describe('independent supplier master', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: string;
  let cookie: string;
  let operatorId: string;
  const boundaries: string[] = [];
  const csrf = randomUUID();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const organization = await prisma.organization.create({ data: { code: `F1-${randomUUID()}`, name: 'F1 owner', type: 'INTERNAL' } });
    owner = organization.id;
    const user = await prisma.user.create({ data: { organizationId: owner, username: `f1-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused-test-hash' } });
    operatorId = user.id;
    const role = await prisma.role.create({ data: { organizationId: owner, code: 'F1_TEST', name: 'F1 test' } });
    for (const code of ['supplier-quality:profiles:read', 'supplier-quality:profiles:write', 'supplier-quality:problems:read', 'supplier-quality:problems:write', 'account:users:create', 'account:users:read', 'account:users:reset', 'account:users:status']) {
      const permission = await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: owner } });
    cookie = `qms_session=${await app.get(SessionService).create(user.id, prisma, { reauthenticated: true, mfaVerified: true })}; qms_csrf=${csrf}`;
  });
  afterAll(async () => {
    if (prisma && owner) {
      await prisma.supplierQualityProblem.deleteMany({ where: { ownerOrganizationId: owner } });
      await prisma.supplierBusinessProfile.deleteMany({ where: { ownerOrganizationId: owner } });
      await prisma.auditEvent.deleteMany({ where: { organizationId: owner } });
      if (boundaries.length) {
        await prisma.auditEvent.deleteMany({ where: { organizationId: { in: boundaries } } });
        await prisma.user.deleteMany({ where: { organizationId: { in: boundaries } } });
        await prisma.organization.deleteMany({ where: { id: { in: boundaries } } });
      }
      await prisma.user.deleteMany({ where: { organizationId: owner } });
      await prisma.organization.delete({ where: { id: owner } });
    }
    await app?.close();
  });
  function post(path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(`/api/v1/supplier-quality/${path}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  it('creates its own display name without creating an organization or an account', async () => {
    const before = [await prisma.organization.count(), await prisma.user.count()];
    const response = await post('profiles', { businessCode: '00042', displayName: 'Independent supplier' }).expect(201);
    expect(response.body).toMatchObject({ businessCode: '00042', displayName: 'Independent supplier', supplierOrganizationId: null });
    expect([await prisma.organization.count(), await prisma.user.count()]).toEqual(before);
  });
  it('imports mixed rows with stable replay and skips duplicates without overwriting', async () => {
    const key = randomUUID();
    const body = { rows: [{ rowNumber: 2, businessCode: 'NEW', displayName: 'Original' }, { rowNumber: 3, businessCode: 'NEW', displayName: 'Do not overwrite' }, { rowNumber: 4, businessCode: '', displayName: 'Invalid' }] };
    const response = await post('profiles/import', body, key).expect(201);
    expect(response.body).toMatchObject({ created: 1, skipped: 1, failed: 1, items: [{ rowNumber: 2, status: 'CREATED' }, { rowNumber: 3, status: 'SKIPPED_DUPLICATE' }, { rowNumber: 4, status: 'FAILED' }] });
    expect((await post('profiles/import', body, key).expect(201)).body).toEqual(response.body);
    expect((await prisma.supplierBusinessProfile.findFirstOrThrow({ where: { ownerOrganizationId: owner, businessCode: 'NEW' } })).displayName).toBe('Original');
  });
  it('rejects an overlimit import with 413 before writing any row or receipt', async () => {
    const before = await prisma.supplierBusinessProfile.count({ where: { ownerOrganizationId: owner } });
    const key = randomUUID();
    const rows = Array.from({ length: 101 }, (_, index) => ({ rowNumber: index + 2, businessCode: `LIMIT-${index}`, displayName: 'Over limit supplier' }));
    await post('profiles/import', { rows }, key).expect(413);
    expect(await prisma.supplierBusinessProfile.count({ where: { ownerOrganizationId: owner } })).toBe(before);
    expect(await prisma.adminMutation.count({ where: { organizationId: owner, key } })).toBe(0);
  });
  it('updates its own name using CAS and never accepts arbitrary organization binding on update', async () => {
    const profile = (await post('profiles', { businessCode: 'EDIT', displayName: 'Before', contactName: 'Contact' }).expect(201)).body;
    const update = (body: object) => request(app.getHttpServer()).put(`/api/v1/supplier-quality/profiles/${profile.id}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
    const result = await update({ expectedVersion: 1, businessCode: 'EDIT', displayName: 'After' }).expect(200);
    expect(result.body).toMatchObject({ displayName: 'After', version: 2, supplierOrganizationId: null });
    await update({ expectedVersion: 1, businessCode: 'EDIT', displayName: 'Stale' }).expect(409);
    await update({ expectedVersion: 2, businessCode: 'EDIT', displayName: 'Injected', supplierOrganizationId: randomUUID() }).expect(400);
  });
  it('rolls back only the import row whose audit failed and retains its stable failure receipt', async () => {
    const audit = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('F1 audit failure'));
    const key = randomUUID();
    const body = { rows: [{ rowNumber: 2, businessCode: 'AUDIT-FAIL', displayName: 'Must roll back' }, { rowNumber: 3, businessCode: 'AUDIT-GOOD', displayName: 'Must commit' }] };
    try {
      const response = await post('profiles/import', body, key).expect(201);
      expect(response.body).toMatchObject({ created: 1, skipped: 0, failed: 1 });
      expect(await prisma.supplierBusinessProfile.count({ where: { ownerOrganizationId: owner, businessCode: 'AUDIT-FAIL' } })).toBe(0);
      expect((await post('profiles/import', body, key).expect(201)).body).toEqual(response.body);
    } finally { audit.mockRestore(); }
  });
  it('allows internal draft facts without a supplier boundary and refuses portal release', async () => {
    const profile = (await post('profiles', { businessCode: 'DRAFT', displayName: 'No collaboration' }).expect(201)).body;
    const response = await post('drafts', { profileId: profile.id, title: 'Internal facts', materialCode: 'M1', defectDescription: 'Defect', defectQuantity: 1, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER' }).expect(201);
    expect(response.body.supplierOrganizationId).toBeNull();
    const issue = await post(`drafts/${response.body.id}/issue`, { expectedVersion: 1 }).expect(409);
    expect(issue.body.code).toBe('SUPPLIER_COLLABORATION_NOT_ENABLED');
  });
  it('opens one isolated enterprise for two independent temporary-password accounts', async () => {
    const profile = (await post('profiles', { businessCode: 'ACCOUNTS', displayName: 'Two staff' }).expect(201)).body;
    const before = await prisma.organization.count();
    const key = randomUUID();
    const input = { username: `supplier-first-${randomUUID()}` };
    const first = (await post(`profiles/${profile.id}/accounts`, input, key).expect(201).expect('Cache-Control', 'no-store')).body;
    boundaries.push(first.organizationId);
    expect(first.temporaryPassword.status).toBe('AVAILABLE');
    const replay = (await post(`profiles/${profile.id}/accounts`, input, key).expect(201)).body;
    expect(replay.id).toBe(first.id);
    const portalRole = await prisma.userRole.findFirstOrThrow({ where: { userId: first.id } });
    const workflowAction = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:act' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: portalRole.roleId, permissionId: workflowAction.id } } });
    const second = (await post(`profiles/${profile.id}/accounts`, { username: `supplier-second-${randomUUID()}` }).expect(201)).body;
    expect(await prisma.rolePermission.count({ where: { roleId: portalRole.roleId, permissionId: workflowAction.id } })).toBe(1);
    expect(second.organizationId).toBe(first.organizationId);
    expect(second.id).not.toBe(first.id);
    expect(await prisma.organization.count()).toBe(before + 1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).mustChangePassword).toBe(true);
    const portalAssignments = await prisma.userRole.findMany({ where: { userId: first.id }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
    expect(portalAssignments.every(({ role, organizationId }) => organizationId === first.organizationId && role.organizationId === first.organizationId)).toBe(true);
    expect(portalAssignments.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)).some((code) => /^(account:|organization:|configuration:)/.test(code))).toBe(false);
    const receipt = await prisma.adminMutation.findFirstOrThrow({ where: { organizationId: owner, key } });
    expect(JSON.stringify(receipt.response)).not.toContain(first.temporaryPassword.temporaryPassword);
    const response = await request(app.getHttpServer()).put(`/api/v1/supplier-quality/profiles/${profile.id}/accounts/${first.id}/status`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ status: 'DISABLED', expectedSecurityVersion: first.securityVersion }).expect(200);
    expect(response.body.status).toBe('DISABLED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('ACTIVE');
    const otherProfile = (await post('profiles', { businessCode: 'OTHER-STAFF', displayName: 'Other company' }).expect(201)).body;
    const otherAccount = (await post(`profiles/${otherProfile.id}/accounts`, { username: `other-company-${randomUUID()}` }).expect(201)).body;
    boundaries.push(otherAccount.organizationId);
    await post(`profiles/${otherProfile.id}/accounts/${second.id}/temporary-password/reset`, {}).expect(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).credentialVersion).toBe(1);
  });
  it('rolls back enterprise creation and binding when the first account conflicts', async () => {
    const profile = (await post('profiles', { businessCode: 'ROLLBACK', displayName: 'Rollback' }).expect(201)).body;
    const existing = await prisma.user.findFirstOrThrow({ where: { organizationId: owner } });
    const before = await prisma.organization.count();
    await post(`profiles/${profile.id}/accounts`, { username: existing.username }).expect(409);
    expect(await prisma.organization.count()).toBe(before);
    expect((await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: profile.id } })).supplierOrganizationId).toBeNull();
  });
  it('serializes competing first-account operators without granting the loser foreign-enterprise governance', async () => {
    const profile = (await post('profiles', { businessCode: 'RACE', displayName: 'Concurrent supplier' }).expect(201)).body;
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: owner, code: 'F1_TEST' } });
    const other = await prisma.user.create({ data: { organizationId: owner, username: `f1-racer-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused' } });
    await prisma.userRole.create({ data: { userId: other.id, roleId: role.id, organizationId: owner } });
    const otherCookie = `qms_session=${await app.get(SessionService).create(other.id, prisma, { reauthenticated: true, mfaVerified: true })}; qms_csrf=${csrf}`;
    const before = await prisma.organization.count();
    const results = await Promise.all([
      post(`profiles/${profile.id}/accounts`, { username: `race-first-${randomUUID()}` }),
      request(app.getHttpServer()).post(`/api/v1/supplier-quality/profiles/${profile.id}/accounts`).set('Cookie', otherCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ username: `race-second-${randomUUID()}` }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 403]);
    const created = results.find(({ status }) => status === 201)!.body;
    boundaries.push(created.organizationId);
    expect(await prisma.organization.count()).toBe(before + 1);
    expect(await prisma.user.count({ where: { organizationId: created.organizationId, accountType: 'SUPPLIER' } })).toBe(1);
  });
  it('projects only current unexpired temporary credentials and reauthorizes resets after commit', async () => {
    const profile = (await post('profiles', { businessCode: 'CREDENTIALS', displayName: 'Credentials supplier' }).expect(201)).body;
    const created = (await post(`profiles/${profile.id}/accounts`, { username: `credentials-${randomUUID()}` }).expect(201)).body;
    boundaries.push(created.organizationId);
    const encrypted = await prisma.userTemporaryPassword.findUniqueOrThrow({ where: { userId: created.id } });
    expect(encrypted.encryptedValue).not.toContain(created.temporaryPassword.temporaryPassword);
    expect(encrypted.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400000);
    const resetKey = randomUUID();
    const reset = (await post(`profiles/${profile.id}/accounts/${created.id}/temporary-password/reset`, {}, resetKey).expect(201).expect('Cache-Control', 'no-store')).body;
    expect(reset.status).toBe('AVAILABLE');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(await app.get(PasswordService).verify(user.passwordHash, reset.temporaryPassword)).toBe(true);
    expect((await post(`profiles/${profile.id}/accounts/${created.id}/temporary-password/reset`, {}, resetKey).expect(201)).body).toEqual(reset);
    const get = () => request(app.getHttpServer()).get(`/api/v1/supplier-quality/profiles/${profile.id}/accounts/${created.id}/temporary-password`).set('Cookie', cookie);
    await prisma.userTemporaryPassword.update({ where: { userId: created.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await get().expect(200).expect('Cache-Control', 'no-store')).body).toEqual({ userId: created.id, status: 'EXPIRED' });
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { organizationId: created.organizationId, user: { accountType: 'INTERNAL' } } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:reset' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: assignment.roleId, permissionId: permission.id } } });
    await get().expect(403);
    await post(`profiles/${profile.id}/accounts/${created.id}/temporary-password/reset`, {}, resetKey).expect(403);
  });
  it('rejects arbitrary existing enterprise binding without target governance', async () => {
    const supplier = await prisma.organization.create({ data: { code: `UNCONTROLLED-${randomUUID()}`, name: 'Not controlled', type: 'SUPPLIER' } });
    boundaries.push(supplier.id);
    await post('profiles', { businessCode: 'UNCONTROLLED', displayName: 'Not controlled', supplierOrganizationId: supplier.id }).expect(403);
    const profile = (await post('profiles', { businessCode: 'CONTROLLED', displayName: 'No target grant' }).expect(201)).body;
    await post(`profiles/${profile.id}/accounts`, { username: `denied-${randomUUID()}`, supplierOrganizationId: supplier.id }).expect(403);
    expect((await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: profile.id } })).supplierOrganizationId).toBeNull();
  });
  it('reauthorizes a controlled legacy organization binding before replaying its profile receipt', async () => {
    const supplier = await prisma.organization.create({ data: { code: `LEGACY-${randomUUID()}`, name: 'Legacy enterprise name', type: 'SUPPLIER' } });
    boundaries.push(supplier.id);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:create' } });
    const role = await prisma.role.create({ data: { organizationId: supplier.id, code: 'CONTROLLED_BINDING', name: 'Controlled binding', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { userId: operatorId, organizationId: supplier.id, roleId: role.id } });
    const key = randomUUID();
    const body = { businessCode: 'LEGACY', supplierOrganizationId: supplier.id };
    const profile = (await post('profiles', body, key).expect(201)).body;
    expect(profile).toMatchObject({ supplierOrganizationId: supplier.id, displayName: 'Legacy enterprise name' });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
    await post('profiles', body, key).expect(403);
  });
  it.each(['OWNER', 'TARGET'] as const)('rechecks %s read permission after waiting for a locked supplier account', async (scope) => {
    const profile = (await post('profiles', { businessCode: `LOCK-${scope}`, displayName: 'Read lock supplier' }).expect(201)).body;
    const created = (await post(`profiles/${profile.id}/accounts`, { username: `read-lock-${randomUUID()}` }).expect(201)).body;
    boundaries.push(created.organizationId);
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: scope === 'OWNER' ? owner : created.organizationId, code: scope === 'OWNER' ? 'F1_TEST' : `SUPPLIER_CARETAKER_${operatorId}` } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: scope === 'OWNER' ? 'supplier-quality:profiles:read' : 'account:users:read' } });
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${created.id}::uuid FOR UPDATE`;
      locked();
      await gate;
    }, { timeout: 20000 });
    await acquired;
    const pending = request(app.getHttpServer()).get(`/api/v1/supplier-quality/profiles/${profile.id}/accounts`).set('Cookie', cookie).then((response) => response);
    let revoked = false;
    try {
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM users%FOR UPDATE%') AS waiting`;
        if (row?.waiting) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
      revoked = true;
      release();
      await holder;
      expect((await pending).status).toBe(403);
    } finally {
      release();
      await holder;
      if (revoked) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      await pending;
    }
  });
  it('enforces all twelve owner/profile foreign keys even when supplier organization is null', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT DISTINCT c.conrelid::regclass::text AS table_name
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.confrelid = 'supplier_business_profiles'::regclass
        AND cardinality(c.conkey) = 2 AND pg_get_constraintdef(c.oid) LIKE '%profile_id, owner_organization_id%'`;
    expect(rows.map((row) => row.table_name).sort()).toEqual([
      'supplier_quality_problems', 'supplier_incoming_inspections', 'supplier_performance_cards',
      'supplier_concession_requests', 'supplier_audit_plans', 'supplier_audit_records', 'supplier_quality_targets',
      'supplier_meetings', 'supplier_ppap_packages', 'supplier_inspection_standards', 'supplier_barcode_rules', 'supplier_asn_records',
    ].sort());
    const profile = (await post('profiles', { businessCode: 'FOREIGN', displayName: 'Owner protected' }).expect(201)).body;
    const record = (await post('drafts', { profileId: profile.id, title: 'Protected', materialCode: 'M1', defectDescription: 'Defect', defectQuantity: 1, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER' }).expect(201)).body;
    const other = await prisma.organization.create({ data: { code: `FOREIGN-${randomUUID()}`, name: 'Other owner', type: 'INTERNAL' } });
    boundaries.push(other.id);
    await expect(prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { ownerOrganizationId: other.id } })).rejects.toMatchObject({ code: 'P2003' });
  });
});
