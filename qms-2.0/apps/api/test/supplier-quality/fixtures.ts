export const supplierIds = {
  owner: '10000000-0000-4000-8000-000000000001',
  otherOwner: '10000000-0000-4000-8000-000000000002',
  supplier: '20000000-0000-4000-8000-000000000001',
  otherSupplier: '20000000-0000-4000-8000-000000000002',
  engineer: '30000000-0000-4000-8000-000000000001',
  verifier: '30000000-0000-4000-8000-000000000002',
  supplierUser: '30000000-0000-4000-8000-000000000003',
  problem: '40000000-0000-4000-8000-000000000001',
  file: '50000000-0000-4000-8000-000000000001',
};

export function problemFacts() {
  return {
    supplierOrganizationId: supplierIds.supplier,
    title: '端子表面氧化',
    materialCode: 'MAT-001',
    materialCategory: 'ELECTRONIC' as const,
    defectDescription: '抽检发现端子表面氧化',
    defectQuantity: 12,
    severity: 'HIGH' as const,
    responseForm: 'BRIEF' as const,
    replyMode: 'SUPPLIER' as const,
  };
}

export function problemResource() {
  return {
    id: supplierIds.problem,
    ownerOrganizationId: supplierIds.owner,
    supplierOrganizationId: supplierIds.supplier,
    replyMode: 'SUPPLIER' as const,
    internalResponderId: null,
    releasedToSupplier: true,
    contentVersion: 2,
  };
}

export function internalActor() {
  return { id: supplierIds.engineer, organizationId: supplierIds.owner, accountType: 'INTERNAL' as const };
}

export function supplierActor() {
  return { id: supplierIds.supplierUser, organizationId: supplierIds.supplier, accountType: 'SUPPLIER' as const };
}

export function availableEvidence() {
  return {
    id: supplierIds.file,
    organizationId: supplierIds.supplier,
    resourceType: 'supplier-quality',
    resourceId: supplierIds.problem,
    status: 'AVAILABLE' as const,
  };
}
