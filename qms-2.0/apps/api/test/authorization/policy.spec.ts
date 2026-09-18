import { HttpException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { OrganizationScopeService } from '../../src/modules/organization/organization-scope.service.js';

const supplierSession = {
  id: 'session-supplier-a',
  user: {
    id: 'user-supplier-a',
    organizationId: 'org-supplier-a',
    accountType: 'SUPPLIER' as const,
  },
};

const internalSession = {
  id: 'session-internal-user',
  user: {
    id: 'user-internal',
    organizationId: 'org-internal-home',
    accountType: 'INTERNAL' as const,
  },
};

describe('authorization policy', () => {
  it('asserts feature permission through role assignments in the scoped organization', async () => {
    const prisma = {
      userRole: {
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new AuthorizationService(prisma as never);

    await expect(
      service.assertFeature('user-internal', 'org-supplier-a', 'organization:read'),
    ).resolves.toBeUndefined();

    expect(prisma.userRole.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-internal',
        organizationId: 'org-supplier-a',
        role: {
          permissions: {
            some: { permission: { code: 'organization:read' } },
          },
        },
      },
    });
  });

  it('rejects missing feature permission with a stable public code', async () => {
    const prisma = {
      userRole: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new AuthorizationService(prisma as never);

    await expect(
      service.assertFeature('user-internal', 'org-supplier-b', 'organization:read'),
    ).rejects.toMatchObject<HttpException>({
      response: { code: 'FEATURE_PERMISSION_DENIED' },
      status: 403,
    });
  });

  it('keeps workflow permission as an explicit unsupported dimension in phase 1', async () => {
    const prisma = {
      userRole: {
        count: jest.fn(),
      },
    };
    const service = new AuthorizationService(prisma as never);

    await expect(
      service.assertAccess(
        internalSession,
        {
          featurePermission: 'organization:read',
          workflowPermission: 'approval:advance',
        },
        'org-supplier-a',
      ),
    ).rejects.toMatchObject<HttpException>({
      response: { code: 'WORKFLOW_PERMISSION_REQUIRED' },
      status: 403,
    });
    expect(prisma.userRole.count).not.toHaveBeenCalled();
  });

  it('derives supplier scope only from the authenticated session organization', async () => {
    const prisma = {
      userRole: {
        findFirst: jest.fn(),
      },
    };
    const scopes = new OrganizationScopeService(prisma as never);

    await expect(
      scopes.fromSession(supplierSession, { requestedOrganizationId: 'org-supplier-a' }),
    ).resolves.toBe('org-supplier-a');
    await expect(
      scopes.fromSession(supplierSession, { requestedOrganizationId: 'org-supplier-b' }),
    ).rejects.toMatchObject<HttpException>({
      response: { code: 'ORGANIZATION_SCOPE_DENIED' },
      status: 403,
    });
    expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
  });

  it('allows internal users only for organizations assigned on the server', async () => {
    const prisma = {
      userRole: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ organizationId: 'org-supplier-a' })
          .mockResolvedValueOnce(null),
      },
    };
    const scopes = new OrganizationScopeService(prisma as never);

    await expect(
      scopes.fromSession(internalSession, { requestedOrganizationId: 'org-supplier-a' }),
    ).resolves.toBe('org-supplier-a');
    await expect(
      scopes.fromSession(internalSession, { requestedOrganizationId: 'org-supplier-b' }),
    ).rejects.toMatchObject<HttpException>({
      response: { code: 'ORGANIZATION_SCOPE_DENIED' },
      status: 403,
    });
  });
});
