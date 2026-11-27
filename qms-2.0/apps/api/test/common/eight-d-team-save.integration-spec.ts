import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { INTERNAL_EIGHT_D_DOMAINS, internalEightDSql } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { emptyProcessEightDDocument, normalizeProcessEightDDocument, type ProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDFixture } from '../supplier-quality/supplier-eight-d.fixture.js';
import { domainFixture, type DomainName } from './internal-eight-d-domains.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('D1 team saves require disposable loopback PostgreSQL, never preview 55440.');
}

const legacyRow = { id: 'legacy', name: '历史手录', department: '旧部门', responsibility: '历史分工', collaborationScope: '' };
const legacyIdentity = { ...legacyRow, id: 'legacy-system', userId: randomUUID(), name: '旧系统人员' };
const legacyDocument = normalizeProcessEightDDocument({ ...emptyProcessEightDDocument(), team: [legacyRow, legacyIdentity] });

describe('8D D1 team save with real PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function internal(domain: DomainName) {
    const f = await domainFixture(app, domain);
    const id = await f.issue([f.chainSource]);
    const tables = internalEightDSql(domain === 'customer-quality' ? INTERNAL_EIGHT_D_DOMAINS.CUSTOMER : INTERNAL_EIGHT_D_DOMAINS.NEW_PRODUCT);
    await f.prisma.$executeRaw`UPDATE ${tables.reports} SET document = ${JSON.stringify(legacyDocument)}::jsonb WHERE problem_id = ${id}::uuid`;
    const save = async (document: ProcessEightDDocument, invalidPath?: string): Promise<ProcessEightDDocument> => {
      const current = await f.read(id);
      const result = f.service.save(f.owner.actor, id, { expectedVersion: current.version, document }, randomUUID(), randomUUID());
      if (invalidPath) {
        await expect(result).rejects.toMatchObject({ response: { code: 'PROCESS_EIGHT_D_DOCUMENT_INVALID' }, fields: { [invalidPath]: expect.any(Array) } });
        expect((await f.read(id)).version).toBe(current.version);
      } else await result;
      return (await f.read(id)).document;
    };
    return { db: f.prisma, organizationId: f.org.id, accountType: 'INTERNAL' as const, foreignId: f.supplier.id, save };
  }

  async function supplier(mode: 'SUPPLIER' | 'INTERNAL') {
    const f = await supplierEightDFixture(app, 'LOW', false, mode);
    if (mode === 'SUPPLIER') {
      const current = await f.read();
      const { body: preview } = await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: current.rowVersion, selectedFileIds: [] }).expect(200);
      await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
    }
    await f.db.supplierResponseDraft.update({ where: { problemId: f.draft.id }, data: { content: JSON.parse(JSON.stringify(legacyDocument)) } });
    const [person, path] = mode === 'SUPPLIER' ? [f.vendor, f.portal] : [f.outsider, f.prefix];
    const save = async (document: ProcessEightDDocument, invalidPath?: string): Promise<ProcessEightDDocument> => {
      const current = await f.read();
      const result = f.http(person.cookie, 'put', path, { ...f.version(current), document });
      if (invalidPath) {
        await result.expect(400).expect(({ body }) => expect(body).toMatchObject({ code: 'SUPPLIER_EIGHT_D_DOCUMENT_INVALID', fields: { [invalidPath]: expect.any(Array) } }));
        expect((await f.read()).rowVersion).toBe(current.rowVersion);
      } else await result.expect(200);
      return (await f.read()).document;
    };
    return { db: f.db, organizationId: person.actor.organizationId, accountType: mode, foreignId: f.otherVendor.user.id, save };
  }

  it.each([
    ['customer', () => internal('customer-quality')],
    ['new product', () => internal('new-product-quality')],
    ['supplier portal', () => supplier('SUPPLIER')],
    ['internal supplier response', () => supplier('INTERNAL')],
  ] as const)('%s revalidates additions and replacements while retaining saved snapshots', async (_name, setup) => {
    const { db, organizationId, accountType, foreignId, save } = await setup();
    const person = (fullName: string) => db.user.create({ data: { organizationId, accountType, username: randomUUID(), fullName, passwordHash: 'fixture' } });
    const department = await db.department.create({ data: { organizationId, code: randomUUID(), name: '实际部门' } });
    const position = await db.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: '实际职务' } });
    const appointed = await person('人员甲'), replacement = await person('人员乙');
    const assign = (userId: string) => db.userPosition.create({ data: { organizationId, userId, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    const appointment = await assign(appointed.id);
    const stale = await assign(replacement.id);
    await db.userPosition.update({ where: { id: stale.id }, data: { endedAt: new Date() } });

    const row = { id: 'system', userId: appointed.id, assignmentId: appointment.id, name: '客户端姓名', department: '客户端部门', jobTitle: '客户端职务',
      responsibility: '排查', collaborationScope: '产线', isLeader: true };
    const document = (team: NonNullable<ProcessEightDDocument['team']>) => ({ ...legacyDocument, team: [...team, legacyIdentity] });
    const saved = await save(document([legacyRow, row]));
    const snapshot = { ...row, name: '人员甲', department: department.name, jobTitle: position.name };
    expect(saved.team).toEqual([legacyRow, snapshot, legacyIdentity]);
    await save(document([legacyRow, { ...row, userId: foreignId }]), 'team[1].userId');
    await save(document([legacyRow, { ...row, userId: undefined }]), 'team[1].userId');
    const missingAssignment = { ...row, assignmentId: undefined };
    await save(document([legacyRow, missingAssignment]), 'team[1].assignmentId');

    const secondPosition = await db.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: '第二任职' } });
    const second = await db.userPosition.create({ data: { organizationId, userId: appointed.id, positionId: secondPosition.id } });
    const mismatched = { ...row, assignmentId: stale.id, department: department.name, jobTitle: position.name };
    await save(document([legacyRow, mismatched]), 'team[1].assignmentId');
    const changedAssignment = { ...row, assignmentId: second.id };
    const changed = await save(document([legacyRow, changedAssignment]));
    const changedSnapshot = { ...snapshot, assignmentId: second.id, jobTitle: secondPosition.name };
    expect(changed.team).toEqual([legacyRow, changedSnapshot, legacyIdentity]);

    await db.userPosition.update({ where: { id: appointment.id }, data: { endedAt: new Date() } });
    await save(document([legacyRow, row]), 'team[1].assignmentId');

    await db.user.update({ where: { id: appointed.id }, data: { fullName: '已改名' } });
    await db.userPosition.update({ where: { id: second.id }, data: { endedAt: new Date() } });
    await save(document([legacyRow, { ...row, userId: replacement.id }]), 'team[1].userId');
    await save(document([legacyRow, { ...row, userId: undefined }]), 'team[1].userId');
    const editedLegacy = { ...legacyRow, responsibility: '补充历史分工' };
    const savedAgain = await save(document([{ ...changedAssignment, responsibility: '复测' }, { ...editedLegacy, name: '客户端改写历史姓名' }]));
    expect(savedAgain.team).toEqual([{ ...changedSnapshot, responsibility: '复测' }, editedLegacy, legacyIdentity]);

    if (accountType === 'SUPPLIER') {
      const unassigned = await person('无任职供应商人员');
      const selected = { ...row, userId: unassigned.id, assignmentId: null };
      const result = await save(document([editedLegacy, selected]));
      expect(result.team?.[1]).toMatchObject({ userId: unassigned.id, assignmentId: null, name: unassigned.fullName, department: '', jobTitle: '' });
    }
    const activeReplacement = await assign(replacement.id);
    const replacementSelection = { ...row, userId: replacement.id, assignmentId: activeReplacement.id };
    const replaced = await save(document([editedLegacy, replacementSelection]));
    expect(replaced.team?.[1]).toEqual({ ...snapshot, userId: replacement.id, assignmentId: activeReplacement.id, name: '人员乙' });
  }, 30_000);
});
