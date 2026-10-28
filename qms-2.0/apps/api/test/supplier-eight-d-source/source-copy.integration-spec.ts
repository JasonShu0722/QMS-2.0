import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { SupplierEightDSourceModule } from '../../src/modules/supplier-eight-d-source/supplier-eight-d-source.module.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Exclusive disposable source-copy PostgreSQL required, never 55440');

describe('controlled supplier COPY FACTS HTTP transactions', () => {
  let app: INestApplication; let db: PrismaService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule, SupplierEightDSourceModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); db = app.get(PrismaService);
    await db.$queryRaw`SELECT 1 FROM process_defect_material_items LIMIT 1`;
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  const copyPermission = 'supplier-quality:issues:copy';
  async function person(organizationId: string, codes: string[], accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } }); expect(permissions).toHaveLength(codes.length);
    const role = await db.role.create({ data: { organizationId, code: randomUUID(), name: 'Real permissions not role names', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    const user = await db.user.create({ data: { organizationId, accountType, username: randomUUID(), passwordHash: 'fixture-only', userRoles: { create: { organizationId, roleId: role.id } } } });
    const token = await app.get(SessionService).create(user.id, db, { mfaVerified: true, reauthenticated: true });
    return { user, role, cookie: `qms_session=${token}` };
  }
  async function fixture(quantity: number | null = null) {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Actual copier scope', type: 'INTERNAL' } });
    const copier = await person(org.id, [copyPermission, 'process-quality:defects:read', 'customer-quality:complaints:read', 'new-product-quality:projects:read', 'supplier-quality:problems:write']);
    const vendor = await db.organization.create({ data: { code: randomUUID(), name: 'Actual target enterprise', type: 'SUPPLIER' } });
    const otherVendor = await db.organization.create({ data: { code: randomUUID(), name: 'Other target enterprise', type: 'SUPPLIER' } });
    const profile = await db.supplierBusinessProfile.create({ data: { ownerOrganizationId: org.id, supplierOrganizationId: vendor.id, businessCode: randomUUID(), displayName: 'Target business profile' } });
    const otherProfile = await db.supplierBusinessProfile.create({ data: { ownerOrganizationId: org.id, supplierOrganizationId: otherVendor.id, businessCode: randomUUID(), displayName: 'Other business profile' } });
    const defect = await db.processDefect.create({ data: { organizationId: org.id, description: 'Owned observed crack', defectQuantity: quantity, productCode: 'FINISHED-NEVER-BAD-MATERIAL', responsibilityCategory: 'EQUIPMENT',
      createdById: copier.user.id, updatedById: copier.user.id } });
    const source = { kind: 'PROCESS_LEDGER', sourceId: defect.id, sourceVersion: defect.version };
    return { org, copier, vendor, otherVendor, profile, otherProfile, defect, source,
      preview: { supplierProfileId: profile.id, sources: [source] },
      draft: { profileId: profile.id, title: 'User edited supplier draft', materialCode: 'USER-CHOSEN-PART', defectDescription: 'User reviewed external text', defectQuantity: 7,
        severity: 'HIGH', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' } };
  }
  const post = (cookie: string, path: string, body: object, key = randomUUID()) => {
    const csrf = randomUUID();
    return request(app.getHttpServer()).post(`/api/v1/supplier-quality/source-copies/${path}`).set('Cookie', [cookie, `qms_csrf=${csrf}`])
      .set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  };
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const preview = async (f: Fixture, input: object = f.preview) => (await post(f.copier.cookie, 'preview', input).expect(201)).body;
  async function material(f: Fixture, profileId: string | null = f.profile.id, enterpriseId: string | null = f.vendor.id) {
    const id = randomUUID();
    await db.$executeRaw`INSERT INTO process_defect_material_items(id, organization_id, defect_id, position, material_code, material_name,
      supplier_profile_id, supplier_organization_id, notes, created_by_id, updated_by_id)
      VALUES (${id}::uuid, ${f.org.id}::uuid, ${f.defect.id}::uuid, 0, 'ACTUAL-BAD-PART', 'Cracked part', ${profileId}::uuid, ${enterpriseId}::uuid,
        'PRIVATE INTERNAL ANALYSIS', ${f.copier.user.id}::uuid, ${f.copier.user.id}::uuid)`;
    return id;
  }

  it('previews owned facts without default risk, finished material, inferred responsibility or fabricated quantity', async () => {
    const f = await fixture(); const before = await db.processDefect.findUniqueOrThrow({ where: { id: f.defect.id } });
    const result = await preview(f);
    expect(result).toEqual({ token: expect.any(String), expiresAt: expect.any(String), facts: [{ factKey: `PROCESS_LEDGER:${f.defect.id}`,
      defectDescription: 'Owned observed crack', defectQuantity: null, materials: [] }] });
    expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id } })).toBe(0);
    expect(await db.processDefect.findUniqueOrThrow({ where: { id: f.defect.id } })).toEqual(before);
  });

  it('atomically creates only an editable DRAFT with explicit overrides, provenance, audit and an idempotent receipt', async () => {
    const f = await fixture(); const p = await preview(f); const key = randomUUID();
    const body = { token: p.token, draft: f.draft };
    const created = (await post(f.copier.cookie, 'drafts', body, key).expect(201)).body;
    expect(created).toEqual({ id: expect.any(String), version: 1, stage: 'DRAFT' });
    expect((await post(f.copier.cookie, 'drafts', body, key).expect(201)).body).toEqual(created);
    const record = await db.supplierQualityProblem.findUniqueOrThrow({ where: { id: created.id } });
    expect(record).toMatchObject({ ...f.draft, severity: 'HIGH', defectQuantity: 7, problemIndexId: null, releasedToSupplierAt: null, workflowBindingId: null });
    expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id } })).toBe(1);
    const [provenance] = await db.$queryRaw<Array<{ sources: unknown; supplier_problem_id: string }>>`SELECT * FROM supplier_copy_provenance WHERE preview_id = ${p.token}::uuid`;
    expect(provenance).toMatchObject({ sources: [f.source], supplier_problem_id: created.id });
    expect(await db.auditEvent.count({ where: { resourceId: created.id, action: 'SUPPLIER_SOURCE_COPY_DRAFT_CREATED' } })).toBe(1);
    expect(await db.problemIndex.count({ where: { sourceId: created.id } })).toBe(0);
    await post(f.copier.cookie, 'drafts', { ...body, draft: { ...f.draft, defectQuantity: 9 } }, key).expect(409);
    await post(f.copier.cookie, 'drafts', body).expect(409);
  });

  it('matches real business profile or enterprise identities, filters other supplier material and leaves unknown manual', async () => {
    const f = await fixture(); const selected = await material(f); const other = await material(f, f.otherProfile.id, f.otherVendor.id);
    const unknown = await material(f, null, null);
    const enterpriseOnly = await material(f, null, f.vendor.id);
    const p = await preview(f);
    expect(p.facts[0].materials).toEqual(expect.arrayContaining([
      { id: selected, materialCode: 'ACTUAL-BAD-PART', materialName: 'Cracked part', materialBatch: null },
      { id: enterpriseOnly, materialCode: 'ACTUAL-BAD-PART', materialName: 'Cracked part', materialBatch: null },
      { id: unknown, materialCode: null, materialName: null, materialBatch: null },
    ]));
    expect(p.facts[0].materials).toHaveLength(3);
    expect(JSON.stringify(p)).not.toContain('PRIVATE INTERNAL'); expect(JSON.stringify(p)).not.toContain(f.otherVendor.id);
    await post(f.copier.cookie, 'preview', { ...f.preview, sources: [{ ...f.source, materialItemId: other }] }).expect(409);
    const chosen = await preview(f, { ...f.preview, sources: [{ ...f.source, materialItemId: selected }] });
    expect(chosen.facts[0].materials).toHaveLength(1);
  });

  it('rejects stale source version, archived source, changed target and target override without leaving a draft', async () => {
    const f = await fixture(); const p = await preview(f);
    await post(f.copier.cookie, 'preview', { ...f.preview, sources: [{ ...f.source, sourceVersion: f.defect.version + 1 }] }).expect(409);
    await post(f.copier.cookie, 'drafts', { token: p.token, draft: { ...f.draft, profileId: f.otherProfile.id } }).expect(409);
    await db.processDefect.update({ where: { id: f.defect.id }, data: { version: { increment: 1 } } });
    await post(f.copier.cookie, 'drafts', { token: p.token, draft: f.draft }).expect(409);
    const current = await preview(f, { ...f.preview, sources: [{ ...f.source, sourceVersion: f.defect.version + 1 }] });
    await db.supplierBusinessProfile.update({ where: { id: f.profile.id }, data: { supplierOrganizationId: null, version: { increment: 1 } } });
    await post(f.copier.cookie, 'drafts', { token: current.token, draft: f.draft }).expect(409);
    await db.processDefect.update({ where: { id: f.defect.id }, data: { archivedAt: new Date() } });
    await post(f.copier.cookie, 'preview', { ...f.preview, sources: [{ ...f.source, sourceVersion: f.defect.version + 1 }] }).expect(409);
    expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id } })).toBe(0);
  });

  it('requires all existing draft facts; rejects raw file IDs and never fills missing quantity or severity', async () => {
    const f = await fixture(); const p = await preview(f);
    for (const field of ['defectQuantity', 'severity', 'materialCode', 'title', 'defectDescription']) {
      const draft = { ...f.draft } as Record<string, unknown>; delete draft[field];
      await post(f.copier.cookie, 'drafts', { token: p.token, draft }).expect(400);
    }
    await post(f.copier.cookie, 'drafts', { token: p.token }).expect(400);
    await post(f.copier.cookie, 'drafts', { token: p.token, draft: { ...f.draft, defectQuantity: null } }).expect(400);
    await post(f.copier.cookie, 'drafts', { token: p.token, draft: { ...f.draft, fileIds: [randomUUID()] } }).expect(400);
    await post(f.copier.cookie, 'preview', { ...f.preview, fileIds: [randomUUID()] }).expect(400);
    expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id } })).toBe(0);
  });

  it('rolls back the inserted draft/audit/provenance/receipt if target rebinding wins the profile lock race', async () => {
    const f = await fixture(); const p = await preview(f); const key = randomUUID();
    let copying!: Promise<request.Response>;
    await db.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM supplier_business_profiles WHERE id = ${f.profile.id}::uuid FOR UPDATE`;
      copying = post(f.copier.cookie, 'drafts', { token: p.token, draft: f.draft }, key).then(response => response);
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [state] = await db.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (state.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await tx.supplierBusinessProfile.update({ where: { id: f.profile.id }, data: { supplierOrganizationId: null, version: { increment: 1 } } });
    }, { timeout: 10000 });
    expect((await copying).status).toBe(409);
    expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { organizationId: f.org.id, action: { in: ['SUPPLIER_PROBLEM_DRAFT_CREATED', 'SUPPLIER_SOURCE_COPY_DRAFT_CREATED'] } } })).toBe(0);
    expect(await db.adminMutation.count({ where: { organizationId: f.org.id, key } })).toBe(0);
    expect(await db.$queryRaw`SELECT id FROM supplier_copy_provenance WHERE preview_id = ${p.token}::uuid`).toEqual([]);
  }, 20000);

  it('deduplicates exact source aliases but never sums distinct duplicate barcode facts or project wrappers', async () => {
    const f = await fixture(4);
    const duplicate = await db.processDefect.create({ data: { organizationId: f.org.id, description: 'Same barcode different record', traceCode: 'DUPLICATE', defectQuantity: 4, createdById: f.copier.user.id, updatedById: f.copier.user.id } });
    const p = await preview(f, { ...f.preview, sources: [f.source, f.source, { ...f.source, sourceId: duplicate.id }] });
    expect(p.facts).toHaveLength(2);
    expect(p.facts.map((fact: { defectQuantity: number }) => fact.defectQuantity)).toEqual([4, 4]);
    expect(p.totalQuantity).toBeUndefined();
    await post(f.copier.cookie, 'preview', { ...f.preview, sources: Array.from({ length: 101 }, () => f.source) }).expect(400);
    await post(f.copier.cookie, 'preview', { ...f.preview, sources: [] }).expect(400);
  });

  it('binds tokens to the actual actor session and expiration, not just a matching user ID', async () => {
    const f = await fixture(); const p = await preview(f);
    const newToken = await app.get(SessionService).create(f.copier.user.id, db, { mfaVerified: true, reauthenticated: true });
    await post(`qms_session=${newToken}`, 'drafts', { token: p.token, draft: f.draft }).expect(404);
    const expiredToken = randomUUID();
    // Preview history is immutable; seed a separate already-expired receipt rather than rewriting issued evidence.
    await db.$executeRaw`INSERT INTO supplier_copy_previews(id, organization_id, actor_user_id, actor_session_id, supplier_profile_id,
      sources, projection_digest, profile_digest, created_at, expires_at)
      SELECT ${expiredToken}::uuid, organization_id, actor_user_id, actor_session_id, supplier_profile_id, sources, projection_digest, profile_digest,
        CURRENT_TIMESTAMP - interval '2 minutes', CURRENT_TIMESTAMP - interval '1 minute' FROM supplier_copy_previews WHERE id = ${p.token}::uuid`;
    await post(f.copier.cookie, 'drafts', { token: expiredToken, draft: f.draft }).expect(409);
  });

  it('rechecks source ACL on preview, commit and replay and refuses supplier/cross-org/session token theft', async () => {
    const f = await fixture(); const p = await preview(f); const body = { token: p.token, draft: f.draft }; const key = randomUUID();
    await post(f.copier.cookie, 'drafts', body, key).expect(201);
    const peer = await person(f.org.id, [copyPermission, 'process-quality:defects:read', 'supplier-quality:problems:write']);
    await post(peer.cookie, 'drafts', body).expect(404);
    const outsider = await fixture();
    await post(outsider.copier.cookie, 'preview', { ...outsider.preview, sources: [f.source] }).expect(404);
    await post(outsider.copier.cookie, 'drafts', body).expect(404);
    await post(f.copier.cookie, 'preview', { ...f.preview, organizationId: outsider.org.id }).expect(403);
    const supplier = await person(f.vendor.id, [copyPermission, 'process-quality:defects:read', 'supplier-quality:problems:write'], 'SUPPLIER');
    await post(supplier.cookie, 'preview', f.preview).expect(403);
    await post(supplier.cookie, 'drafts', body).expect(403);
    const permission = await db.permission.findUniqueOrThrow({ where: { code: 'process-quality:defects:read' } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.copier.role.id, permissionId: permission.id } } });
    await post(f.copier.cookie, 'drafts', body, key).expect(403);
    await post(f.copier.cookie, 'preview', f.preview).expect(403);
  });
});
