import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import type { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import type { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import type { ComponentProjectResolutionDto } from '../../src/modules/platform-configuration/component-project.dto.js';

type DomainResolver = ComponentProjectService & {
  resolveForDomain(tx: Prisma.TransactionClient, organizationId: string, componentCode: string): Promise<ComponentProjectResolutionDto>;
};
function fixture(type = 'INTERNAL') {
  const query = jest.fn(async (_query: Prisma.Sql) => []);
  const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
  const lookup = jest.fn(async () => ({ id: 'org', type }));
  const service = new ComponentProjectService({} as PrismaService, {} as AdminMutationService, {} as AuditLogService,
    { lookup } as unknown as OrganizationService) as DomainResolver;
  return { tx, query, lookup, service };
}

describe('component mapping read seam for an authorized domain transaction', () => {
  it('retains tenant and exact text code parameters without opening another transaction', async () => {
    const { tx, query, lookup, service } = fixture();
    const result = await service.resolveForDomain(tx, 'org', '  0001.A-R0000  ');
    expect(result).toMatchObject({ componentCode: '0001.A-R0000', outcome: 'unmapped', issues: ['MAPPING_NOT_FOUND'] });
    expect(lookup).toHaveBeenCalledWith('org', tx);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0].values).toEqual(['org', '0001.A-R0000']);
  });

  it('rejects a supplier organization before reading internal project data', async () => {
    const { tx, query, service } = fixture('SUPPLIER');
    await expect(service.resolveForDomain(tx, 'org', 'COMPONENT')).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the same code validation as the configuration read API', async () => {
    const { tx, query, service } = fixture();
    await expect(service.resolveForDomain(tx, 'org', ' ')).rejects.toMatchObject({ status: 400 });
    await expect(service.resolveForDomain(tx, 'org', 'x'.repeat(101))).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
});
