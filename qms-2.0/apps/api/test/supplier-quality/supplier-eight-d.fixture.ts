import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { createWorkflowClosureFixture } from '../workflow/workflow-closure-round.fixture.js';
import { normalizeProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import type { WorkflowActor } from '../../src/modules/workflow/workflow-access-policy.js';

export function supplierEightDDocument() {
  return normalizeProcessEightDDocument({ description: 'Actual supplier defect', occurrenceCause: 'Fixture drift', escapeCause: 'Inspection missed drift',
    correctiveActions: ['OCCURRENCE', 'ESCAPE'].map((causeKind, index) => ({ id: `action-${index}`, causeKind,
      action: 'Control drift', owner: 'Supplier operator', plannedAt: '2026-10-28', verificationMethod: 'Measure output',
      implementationAt: '2026-10-28', result: 'Implemented', beforeState: 'Outside tolerance', afterState: 'Within tolerance', firstBatch: `batch-${index}`,
      followUpBatchCount: 1, verificationRecord: 'Measured output meets standard', effective: true })) });
}

export async function supplierEightDFixture(app: INestApplication, severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW', dual = false, mode: 'SUPPLIER' | 'INTERNAL' = 'SUPPLIER') {
  const db = app.get(PrismaService);
  // Only actual organization/appointment setup is reused. No neutral adapter is registered or invoked.
  const f = await createWorkflowClosureFixture(db, app.get(WorkflowClosureRoundService), 'SUPPLIER', severity, dual);
  const codes = ['workflow:start', 'workflow:manage', 'configuration:read', 'configuration:manage',
    'supplier-quality:profiles:read', 'supplier-quality:profiles:write', 'supplier-quality:problems:read', 'supplier-quality:problems:write',
    'supplier-quality:responses:read', 'supplier-quality:responses:write',
    ...['read', 'issue', 'work', 'deadlines'].map(a => `supplier-quality:issues:${a}`)];
  for (const code of codes) {
    const permission = await db.permission.findUniqueOrThrow({ where: { code } });
    await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
  }
  async function session(userId: string) {
    const token = await app.get(SessionService).create(userId, db, { mfaVerified: true, reauthenticated: true });
    const s = (await app.get(SessionService).resolve(token))!;
    return { cookie: `qms_session=${token}`, actor: { ...s.user, sessionId: s.id } as WorkflowActor };
  }
  const sqe = await session(f.owner.user.id), manager = await session(f.manager.user.id), minister = await session(dual ? f.manager.user.id : f.minister.user.id), outsider = await session(f.professional.user.id);
  const makeVendor = async () => {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Supplier enterprise', type: 'SUPPLIER' } });
    const permissions = await db.permission.findMany({ where: { code: { in: ['supplier-quality:responses:read', 'supplier-quality:responses:write', 'workflow:act'] } } });
    const role = await db.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Actual supplier responder', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    const user = await db.user.create({ data: { organizationId: org.id, accountType: 'SUPPLIER', username: randomUUID(), passwordHash: 'unused-test-session',
      userRoles: { create: { organizationId: org.id, roleId: role.id } } } });
    return { org, role, user, ...await session(user.id) };
  };
  const vendor = await makeVendor(), otherVendor = await makeVendor();
  const http = (cookie: string, method: 'get' | 'put' | 'post', path: string, body?: object | string, key = randomUUID()) => {
    const csrf = randomUUID();
    const call = request(app.getHttpServer())[method](`/api/v1/${path}`).set('Cookie', [cookie, `qms_csrf=${csrf}`]);
    return method === 'get' ? call : call.set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  };
  const template = (await http(sqe.cookie, 'post', 'workflows/closure-templates', { policy: 'SUPPLIER', domainCode: 'supplier-quality', code: randomUUID(), name: 'Supplier full 8D' }).expect(201)).body;
  const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id, userId: sqe.actor.id, actor: sqe.actor,
    definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
  const binding = (await http(sqe.cookie, 'put', 'supplier-quality/workflow-bindings', { severity, responseForm: 'EIGHT_D', replyMode: mode, expectedVersion: 0, workflowVersionId: published.id, enabled: false }).expect(200)).body;
  await http(sqe.cookie, 'put', 'supplier-quality/workflow-bindings/activation', { severity, responseForm: 'EIGHT_D', replyMode: mode, expectedVersion: binding.version, enabled: true }).expect(200);
  await app.get(NumberingService).publishRuleVersion({ organizationId: f.org.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
  const caretaker = await db.role.create({ data: { organizationId: vendor.org.id, code: randomUUID(), name: 'Explicit fixture account caretaker',
    permissions: { create: { permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'account:users:create' } })).id } } } });
  await db.userRole.create({ data: { organizationId: vendor.org.id, userId: sqe.actor.id, roleId: caretaker.id } });
  const profile = (await http(sqe.cookie, 'post', 'supplier-quality/profiles', { supplierOrganizationId: vendor.org.id, businessCode: randomUUID(), displayName: 'Supplier actual profile' }).expect(201)).body;
  const draft = (await http(sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: profile.id, title: 'Supplier defect', materialCode: 'PART-N5',
    defectDescription: 'Observed actual nonconformity', defectQuantity: 2, severity, responseForm: 'EIGHT_D', replyMode: mode,
    ...(mode === 'INTERNAL' ? { internalResponderId: f.professional.user.id } : {}) }).expect(201)).body;
  const issueInput = { expectedVersion: draft.version, sqeAssignmentId: f.owner.assignment.id };
  const issueKey = randomUUID();
  const issued = (await http(sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${draft.id}/issue`, issueInput, issueKey).expect(201)).body;
  const prefix = `supplier-quality/eight-d/${draft.id}`, portal = `supplier-portal/eight-d/${draft.id}`;
  const version = (row: { rowVersion: number; instanceVersion: number }) => ({ expectedRowVersion: row.rowVersion, expectedInstanceVersion: row.instanceVersion });
  const read = async () => (await http(sqe.cookie, 'get', prefix).expect(200)).body;
  const decide = async (person: typeof sqe, round: { id: string; version: number }, duties: string[], decision = 'APPROVE', key = randomUUID()) =>
    (await http(person.cookie, 'post', `workflow-closure/rounds/${round.id}/decide`, { expectedRoundVersion: round.version, duties, decision, comment: 'Actual duty verified' }, key));
  return { f, db, sqe, manager, minister, outsider, vendor, otherVendor, http, draft, issueInput, issueKey, issued, prefix, portal, version, read, decide, profile, mode };
}
