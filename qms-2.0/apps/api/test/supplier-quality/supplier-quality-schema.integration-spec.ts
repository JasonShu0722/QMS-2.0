import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { jest } from '@jest/globals';

if (!process.env.DATABASE_URL) throw new Error('Supplier PostgreSQL integration requires DATABASE_URL; no skipping.');

describe('supplier quality real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID();
  const csrf = randomUUID();
  const organizations: string[] = [];
  const users: { id: string; organizationId: string; cookie: string }[] = [];
  const permissions = ['supplier-quality:profiles:read', 'supplier-quality:profiles:write', 'supplier-quality:problems:read', 'supplier-quality:problems:write', 'supplier-quality:responses:read', 'supplier-quality:responses:write'];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    for (const [index, type] of (['INTERNAL', 'INTERNAL', 'SUPPLIER', 'SUPPLIER'] as const).entries()) {
      const organization = await prisma.organization.create({ data: { code: `SQ-${index}-${suffix}`, name: `领域测试组织 ${index}`, type } });
      organizations.push(organization.id);
      const user = await prisma.user.create({ data: { organizationId: organization.id, username: `sq-${index}-${suffix}`, accountType: type, passwordHash: 'unused-test-hash' } });
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'SQ_TEST', name: '测试授权' } });
      for (const code of permissions) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
      users.push({ ...user, cookie: `qms_session=${await app.get(SessionService).create(user.id, prisma, { reauthenticated: true })}; qms_csrf=${csrf}` });
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.supplierQualityProblem.deleteMany({ where: { ownerOrganizationId: { in: organizations } } });
      await prisma.supplierBusinessProfile.deleteMany({ where: { ownerOrganizationId: { in: organizations } } });
      await prisma.problemIndex.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.user.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    }
    await app?.close();
  });

  it('returns the actual empty owner-scoped supplier directory', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/supplier-quality/profiles').set('Cookie', users[0]!.cookie).expect(200);
    expect(response.body.items).toEqual([]);
  });

  function send(user: number, method: 'post' | 'put', path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer())[method](`/api/v1/${path}`).set('Cookie', users[user]!.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }

  async function draft(overrides: object = {}, owner = 0, supplier = 2) {
    let profile = await prisma.supplierBusinessProfile.findFirst({ where: { ownerOrganizationId: organizations[owner], supplierOrganizationId: organizations[supplier] } });
    if (!profile) {
      const response = await send(owner, 'post', 'supplier-quality/profiles', { supplierOrganizationId: organizations[supplier], businessCode: `CODE-${randomUUID()}` }).expect(201);
      profile = await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: response.body.id } });
    }
    const body = { profileId: profile.id, title: '来料测试问题', materialCode: 'MAT-001', defectDescription: '端子表面氧化', defectQuantity: 12, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', ...overrides };
    const response = await send(owner, 'post', 'supplier-quality/drafts', body).expect(201);
    return { ...response.body, input: body };
  }

  async function released() {
    const record = await draft();
    const index = await prisma.problemIndex.create({ data: { organizationId: organizations[0]!, reportNumber: `TEST-${randomUUID()}`, domainCode: 'supplier-quality', problemType: 'MATERIAL', sourceType: 'supplier-quality', sourceId: record.id, severity: 'HIGH' } });
    await prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { problemIndexId: index.id, releasedToSupplierAt: new Date() } });
    return record;
  }

  it('requires a session and rejects supplier access to internal profiles even with matching feature grants', async () => {
    await request(app.getHttpServer()).get('/api/v1/supplier-quality/profiles').expect(401);
    await request(app.getHttpServer()).get('/api/v1/supplier-quality/profiles').set('Cookie', users[2]!.cookie).expect(403);
  });

  it('persists a draft with an audit receipt but no formal index, workflow or Outbox', async () => {
    const record = await draft();
    expect(record.stage).toBe('DRAFT');
    expect(record.version).toBe(1);
    expect(await prisma.supplierQualityProblem.count({ where: { id: record.id } })).toBe(1);
    expect(await prisma.problemIndex.count({ where: { sourceId: record.id } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: record.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { resourceId: record.id, action: 'SUPPLIER_PROBLEM_DRAFT_CREATED' } })).toBe(1);
  });

  it('keeps business identity references stable when users or organizations change', async () => {
    await draft();
    await expect(prisma.user.update({ where: { id: users[0]!.id }, data: { organizationId: organizations[1] } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.organization.update({ where: { id: organizations[2]! }, data: { type: 'INTERNAL' } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('provides owner-scoped profile and responder options and excludes unissued portal records', async () => {
    const record = await draft();
    const options = await request(app.getHttpServer()).get('/api/v1/supplier-quality/reference-options').set('Cookie', users[0]!.cookie).expect(200);
    expect(options.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: record.profileId })]));
    const responders = await request(app.getHttpServer()).get('/api/v1/supplier-quality/reference-options?kind=responders').set('Cookie', users[0]!.cookie).expect(200);
    expect(responders.body.items.map((entry: { id: string }) => entry.id)).toEqual([users[0]!.id]);
    const portal = await request(app.getHttpServer()).get('/api/v1/supplier-portal/problems').set('Cookie', users[2]!.cookie).expect(200);
    expect(portal.body.items).toEqual([]);
    expect(portal.body.canCreateDraft).toBe(false);
  });

  it('replays identical creation and rejects changed content using the same key', async () => {
    const record = await draft();
    const key = randomUUID();
    const first = await send(0, 'post', 'supplier-quality/drafts', record.input, key).expect(201);
    const replay = await send(0, 'post', 'supplier-quality/drafts', record.input, key).expect(201);
    expect(replay.body).toEqual(first.body);
    const conflict = await send(0, 'post', 'supplier-quality/drafts', { ...record.input, title: '不同内容' }, key).expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_REPLAY');
    expect(await prisma.auditEvent.count({ where: { resourceId: first.body.id } })).toBe(1);
  });

  it('rejects missing CSRF, guessed profiles and server-owned field injection', async () => {
    const record = await draft();
    await request(app.getHttpServer()).post('/api/v1/supplier-quality/drafts').set('Cookie', users[0]!.cookie).set('Idempotency-Key', randomUUID()).send(record.input).expect(403);
    await send(1, 'post', 'supplier-quality/drafts', record.input).expect(404);
    await send(0, 'post', 'supplier-quality/drafts', { ...record.input, releasedToSupplierAt: new Date().toISOString() }).expect(400);
    await send(0, 'post', 'supplier-quality/drafts', { ...record.input, responseForm: undefined }).expect(400);
    await send(0, 'post', 'supplier-quality/drafts', { ...record.input, defectQuantity: 2147483648 }).expect(400);
  });

  it('rejects internal organizations as suppliers and duplicate business relationships', async () => {
    await send(0, 'post', 'supplier-quality/profiles', { supplierOrganizationId: organizations[1], businessCode: 'WRONG' }).expect(400);
    await draft();
    await send(0, 'post', 'supplier-quality/profiles', { supplierOrganizationId: organizations[2], businessCode: 'DUPLICATE' }).expect(409);
  });

  it('isolates internal organizations and hides unreleased problems from the supplier', async () => {
    const record = await draft();
    await request(app.getHttpServer()).get(`/api/v1/supplier-quality/problems/${record.id}`).set('Cookie', users[0]!.cookie).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/supplier-quality/problems/${record.id}`).set('Cookie', users[1]!.cookie).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/supplier-portal/problems/${record.id}`).set('Cookie', users[2]!.cookie).expect(404);
  });

  it('uses database CAS so only one competing edit wins', async () => {
    const record = await draft();
    const responses = await Promise.all(['第一份', '第二份'].map((title) => send(0, 'put', `supplier-quality/drafts/${record.id}`, { ...record.input, title, expectedVersion: 1 })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id } })).version).toBe(2);
  });

  it('allows only the specified internal person to draft an internal reply', async () => {
    const record = await draft({ replyMode: 'INTERNAL', internalResponderId: users[0]!.id });
    await send(0, 'put', `supplier-quality/problems/${record.id}/response-draft`, { expectedVersion: 1, content: { rootCause: '内部初步分析' } }).expect(200);
    await send(2, 'put', `supplier-portal/problems/${record.id}/response-draft`, { expectedVersion: 2, content: {} }).expect(404);
    await send(0, 'post', 'supplier-quality/drafts', { ...record.input, internalResponderId: users[1]!.id }).expect(400);
  });

  it('shows released records only to the related supplier and accepts a real reply draft', async () => {
    const record = await released();
    const detail = await request(app.getHttpServer()).get(`/api/v1/supplier-portal/problems/${record.id}`).set('Cookie', users[2]!.cookie).expect(200);
    expect(detail.body.canEditResponse).toBe(true);
    await request(app.getHttpServer()).get(`/api/v1/supplier-portal/problems/${record.id}`).set('Cookie', users[3]!.cookie).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/supplier-portal/problems?organizationId=${organizations[0]}`).set('Cookie', users[2]!.cookie).expect(403);
    const saved = await send(2, 'put', `supplier-portal/problems/${record.id}/response-draft`, { expectedVersion: 1, content: { rootCause: '包装破损', correctiveAction: '更换包装' } }).expect(200);
    expect(saved.body.version).toBe(2);
    expect(saved.body.responseDraft.rootCause).toBe('包装破损');
    await send(0, 'put', `supplier-quality/problems/${record.id}/response-draft`, { expectedVersion: 2, content: {} }).expect(403);
    await send(0, 'put', `supplier-quality/drafts/${record.id}`, { ...record.input, expectedVersion: 2 }).expect(409);
  });

  it('rechecks domain release before replay and rejects supplier verification injection', async () => {
    const record = await released();
    const key = randomUUID();
    const body = { expectedVersion: 1, content: { rootCause: '初步分析' } };
    await send(2, 'put', `supplier-portal/problems/${record.id}/response-draft`, body, key).expect(200);
    await send(2, 'put', `supplier-portal/problems/${record.id}/response-draft`, { expectedVersion: 2, content: { accepted: true } }).expect(400);
    await prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { releasedToSupplierAt: null } });
    await send(2, 'put', `supplier-portal/problems/${record.id}/response-draft`, body, key).expect(404);
  });

  it('does not save reply drafts for closed or archived formal problems', async () => {
    const record = await released();
    await prisma.problemIndex.updateMany({ where: { sourceId: record.id }, data: { status: 'CLOSED' } });
    await send(2, 'put', `supplier-portal/problems/${record.id}/response-draft`, { expectedVersion: 1, content: {} }).expect(409);
  });

  it('rolls back content, version and receipt when audit insertion fails', async () => {
    const record = await draft({ replyMode: 'INTERNAL', internalResponderId: users[0]!.id });
    const key = randomUUID();
    const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('injected audit failure'));
    try {
      await send(0, 'put', `supplier-quality/problems/${record.id}/response-draft`, { expectedVersion: 1, content: { rootCause: '不能保存' } }, key).expect(500);
      expect(failure).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUPPLIER_RESPONSE_DRAFT_SAVED' }), expect.anything());
    } finally { failure.mockRestore(); }
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id } })).version).toBe(1);
    expect(await prisma.supplierResponseDraft.count({ where: { problemId: record.id } })).toBe(0);
    expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
  });

  it('enforces the profile ownership composite key in PostgreSQL', async () => {
    const record = await draft();
    await expect(prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { ownerOrganizationId: organizations[1] } })).rejects.toThrow();
  });

  it('rejects a replay after feature permission revocation', async () => {
    const record = await draft();
    const key = randomUUID();
    await send(0, 'post', 'supplier-quality/drafts', record.input, key).expect(201);
    const role = await prisma.userRole.findFirstOrThrow({ where: { userId: users[0]!.id } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:problems:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.roleId, permissionId: permission.id } } });
    try { await send(0, 'post', 'supplier-quality/drafts', record.input, key).expect(403); }
    finally { await prisma.rolePermission.create({ data: { roleId: role.roleId, permissionId: permission.id } }); }
  });

  it.each(permissions)('denies the actual endpoint after revoking %s', async (code) => {
    const record = await released();
    const portal = code.includes(':responses:');
    const actorIndex = portal ? 2 : 0;
    const role = await prisma.userRole.findFirstOrThrow({ where: { userId: users[actorIndex]!.id } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.roleId, permissionId: permission.id } } });
    try {
      if (code.endsWith(':read')) {
        const path = portal ? 'supplier-portal/problems' : code.includes(':profiles:') ? 'supplier-quality/profiles' : 'supplier-quality/problems';
        await request(app.getHttpServer()).get(`/api/v1/${path}`).set('Cookie', users[actorIndex]!.cookie).expect(403);
      } else if (code.includes(':profiles:')) {
        await send(0, 'post', 'supplier-quality/profiles', { supplierOrganizationId: organizations[3], businessCode: 'DENIED' }).expect(403);
      } else if (portal) {
        await send(2, 'put', `supplier-portal/problems/${record.id}/response-draft`, { expectedVersion: 1, content: {} }).expect(403);
      } else {
        await send(0, 'post', 'supplier-quality/drafts', record.input).expect(403);
      }
    } finally { await prisma.rolePermission.create({ data: { roleId: role.roleId, permissionId: permission.id } }); }
  });

  function get(user: number, path: string) { return request(app.getHttpServer()).get(`/api/v1/supplier-quality/${path}`).set('Cookie', users[user]!.cookie); }

  it('edits profile contacts atomically, clears optional values and replays only the same request', async () => {
    const record = await draft();
    const current = await get(0, `profiles/${record.profileId}`).expect(200);
    const key = randomUUID();
    const input = { expectedVersion: current.body.version, businessCode: `EDIT-${randomUUID()}`, contactName: '  联系人  ', contactEmail: 'quality@example.test' };
    const saved = await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, input, key).expect(200);
    expect(saved.body).toMatchObject({ contactName: '联系人', contactEmail: input.contactEmail, version: current.body.version + 1 });
    expect((await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, input, key).expect(200)).body).toEqual(saved.body);
    await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, { ...input, contactName: '另一个人' }, key).expect(409);
    const cleared = await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, { businessCode: input.businessCode, expectedVersion: saved.body.version }).expect(200);
    expect(cleared.body.contactName).toBeUndefined();
    expect(cleared.body.contactEmail).toBeUndefined();
    expect(await prisma.auditEvent.count({ where: { resourceId: record.profileId, action: 'SUPPLIER_PROFILE_UPDATED' } })).toBe(2);
  });

  it('rejects profile identity changes, invalid data, other organizations and suppliers', async () => {
    const record = await draft();
    const profile = await get(0, `profiles/${record.profileId}`).expect(200);
    const input = { businessCode: profile.body.businessCode, expectedVersion: profile.body.version };
    await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, { ...input, supplierOrganizationId: organizations[3] }).expect(400);
    await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, { ...input, businessCode: '   ' }).expect(400);
    await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, { ...input, contactEmail: 'invalid' }).expect(400);
    await get(1, `profiles/${record.profileId}`).expect(404);
    await send(1, 'put', `supplier-quality/profiles/${record.profileId}`, input).expect(404);
    await get(2, `profiles/${record.profileId}`).expect(403);
    await send(2, 'put', `supplier-quality/profiles/${record.profileId}`, input).expect(403);
  });

  it('rejects duplicate profile codes and accepts exactly one concurrent editor', async () => {
    const record = await draft();
    const other = await draft({}, 0, 3);
    const profile = await get(0, `profiles/${record.profileId}`).expect(200);
    const duplicate = await get(0, `profiles/${other.profileId}`).expect(200);
    await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, { expectedVersion: profile.body.version, businessCode: duplicate.body.businessCode }).expect(409);
    const results = await Promise.all(['first', 'second'].map((contactName) => send(0, 'put', `supplier-quality/profiles/${record.profileId}`, { businessCode: profile.body.businessCode, expectedVersion: profile.body.version, contactName })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it('rolls back profile version and contact changes when audit fails', async () => {
    const record = await draft();
    const profile = await get(0, `profiles/${record.profileId}`).expect(200);
    const key = randomUUID();
    const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('profile audit failure'));
    try {
      await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, { businessCode: profile.body.businessCode, expectedVersion: profile.body.version, contactName: '不应保存' }, key).expect(500);
      expect(failure).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUPPLIER_PROFILE_UPDATED' }), expect.anything());
    } finally { failure.mockRestore(); }
    expect((await get(0, `profiles/${record.profileId}`).expect(200)).body).toEqual(profile.body);
    expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
  });

  it('checks profile read/write grants and rechecks them before mutation replay', async () => {
    const record = await draft();
    const profile = await get(0, `profiles/${record.profileId}`).expect(200);
    const key = randomUUID();
    const input = { businessCode: profile.body.businessCode, expectedVersion: profile.body.version, contactName: '授权测试' };
    await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, input, key).expect(200);
    const role = await prisma.userRole.findFirstOrThrow({ where: { userId: users[0]!.id } });
    for (const operation of ['read', 'write']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: `supplier-quality:profiles:${operation}` } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.roleId, permissionId: permission.id } } });
      try {
        if (operation === 'read') await get(0, `profiles/${record.profileId}`).expect(403);
        else await send(0, 'put', `supplier-quality/profiles/${record.profileId}`, input, key).expect(403);
      } finally { await prisma.rolePermission.create({ data: { roleId: role.roleId, permissionId: permission.id } }); }
    }
  });

  it('searches and pages directories beyond 100 entries without leaking other organizations', async () => {
    const entries = Array.from({ length: 105 }, (_, index) => ({ id: randomUUID(), code: `DIR-${suffix}-${String(index).padStart(3, '0')}`, name: `目录供应商 ${index}`, type: 'SUPPLIER' as const }));
    organizations.push(...entries.map((entry) => entry.id));
    await prisma.organization.createMany({ data: entries });
    await prisma.supplierBusinessProfile.createMany({ data: entries.map((entry) => ({ id: randomUUID(), ownerOrganizationId: organizations[0]!, supplierOrganizationId: entry.id, businessCode: entry.code, displayName: entry.name })) });
    await prisma.user.createMany({ data: entries.map((entry) => ({ id: randomUUID(), organizationId: organizations[0]!, username: entry.code, passwordHash: 'unused', accountType: 'INTERNAL' })) });
    const search = encodeURIComponent(`DIR-${suffix}`);
    for (const path of ['supplier-options', 'reference-options?kind=profiles', 'reference-options?kind=responders']) {
      const first = await get(0, `${path}${path.includes('?') ? '&' : '?'}search=${search}&pageSize=100`).expect(200);
      const second = await get(0, `${path}${path.includes('?') ? '&' : '?'}search=${search}&pageSize=100&page=2`).expect(200);
      expect(first.body.total).toBe(105);
      expect(first.body.items).toHaveLength(100);
      expect(second.body.items).toHaveLength(5);
      expect(new Set([...first.body.items, ...second.body.items].map((entry: { id: string }) => entry.id)).size).toBe(105);
      const selectedId = second.body.items[4].id;
      const selected = await get(0, `${path}${path.includes('?') ? '&' : '?'}selectedId=${selectedId}`).expect(200);
      expect(selected.body.items).toEqual([second.body.items[4]]);
      if (path !== 'supplier-options') expect((await get(1, `${path}&selectedId=${selectedId}`).expect(200)).body.items).toEqual([]);
      await get(2, path).expect(403);
    }
    await get(0, 'reference-options?kind=unknown').expect(400);
    await get(0, 'reference-options?pageSize=101').expect(400);
    await get(0, 'supplier-options?selectedId=invalid').expect(400);
    await get(0, 'supplier-options?page=1000000000000').expect(400);
  });

  it('combines ledger filters with the server-owned organization and release scope', async () => {
    const keyword = `FILTER-${randomUUID()}`;
    const match = await draft({ title: keyword, severity: 'LOW', responseForm: 'EIGHT_D' });
    await draft({ title: keyword, severity: 'HIGH', responseForm: 'BRIEF' });
    await draft({ title: keyword, severity: 'LOW', responseForm: 'EIGHT_D' }, 1);
    const query = `search=${keyword}&severity=LOW&responseForm=EIGHT_D&stage=DRAFT`;
    const filtered = await get(0, `problems?${query}`).expect(200);
    expect(filtered.body.items.map((item: { id: string }) => item.id)).toEqual([match.id]);
    const portal = await request(app.getHttpServer()).get(`/api/v1/supplier-portal/problems?${query}`).set('Cookie', users[2]!.cookie).expect(200);
    expect(portal.body.items).toEqual([]);
    await get(0, 'problems?severity=INVALID').expect(400);
  });
});
