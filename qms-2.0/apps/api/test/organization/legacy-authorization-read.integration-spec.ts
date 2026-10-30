import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { accountDeliveryFixture, type AccountDeliveryFixture } from '../identity/account-delivery-fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';

describe('legacy authorization read models with real PostgreSQL and HTTP', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => {
    if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Disposable PostgreSQL required; preview 55440 forbidden.');
    f = await accountDeliveryFixture();
    const grant = await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } });
    for (const code of ADMIN_PERMISSIONS) {
      const permission = await f.prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await f.prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: permission.id } }, create: { roleId: grant.roleId, permissionId: permission.id }, update: {} });
    }
  });
  afterAll(async () => { await f?.app.close(); });
  const get = (suffix: string) => request(f.app.getHttpServer()).get(`/api/v1/organizations/${f.organization.id}/${suffix}`).set('Cookie', f.cookie);
  async function role(name = 'Legacy readable role', organizationId: string | null = f.organization.id) {
    return f.prisma.role.create({ data: { organizationId, code: randomUUID(), name } });
  }
  const position = (name = 'Readable position') => f.prisma.position.create({ data: { organizationId: f.organization.id, code: randomUUID(), name, departmentId: null } });
  const direct = (userId: string, roleId: string, organizationId = f.organization.id) => f.prisma.userRole.create({ data: { userId, roleId, organizationId } });
  const mapping = (positionId: string, roleId: string, isCanonical = false) => f.prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId, roleId, isCanonical } });
  async function remove(source: { id: string }, userIds: string[] = [], positionIds: string[] = []) {
    const input = { operation: 'REMOVE', directUserIds: userIds, sourcePositionIds: positionIds };
    const preview = await f.post(`/organizations/${f.organization.id}/legacy-authorizations/${source.id}/preview`, input).expect(200);
    return f.post(`/organizations/${f.organization.id}/legacy-authorizations/${source.id}/commit`, { ...input, authorizationBaseline: preview.body.authorizationBaseline, confirmedImpactUserIds: preview.body.impactUserIds }).expect(200);
  }

  it('reads a bounded empty history without depending on a live role', async () => {
    const result = await get(`legacy-authorizations/history?roleId=${randomUUID()}`).expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({ items: [], total: 0, pageSize: 20, offset: 0 });
  });

  it.each(['', '?userId=nope', '?positionId=nope', `?userId=${randomUUID()}&positionId=${randomUUID()}`, '?userId=', '?unknown=1'])('rejects missing, ambiguous, invalid and unknown source parameters: %s', async suffix => {
    await get(`authorization-sources${suffix}`).expect(400);
  });

  it.each(['pageSize=0', 'pageSize=101', 'pageSize=1.2', 'offset=-1', 'offset=10001', 'offset=1.2', 'roleId=nope', 'unexpected=1'])('rejects invalid history pagination and query fields: %s', async query => {
    await get(`legacy-authorizations/history?${query}`).expect(400);
  });

  it('classifies canonical, legacy mappings and direct grants without guessing from names', async () => {
    const user = await f.target();
    const legacy = await role('ORGANIZATION_GOVERNOR');
    const canonical = await role('Not an initialization marker');
    const mapped = await role();
    const p = await position();
    await direct(user.id, legacy.id);
    await mapping(p.id, canonical.id, true);
    await mapping(p.id, mapped.id);
    await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: user.id, positionId: p.id, startedAt: new Date(Date.now() - 1000) } });
    const result = await get(`authorization-sources?userId=${user.id}`).expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.currentSources).toMatchObject({ total: 3, pageSize: 20, offset: 0, items: expect.arrayContaining([
      expect.objectContaining({ kind: 'LEGACY_DIRECT', role: expect.objectContaining({ id: legacy.id, platformMarker: false }) }),
      expect.objectContaining({ kind: 'POSITION_CANONICAL', role: expect.objectContaining({ id: canonical.id }) }),
      expect.objectContaining({ kind: 'LEGACY_MAPPING', role: expect.objectContaining({ id: mapped.id }) }),
    ]) });
    expect(result.body.labels.users).toContainEqual(expect.objectContaining({ id: user.id, username: user.username }));
    expect(result.body.labels.positions).toContainEqual(expect.objectContaining({ id: p.id, name: p.name, departmentId: null, version: 1, roleVersion: 1 }));
    expect(JSON.stringify(result.body)).not.toMatch(/passwordHash|encryptedSecret|credentialVersion|authorizationBaseline|tokenHash|sessionId|@example/);
  });

  it('uses only exact initialization provenance rather than ordinary role names or codes', async () => {
    const user = await f.target();
    const exact = await role('Ordinary name');
    const fake = await role('ORGANIZATION_GOVERNOR');
    await direct(user.id, exact.id);
    await direct(user.id, fake.id);
    await f.prisma.$executeRaw`INSERT INTO organization_initializations (organization_id, role_id, creator_user_id, permission_codes, original_organization, grant_user_id, grant_role_id, grant_organization_id)
      VALUES (${f.organization.id}::uuid, ${exact.id}::uuid, ${f.actor.id}::uuid, ARRAY[]::text[], '{}'::jsonb, ${user.id}::uuid, ${exact.id}::uuid, ${f.organization.id}::uuid)`;
    try {
      const result = await get(`authorization-sources?userId=${user.id}`).expect(200);
      expect(result.body.currentSources.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'SYSTEM_INITIALIZATION', role: expect.objectContaining({ id: exact.id }) }),
        expect.objectContaining({ kind: 'LEGACY_DIRECT', role: expect.objectContaining({ id: fake.id }) }),
      ]));
    } finally { await f.prisma.$executeRaw`DELETE FROM organization_initializations WHERE organization_id = ${f.organization.id}::uuid`; }
  });

  it('pages exact grant-appointment rows and preserves current, future and ended source windows', async () => {
    const user = await f.target();
    const p = await position();
    await mapping(p.id, (await role()).id, true);
    await mapping(p.id, (await role()).id);
    const now = Date.now();
    for (const [startedAt, endedAt] of [[now - 5000, now - 1000], [now - 500, now + 50000], [now + 5000, now + 10000]]) {
      await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: user.id, positionId: p.id, startedAt: new Date(startedAt!), endedAt: new Date(endedAt!) } });
    }
    const all = await get(`authorization-sources?userId=${user.id}`).expect(200);
    expect(all.body.currentSources.total).toBe(6);
    expect(all.body.currentSources.items.map((row: { temporalState: string }) => row.temporalState).sort()).toEqual(['CURRENT', 'CURRENT', 'ENDED', 'ENDED', 'FUTURE', 'FUTURE']);
    const page = await get(`authorization-sources?userId=${user.id}&pageSize=2&offset=2`).expect(200);
    expect(page.body.currentSources).toMatchObject({ total: 6, pageSize: 2, offset: 2, items: all.body.currentSources.items.slice(2, 4) });
    const empty = await get(`authorization-sources?userId=${user.id}&pageSize=100&offset=10000`).expect(200);
    expect(empty.body.currentSources).toMatchObject({ items: [], total: 6 });
    await get(`authorization-sources?userId=${user.id}&pageSize=101`).expect(400);
  });

  it('shows inactive structure and empty-position mappings without pretending they are active', async () => {
    const p = await position();
    await mapping(p.id, (await role()).id, true);
    await f.prisma.position.update({ where: { id: p.id }, data: { status: 'DISABLED' } });
    const result = await get(`authorization-sources?positionId=${p.id}`).expect(200);
    expect(result.body.currentSources).toMatchObject({ total: 1, items: [expect.objectContaining({ kind: 'POSITION_CANONICAL', userId: null, temporalState: 'UNAVAILABLE', active: false })] });
  });

  it('does not fabricate ACTIVE user labels from a future appointment and does not activate a pending subject', async () => {
    const user = await f.target();
    const p = await position();
    await mapping(p.id, (await role()).id);
    await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: user.id, positionId: p.id, startedAt: new Date(Date.now() + 60000) } });
    await f.prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    const future = await get(`authorization-sources?positionId=${p.id}`).expect(200);
    expect(future.body.labels.users).toContainEqual(expect.objectContaining({ id: user.id, status: 'DISABLED', unavailable: true }));
    expect(future.body.currentSources.items[0]).toMatchObject({ temporalState: 'FUTURE', active: false });
    await f.prisma.user.update({ where: { id: user.id }, data: { configurationRequired: true } });
    const legacy = await role();
    await direct(user.id, legacy.id);
    const pending = await get(`authorization-sources?userId=${user.id}`).expect(200);
    expect(pending.body.currentSources.items).toContainEqual(expect.objectContaining({ kind: 'LEGACY_DIRECT', temporalState: 'UNAVAILABLE', active: false }));
    expect(pending.body.labels.users).toContainEqual(expect.objectContaining({ id: user.id, unavailable: true }));
  });

  it('fixes authorized preview labels in the baseline and preserves historical labels after a rename', async () => {
    const user = await f.target();
    await f.prisma.user.update({ where: { id: user.id }, data: { fullName: 'Original full name' } });
    const source = await role();
    await direct(user.id, source.id);
    const p = await position();
    await mapping(p.id, source.id);
    const input = { operation: 'REMOVE', directUserIds: [user.id], sourcePositionIds: [p.id] };
    const first = await f.post(`/organizations/${f.organization.id}/legacy-authorizations/${source.id}/preview`, input).expect(200);
    expect(first.body.labels.users).toContainEqual(expect.objectContaining({ id: user.id, username: user.username, fullName: 'Original full name' }));
    expect(first.body.labels.positions).toContainEqual(expect.objectContaining({ id: p.id, code: p.code, name: p.name, roleVersion: 1 }));
    expect(first.body.labels.organizations).toContainEqual(expect.objectContaining({ id: f.organization.id, code: f.organization.code, name: f.organization.name }));
    await f.prisma.user.update({ where: { id: user.id }, data: { fullName: 'Renamed before commit' } });
    await f.post(`/organizations/${f.organization.id}/legacy-authorizations/${source.id}/commit`, { ...input, authorizationBaseline: first.body.authorizationBaseline, confirmedImpactUserIds: first.body.impactUserIds }).expect(409);
    await remove(source, [user.id], [p.id]);
    await f.prisma.user.update({ where: { id: user.id }, data: { fullName: 'Current later name' } });
    const history = await get(`legacy-authorizations/history?roleId=${source.id}`).expect(200);
    expect(history.body).toMatchObject({ total: 1, items: [expect.objectContaining({ archiveId: expect.any(String), roleId: source.id, actorUserId: f.actor.id, operation: 'REMOVE', state: 'HISTORICAL', role: expect.objectContaining({ code: source.code }), retainedSourceCount: 0, labelsUnavailable: false })] });
    expect(history.body.items[0].labels.users).toContainEqual(expect.objectContaining({ id: user.id, fullName: 'Renamed before commit' }));
    expect(JSON.stringify(history.body)).not.toContain('Current later name');
    expect(JSON.stringify(history.body)).not.toMatch(/authorizationBaseline|credentialVersion|snapshot|passwordHash|encryptedSecret|tokenHash/);
    const detail = await get(`authorization-sources?userId=${user.id}`).expect(200);
    expect(detail.body.currentSources.total).toBe(0);
    expect(detail.body.history.items).toContainEqual(expect.objectContaining({ roleId: source.id }));
  });

  it('projects readable department labels for a mapped source without relying on the current directory', async () => {
    const department = await f.prisma.department.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Historical department label' } });
    const p = await position();
    await f.prisma.position.update({ where: { id: p.id }, data: { departmentId: department.id } });
    const source = await role();
    await mapping(p.id, source.id);
    const preview = await f.post(`/organizations/${f.organization.id}/legacy-authorizations/${source.id}/preview`, { operation: 'REMOVE', directUserIds: [], sourcePositionIds: [p.id] }).expect(200);
    expect(preview.body.labels.positions).toContainEqual(expect.objectContaining({ id: p.id, department: { id: department.id, code: department.code, name: department.name } }));
    const detail = await get(`authorization-sources?positionId=${p.id}`).expect(200);
    expect(detail.body.labels.positions).toContainEqual(expect.objectContaining({ id: p.id, department: { id: department.id, code: department.code, name: department.name } }));
  });

  it('keeps public history after physical role deletion and pages it without a role lookup', async () => {
    const empty = await role();
    await remove(empty);
    expect(await f.prisma.role.findUnique({ where: { id: empty.id } })).toBeNull();
    const result = await get(`legacy-authorizations/history?roleId=${empty.id}&pageSize=1`).expect(200);
    expect(result.body).toMatchObject({ total: 1, items: [expect.objectContaining({ roleId: empty.id, role: expect.objectContaining({ code: empty.code }) })] });
    const next = await get(`legacy-authorizations/history?roleId=${empty.id}&pageSize=1&offset=1`).expect(200);
    expect(next.body).toMatchObject({ total: 1, items: [] });
  });

  it.each(['userId', 'positionId'] as const)('matches uppercase and lowercase %s current sources and historical pages identically', async subject => {
    const user = await f.target();
    const p = await position();
    await mapping(p.id, (await role()).id, true);
    await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: user.id, positionId: p.id, startedAt: new Date(Date.now() - 1000) } });
    for (let index = 0; index < 2; index++) {
      const old = await role();
      await direct(user.id, old.id);
      await mapping(p.id, old.id);
      await remove(old, [user.id], [p.id]);
    }
    const id = subject === 'userId' ? user.id : p.id;
    for (const offset of [0, 1, 10000]) {
      const lower = await get(`authorization-sources?${subject}=${id}&pageSize=1&offset=${offset}`).expect(200);
      const upper = await get(`authorization-sources?${subject}=${id.toUpperCase()}&pageSize=1&offset=${offset}`).expect(200);
      expect(lower.body.currentSources).toMatchObject({ total: 1, pageSize: 1, offset });
      expect(lower.body.history).toMatchObject({ total: 2, pageSize: 1, offset });
      expect(upper.body.currentSources).toEqual(lower.body.currentSources);
      expect(upper.body.history).toEqual(lower.body.history);
      expect(lower.body.history.items).toHaveLength(offset === 10000 ? 0 : 1);
    }
  });

  it('returns unavailable historical labels for old receipts and never substitutes present-day names', async () => {
    const source = await role();
    const user = await f.target();
    await f.prisma.legacyAuthorizationArchive.create({ data: { organizationId: f.organization.id, roleId: source.id, actorUserId: f.actor.id, operation: 'REMOVE', snapshot: { preview: { role: source, directSources: [{ userId: user.id, organizationId: f.organization.id, roleId: source.id, selected: true }], mappedSources: [], target: null, retainedSourceCount: 0, authorizationBaseline: 'not-public' } } as unknown as Prisma.InputJsonValue } });
    const result = await get(`legacy-authorizations/history?roleId=${source.id}`).expect(200);
    expect(result.body.items[0]).toMatchObject({ labels: null, labelsUnavailable: true });
    expect(JSON.stringify(result.body)).not.toContain(user.username);
    expect(JSON.stringify(result.body)).not.toContain('not-public');
  });

  it('rejects cross-scope current sources and history before returning any label or count, including an empty offset', async () => {
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'SECRET organization', type: 'INTERNAL' } });
    const user = await f.target();
    const global = await role('SECRET global role', null);
    await direct(user.id, global.id, other.id);
    const result = await get(`authorization-sources?userId=${user.id}&offset=10000`).expect(403);
    expect(JSON.stringify(result.body)).not.toMatch(/SECRET|total|labels|username/);
    await f.prisma.legacyAuthorizationArchive.create({ data: { organizationId: f.organization.id, roleId: global.id, actorUserId: f.actor.id, operation: 'REMOVE', snapshot: { preview: { role: global, directSources: [{ userId: user.id, organizationId: other.id, roleId: global.id, selected: false }], mappedSources: [], affectedUsers: [], target: null } } as unknown as Prisma.InputJsonValue } });
    const history = await get(`legacy-authorizations/history?roleId=${global.id}&offset=10000`).expect(403);
    expect(JSON.stringify(history.body)).not.toMatch(/SECRET|total|labels|username/);
    // The intentionally denied fact must not affect later whole-organization history tests.
    await f.prisma.legacyAuthorizationArchive.deleteMany({ where: { organizationId: f.organization.id, roleId: global.id } });
  });

  it('never selects another organization subject by UUID and never resolves a role outside its history namespace', async () => {
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Hidden owner', type: 'INTERNAL' } });
    const user = await f.prisma.user.create({ data: { organizationId: other.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: f.actor.passwordHash } });
    const p = await f.prisma.position.create({ data: { organizationId: other.id, code: randomUUID(), name: 'Hidden position', departmentId: null } });
    await get(`authorization-sources?userId=${user.id}`).expect(403);
    await get(`authorization-sources?positionId=${p.id}`).expect(403);
    const result = await get(`legacy-authorizations/history?roleId=${randomUUID()}`).expect(200);
    expect(result.body).toMatchObject({ total: 0, items: [] });
  });

  it('authorizes the historical identity-owner scopes too, even when no current-page source reveals them', async () => {
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Historical hidden home', type: 'INTERNAL' } });
    const source = await role();
    const fact = await f.prisma.legacyAuthorizationArchive.create({ data: { organizationId: f.organization.id, roleId: source.id, actorUserId: f.actor.id, operation: 'REMOVE', snapshot: { preview: { role: source, directSources: [], mappedSources: [], target: null }, userVersions: [{ id: randomUUID(), organizationId: other.id, securityVersion: 1, credentialVersion: 1 }] } as unknown as Prisma.InputJsonValue } });
    try {
      const result = await get(`legacy-authorizations/history?roleId=${source.id}&offset=10000`).expect(403);
      expect(JSON.stringify(result.body)).not.toMatch(/Historical hidden home|total|labels/);
    } finally { await f.prisma.legacyAuthorizationArchive.delete({ where: { id: fact.id } }); }
  });

  it('refuses supplier actors and revoked sessions, and rechecks removed read permissions', async () => {
    const user = await f.target();
    const session = await f.app.get(SessionService).create(user.id, f.prisma, { mfaVerified: true });
    await direct(user.id, (await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } })).roleId);
    const supplier = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Supplier', type: 'SUPPLIER' } });
    const vendor = await f.prisma.user.create({ data: { organizationId: supplier.id, username: randomUUID(), accountType: 'SUPPLIER', passwordHash: f.actor.passwordHash } });
    const vendorRole = await role('Supplier read role', supplier.id);
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:roles:read' } });
    await f.prisma.rolePermission.create({ data: { roleId: vendorRole.id, permissionId: permission.id } });
    await direct(vendor.id, vendorRole.id, supplier.id);
    const vendorSession = await f.app.get(SessionService).create(vendor.id, f.prisma, { mfaVerified: true });
    await request(f.app.getHttpServer()).get(`/api/v1/organizations/${supplier.id}/legacy-authorizations/history`).set('Cookie', `qms_session=${vendorSession}`).expect(403);
    await request(f.app.getHttpServer()).get(`/api/v1/organizations/${f.organization.id}/legacy-authorizations/history`).expect(401);
    await f.prisma.userRole.deleteMany({ where: { userId: user.id } });
    await request(f.app.getHttpServer()).get(`/api/v1/organizations/${f.organization.id}/legacy-authorizations/history`).set('Cookie', `qms_session=${session}`).expect(403);
    await f.prisma.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });
    await request(f.app.getHttpServer()).get(`/api/v1/organizations/${f.organization.id}/legacy-authorizations/history`).set('Cookie', `qms_session=${session}`).expect(401);
  });
});
