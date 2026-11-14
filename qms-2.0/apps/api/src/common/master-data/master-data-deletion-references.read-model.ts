import type { AdminTransaction } from '../security/admin-mutation.service.js';

export async function supplierProfileHasAccounts(transaction: AdminTransaction, organizationId: string, id: string): Promise<boolean> {
  const [result] = await transaction.$queryRaw<{ referenced: boolean }[]>`SELECT EXISTS (
    SELECT 1 FROM supplier_business_profiles p JOIN users u ON u.organization_id = p.supplier_organization_id
    WHERE p.owner_organization_id = ${organizationId}::uuid AND p.id = ${id}::uuid AND u.account_type = 'SUPPLIER' AND u.deleted_at IS NULL
  ) AS referenced`;
  return result!.referenced;
}

export async function componentMappingIsReferenced(transaction: AdminTransaction, organizationId: string, id: string): Promise<boolean> {
  const [result] = await transaction.$queryRaw<{ referenced: boolean }[]>`SELECT EXISTS (
    SELECT 1 FROM component_project_mappings m WHERE m.organization_id = ${organizationId}::uuid AND m.id = ${id}::uuid AND (
      EXISTS (SELECT 1 FROM process_defects d WHERE d.organization_id = m.organization_id AND d.product_code = m.component_code)
      OR EXISTS (SELECT 1 FROM customer_quality_complaints c WHERE c.organization_id = m.organization_id AND COALESCE(c.ledger_normalized->>'componentCode', c.product_code) = m.component_code)
      OR EXISTS (SELECT 1 FROM new_product_defect_selections s WHERE s.organization_id = m.organization_id AND s.source_snapshot->'inclusion'->>'mappingId' = m.id::text)
    )
  ) AS referenced`;
  return result!.referenced;
}
