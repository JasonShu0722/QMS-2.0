import { Prisma } from '../../generated/prisma/client.js';

export function aiDescriptionRuntimeRecords(organizationId: string, applicationId: string) {
  return Prisma.sql`SELECT id, 'RUNTIME_TASK' AS source, application_version::text AS version,
    connection_id AS "connectionId", connection_version AS "connectionVersion", model,
    CASE WHEN output_configuration->>'mode' IN ('TEXT', 'JSON') THEN output_configuration->>'mode' END AS "outputMode",
    NULL::jsonb AS "testMetadata", status, attempts,
    error_code AS "errorCode", updated_at AS "recordedAt", id AS "taskId", NULL::text AS "traceId"
    FROM integration_ai_description_tasks WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid`;
}
