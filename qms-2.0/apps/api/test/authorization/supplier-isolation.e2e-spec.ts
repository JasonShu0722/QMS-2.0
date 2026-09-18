import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';

const ORG_INTERNAL = {
  id: '20000000-0000-4000-8000-000000000001',
  code: 'INTERNAL',
  name: 'Internal Quality Team',
  type: 'INTERNAL',
};
const ORG_SUPPLIER_A = {
  id: '20000000-0000-4000-8000-0000000000a1',
  code: 'SUP-A',
  name: 'Supplier A',
  type: 'SUPPLIER',
};
const ORG_SUPPLIER_B = {
  id: '20000000-0000-4000-8000-0000000000b1',
  code: 'SUP-B',
  name: 'Supplier B',
  type: 'SUPPLIER',
};

const USERS = {
  supplierA: {
    id: '10000000-0000-4000-8000-0000000000a1',
    organizationId: ORG_SUPPLIER_A.id,
    accountType: 'SUPPLIER',
    status: 'ACTIVE',
  },
  internalAdmin: {
    id: '10000000-0000-4000-8000-000000000011',
    organizationId: ORG_INTERNAL.id,
    accountType: 'INTERNAL',
    status: 'ACTIVE',
  },
  internalMember: {
    id: '10000000-0000-4000-8000-000000000012',
    organizationId: ORG_INTERNAL.id,
    accountType: 'INTERNAL',
    status: 'ACTIVE',
  },
} as const;

const sessionByToken = {
  'supplier-a-token': USERS.supplierA,
  'internal-admin-token': USERS.internalAdmin,
  'internal-member-token': USERS.internalMember,
} as const;

const organizations = new Map(
  [ORG_INTERNAL, ORG_SUPPLIER_A, ORG_SUPPLIER_B].map((organization) => [
    organization.id,
    organization,
  ]),
);

const grants = [
  {
    userId: USERS.supplierA.id,
    organizationId: ORG_SUPPLIER_A.id,
    permissions: ['organization:read', 'system:permissions:read'],
  },
  {
    userId: USERS.internalAdmin.id,
    organizationId: ORG_SUPPLIER_A.id,
    permissions: ['organization:read', 'system:permissions:read'],
  },
  {
    userId: USERS.internalAdmin.id,
    organizationId: ORG_SUPPLIER_B.id,
    permissions: ['organization:read', 'system:permissions:read'],
  },
  {
    userId: USERS.internalMember.id,
    organizationId: ORG_SUPPLIER_A.id,
    permissions: ['organization:read'],
  },
];

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hasGrant(userId: string, organizationId: string, permission?: string): boolean {
  return grants.some(
    (grant) =>
      grant.userId === userId &&
      grant.organizationId === organizationId &&
      (!permission || grant.permissions.includes(permission)),
  );
}

describe('supplier isolation HTTP guard', () => {
  let app: INestApplication;
  const prisma = {
    session: {
      findUnique: jest.fn(),
    },
    userRole: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    organization: {
      findUniqueOrThrow: jest.fn(),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.session.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => {
      const entry = Object.entries(sessionByToken).find(
        ([token]) => hashToken(token) === where.tokenHash,
      );
      if (!entry) return null;
      const [token, user] = entry;
      return {
        id: `session-${token}`,
        tokenHash: where.tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user,
      };
    });
    prisma.userRole.count.mockImplementation(async ({ where }: { where: { userId: string; organizationId: string; role: { permissions: { some: { permission: { code: string } } } } } }) =>
      hasGrant(where.userId, where.organizationId, where.role.permissions.some.permission.code)
        ? 1
        : 0,
    );
    prisma.userRole.findFirst.mockImplementation(async ({ where }: { where: { userId: string; organizationId: string } }) =>
      hasGrant(where.userId, where.organizationId) ? { organizationId: where.organizationId } : null,
    );
    prisma.userRole.findMany.mockImplementation(async ({ where }: { where: { userId: string; organizationId: string } }) =>
      grants
        .filter((grant) => grant.userId === where.userId && grant.organizationId === where.organizationId)
        .map((grant) => ({
          role: {
            permissions: grant.permissions.map((code) => ({ permission: { code } })),
          },
        })),
    );
    prisma.organization.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const organization = organizations.get(where.id);
      if (!organization) throw new Error('not found');
      return organization;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  function get(path: string, token: keyof typeof sessionByToken) {
    return request(app.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`);
  }

  it('allows a supplier to read its own organization and rejects another supplier organization', async () => {
    const own = await get(
      `/api/v1/organizations/current?organizationId=${ORG_SUPPLIER_A.id}`,
      'supplier-a-token',
    ).expect(200);

    expect(own.body.organization).toEqual(ORG_SUPPLIER_A);

    const other = await get(
      `/api/v1/organizations/current?organizationId=${ORG_SUPPLIER_B.id}`,
      'supplier-a-token',
    ).expect(403);

    expect(other.body).toMatchObject({
      code: 'ORGANIZATION_SCOPE_DENIED',
      fields: {},
    });
    expect(other.body.traceId).toEqual(expect.any(String));
    expect(JSON.stringify(other.body)).not.toMatch(/SELECT|password|C:\\|stack/i);
  });

  it('does not let supplier query parameters broaden the server-owned organization scope', async () => {
    const response = await get(
      `/api/v1/system/permissions?organizationId=${ORG_SUPPLIER_B.id}`,
      'supplier-a-token',
    ).expect(403);

    expect(response.body.code).toBe('ORGANIZATION_SCOPE_DENIED');
    expect(prisma.userRole.count).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_SUPPLIER_B.id }) }),
    );
  });

  it('allows an internal administrator to access each authorized supplier organization', async () => {
    const supplierA = await get(
      `/api/v1/organizations/current?organizationId=${ORG_SUPPLIER_A.id}`,
      'internal-admin-token',
    ).expect(200);
    const supplierB = await get(
      `/api/v1/organizations/current?organizationId=${ORG_SUPPLIER_B.id}`,
      'internal-admin-token',
    ).expect(200);

    expect(supplierA.body.organization.id).toBe(ORG_SUPPLIER_A.id);
    expect(supplierB.body.organization.id).toBe(ORG_SUPPLIER_B.id);
  });

  it('keeps an ordinary internal user inside assigned organizations only', async () => {
    await get(
      `/api/v1/organizations/current?organizationId=${ORG_SUPPLIER_A.id}`,
      'internal-member-token',
    ).expect(200);

    const forbidden = await get(
      `/api/v1/organizations/current?organizationId=${ORG_SUPPLIER_B.id}`,
      'internal-member-token',
    ).expect(403);

    expect(forbidden.body.code).toBe('ORGANIZATION_SCOPE_DENIED');
  });

  it('requires feature permission after organization scope passes', async () => {
    const response = await get(
      `/api/v1/system/permissions?organizationId=${ORG_SUPPLIER_A.id}`,
      'internal-member-token',
    ).expect(403);

    expect(response.body.code).toBe('FEATURE_PERMISSION_DENIED');
  });

  it('returns effective permissions from the server-side context only', async () => {
    const response = await get(
      `/api/v1/system/permissions?organizationId=${ORG_SUPPLIER_A.id}`,
      'supplier-a-token',
    ).expect(200);

    expect(response.body).toEqual({
      organizationId: ORG_SUPPLIER_A.id,
      permissions: ['organization:read', 'system:permissions:read'],
    });
  });
});
