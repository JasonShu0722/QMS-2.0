import { Prisma } from '../../generated/prisma/client.js';

export const INTERNAL_EIGHT_D_DOMAIN = Symbol('INTERNAL_EIGHT_D_DOMAIN');

export const INTERNAL_EIGHT_D_DOMAINS = Object.freeze({
  PROCESS: Object.freeze({
    domainCode: 'process-quality', sourceDomain: 'process-quality', sourceType: 'process-defect', problemType: 'PROCESS_DEFECT',
    permissionPrefix: 'process-quality:issues', sourceReadPermission: 'process-quality:defects:read',
    resourceType: 'process-eight-d', revisionType: 'ProcessEightDRevision', storagePrefix: 'process_eight_d',
  } as const),
  CUSTOMER: Object.freeze({
    domainCode: 'customer-quality', sourceDomain: 'customer-quality', sourceType: 'customer-complaint', problemType: 'CUSTOMER_COMPLAINT',
    permissionPrefix: 'customer-quality:issues', sourceReadPermission: 'customer-quality:complaints:read',
    resourceType: 'customer-eight-d', revisionType: 'CustomerEightDRevision', storagePrefix: 'customer_eight_d',
  } as const),
  NEW_PRODUCT: Object.freeze({
    domainCode: 'new-product-quality', sourceDomain: 'new-product-quality', sourceType: 'new-product-defect-selection', problemType: 'NEW_PRODUCT_ISSUE',
    permissionPrefix: 'new-product-quality:issues', sourceReadPermission: 'new-product-quality:projects:read',
    resourceType: 'new-product-eight-d', revisionType: 'NewProductEightDRevision', storagePrefix: 'new_product_eight_d',
  } as const),
});

export type InternalEightDDomainDescriptor = (typeof INTERNAL_EIGHT_D_DOMAINS)[keyof typeof INTERNAL_EIGHT_D_DOMAINS];

export function assertInternalEightDDomain(domain: InternalEightDDomainDescriptor): void {
  if (!Object.values(INTERNAL_EIGHT_D_DOMAINS).some(approved => approved === domain)) throw new Error('INTERNAL_EIGHT_D_DOMAIN_INVALID');
}

export function internalEightDSql(domain: InternalEightDDomainDescriptor) {
  // SQL identifiers come only from the three frozen server objects, never from request fields.
  assertInternalEightDDomain(domain);
  return {
    reports: Prisma.raw(`${domain.storagePrefix}_reports`),
    bindings: Prisma.raw(`${domain.storagePrefix}_bindings`),
    collaborators: Prisma.raw(`${domain.storagePrefix}_collaborators`),
    revisions: Prisma.raw(`${domain.storagePrefix}_revisions`),
    receipts: Prisma.raw(`${domain.storagePrefix}_receipts`),
    sourceConfirmations: Prisma.raw(`${domain.storagePrefix}_source_confirmations`),
    confirmationSourceColumn: domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS ? Prisma.sql`defect_id` : Prisma.sql`source_id`,
    readPermission: Prisma.raw(`'${domain.permissionPrefix}:read'`),
    workPermission: Prisma.raw(`'${domain.permissionPrefix}:work'`),
  };
}
