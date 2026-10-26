import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';

function fixture(kind: 'INDEPENDENT' | 'OWNER' | 'MANAGEMENT' = 'INDEPENDENT') {
  const actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL' };
  const section = randomUUID(), other = randomUUID(), problemId = randomUUID(), target = randomUUID();
  const record = { problem: { id: problemId, ownerId: kind === 'OWNER' ? actor.id : randomUUID(), version: 1 },
    report: { responsibleSectionDepartmentId: section } };
  const grants = new Set(['process-quality:issues:read', `process-quality:issues:${kind === 'INDEPENDENT' ? 'reassign' : 'work'}`]);
  const departmentCalls: unknown[][] = [], writes: string[] = [], checks: string[] = [];
  let valid = true;
  const tx = { $queryRaw: async () => [{ users: [], userTotal: 0 }], $executeRaw: async () => { writes.push('collaborators'); } };
  const service = Object.assign(Object.create(ProcessEightDService.prototype), {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx),
    lockRecord: async () => record,
    authorizeRead: async () => { checks.push('read'); if (!valid) throw new HttpException({}, 403); },
    editable: () => { checks.push('editable'); },
    authorize: async (_tx: unknown, _actor: unknown, permission: string) => {
      checks.push(permission); if (!grants.has(permission)) throw new HttpException({}, 403);
    },
    feature: async (_tx: unknown, _org: string, _user: string, permission: string) => grants.has(permission),
    assertOwnerAssignment: async () => { checks.push('assignment'); if (!valid) throw new HttpException({}, 403); },
    eligibleWorker: async () => true,
    responsibilities: {
      workflowDepartmentOptions: async (...args: unknown[]) => { departmentCalls.push(args); return { items: [], total: 0 }; },
      resolveManagementResponsibilities: async () => ({ responsibilities: [{ userId: actor.id, bindingId: 'binding' }] }),
      revalidateLockedManagementResponsibilities: async () => new Set(valid ? ['binding'] : []),
    },
    command: async (_actor: unknown, _id: string, _input: unknown, _action: string, _key: string, _trace: string,
      work: (tx: unknown, current: unknown) => Promise<unknown>) => work(tx, record),
    problems: { updateDomainSummary: async () => { writes.push('problem'); } },
    updateReport: async () => { writes.push('report'); },
  });
  return { actor, section, other, problemId, target, record, grants, departmentCalls, checks, writes, tx, service,
    invalidate: () => { valid = false; } };
}

describe('process 8D independent and internal reassignment seams (no database)', () => {
  it.each(['none', 'current', 'other'])('keeps independent candidate eligibility with %s section filter', async choice => {
    const f = fixture();
    const sectionDepartmentId = choice === 'none' ? undefined : choice === 'current' ? f.section : f.other;
    await expect(f.service.assignmentOptions(f.actor, { action: 'REASSIGN', problemId: f.problemId, sectionDepartmentId })).resolves.toMatchObject({ users: [] });
    expect(f.checks).toContain('editable');
    expect(f.checks).not.toContain('process-quality:issues:work');
    expect(f.departmentCalls[0]?.[5]).toBeUndefined();
  });

  it.each(['current', 'other'])('allows independent actual reassignment to the %s section without internal work', async choice => {
    const f = fixture();
    await expect(f.service.reassign(f.actor, f.problemId, { ownerUserId: f.target,
      responsibleSectionDepartmentId: choice === 'current' ? f.section : f.other, expectedVersion: 1 }, 'trace', 'test-key'))
      .resolves.toEqual({ kind: 'CROSS_DEPARTMENT', sectionDepartmentId: f.section });
    expect(f.writes).toEqual(['problem', 'collaborators', 'report']);
    expect(f.checks).not.toContain('process-quality:issues:work');
  });

  it.each(['OWNER', 'MANAGEMENT'] as const)('restricts %s candidate departments to the current section', async kind => {
    const f = fixture(kind);
    await f.service.assignmentOptions(f.actor, { action: 'REASSIGN', problemId: f.problemId });
    expect(f.departmentCalls[0]?.[5]).toBe(f.section);
    expect(f.checks).toContain('process-quality:issues:work');
    await expect(f.service.assignmentOptions(f.actor, { action: 'REASSIGN', problemId: f.problemId, sectionDepartmentId: f.other }))
      .rejects.toMatchObject({ status: 403 });
    expect(f.departmentCalls).toHaveLength(1);
  });

  it.each(['OWNER', 'MANAGEMENT'] as const)('does not upgrade the original %s replay route to a newly acquired independent grant', async kind => {
    const f = fixture(kind);
    f.grants.add('process-quality:issues:reassign');
    f.grants.delete('process-quality:issues:work');
    await expect(f.service.replayAccess(f.tx, f.actor, f.record, 'REASSIGN', { kind, sectionDepartmentId: f.section }))
      .rejects.toMatchObject({ status: 403 });
    expect(f.writes).toEqual([]);
  });

  it('revalidates independent replay with the original grant, not newly acquired ownership', async () => {
    const f = fixture();
    f.grants.delete('process-quality:issues:reassign'); f.grants.add('process-quality:issues:work'); f.record.problem.ownerId = f.actor.id;
    await expect(f.service.replayAccess(f.tx, f.actor, f.record, 'REASSIGN', { kind: 'CROSS_DEPARTMENT', sectionDepartmentId: f.section }))
      .rejects.toMatchObject({ status: 403 });
  });

  it.each(['OWNER', 'MANAGEMENT'] as const)('rejects a lost %s appointment or binding on replay even with an independent grant', async kind => {
    const f = fixture(kind); f.grants.add('process-quality:issues:reassign');
    if (kind === 'OWNER') Object.assign(f.service, { assertOwnerAssignment: async () => { throw new HttpException({}, 403); } });
    else f.service.responsibilities.revalidateLockedManagementResponsibilities = async () => new Set();
    await expect(f.service.replayAccess(f.tx, f.actor, f.record, 'REASSIGN', { kind, sectionDepartmentId: f.section }))
      .rejects.toMatchObject({ status: 403 });
    expect(f.writes).toEqual([]);
  });

  it('rejects lost actor access, foreign scope and locked state before disclosing independent candidates', async () => {
    const f = fixture(); f.invalidate();
    await expect(f.service.assignmentOptions(f.actor, { action: 'REASSIGN', problemId: f.problemId })).rejects.toMatchObject({ status: 403 });
    expect(f.departmentCalls).toEqual([]);
    await expect(f.service.assignmentOptions({ ...f.actor, scopeOrganizationId: randomUUID() }, { action: 'REASSIGN', problemId: f.problemId })).rejects.toMatchObject({ status: 403 });
    const locked = fixture();
    Object.assign(locked.service, { editable: () => { throw new HttpException({}, 409); } });
    await expect(locked.service.assignmentOptions(locked.actor, { action: 'REASSIGN', problemId: locked.problemId })).rejects.toMatchObject({ status: 409 });
    expect(locked.departmentCalls).toEqual([]);
  });
});

describe('organization-owned workflow department projection (no database)', () => {
  it.each([undefined, randomUUID()])('applies the optional section bound to both page and count (%s)', async sectionId => {
    const queries: Array<{ where: object }> = [];
    const tx = { organization: { findUnique: async () => ({ status: 'ACTIVE', type: 'INTERNAL' }) },
      department: { findMany: async (query: { where: object }) => { queries.push(query); return []; },
        count: async (query: { where: object }) => { queries.push(query); return 0; } } };
    const service = new OrganizationResponsibilityService({} as never, {} as never, {} as never);
    await service.workflowDepartmentOptions(tx as never, 'org', 'name', 5, 0, sectionId);
    expect(queries).toHaveLength(2);
    for (const query of queries) expect(query.where).toEqual({ organizationId: 'org', status: 'ACTIVE',
      ...(sectionId ? { id: sectionId } : {}), OR: [{ code: { contains: 'name', mode: 'insensitive' } }, { name: { contains: 'name', mode: 'insensitive' } }] });
  });
});
