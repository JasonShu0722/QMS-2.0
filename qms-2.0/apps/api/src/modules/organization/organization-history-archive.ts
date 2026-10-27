import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

type ArchivedDelete = { id: string; action: string; scopeOrganizationId: string; organizationId: string; requestDigest: string; response: Prisma.JsonValue };

export async function archivedOrganizationDelete(transaction: AdminTransaction, actorUserId: string, key: string, organizationId: string) {
  const rows = await transaction.$queryRaw<ArchivedDelete[]>`
    SELECT id, action, scope_organization_id AS "scopeOrganizationId", organization_id AS "organizationId",
      request_digest AS "requestDigest", response FROM organization_mutation_archives
    WHERE actor_user_id = ${actorUserId}::uuid AND key = ${key} AND action = 'ORGANIZATION_DELETED'
      AND response->'value'->>'id' = ${organizationId} AND response->'value'->'deleted' = 'true'::jsonb`;
  return rows.length === 1 ? rows[0] : undefined;
}

export async function archiveOrganizationHistory(transaction: AdminTransaction, organization: { id: string; name: string; code: string }, parentId: string) {
  const snapshot = JSON.stringify(organization);
  // Never move technical keys into a surviving live namespace or discard their original response/digest.
  await transaction.$executeRaw`
    INSERT INTO organization_mutation_archives (id, scope_organization_id, organization_id, actor_user_id, key,
      action, request_digest, response, original_organization, created_at)
    SELECT id, ${parentId}::uuid, organization_id, actor_user_id, key, action, request_digest, response,
      ${snapshot}::jsonb, created_at FROM admin_mutations WHERE organization_id = ${organization.id}::uuid`;
  await transaction.adminMutation.deleteMany({ where: { organizationId: organization.id } });
  await transaction.$executeRaw`UPDATE organization_mutation_archives SET scope_organization_id = ${parentId}::uuid
    WHERE scope_organization_id = ${organization.id}::uuid`;
  // Merge only additive provenance; never overwrite any original actor/time/action/result/trace/resource.
  await transaction.$executeRaw`
    UPDATE audit_events SET organization_id = ${parentId}::uuid,
    metadata = (CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata
      ELSE jsonb_build_object('originalMetadata', metadata) END) || jsonb_build_object(
      'organizationId', COALESCE(metadata->'organizationId', to_jsonb(${organization.id}::text)),
      'structureCode', COALESCE(metadata->'structureCode', to_jsonb(${organization.code}::text)),
      'structureName', COALESCE(metadata->'structureName', to_jsonb(${organization.name}::text)),
      'originalOrganizationId', COALESCE(metadata->'originalOrganizationId', to_jsonb(${organization.id}::text)),
      'originalOrganizationCode', COALESCE(metadata->'originalOrganizationCode',
        CASE WHEN resource_type = 'Organization' AND resource_id = ${organization.id} THEN metadata->'structureCode' END,
        to_jsonb(${organization.code}::text)),
      'originalOrganizationName', COALESCE(metadata->'originalOrganizationName',
        CASE WHEN resource_type = 'Organization' AND resource_id = ${organization.id} THEN metadata->'structureName' END,
        to_jsonb(${organization.name}::text)))
    WHERE organization_id = ${organization.id}::uuid`;
}
