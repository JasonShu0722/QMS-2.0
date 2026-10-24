import 'reflect-metadata';
import { AUTHENTICATED_SESSION } from '../../src/common/guards/authenticated.guard.js';
import { AdminOrganizationController } from '../../src/modules/identity/admin-organization.controller.js';

describe('component project organization directory', () => {
  it.each(['component-project:read', 'component-project:manage'])('allows an internal %s grant without platform administration permissions', async (code) => {
    const organization = { id: 'organization', code: 'ORG', name: 'Internal organization', type: 'INTERNAL' };
    const prisma = {
      user: { findUnique: async () => ({ organizationId: organization.id }) },
      userRole: { findMany: async () => [{ organizationId: organization.id, role: { id: 'role', organizationId: organization.id, code: 'mapping', name: 'Mapping', mfaRequired: false, permissions: [{ permission: { id: 'permission', code, name: code } }] } }] },
      userPosition: { findMany: async () => [] },
      organization: { findMany: async () => [organization] },
    };
    const controller = new AdminOrganizationController(prisma as never);
    const session = { id: 'session', user: { id: 'user', organizationId: organization.id, accountType: 'INTERNAL' } };
    expect(await controller.list({ [AUTHENTICATED_SESSION]: session } as never)).toEqual([{ ...organization, permissions: [code] }]);
    session.user.accountType = 'SUPPLIER';
    expect(await controller.list({ [AUTHENTICATED_SESSION]: session } as never)).toEqual([]);
  });
});
