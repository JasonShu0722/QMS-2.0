import { Prisma } from '../../generated/prisma/client.js';
import { adminError, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import { featurePredicate } from '../workflow/workflow-access-policy.js';
import { organizationAdministrativeAffectedAssignments } from './organization-administrative-impact.read-model.js';

type ReferenceColumn = { tableName: string; columnName: string };
const organizationOwned = new Set(['audit_events', 'admin_mutations', 'organization_initializations', 'organization_mutation_archives', 'roles', 'user_roles', 'users', 'departments', 'positions', 'user_positions']);
const historyOnly = new Set([
  'integration_credentials', 'integration_receipts', 'integration_request_attempts', 'integration_scope_capacities',
  'user_organization_history', 'administrative_deletions', 'administrative_configuration_links',
  'admin_mutations', 'account_batches', 'export_artifacts', 'number_sequences', 'problem_saved_views',
  'mfa_challenges', 'password_change_challenges', 'announcement_recipients', 'approval_signatures', 'user_signatures',
  'audit_checklist_results', 'audit_template_versions',
  'customer_quality_complaint_events', 'customer_quality_ingestion_audits',
  'domain_source_issue_link_history', 'domain_source_issue_links', 'process_defect_ingestion_audits', 'process_defect_disposition_history',
  'process_ledger_workflow_configuration_revisions', 'process_eight_d_workflow_configuration_revisions',
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
export async function structureBusinessReferences(transaction: AdminTransaction, targetId: string, kind: 'organization' | 'department' | 'position') {
  const columns = await transaction.$queryRaw<ReferenceColumn[]>`
    SELECT c.relname AS "tableName", a.attname AS "columnName"
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND NOT a.attisdropped
      AND a.atttypid = 'uuid'::regtype
      AND ((${kind} = 'organization' AND a.attname ~ '(^|_)organization_id$')
        OR (${kind} = 'department' AND a.attname ~ '(^|_)department_id$')
        OR (${kind} = 'position' AND a.attname ~ '(^|_)position_id$'))
    ORDER BY c.relname, a.attname`;
  const references = columns.filter(({ tableName }) => kind === 'organization' ? !organizationOwned.has(tableName)
    : kind === 'department' ? tableName !== 'positions' : tableName !== 'position_roles');
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

export async function lockPositionDeletionConfiguration(tx: AdminTransaction, organizationId: string) {
  for (const name of ['process-eight-d-workflow-configuration', 'process-ledger-workflow-configuration']) {
    const [result] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`${name}:${organizationId}`}, 0)) AS locked`;
    if (!result?.locked) adminError('CONCURRENCY_CONFLICT', 409);
  }
}

export async function positionClosureStageLosses(tx: AdminTransaction, organizationId: string, positionId: string, problemId?: string) {
  const scope = problemId ? Prisma.sql`AND r.problem_id = ${problemId}::uuid` : Prisma.empty;
  const user = Prisma.sql`d.user_id`, organization = Prisma.sql`r.organization_id`;
  const processManaged = Prisma.sql`(p.domain_code = 'process-quality' AND r.context->'processManagement' IS NOT DISTINCT FROM 'true'::jsonb)`;
  const losesPermission = (code: string) => {
    const permission = Prisma.sql`${code}`;
    return Prisma.sql`(${featurePredicate(user, organization, permission)}
      AND NOT ${featurePredicate(user, organization, permission, Prisma.sql`${positionId}::uuid`)})`;
  };
  const candidates = await tx.$queryRaw<{ roundId: string; userId: string; positions: string[]; requiresDepartment: boolean; losesPermission: boolean }[]>(Prisma.sql`
    SELECT DISTINCT r.id AS "roundId", d.user_id AS "userId", (d.duty = 'PROFESSIONAL' AND NOT ${processManaged}) AS "requiresDepartment",
      ARRAY(SELECT jsonb_array_elements_text(config.positions)) AS positions,
      CASE WHEN d.status IN ('PENDING', 'WAITING') THEN
        ${losesPermission('workflow:act')} OR (${processManaged} AND ${losesPermission('process-quality:issues:read')})
        ELSE false END AS "losesPermission"
    FROM workflow_closure_rounds r
    JOIN problem_indexes p ON p.organization_id = r.organization_id AND p.id = r.problem_id
    JOIN workflow_closure_duties d ON d.organization_id = r.organization_id AND d.round_id = r.id
    LEFT JOIN LATERAL (
      SELECT stages->'CLOSURE' AS positions FROM process_eight_d_workflow_configuration_revisions
      WHERE organization_id = r.organization_id AND workflow_version_id = r.workflow_version_id
      ORDER BY version DESC LIMIT 1
    ) config ON p.domain_code = 'process-quality' AND NOT ${processManaged}
      AND d.status IN ('PENDING', 'WAITING') AND config.positions ? ${positionId}
    WHERE r.organization_id = ${organizationId}::uuid AND r.status = 'PENDING' ${scope}
      AND (p.domain_code <> 'process-quality' OR (d.duty = 'PROFESSIONAL' AND d.status <> 'APPROVED'))
      AND EXISTS (SELECT 1 FROM user_positions appointment WHERE appointment.organization_id = r.organization_id
        AND appointment.user_id = d.user_id AND appointment.position_id = ${positionId}::uuid)`);
  if (!candidates.length) return [];
  const appointments = await tx.userPosition.findMany({ where: { ...effectivePositionAssignmentWhere(), organizationId,
    userId: { in: [...new Set(candidates.map(candidate => candidate.userId))] },
    user: { organizationId, accountType: 'INTERNAL', status: 'ACTIVE', deletedAt: null, configurationRequired: false } },
  select: { userId: true, positionId: true, position: { select: { departmentId: true } } } });
  const held = new Set(appointments.map(appointment => `${appointment.userId}:${appointment.positionId}`));
  const departmentSurvivors = new Set(appointments.filter(appointment => appointment.positionId !== positionId
    && appointment.position.departmentId !== null).map(appointment => appointment.userId));
  const departmentHolders = new Set(appointments.filter(appointment => appointment.positionId === positionId
    && appointment.position.departmentId !== null).map(appointment => appointment.userId));
  return [...new Set(candidates.filter(candidate => {
    if (candidate.losesPermission) return true;
    const losesStage = candidate.positions.length > 0 && held.has(`${candidate.userId}:${positionId}`)
      && !candidate.positions.some(other => other !== positionId && held.has(`${candidate.userId}:${other}`));
    const losesProfessional = candidate.requiresDepartment && departmentHolders.has(candidate.userId) && !departmentSurvivors.has(candidate.userId);
    return losesStage || losesProfessional;
  }).map(candidate => candidate.roundId))];
}

export async function positionWorkflowReferences(tx: AdminTransaction, organizationId: string, positionId: string,
  unavailableUserIds: string[] = [], ministerScopeIds: string[] = []) {
  const lostRounds = await positionClosureStageLosses(tx, organizationId, positionId);
  const lostRoundCondition = lostRounds.length
    ? Prisma.sql`r.id IN (${Prisma.join(lostRounds.map(id => Prisma.sql`${id}::uuid`))})`
    : Prisma.sql`FALSE`;
  const matches = (part: Prisma.Sql) => Prisma.sql`(${part}->>'positionId' = ${positionId}
    OR ${part}->>'userId' = ANY(${unavailableUserIds}::text[]) OR ${part}->>'scopeId' = ANY(${ministerScopeIds}::text[]))`;
  const [responsibilities, configurations] = await Promise.all([
    tx.$queryRaw<{ source: string; id: string; version: number; snapshot: unknown }[]>(Prisma.sql`
      SELECT 'WORKFLOW_CLOSURE' AS source, r.id::text, r.version, jsonb_build_array(r.context, duties.snapshot) AS snapshot
      FROM workflow_closure_rounds r JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_array(d.id, d.version, d.participant, d.status) ORDER BY d.id) AS snapshot
        FROM workflow_closure_duties d WHERE d.organization_id = r.organization_id AND d.round_id = r.id
          AND ${matches(Prisma.sql`d.participant`)}
      ) duties ON true
      WHERE r.status = 'PENDING'
        AND (duties.snapshot IS NOT NULL OR ${lostRoundCondition} OR r.context->>'ownerUserId' = ANY(${unavailableUserIds}::text[])
          OR r.context->>'professionalUserId' = ANY(${unavailableUserIds}::text[]) OR r.created_by = ANY(${unavailableUserIds}::uuid[]))
      UNION ALL
      SELECT 'WORKFLOW_DEADLINE_EXTENSION', r.id::text, r.version, jsonb_build_array(r.context, r.participants)
      FROM workflow_deadline_extensions r WHERE r.status IN ('LEADER_PENDING', 'QUALITY_PENDING')
        AND (${matches(Prisma.sql`(r.participants->'leader')`)} OR ${matches(Prisma.sql`(r.participants->'professional')`)}
          OR r.context->>'ownerUserId' = ANY(${unavailableUserIds}::text[]) OR r.context->>'professionalUserId' = ANY(${unavailableUserIds}::text[])
          OR r.applicant_user_id = ANY(${unavailableUserIds}::uuid[]))
      UNION ALL
      SELECT 'SUPPLIER_EIGHT_D_DEADLINE', r.id::text, r.version, jsonb_build_array(r.stage, r.status, r.sqe_assignment_id, r.manager_user_id, r.applicant_user_id)
      FROM supplier_eight_d_deadline_requests r JOIN supplier_eight_d_controls c
        ON c.organization_id = r.organization_id AND c.supplier_problem_id = r.supplier_problem_id
      WHERE r.status IN ('QUALITY_PENDING', 'MANAGER_PENDING') AND (
        r.sqe_user_id = ANY(${unavailableUserIds}::uuid[]) OR r.manager_user_id = ANY(${unavailableUserIds}::uuid[])
        OR r.applicant_user_id = ANY(${unavailableUserIds}::uuid[]) OR EXISTS (
          SELECT 1 FROM (${organizationAdministrativeAffectedAssignments(organizationId, [], [positionId])}) affected
          WHERE affected.organization_id = r.organization_id AND (affected.assignment_id = r.sqe_assignment_id
            OR (affected.user_id = r.manager_user_id AND affected.section_department_id = c.responsible_section_department_id))))
      ORDER BY source, id`),
    tx.$queryRaw<{ source: string; id: string; version: number; snapshot: unknown }[]>`
      SELECT 'PROCESS_LEDGER' AS source, board.key AS id, config.version, board.value AS snapshot
      FROM (SELECT version, boards FROM process_ledger_workflow_configuration_revisions
        WHERE organization_id = ${organizationId}::uuid ORDER BY version DESC LIMIT 1) config
      CROSS JOIN LATERAL jsonb_each(config.boards) board WHERE board.value ? ${positionId}
      UNION ALL
      SELECT 'PROCESS_EIGHT_D', stage.key, config.version, stage.value
      FROM (SELECT version, stages FROM process_eight_d_workflow_configuration_revisions
        WHERE organization_id = ${organizationId}::uuid ORDER BY version DESC LIMIT 1) config
      CROSS JOIN LATERAL jsonb_each(config.stages) stage WHERE stage.value ? ${positionId}
      UNION ALL
      SELECT 'WORKFLOW_NODE', node.id::text, node.version, node.config
      FROM workflow_nodes node JOIN workflow_versions v ON v.id = node.workflow_version_id AND v.organization_id = node.organization_id
      WHERE node.organization_id = ${organizationId}::uuid AND v.status IN ('DRAFT', 'PUBLISHED')
        AND jsonb_path_exists(node.config, '$.** ? (@ == $position)', jsonb_build_object('position', ${positionId}::text))
      UNION ALL
      SELECT 'COMPONENT_PROJECT', record.id::text, record.version, jsonb_build_array(record.customer_engineer_assignment_id, record.project_engineer_assignment_id)
      FROM component_project_records record
      WHERE record.organization_id = ${organizationId}::uuid AND EXISTS (SELECT 1 FROM user_positions appointment
        WHERE appointment.organization_id = record.organization_id AND appointment.position_id = ${positionId}::uuid
          AND appointment.id IN (record.customer_engineer_assignment_id, record.project_engineer_assignment_id))
      ORDER BY source, id`,
  ]);
  return { responsibilities, configurations };
}
