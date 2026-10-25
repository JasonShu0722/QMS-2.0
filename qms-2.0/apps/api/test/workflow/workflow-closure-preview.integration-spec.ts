import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { createOpenApiDocument } from '../../src/openapi.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Closure preview requires disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('workflow closure configuration preview with real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let responsibilities: OrganizationResponsibilityService;
  const csrf = randomUUID();
  const path = '/api/v1/workflows/closure-preview';

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    responsibilities = app.get(OrganizationResponsibilityService);
  });
  afterAll(async () => { await app?.close(); });

  it('publishes a boolean true preview marker rather than a number enum or an execution capability', () => {
    const document = createOpenApiDocument(app);
    expect(document.components?.schemas?.WorkflowClosurePreviewDto).toMatchObject({ properties: { previewOnly: { type: 'boolean', example: true, readOnly: true } } });
    expect(document.paths[path]?.post?.responses).toHaveProperty('200');
  });

  async function fixture() {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Closure preview fixture', type: 'INTERNAL' } });
    const dept = await prisma.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Department' } });
    const section = await prisma.department.create({ data: { organizationId: org.id, parentId: dept.id, code: randomUUID(), name: 'Section' } });
    const position = (departmentId: string, name: string) => prisma.position.create({ data: { organizationId: org.id, departmentId, code: randomUUID(), name } });
    const managerPosition = await position(section.id, 'Arbitrary manager label');
    const ministerPosition = await position(dept.id, 'Arbitrary minister label');
    const qualityPosition = await position(dept.id, 'Arbitrary quality label');
    const act = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:act' } });
    const actRole = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Act fixture', permissions: { create: { permissionId: act.id } } } });
    const person = async (positionId: string, allowed = true) => {
      const user = await prisma.user.create({ data: { organizationId: org.id, accountType: 'INTERNAL', username: randomUUID(), passwordHash: 'unused' } });
      const assignment = await prisma.userPosition.create({ data: { organizationId: org.id, userId: user.id, positionId, startedAt: new Date(Date.now() - 60_000) } });
      if (allowed) await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: actRole.id } });
      return { user, assignment };
    };
    const manager = await person(managerPosition.id);
    const minister = await person(ministerPosition.id);
    const professional = await person(qualityPosition.id);
    const owner = await person(managerPosition.id, false);
    // The owner uses another position so the configured manager has exactly one eligible appointment.
    const ownerPosition = await position(section.id, 'Owner fixture');
    await prisma.userPosition.update({ where: { id: owner.assignment.id }, data: { positionId: ownerPosition.id } });
    const actor = await prisma.user.create({ data: { organizationId: org.id, accountType: 'INTERNAL', username: randomUUID(), passwordHash: 'unused' } });
    const codes = await prisma.permission.findMany({ where: { code: { in: ['workflow:manage', 'organization:structure:manage'] } } });
    const governor = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Preview governor', permissions: { create: codes.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: actor.id, roleId: governor.id } });
    const token = await app.get(SessionService).create(actor.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await app.get(SessionService).resolve(token))!;
    const managementActor = { id: actor.id, organizationId: org.id, accountType: 'INTERNAL' as const, sessionId: session.id };
    const binding = (responsibility: 'SECTION_MANAGER' | 'MINISTER') => responsibilities.createManagementBinding(managementActor, org.id, {
      responsibility, departmentId: responsibility === 'SECTION_MANAGER' ? section.id : dept.id,
      positionId: responsibility === 'SECTION_MANAGER' ? managerPosition.id : ministerPosition.id,
    }, randomUUID(), randomUUID());
    const scope = () => responsibilities.createMinisterScope(managementActor, org.id, {
      departmentId: dept.id, sectionDepartmentId: section.id, ministerAssignmentId: minister.assignment.id,
    }, randomUUID(), randomUUID());
    const body = { policy: 'INTERNAL', severity: 'LOW', responsibleSectionDepartmentId: section.id, ownerUserId: owner.user.id, professionalUserId: professional.user.id };
    const cookie = `qms_session=${token}; qms_csrf=${csrf}`;
    const post = (payload: object = body, authenticated = true) => request(app.getHttpServer()).post(path)
      .set('Cookie', authenticated ? cookie : `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send(payload);
    return { org, dept, section, managerPosition, ministerPosition, qualityPosition, person, manager, minister, professional, owner, actor, governor, session, binding, scope, body, post, cookie };
  }

  it('resolves low-risk parallel duties from actual appointments without creating a round, task or approval', async () => {
    const f = await fixture(); const binding = await f.binding('SECTION_MANAGER');
    const counts = async () => Promise.all([prisma.workflowInstance.count(), prisma.workflowTask.count(), prisma.auditEvent.count({ where: { organizationId: f.org.id } })]);
    const before = await counts();
    const result = (await f.post().expect(200)).body;
    expect(result).toMatchObject({ previewOnly: true, configurationReady: true, organizationId: f.org.id, sectionDepartmentId: f.section.id, executionMode: 'PARALLEL', issues: [] });
    expect(result.duties).toEqual([
      expect.objectContaining({ duty: 'PROFESSIONAL', status: 'PENDING', participant: expect.objectContaining({ userId: f.professional.user.id, assignmentId: null }) }),
      expect.objectContaining({ duty: 'SECTION_MANAGER', status: 'PENDING', participant: expect.objectContaining({ userId: f.manager.user.id, assignmentId: f.manager.assignment.id, bindingId: binding.id }) }),
    ]);
    expect(await counts()).toEqual(before);
  });

  it('provides bounded named configuration choices with workflow manage alone and never exposes email or foreign identities', async () => {
    const f = await fixture(); const other = await fixture();
    await prisma.rolePermission.deleteMany({ where: { roleId: f.governor.id, permission: { code: 'organization:structure:manage' } } });
    const choices = (await request(app.getHttpServer()).get('/api/v1/workflows/closure-options?pageSize=1&page=1').set('Cookie', f.cookie).expect(200)).body;
    expect(choices).toMatchObject({ page: 1, pageSize: 1, departmentTotal: 2, userTotal: 4 });
    expect(choices.departments).toHaveLength(1); expect(choices.users).toHaveLength(1);
    expect(Object.keys(choices.users[0]).sort()).toEqual(['fullName', 'id', 'username']);
    expect(JSON.stringify(choices)).not.toContain(other.professional.user.id);
    const found = (await request(app.getHttpServer()).get(`/api/v1/workflows/closure-options?search=${f.professional.user.username}`).set('Cookie', f.cookie).expect(200)).body;
    expect(found.users).toEqual([{ id: f.professional.user.id, username: f.professional.user.username, fullName: null }]);
    const second = (await request(app.getHttpServer()).get('/api/v1/workflows/closure-options?pageSize=1&page=2').set('Cookie', f.cookie).expect(200)).body;
    expect(second.users[0].id).not.toBe(choices.users[0].id); expect(second.departments[0].id).not.toBe(choices.departments[0].id);
    expect(Object.keys(choices.departments[0]).sort()).toEqual(['code', 'id', 'name']);
    await prisma.user.update({ where: { id: f.professional.user.id }, data: { fullName: 'Distinct quality name' } });
    const named = (await request(app.getHttpServer()).get('/api/v1/workflows/closure-options?search=Distinct').set('Cookie', f.cookie).expect(200)).body;
    expect(named.users.map((item: { id: string }) => item.id)).toEqual([f.professional.user.id]);
    const section = (await request(app.getHttpServer()).get(`/api/v1/workflows/closure-options?search=${f.section.code}`).set('Cookie', f.cookie).expect(200)).body;
    expect(section.departments).toEqual([{ id: f.section.id, code: f.section.code, name: f.section.name }]);
    await prisma.user.update({ where: { id: f.professional.user.id }, data: { status: 'DISABLED' } });
    expect((await request(app.getHttpServer()).get('/api/v1/workflows/closure-options?search=Distinct').set('Cookie', f.cookie).expect(200)).body.users).toEqual([]);
    for (const query of ['pageSize=101', 'organizationId='+other.org.id, 'page=0', 'page=101']) await request(app.getHttpServer()).get('/api/v1/workflows/closure-options?'+query).set('Cookie', f.cookie).expect(400);
    await request(app.getHttpServer()).get('/api/v1/workflows/closure-options').expect(401);
    await prisma.userRole.deleteMany({ where: { userId: f.actor.id } });
    await request(app.getHttpServer()).get('/api/v1/workflows/closure-options').set('Cookie', f.cookie).expect(403);
  });

  it('skips only an internal low/medium manager who is the valid owner, never the professional review', async () => {
    const f = await fixture(); await f.binding('SECTION_MANAGER');
    const result = (await f.post({ ...f.body, severity: 'MEDIUM', ownerUserId: f.manager.user.id, professionalUserId: f.manager.user.id }).expect(200)).body;
    expect(result.configurationReady).toBe(true);
    expect(result.duties.map((d: { duty: string; status: string }) => [d.duty, d.status])).toEqual([['PROFESSIONAL', 'PENDING'], ['SECTION_MANAGER', 'SKIPPED_SAME_PERSON']]);
    expect(result.samePersonGroups).toEqual([]);
  });

  it.each(['HIGH', 'CRITICAL'])('uses only the assigned minister for internal %s, not a missing section manager', async severity => {
    const f = await fixture(); await f.binding('MINISTER'); const scope = await f.scope();
    const ownerPosition = await prisma.userPosition.findUniqueOrThrow({ where: { id: f.owner.assignment.id } });
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.minister.user.id, positionId: ownerPosition.positionId, startedAt: new Date(Date.now() - 60_000) } });
    const result = (await f.post({ ...f.body, severity, ownerUserId: f.minister.user.id }).expect(200)).body;
    expect(result).toMatchObject({ configurationReady: true, issues: [] });
    expect(result.duties.map((d: { duty: string }) => d.duty)).toEqual(['PROFESSIONAL', 'MINISTER']);
    expect(result.duties[1]).toMatchObject({ status: 'PENDING', participant: { userId: f.minister.user.id, scopeId: scope.id } });
  });

  it('leaves supplier management waiting after professional and preserves both same-person management duties', async () => {
    const f = await fixture();
    await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { userId: f.minister.user.id } });
    await f.binding('SECTION_MANAGER'); await f.binding('MINISTER'); await f.scope();
    const { ownerUserId: _owner, ...body } = f.body;
    const result = (await f.post({ ...body, policy: 'SUPPLIER', severity: 'CRITICAL' }).expect(200)).body;
    expect(result).toMatchObject({ configurationReady: true, executionMode: 'PROFESSIONAL_THEN_MANAGEMENT', samePersonGroups: [{ userId: f.minister.user.id, duties: ['SECTION_MANAGER', 'MINISTER'] }] });
    expect(result.duties.map((d: { status: string }) => d.status)).toEqual(['PENDING', 'WAITING', 'WAITING']);
    expect(result.duties[1].participant.assignmentId).not.toBe(result.duties[2].participant.assignmentId);
  });

  it('reports missing and ambiguous manager sources without inventing a fallback or changing configuration', async () => {
    const f = await fixture();
    expect((await f.post().expect(200)).body).toMatchObject({ configurationReady: false, issues: [{ duty: 'SECTION_MANAGER', code: 'BINDING_MISSING' }] });
    await f.binding('SECTION_MANAGER'); await f.person(f.managerPosition.id);
    const result = (await f.post().expect(200)).body;
    expect(result).toMatchObject({ configurationReady: false, issues: [{ duty: 'SECTION_MANAGER', code: 'ASSIGNMENT_AMBIGUOUS' }] });
    expect(result.duties[1]).toMatchObject({ participant: null, status: 'PENDING' });
  });

  it.each(['foreign', 'disabled', 'no-appointment', 'no-permission'])('rejects a %s professional as a configuration issue without disclosing another organization', async reason => {
    const f = await fixture(); await f.binding('SECTION_MANAGER');
    let id = f.professional.user.id;
    if (reason === 'foreign') id = (await fixture()).professional.user.id;
    if (reason === 'disabled') await prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
    if (reason === 'no-appointment') await prisma.userPosition.update({ where: { id: f.professional.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    if (reason === 'no-permission') await prisma.userRole.deleteMany({ where: { userId: id } });
    const result = (await f.post({ ...f.body, professionalUserId: id }).expect(200)).body;
    expect(result).toMatchObject({ configurationReady: false, issues: [{ duty: 'PROFESSIONAL', code: 'PARTICIPANT_NOT_ELIGIBLE' }] });
    expect(result.duties[0].participant).toBeNull();
    expect(JSON.stringify(result)).not.toContain(id);
  });

  it('preserves an effective manager source without confusing configuration with execution permission, but validates owner membership', async () => {
    const f = await fixture(); await f.binding('SECTION_MANAGER');
    await prisma.userRole.deleteMany({ where: { userId: f.manager.user.id } });
    const result = (await f.post({ ...f.body, ownerUserId: f.manager.user.id }).expect(200)).body;
    expect(result).toMatchObject({ configurationReady: true, issues: [] });
    expect(result.duties[1]).toMatchObject({ status: 'SKIPPED_SAME_PERSON', participant: { userId: f.manager.user.id, assignmentId: f.manager.assignment.id } });
    await prisma.userPosition.update({ where: { id: f.owner.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    expect((await f.post().expect(200)).body.issues).toContainEqual({ duty: 'OWNER', code: 'PARTICIPANT_NOT_ELIGIBLE' });
  });

  it('preserves a minister source without workflow act permission while marking the response preview-only', async () => {
    const f = await fixture(); await f.binding('MINISTER'); await f.scope();
    await prisma.userRole.deleteMany({ where: { userId: f.minister.user.id } });
    const result = (await f.post({ ...f.body, severity: 'HIGH' }).expect(200)).body;
    expect(result).toMatchObject({ previewOnly: true, configurationReady: true, issues: [] });
    expect(result.duties[1].participant.userId).toBe(f.minister.user.id);
  });

  it('uses the validated database identity when an owner UUID has uppercase hex characters', async () => {
    const f = await fixture(); await f.binding('SECTION_MANAGER');
    const result = (await f.post({ ...f.body, ownerUserId: f.manager.user.id.toUpperCase() }).expect(200)).body;
    expect(result).toMatchObject({ configurationReady: true, issues: [] });
    expect(result.duties[1]).toMatchObject({ status: 'SKIPPED_SAME_PERSON', participant: { userId: f.manager.user.id } });
  });

  it('resolves two ministers by their actual section scope, never by display name or first appointment', async () => {
    const f = await fixture(); await f.binding('MINISTER'); const first = await f.scope();
    const secondSection = await prisma.department.create({ data: { organizationId: f.org.id, parentId: f.dept.id, code: randomUUID(), name: 'Second section' } });
    const secondMinister = await f.person(f.ministerPosition.id);
    const secondOwnerPosition = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: secondSection.id, code: randomUUID(), name: 'Second owner' } });
    const secondOwner = await f.person(secondOwnerPosition.id, false);
    await prisma.$executeRaw`INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id, minister_assignment_id, valid_from, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${f.org.id}::uuid, ${f.dept.id}::uuid, ${secondSection.id}::uuid, ${secondMinister.assignment.id}::uuid, CURRENT_TIMESTAMP - INTERVAL '1 minute', ${f.actor.id}::uuid, ${f.actor.id}::uuid)`;
    const one = (await f.post({ ...f.body, severity: 'HIGH' }).expect(200)).body;
    const two = (await f.post({ ...f.body, severity: 'HIGH', responsibleSectionDepartmentId: secondSection.id, ownerUserId: secondOwner.user.id }).expect(200)).body;
    expect(one).toMatchObject({ configurationReady: true, duties: [expect.anything(), expect.objectContaining({ participant: expect.objectContaining({ userId: f.minister.user.id, assignmentId: f.minister.assignment.id, scopeId: first.id }) })] });
    expect(two.configurationReady).toBe(true);
    expect(two.duties[1].participant.userId).toBe(secondMinister.user.id);
    expect(two.duties[1].participant.scopeId).not.toBe(first.id);
  });

  it('does not disclose a foreign or wrong-section owner, or use an expired manager appointment', async () => {
    const f = await fixture(); const other = await fixture(); await f.binding('SECTION_MANAGER');
    for (const ownerUserId of [other.owner.user.id, f.professional.user.id]) {
      const result = (await f.post({ ...f.body, ownerUserId }).expect(200)).body;
      expect(result.configurationReady).toBe(false);
      expect(result.issues).toContainEqual({ duty: 'OWNER', code: 'PARTICIPANT_NOT_ELIGIBLE' });
      if (ownerUserId === other.owner.user.id) expect(JSON.stringify(result)).not.toContain(ownerUserId);
    }
    await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: new Date(Date.now() - 1000) } });
    const result = (await f.post().expect(200)).body;
    expect(result.issues).toContainEqual({ duty: 'SECTION_MANAGER', code: 'ASSIGNMENT_MISSING' });
    expect(result.duties[1]).toMatchObject({ participant: null, status: 'PENDING' });
  });

  it.each(['session', 'permission'])('rechecks %s after the real resolver returns', async change => {
    const f = await fixture(); await f.binding('SECTION_MANAGER');
    const original = responsibilities.resolveManagementResponsibilities.bind(responsibilities);
    responsibilities.resolveManagementResponsibilities = async (...args) => {
      const result = await original(...args);
      if (change === 'session') await prisma.session.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } });
      else await prisma.userRole.deleteMany({ where: { userId: f.actor.id } });
      return result;
    };
    try { await f.post().expect(change === 'session' ? 401 : 403); }
    finally { responsibilities.resolveManagementResponsibilities = original; }
  });

  it('waits on a real candidate-user lock and rejects a session revoked during the wait without acquiring actor update locks', async () => {
    const f = await fixture(); await f.binding('SECTION_MANAGER');
    let locked!: () => void; let release!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let holder = 0;
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.manager.user.id}::uuid FOR UPDATE`;
      const [pid] = await tx.$queryRaw<{ id: number }[]>`SELECT pg_backend_pid() AS id`;
      holder = pid!.id; locked(); await gate;
    }, { timeout: 20_000 });
    await ready;
    const pending = f.post().then(response => response);
    try {
      let waiting = false;
      for (let index = 0; index < 100; index++) {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${holder}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
        if (row?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await prisma.session.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } });
      release(); await blocker;
      expect((await pending).status).toBe(401);
    } finally { release(); await blocker; await pending; }
  });

  it('requires a live manager session and denies revoked permission/session, foreign sections and supplier actors', async () => {
    const f = await fixture(); await f.post(f.body, false).expect(401);
    const other = await fixture(); await f.post({ ...f.body, responsibleSectionDepartmentId: other.section.id }).expect(409);
    await prisma.userRole.deleteMany({ where: { userId: f.actor.id } }); await f.post().expect(403);
    await prisma.userRole.create({ data: { userId: f.actor.id, organizationId: f.org.id, roleId: f.governor.id } });
    await prisma.session.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } }); await f.post().expect(401);
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Supplier fixture', type: 'SUPPLIER' } });
    const user = await prisma.user.create({ data: { organizationId: supplier.id, accountType: 'SUPPLIER', username: randomUUID(), passwordHash: 'unused' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:manage' } });
    const role = await prisma.role.create({ data: { organizationId: supplier.id, code: randomUUID(), name: 'Not internal', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { userId: user.id, organizationId: supplier.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    await request(app.getHttpServer()).post(path).set('Cookie', `qms_session=${token}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).send(f.body).expect(403);
  });

  it('rejects a supplier organization even if an inconsistent stored account is marked internal', async () => {
    const f = await fixture(); await f.binding('SECTION_MANAGER');
    await prisma.organization.update({ where: { id: f.org.id }, data: { type: 'SUPPLIER' } });
    await f.post().expect(403);
  });

  it.each([false, true])('rechecks a real time-activated MFA assignment after the resolver, session MFA verified = %s', async verified => {
    const f = await fixture(); await f.binding('SECTION_MANAGER');
    const structure = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:structure:manage' } });
    await prisma.rolePermission.deleteMany({ where: { roleId: f.governor.id, permissionId: structure.id } });
    const role = await prisma.role.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Time activated MFA', mfaRequired: true } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.qualityPosition.id, roleId: role.id } });
    const token = await app.get(SessionService).create(f.actor.id, prisma, { mfaVerified: verified });
    expect(await app.get(SessionService).resolve(token)).not.toBeNull();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: f.actor.id } });
    const original = responsibilities.resolveManagementResponsibilities.bind(responsibilities);
    let activated = false;
    responsibilities.resolveManagementResponsibilities = async (...args) => {
      // Keep real resolution, real time and real role policy; only schedule the activation after the guard passed.
      await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.actor.id,
        positionId: f.qualityPosition.id, startedAt: new Date(Date.now() + 100) } });
      await new Promise(resolve => setTimeout(resolve, 180));
      activated = true;
      return original(...args);
    };
    try {
      await request(app.getHttpServer()).post(path).set('Cookie', `qms_session=${token}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).send(f.body).expect(verified ? 200 : 401);
      expect(activated).toBe(true);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: f.actor.id } })).securityVersion).toBe(before.securityVersion);
    } finally { responsibilities.resolveManagementResponsibilities = original; }
  });

  it('rejects extra fields, invalid enums/IDs, missing internal owner and a supplier owner rather than silently ignoring identity', async () => {
    const f = await fixture();
    for (const body of [{ ...f.body, organizationId: f.org.id }, { ...f.body, severity: 'URGENT' }, { ...f.body, professionalUserId: 'bad' },
      { ...f.body, ownerUserId: undefined }, { ...f.body, policy: 'SUPPLIER' }, { ...f.body, policy: 'OTHER' }]) await f.post(body).expect(400);
    await request(app.getHttpServer()).post(path).send(f.body).expect(403);
  });
});
