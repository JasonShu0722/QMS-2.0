import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Legacy supplier read scope requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('legacy supplier reads enforce the controlled read scope before pagination', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  type Fixture = Awaited<ReturnType<typeof supplierEightDFixture>>;
  async function legacy(f: Fixture, responseForm: 'BRIEF' | 'EIGHT_D' = 'BRIEF', replyMode: 'SUPPLIER' | 'INTERNAL' = 'SUPPLIER') {
    const record = await f.db.supplierQualityProblem.create({ data: {
      ownerOrganizationId: f.f.org.id, supplierOrganizationId: f.vendor.org.id, profileId: f.profile.id,
      createdById: f.sqe.actor.id, title: `Legacy ${responseForm} ${replyMode}`, materialCode: 'OLD-PART',
      defectDescription: 'Retained legacy facts', defectQuantity: 1, severity: 'LOW', responseForm, replyMode,
      ...(replyMode === 'INTERNAL' ? { internalResponderId: f.outsider.actor.id } : {}),
    } });
    const index = await f.db.problemIndex.create({ data: { organizationId: f.f.org.id, reportNumber: randomUUID(),
      domainCode: 'supplier-quality', sourceType: 'supplier-quality', sourceId: record.id, problemType: responseForm, severity: 'LOW' } });
    await f.db.supplierQualityProblem.update({ where: { id: record.id }, data: { problemIndexId: index.id,
      releasedToSupplierAt: replyMode === 'SUPPLIER' ? new Date() : null } });
    return { record, index };
  }

  async function revoke(f: Fixture) {
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:read' } });
    await f.db.rolePermission.deleteMany({ where: { roleId: f.f.role.id, permissionId: permission.id } });
  }

  async function release(f: Fixture) {
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, {
      expectedRowVersion: f.issued.rowVersion, selectedFileIds: [],
    }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, {
      expectedRowVersion: preview.rowVersion, selectedFileIds: [], previewToken: preview.previewToken, confirmed: true,
    }).expect(200);
  }

  it('allows both read grants, then hides items, total and detail after real issues:read revocation in the same session', async () => {
    const f = await supplierEightDFixture(app);
    expect((await f.http(f.sqe.cookie, 'get', 'supplier-quality/problems?pageSize=1').expect(200)).body)
      .toMatchObject({ total: 1, items: [{ id: f.draft.id, controlledEightD: true }] });
    await f.http(f.sqe.cookie, 'get', `supplier-quality/problems/${f.draft.id}`).expect(200);
    await revoke(f);
    expect((await f.http(f.sqe.cookie, 'get', 'supplier-quality/problems?pageSize=1').expect(200)).body)
      .toMatchObject({ total: 0, items: [] });
    await f.http(f.sqe.cookie, 'get', `supplier-quality/problems/${f.draft.id}`).expect(404);
    await f.http(f.sqe.cookie, 'get', f.prefix).expect(403);
  }, 30_000);

  it('retains legacy BRIEF/EIGHT_D, INTERNAL replies and controlled-route draft maintenance without issues:read', async () => {
    const f = await supplierEightDFixture(app);
    const old = [];
    for (const form of ['BRIEF', 'EIGHT_D'] as const) {
      for (const mode of ['SUPPLIER', 'INTERNAL'] as const) old.push(await legacy(f, form, mode));
    }
    await revoke(f);
    const input = { profileId: f.profile.id, title: 'Prepared full 8D draft', materialCode: 'PREPARED',
      defectDescription: 'Draft facts', defectQuantity: 1, severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' };
    const draft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', input).expect(201)).body;
    expect(draft).toMatchObject({ controlledEightD: true, stage: 'DRAFT', canEditFacts: true });
    await f.http(f.sqe.cookie, 'put', `supplier-quality/drafts/${draft.id}`, { ...input, expectedVersion: draft.version, title: 'Edited draft' }).expect(200);
    await f.db.supplierQualityProblem.update({ where: { id: f.draft.id }, data: { updatedAt: new Date('2099-01-01') } });
    const expected = [...old.map(entry => entry.record.id), draft.id].sort();
    const seen: string[] = [];
    for (let page = 1; page <= expected.length + 1; page++) {
      const result = (await f.http(f.sqe.cookie, 'get', `supplier-quality/problems?pageSize=1&page=${page}`).expect(200)).body;
      expect(result.total).toBe(expected.length);
      expect(result.items).toHaveLength(page <= expected.length ? 1 : 0);
      seen.push(...result.items.map((row: { id: string }) => row.id));
    }
    expect(seen.sort()).toEqual(expected);
    for (const id of expected) await f.http(f.sqe.cookie, 'get', `supplier-quality/problems/${id}`).expect(200);
    const drafts = (await f.http(f.sqe.cookie, 'get', 'supplier-quality/problems?stage=DRAFT').expect(200)).body;
    expect(drafts).toMatchObject({ total: 1, items: [{ id: draft.id }] });
    expect((await f.http(f.sqe.cookie, 'get', 'supplier-quality/problems?stage=ISSUED&responseForm=BRIEF&severity=LOW').expect(200)).body.total).toBe(2);
  }, 30_000);

  it.each(['SUPPLIER', 'INTERNAL'] as const)('returns 404 for issued controlled %s detail without substituting legacy read permission', async mode => {
    const f = await supplierEightDFixture(app, 'LOW', false, mode);
    await revoke(f);
    await f.http(f.sqe.cookie, 'get', `supplier-quality/problems/${f.draft.id}`).expect(404);
  }, 30_000);

  it.each(['timestamp', 'status'] as const)('keeps actual released own-enterprise reads but hides controlled archive by %s, not legacy archives', async archive => {
    const f = await supplierEightDFixture(app);
    const path = 'supplier-portal/problems';
    expect((await f.http(f.vendor.cookie, 'get', path).expect(200)).body).toMatchObject({ total: 0, items: [] });
    await f.http(f.vendor.cookie, 'get', `${path}/${f.draft.id}`).expect(404);
    await release(f);
    expect((await f.http(f.vendor.cookie, 'get', `${path}?pageSize=1`).expect(200)).body)
      .toMatchObject({ total: 1, items: [{ id: f.draft.id }] });
    await f.http(f.vendor.cookie, 'get', `${path}/${f.draft.id}`).expect(200);
    expect((await f.http(f.otherVendor.cookie, 'get', path).expect(200)).body).toMatchObject({ total: 0, items: [] });
    await f.http(f.otherVendor.cookie, 'get', `${path}/${f.draft.id}`).expect(404);
    const old = await legacy(f);
    const data = archive === 'timestamp' ? { archivedAt: new Date() } : { status: 'ARCHIVED' };
    for (const id of [f.issued.problemId, old.index.id]) await f.db.problemIndex.update({ where: { id }, data });
    await f.db.supplierQualityProblem.update({ where: { id: f.draft.id }, data: { updatedAt: new Date('2099-01-01') } });
    expect((await f.http(f.vendor.cookie, 'get', `${path}?pageSize=1`).expect(200)).body)
      .toMatchObject({ total: 1, items: [{ id: old.record.id }] });
    expect((await f.http(f.vendor.cookie, 'get', `${path}?pageSize=1&page=2`).expect(200)).body)
      .toMatchObject({ total: 1, items: [] });
    await f.http(f.vendor.cookie, 'get', `${path}/${f.draft.id}`).expect(404);
    await f.http(f.vendor.cookie, 'get', `${path}/${old.record.id}`).expect(200);
    await f.http(f.sqe.cookie, 'get', `supplier-quality/problems/${f.draft.id}`).expect(200);
  }, 30_000);

  it('uses the genuine actor rather than target-scope grants to admit controlled cases', async () => {
    const f = await supplierEightDFixture(app);
    const old = await legacy(f);
    const org = await f.db.organization.create({ data: { code: randomUUID(), name: 'Other internal owner', type: 'INTERNAL' } });
    const user = await f.db.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused-test-session',
      userRoles: { create: { organizationId: f.f.org.id, roleId: f.f.role.id } } } });
    const cookie = `qms_session=${await app.get(SessionService).create(user.id, f.db, { mfaVerified: true })}`;
    const query = `organizationId=${f.f.org.id}`;
    const result = (await f.http(cookie, 'get', `supplier-quality/problems?${query}`).expect(200)).body;
    expect(result).toMatchObject({ total: 1, items: [{ id: old.record.id }] });
    await f.http(cookie, 'get', `supplier-quality/problems/${old.record.id}?${query}`).expect(200);
    await f.http(cookie, 'get', `supplier-quality/problems/${f.draft.id}?${query}`).expect(404);
  }, 30_000);

  it('retains literal case-insensitive percent/underscore searches and stable updatedAt/id ordering with pre-page filters', async () => {
    const f = await supplierEightDFixture(app);
    const a = await legacy(f), b = await legacy(f), decoy = await legacy(f);
    const updatedAt = new Date('2098-01-01');
    await f.db.supplierQualityProblem.update({ where: { id: a.record.id }, data: { title: 'MiXeD 100%_OK', updatedAt } });
    await f.db.supplierQualityProblem.update({ where: { id: b.record.id }, data: { materialCode: 'MiXeD 100%_OK', updatedAt } });
    await f.db.supplierQualityProblem.update({ where: { id: decoy.record.id }, data: { title: 'mixed 100xxOK', updatedAt } });
    await revoke(f);
    const query = `search=${encodeURIComponent('mixed 100%_')}&stage=ISSUED&responseForm=BRIEF&severity=LOW&pageSize=1`;
    const ids = [a.record.id, b.record.id].sort();
    for (const [index, id] of ids.entries()) {
      expect((await f.http(f.sqe.cookie, 'get', `supplier-quality/problems?${query}&page=${index + 1}`).expect(200)).body)
        .toMatchObject({ total: 2, items: [{ id }] });
    }
  }, 30_000);
});
