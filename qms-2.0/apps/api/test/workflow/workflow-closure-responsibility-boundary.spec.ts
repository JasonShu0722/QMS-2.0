import 'reflect-metadata';
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import type { ManagementResponsibilitiesDto } from '../../src/modules/organization/organization-responsibility.dto.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import type { WorkflowClosureContext } from '../../src/modules/workflow/workflow-closure-round.types.js';

describe('closure responsibility module boundary (unit contract, no database)', () => {
  afterEach(() => jest.useRealTimers());

  it('does not read organization-private responsibility tables from workflow', () => {
    const source = readFileSync(new URL('../../src/modules/workflow/workflow-closure-round.service.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bdepartment_(?:management_bindings|minister_scopes)\b/);
  });

  it('revalidates the same locked snapshot and transaction at post-wait time without resolving new users', async () => {
    const beforeWait = new Date('2026-10-25T00:00:00Z');
    const afterWait = new Date('2026-10-25T00:00:02Z');
    jest.useFakeTimers({ now: beforeWait });
    const management: ManagementResponsibilitiesDto = {
      organizationId: 'organization', sectionDepartmentId: 'section', at: beforeWait, issues: [],
      responsibilities: [{
        responsibility: 'SECTION_MANAGER', assignmentId: 'locked-assignment', userId: 'locked-user',
        username: 'manager', fullName: null, positionId: 'position', positionName: 'Manager', positionVersion: 1,
        departmentId: 'section', startedAt: beforeWait, endedAt: null, bindingId: 'binding', bindingVersion: 1,
        scopeId: null, scopeVersion: null, departmentVersion: 1, sectionDepartmentVersion: 1, organizationVersion: 1,
      }],
    };
    const resolve = jest.fn(async () => {
      jest.setSystemTime(afterWait);
      return management;
    });
    const revalidate = jest.fn<(_tx: Prisma.TransactionClient, snapshot: ManagementResponsibilitiesDto, at: Date) => Promise<Set<string>>>()
      .mockResolvedValue(new Set<string>());
    const responsibilities = Object.assign(Object.create(OrganizationResponsibilityService.prototype), {
      resolveManagementResponsibilities: resolve, revalidateLockedManagementResponsibilities: revalidate,
    }) as OrganizationResponsibilityService;
    const findAssignment = jest.fn(async () => ({ id: 'locked-assignment' }));
    const query = jest.fn(async () => [{ id: 'binding' }]);
    const tx = {
      userPosition: { findFirst: findAssignment, count: async () => 1 },
      $queryRaw: query, user: { findFirst: async () => null },
    } as unknown as Prisma.TransactionClient;
    const service = new WorkflowClosureRoundService({} as PrismaService, {} as AuditLogService, responsibilities, new WorkflowClosureRegistry([]));
    const context = {
      organizationId: management.organizationId, responsibleSectionDepartmentId: management.sectionDepartmentId,
      professionalUserId: 'professional', ownerUserId: 'owner', policy: 'INTERNAL', severity: 'LOW',
    } as WorkflowClosureContext;

    const plan = await service['plan'](tx, context);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(tx, management.organizationId, management.sectionDepartmentId);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith(tx, management, afterWait);
    expect(revalidate.mock.calls[0]![1]).toBe(management);
    expect(findAssignment).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(plan.duties.find(duty => duty.duty === 'SECTION_MANAGER')?.participant).toBeNull();
  });
});
