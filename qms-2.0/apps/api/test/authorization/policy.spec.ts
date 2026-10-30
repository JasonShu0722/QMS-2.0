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
      organization: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-internal-home' }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      userRole: {
        findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-supplier-a', role: { id: 'role', permissions: [{ permission: { code: 'organization:read' } }] } }]),
      },
    };
    const service = new AuthorizationService(prisma as never);

    await expect(
      service.assertFeature('user-internal', 'org-supplier-a', 'organization:read'),
    ).resolves.toBeUndefined();

    expect(prisma.userRole.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-internal',
        role: { archivedAt: null },
        OR: expect.arrayContaining([{ organizationId: 'org-supplier-a' }]),
      },
    }));
  });

  it('rejects missing feature permission with a stable public code', async () => {
    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-internal-home' }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      userRole: {
        findMany: jest.fn().mockResolvedValue([]),
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
      user: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-internal-home' }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      userRole: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ organizationId: 'org-supplier-a', role: { id: 'role', permissions: [] } }])
          .mockResolvedValueOnce([]),
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
