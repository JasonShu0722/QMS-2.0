import { Prisma } from '../../generated/prisma/client.js';
import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';

type ReferenceColumn = { tableName: string; columnName: string };
const organizationOwned = new Set(['audit_events', 'admin_mutations', 'organization_initializations', 'organization_mutation_archives', 'roles', 'user_roles', 'users', 'departments', 'positions', 'user_positions']);
const historyOnly = new Set([
  'admin_mutations', 'account_batches', 'export_artifacts', 'number_sequences', 'problem_saved_views',
  'mfa_challenges', 'password_change_challenges', 'announcement_recipients', 'approval_signatures', 'user_signatures',
  'audit_checklist_results', 'audit_template_versions',
  'customer_quality_complaint_events', 'customer_quality_ingestion_audits',
  'domain_source_issue_link_history', 'domain_source_issue_links', 'process_defect_ingestion_audits',
  'process_production_revisions', 'process_shipment_report_customers', 'process_shipment_report_evidence_refs', 'process_shipment_report_issues',
  'new_product_issue_revisions', 'new_product_issue_sources', 'new_product_legacy_issues', 'new_product_trial_summary_revisions',
  'quality_data_snapshots', 'quality_metric_facts', 'workflow_mutations', 'workflow_upgrades',
  'workflow_definitions', 'workflow_nodes', 'workflow_transitions',
  'supplier_asn_events', 'supplier_audit_record_events', 'supplier_barcode_rule_events', 'supplier_barcode_scans',
  'supplier_inspection_standard_events', 'supplier_meeting_events', 'supplier_ppap_events',
  'notifications', 'supplier_portal_notifications',
  'workflow_closure_receipts', 'closure_notifications',
]);
const inactiveStatuses = ['DISABLED', 'RETIRED', 'ARCHIVED', 'CLOSED', 'COMPLETED', 'CANCELLED', 'RESOLVED', 'REJECTED', 'DELETED'];
const identifier = (value: string) => Prisma.raw(`"${value.replaceAll('"', '""')}"`);

// Uses alias t so individual dependencies can be checked without other live references masking them.
export function structureReferenceLiveCondition(tableName: string) {
  if (historyOnly.has(tableName)) return Prisma.sql`false`;
  return tableName === 'workflow_versions'
    ? Prisma.sql`to_jsonb(t)->>'status' = 'PUBLISHED'`
    : tableName === 'audit_import_rows'
    ? Prisma.sql`to_jsonb(t)->>'status' IN ('PENDING_REVIEW', 'ACCEPTED')`
    : tableName === 'audit_postponements'
    ? Prisma.sql`to_jsonb(t)->>'status' = 'PENDING'`
    : tableName === 'supplier_concession_requests'
    ? Prisma.sql`to_jsonb(t)->>'status' NOT IN ('REJECTED', 'WITHDRAWN')`
    : tableName === 'supplier_meeting_topics'
    ? Prisma.sql`to_jsonb(t)->>'status' = 'OPEN'`
    : tableName === 'supplier_incoming_inspections'
    ? Prisma.sql`to_jsonb(t)->>'status' = 'DRAFT'`
    : tableName === 'supplier_performance_appeals'
    ? Prisma.sql`to_jsonb(t)->>'status' IN ('DRAFT', 'SUBMITTED')`
    : tableName === 'new_product_stages'
    ? Prisma.sql`to_jsonb(t)->>'status' = 'OPEN'`
    : tableName === 'department_minister_scopes'
    ? Prisma.sql`t.status = 'ACTIVE' AND (t.valid_to IS NULL OR t.valid_to > CURRENT_TIMESTAMP)`
    : tableName === 'workflow_closure_rounds'
    ? Prisma.sql`t.status = 'PENDING'`
    : tableName === 'workflow_closure_duties'
    ? Prisma.sql`t.status IN ('PENDING', 'WAITING') AND EXISTS (
        SELECT 1 FROM workflow_closure_rounds r WHERE r.organization_id = t.organization_id AND r.id = t.round_id AND r.status = 'PENDING')`
    : tableName === 'customer_quality_physical_dispositions' || tableName === 'customer_quality_physical_analyses'
    ? Prisma.sql`t.status NOT IN ('CLOSED', 'COMPLETED') AND NOT EXISTS (
        SELECT 1 FROM ${identifier(tableName)} newer
        WHERE newer.organization_id = t.organization_id AND newer.complaint_id = t.complaint_id
          AND newer.version > t.version)`
    : Prisma.sql`CASE
        WHEN to_jsonb(t) ? 'enabled' THEN to_jsonb(t)->>'enabled' = 'true'
        WHEN to_jsonb(t) ? 'active' THEN to_jsonb(t)->>'active' = 'true'
        WHEN to_jsonb(t)->>'archived_at' IS NOT NULL THEN false
        WHEN to_jsonb(t)->>'status' IS NOT NULL THEN to_jsonb(t)->>'status' NOT IN (${Prisma.join(inactiveStatuses)})
        ELSE true END`;
}

export async function positionManagementReferences(transaction: AdminTransaction, organizationId: string, positionId: string, at = new Date()) {
  const [row] = await transaction.$queryRaw<{ referenced: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM department_management_bindings
      WHERE organization_id = ${organizationId}::uuid AND position_id = ${positionId}::uuid AND status = 'ACTIVE')
    OR EXISTS (SELECT 1 FROM department_minister_scopes s JOIN user_positions p
      ON p.organization_id = s.organization_id AND p.id = s.minister_assignment_id
      WHERE s.organization_id = ${organizationId}::uuid AND p.position_id = ${positionId}::uuid
        AND s.status = 'ACTIVE' AND (s.valid_to IS NULL OR s.valid_to > ${at})) AS referenced`;
  return row?.referenced ?? false;
}

export async function ministerAssignmentReferences(transaction: AdminTransaction, organizationId: string, assignmentIds: string[], at = new Date()) {
  if (!assignmentIds.length) return false;
  const [row] = await transaction.$queryRaw<{ referenced: boolean }[]>(Prisma.sql`
    SELECT EXISTS (SELECT 1 FROM department_minister_scopes WHERE organization_id = ${organizationId}::uuid
      AND minister_assignment_id IN (${Prisma.join(assignmentIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND status = 'ACTIVE' AND (valid_to IS NULL OR valid_to > ${at})) AS referenced`);
  return row?.referenced ?? false;
}

// A dependency projection, including migration-owned tables absent from Prisma and UUIDs without FKs.
// Only administrative reference counts leave this read model, never business rows or identifiers.
export async function structureBusinessReferences(transaction: AdminTransaction, targetId: string, kind: 'organization' | 'department') {
  const columns = await transaction.$queryRaw<ReferenceColumn[]>`
    SELECT c.relname AS "tableName", a.attname AS "columnName"
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND NOT a.attisdropped
      AND a.atttypid = 'uuid'::regtype
      AND ((${kind} = 'organization' AND a.attname ~ '(^|_)organization_id$')
        OR (${kind} = 'department' AND a.attname ~ '(^|_)department_id$'))
    ORDER BY c.relname, a.attname`;
  const references = columns.filter(({ tableName }) => kind === 'organization' ? !organizationOwned.has(tableName) : tableName !== 'positions');
  const rows = references.length ? await transaction.$queryRaw<{ tableName: string; columnName: string; count: number; liveCount: number }[]>(Prisma.sql`
    SELECT * FROM (${Prisma.join(references.map(({ tableName, columnName }) => {
      const scope = Prisma.sql`${identifier(columnName)} = ${targetId}::uuid`;
      const live = historyOnly.has(tableName)
        ? Prisma.sql`false`
        : structureReferenceLiveCondition(tableName);
      return Prisma.sql`SELECT ${tableName}::text AS "tableName", ${columnName}::text AS "columnName", count(*)::int AS count,
        count(*) FILTER (WHERE ${live})::int AS "liveCount" FROM ${identifier(tableName)} t WHERE ${scope}`;
    }), ' UNION ALL ')} ) dependencies WHERE count > 0`) : [];
  const result = { referenced: rows.some(row => row.count > 0), live: rows.some(row => row.liveCount > 0), details: rows };
  if (kind === 'department') {
    // Closure snapshots retain department provenance in JSON, outside the UUID-column projection.
    const [closure] = await transaction.$queryRaw<{ referenced: boolean; live: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM workflow_closure_rounds WHERE lower(context->>'responsibleSectionDepartmentId') = lower(${targetId}))
        OR EXISTS (SELECT 1 FROM workflow_closure_duties WHERE lower(participant->>'departmentId') = lower(${targetId})) AS referenced,
      EXISTS (SELECT 1 FROM workflow_closure_rounds WHERE lower(context->>'responsibleSectionDepartmentId') = lower(${targetId}) AND status = 'PENDING')
        OR EXISTS (SELECT 1 FROM workflow_closure_duties d JOIN workflow_closure_rounds r
          ON r.organization_id = d.organization_id AND r.id = d.round_id
          WHERE lower(d.participant->>'departmentId') = lower(${targetId}) AND d.status IN ('PENDING', 'WAITING') AND r.status = 'PENDING') AS live`;
    result.referenced ||= closure?.referenced ?? false;
    result.live ||= closure?.live ?? false;
  }
  if (kind === 'organization') {
    const [notifications] = await transaction.$queryRaw<{ liveCount: number }[]>`
      SELECT ((SELECT count(*) FROM notifications n LEFT JOIN workflow_tasks t ON t.id = n.workflow_task_id
        LEFT JOIN workflow_instances i ON i.id = t.workflow_instance_id WHERE n.organization_id = ${targetId}::uuid
        AND ((n.workflow_task_id IS NULL AND n.read_at IS NULL AND n.status IN ('PENDING', 'SENT'))
          OR t.status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') OR i.status IN ('RUNNING', 'SUSPENDED')))
      + (SELECT count(*) FROM supplier_portal_notifications n JOIN workflow_tasks t ON t.id = n.workflow_task_id
        JOIN workflow_instances i ON i.id = t.workflow_instance_id WHERE (n.owner_organization_id = ${targetId}::uuid OR n.supplier_organization_id = ${targetId}::uuid)
        AND (t.status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') OR i.status IN ('RUNNING', 'SUSPENDED'))))::int AS "liveCount"`;
    result.live ||= Boolean(notifications?.liveCount);
    if (notifications?.liveCount) result.details.push({ tableName: 'notifications', columnName: 'workflow_state', count: 0, liveCount: notifications.liveCount });
    const [outbox] = await transaction.$queryRaw<{ count: number; liveCount: number }[]>`
      SELECT count(*)::int AS count, count(*) FILTER (WHERE status <> 'PROCESSED')::int AS "liveCount"
      FROM outbox_events WHERE payload->>'organizationId' = ${targetId}
        OR payload->>'ownerOrganizationId' = ${targetId} OR payload->>'supplierOrganizationId' = ${targetId}`;
    result.referenced ||= Boolean(outbox?.count);
    result.live ||= Boolean(outbox?.liveCount);
    if (outbox?.count) result.details.push({ tableName: 'outbox_events', columnName: 'payload', ...outbox });
  }
  return result;
}
