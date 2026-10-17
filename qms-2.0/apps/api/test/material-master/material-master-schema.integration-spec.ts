import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { MaterialMasterService } from '../../src/modules/material-master/material-master.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('An independent disposable PostgreSQL database is required');
jest.setTimeout(60_000);

it('has a dedicated two-field material master persistence table', async () => {
  const prisma = new PrismaService();
  try {
    const rows = await prisma.$queryRaw<{ found: string | null }[]>`SELECT to_regclass('material_masters')::text AS found`;
    expect(rows[0]?.found).toBe('material_masters');
  } finally { await prisma.$disconnect(); }
});

it('migration grants initial permissions only to internal roles with both governance permissions', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = `material_test_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query(`CREATE TABLE organizations (id uuid PRIMARY KEY, type text NOT NULL); CREATE TABLE users (id uuid PRIMARY KEY); CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid); CREATE TABLE permissions (id uuid PRIMARY KEY, code text UNIQUE, name text); CREATE TABLE role_permissions (role_id uuid, permission_id uuid, PRIMARY KEY(role_id, permission_id))`);
    const internal = randomUUID(); const supplier = randomUUID();
    await client.query('INSERT INTO organizations VALUES ($1, $3), ($2, $4)', [internal, supplier, 'INTERNAL', 'SUPPLIER']);
    const manage = randomUUID(); const assign = randomUUID();
    await client.query('INSERT INTO permissions VALUES ($1,$3,$3),($2,$4,$4)', [manage, assign, 'organization:manage', 'account:roles:assign']);
    const roleIds = Array.from({ length: 5 }, () => randomUUID());
    for (let index = 0; index < roleIds.length; index++) {
      await client.query('INSERT INTO roles VALUES ($1,$2)', [roleIds[index], index === 4 ? supplier : internal]);
      if ([0, 1, 4].includes(index)) await client.query('INSERT INTO role_permissions VALUES ($1,$2)', [roleIds[index], manage]);
      if ([0, 2, 4].includes(index)) await client.query('INSERT INTO role_permissions VALUES ($1,$2)', [roleIds[index], assign]);
    }
    await client.query(readFileSync(new URL('../../prisma/migrations/20261018030000_material_master/migration.sql', import.meta.url), 'utf8'));
    const result = await client.query('SELECT rp.role_id, p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.code LIKE $1 ORDER BY p.code', ['material-master:%']);
    expect(result.rows).toEqual(['material-master:import', 'material-master:read', 'material-master:write'].map((code) => ({ role_id: roleIds[0], code })));
  } finally { await client.query('ROLLBACK'); await client.end(); }
});

describe('material master HTTP and real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let roleId: string;
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const supplierOrganizationId = randomUUID();
  const userId = randomUUID();
  const csrf = randomUUID();
  const path = '/api/v1/material-masters';
  const codes = ['material-master:read', 'material-master:write', 'material-master:import'];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.organization.createMany({ data: [organizationId, otherOrganizationId].map((id) => ({ id, code: `MM-${id}`, name: 'Material test', type: 'INTERNAL' as const })) });
    await prisma.organization.create({ data: { id: supplierOrganizationId, code: `MM-${supplierOrganizationId}`, name: 'Supplier scope test', type: 'SUPPLIER' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `mm-${userId}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const role = await prisma.role.create({ data: { organizationId, code: 'MATERIAL_TEST', name: 'Material test' } }); roleId = role.id;
    for (const code of codes) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
    const token = await app.get(SessionService).create(userId, prisma, { reauthenticated: true });
    cookie = `qms_session=${token}; qms_csrf=${csrf}`;
  });
  afterAll(async () => {
    if (prisma) {
      const tables = await prisma.$queryRaw<{ found: string | null }[]>`SELECT to_regclass('material_masters')::text AS found`;
      if (tables[0]?.found) await prisma.$executeRaw`DELETE FROM material_masters WHERE organization_id IN (${organizationId}::uuid, ${otherOrganizationId}::uuid, ${supplierOrganizationId}::uuid)`;
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId, supplierOrganizationId] } } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId, supplierOrganizationId] } } });
    }
    await app?.close();
  });
  const send = (body: object, key = randomUUID()) => request(app.getHttpServer()).post(`${path}/import`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const create = (body: object) => request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
  const list = () => request(app.getHttpServer()).get(path).set('Cookie', cookie);
  const row = (materialCode: string) => ({ rowNumber: 2, materialCode, materialName: '物料' });
  const rename = (id: string, body: object) => request(app.getHttpServer()).patch(`${path}/${id}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);

  it('creates trimmed string codes preserving case and zeroes; renames with CAS and never accepts extra business fields', async () => {
    const first = await create({ materialCode: ' 00042 ', materialName: ' 原物料 ' }).expect(201);
    expect(first.body).toMatchObject({ materialCode: '00042', materialName: '原物料', version: 1 });
    await create({ materialCode: '00042', materialName: '覆盖' }).expect(409);
    await create({ materialCode: 'abc', materialName: '小写' }).expect(201);
    await create({ materialCode: 'ABC', materialName: '大写' }).expect(201);
    await create({ materialCode: 42, materialName: '数字' }).expect(400);
    await create({ materialCode: 'EXTRA', materialName: '名称', unit: 'kg' }).expect(400);
    await create({ materialCode: 'EMPTY', materialName: ' ' }).expect(400);
    expect((await rename(first.body.id, { materialName: '新名称', expectedVersion: 1 }).expect(200)).body).toMatchObject({ materialCode: '00042', materialName: '新名称', version: 2 });
    await rename(first.body.id, { materialName: '旧提交', expectedVersion: 1 }).expect(409);
    await rename(first.body.id, { materialCode: 'CHANGED', materialName: '覆盖编码', expectedVersion: 2 }).expect(400);
    expect((await list().expect(200)).body).toEqual(expect.arrayContaining([expect.objectContaining({ materialCode: '00042', materialName: '新名称', version: 2 })]));
  });

  it('imports sorted rows independently, skips duplicates without overwrite and replays the complete batch', async () => {
    const rows = [row('BATCH'), { rowNumber: 4, materialCode: 'LATER', materialName: '' }, { rowNumber: 3, materialCode: ' BATCH ', materialName: '不覆盖' }, { rowNumber: 5, materialCode: 'LATER', materialName: '有效' }, { rowNumber: 6, materialCode: 42, materialName: '数字' }];
    const key = randomUUID();
    const result = await send({ rows }, key).expect(201);
    expect(result.body).toMatchObject({ created: 2, skipped: 1, failed: 2, items: [{ rowNumber: 2, code: 'BATCH', status: 'CREATED' }, { rowNumber: 3, status: 'SKIPPED_DUPLICATE' }, { rowNumber: 4, status: 'FAILED' }, { rowNumber: 5, status: 'CREATED' }, { rowNumber: 6, status: 'FAILED' }] });
    expect((await send({ rows }, key).expect(201)).body).toEqual(result.body);
    await send({ rows: [row('DIFFERENT')] }, key).expect(409);
    expect((await list().expect(200)).body.find((item: { materialCode: string }) => item.materialCode === 'BATCH')).toMatchObject({ materialName: '物料', version: 1 });
    expect(await prisma.auditEvent.count({ where: { organizationId, action: 'MATERIAL_MASTER_CREATED' } })).toBe(5);
  });

  it('rejects structural errors, missing key and CSRF, overlimit and cross-organization before committing', async () => {
    for (const body of [{ rows: [] }, { rows: [row('STRUCTURE'), { ...row('OTHER'), rowNumber: 3, unit: 'kg' }] }, { rows: [row('STRUCTURE'), row('DUP-ROW')] }]) await send(body).expect(400);
    await send({ rows: Array.from({ length: 101 }, (_, index) => ({ ...row(`SIZE-${index}`), rowNumber: index + 2 })) }).expect(413);
    await send({ organizationId: otherOrganizationId, rows: [row('CROSS')] }).expect(403);
    await request(app.getHttpServer()).get(`${path}?organizationId=${otherOrganizationId}`).set('Cookie', cookie).expect(403);
    await request(app.getHttpServer()).post(`${path}/import`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ rows: [row('NO-KEY')] }).expect(400);
    await request(app.getHttpServer()).post(`${path}/import`).set('Cookie', cookie).set('Idempotency-Key', randomUUID()).send({ rows: [row('NO-CSRF')] }).expect(403);
    expect((await list().expect(200)).body.some((item: { materialCode: string }) => /^(SIZE-|STRUCTURE|OTHER|CROSS|NO-)/.test(item.materialCode))).toBe(false);
  });

  it('uses an independent import permission including on replay', async () => {
    const key = randomUUID(); const body = { rows: [row('REVOKED')] };
    await send(body, key).expect(201);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'material-master:import' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    try {
      await create({ materialCode: 'WRITE-ONLY', materialName: '可手工新增' }).expect(201);
      await send({ rows: [row('NO-IMPORT')] }).expect(403); await send(body, key).expect(403);
    } finally { await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); }
  });

  it('isolates organizations, admits exactly 100 rows and handles concurrent duplicate inserts', async () => {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'material-master:write' } });
    const otherRole = await prisma.role.create({ data: { organizationId: otherOrganizationId, code: 'OTHER', name: 'Other' } });
    await prisma.rolePermission.create({ data: { roleId: otherRole.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId, organizationId: otherOrganizationId, roleId: otherRole.id } });
    const other = await create({ organizationId: otherOrganizationId, materialCode: '00042', materialName: '其他组织' }).expect(201);
    await rename(other.body.id, { expectedVersion: 1, materialName: '越权' }).expect(404);
    expect((await list().expect(200)).body.some((item: { id: string }) => item.id === other.body.id)).toBe(false);
    const bulk = Array.from({ length: 100 }, (_, index) => ({ ...row(`BULK-${index}`), rowNumber: index + 2 }));
    expect((await send({ rows: bulk }).expect(201)).body).toMatchObject({ created: 100, failed: 0, skipped: 0 });
    const result = await Promise.all([send({ rows: [row('RACE')] }), send({ rows: [row(' RACE ')] })]);
    expect(result.map((response) => response.status)).toEqual([201, 201]);
    expect(result.flatMap((response) => response.body.items.map((item: { status: string }) => item.status)).sort()).toEqual(['CREATED', 'SKIPPED_DUPLICATE']);
  });

  it('allows import without manual-write permission and rolls back when the real audit insert fails', async () => {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'material-master:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    try {
      await create({ materialCode: 'NO-WRITE', materialName: '不可手工新增' }).expect(403);
      expect((await send({ rows: [row('IMPORT-ONLY')] }).expect(201)).body.created).toBe(1);
      const session = await prisma.session.findFirstOrThrow({ where: { userId } });
      const actor = { id: userId, organizationId, sessionId: session.id, accountType: 'INTERNAL' as const };
      const result = await app.get(MaterialMasterService).importMaterials(actor, [row('AUDIT-FAIL')], 'x'.repeat(101), randomUUID());
      expect(result).toMatchObject({ created: 0, skipped: 0, failed: 1 });
      expect((await list().expect(200)).body.some((item: { materialCode: string }) => item.materialCode === 'AUDIT-FAIL')).toBe(false);
      await expect(app.get(MaterialMasterService).listMaterials({ ...actor, accountType: 'SUPPLIER' })).rejects.toMatchObject({ status: 403 });
    } finally { await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); }
  });

  it('rejects a supplier target organization even when the internal actor has explicit material grants there', async () => {
    const role = await prisma.role.create({ data: { organizationId: supplierOrganizationId, code: 'SUPPLIER_SCOPE', name: 'Supplier scope' } });
    for (const code of codes) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId: supplierOrganizationId, roleId: role.id } });
    await create({ organizationId: supplierOrganizationId, materialCode: 'SUPPLIER-SCOPE', materialName: '错误组织' }).expect(403);
    await send({ organizationId: supplierOrganizationId, rows: [row('SUPPLIER-SCOPE')] }).expect(403);
    await request(app.getHttpServer()).get(`${path}?organizationId=${supplierOrganizationId}`).set('Cookie', cookie).expect(403);
  });
});
