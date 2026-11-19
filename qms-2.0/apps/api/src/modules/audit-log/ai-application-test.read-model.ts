import { isUUID } from 'class-validator';
import type { AiDescriptionOutput } from '../../common/ai-description.js';
import { Prisma } from '../../generated/prisma/client.js';

export function aiApplicationTestMetadata(value: unknown) {
  const { connectionId, connectionVersion, model, outputMode } = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const mode: AiDescriptionOutput['mode'] | null = outputMode === 'TEXT' || outputMode === 'JSON' ? outputMode : null;
  return {
    connectionId: typeof connectionId === 'string' && isUUID(connectionId) ? connectionId : null,
    connectionVersion: typeof connectionVersion === 'number' && Number.isInteger(connectionVersion) && connectionVersion >= 1 && connectionVersion <= 2147483647 ? connectionVersion : null,
    model: typeof model === 'string' && model.length >= 1 && model.length <= 120 && !/[\s\u0000-\u001f\u007f]/u.test(model) ? model : null,
    outputMode: mode,
  };
}

export function aiApplicationTestRecords(organizationId: string, applicationId: string) {
  return Prisma.sql`SELECT id, 'APPLICATION_TEST' AS source,
    CASE WHEN jsonb_typeof(metadata->'resourceVersion') = 'number' THEN metadata->>'resourceVersion' END AS version,
    NULL::uuid AS "connectionId", NULL::integer AS "connectionVersion", NULL::text AS model, NULL::text AS "outputMode",
    jsonb_build_object('connectionId', metadata->'connectionId', 'connectionVersion', metadata->'connectionVersion',
      'model', metadata->'model', 'outputMode', metadata->'outputMode') AS "testMetadata",
    CASE WHEN outcome = 'SUCCESS' THEN 'SUCCESS' ELSE 'FAILED' END AS status, NULL::integer AS attempts,
    metadata->>'reasonCode' AS "errorCode", created_at AS "recordedAt", NULL::uuid AS "taskId", trace_id AS "traceId"
    FROM audit_events WHERE organization_id = ${organizationId}::uuid AND action = 'AI_APPLICATION_TESTED'
    AND resource_type = 'AiApplication' AND lower(resource_id) = ${applicationId}::uuid::text AND outcome IN ('SUCCESS', 'FAILURE')`;
}
