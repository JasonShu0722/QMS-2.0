import type { Prisma } from '../../generated/prisma/client.js';

export async function hasCurrentAdministrativeUserReferences(tx: Prisma.TransactionClient, userId: string) {
  const [result] = await tx.$queryRaw<{ referenced: boolean }[]>`
    WITH target AS (SELECT ${userId}::uuid AS id), appointments AS (
      SELECT appointment.id FROM user_positions appointment JOIN target ON target.id = appointment.user_id
    ), open_problems AS (
      SELECT id, organization_id, owner_id FROM problem_indexes
      WHERE archived_at IS NULL AND closed_at IS NULL AND status IN ('OPEN', 'IN_PROGRESS', 'PENDING')
    )
    SELECT EXISTS (
      SELECT 1 FROM component_project_records project JOIN appointments appointment
        ON appointment.id IN (project.customer_engineer_assignment_id, project.project_engineer_assignment_id)
      UNION ALL
      SELECT 1 FROM department_responsible_appointments responsibility JOIN appointments appointment
        ON appointment.id = ANY(responsibility.assignment_ids) OR appointment.id = responsibility.primary_assignment_id
      JOIN departments department ON department.id = responsibility.department_id AND department.status = 'ACTIVE'
      UNION ALL
      SELECT 1 FROM department_minister_scopes scope JOIN appointments appointment ON appointment.id = scope.minister_assignment_id
        WHERE scope.status = 'ACTIVE' AND (scope.valid_to IS NULL OR scope.valid_to > CURRENT_TIMESTAMP)
      UNION ALL
      SELECT 1 FROM open_problems problem JOIN target ON target.id = problem.owner_id
      UNION ALL
      SELECT 1 FROM workflow_tasks task JOIN target ON target.id IN (task.assignee_user_id, task.claimed_by_user_id)
        JOIN workflow_instances instance ON instance.id = task.workflow_instance_id
        WHERE task.status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') AND instance.status IN ('RUNNING', 'SUSPENDED')
      UNION ALL
      SELECT 1 FROM workflow_closure_rounds round CROSS JOIN target WHERE round.status = 'PENDING' AND (
        round.created_by = target.id OR target.id::text IN (round.context->>'ownerUserId', round.context->>'professionalUserId')
        OR EXISTS (SELECT 1 FROM workflow_closure_duties duty WHERE duty.round_id = round.id AND duty.organization_id = round.organization_id
          AND (duty.user_id = target.id OR duty.participant->>'userId' = target.id::text)))
      UNION ALL
      SELECT 1 FROM workflow_deadline_extensions request CROSS JOIN target WHERE request.status IN ('LEADER_PENDING', 'QUALITY_PENDING') AND (
        request.applicant_user_id = target.id OR target.id::text IN (request.context->>'ownerUserId', request.context->>'professionalUserId',
          request.participants->'leader'->>'userId', request.participants->'professional'->>'userId'))
      UNION ALL
      SELECT 1 FROM workflow_nodes node JOIN workflow_versions version ON version.id = node.workflow_version_id
        CROSS JOIN target WHERE version.status IN ('DRAFT', 'PUBLISHED')
        AND EXISTS (SELECT 1 FROM jsonb_path_query(node.config, 'strict $.**.assigneeUserId') AS assignee(value)
          WHERE lower(assignee.value #>> '{}') = target.id::text)
      UNION ALL
      SELECT 1 FROM supplier_eight_d_deadline_requests request JOIN target ON target.id IN (request.applicant_user_id, request.sqe_user_id, request.manager_user_id)
        WHERE request.status IN ('QUALITY_PENDING', 'MANAGER_PENDING')
      UNION ALL
      SELECT 1 FROM supplier_eight_d_controls control JOIN target ON target.id = control.sqe_user_id
        JOIN open_problems problem ON problem.id = control.problem_index_id AND problem.organization_id = control.organization_id
      UNION ALL
      SELECT 1 FROM customer_quality_complaints complaint JOIN target ON target.id IN (complaint.owner_user_id, complaint.quality_engineer_id)
        WHERE complaint.archived_at IS NULL AND complaint.closed_at IS NULL AND complaint.status NOT IN ('CLOSED', 'RESOLVED', 'REJECTED')
      UNION ALL
      SELECT 1 FROM customer_complaint_analyses analysis JOIN target ON target.id = analysis.assignee_user_id
        JOIN customer_quality_complaints complaint ON complaint.id = analysis.complaint_id AND complaint.organization_id = analysis.organization_id
        WHERE complaint.archived_at IS NULL AND complaint.closed_at IS NULL AND complaint.status NOT IN ('CLOSED', 'RESOLVED', 'REJECTED')
      UNION ALL
      SELECT 1 FROM new_product_issues issue JOIN target ON target.id = issue.owner_user_id
        WHERE issue.closed_at IS NULL AND issue.status NOT IN ('CLOSED', 'CANCELLED')
      UNION ALL
      SELECT 1 FROM audit_ncs finding JOIN target ON target.id = finding.assignee_user_id WHERE finding.status <> 'CLOSED'
      UNION ALL
      SELECT 1 FROM supplier_meeting_actions action JOIN target ON target.id = action.assignee_user_id
        WHERE action.status NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')
      UNION ALL
      SELECT 1 FROM process_defect_material_items material JOIN target ON target.id = material.sqe_user_id
        WHERE material.removed_at IS NULL AND material.verified_at IS NULL
      UNION ALL
      SELECT 1 FROM (
        SELECT organization_id, problem_id, professional_user_id AS user_id FROM process_eight_d_reports UNION ALL
        SELECT organization_id, problem_id, professional_user_id FROM customer_eight_d_reports UNION ALL
        SELECT organization_id, problem_id, professional_user_id FROM new_product_eight_d_reports UNION ALL
        SELECT organization_id, problem_id, user_id FROM process_eight_d_collaborators UNION ALL
        SELECT organization_id, problem_id, user_id FROM customer_eight_d_collaborators UNION ALL
        SELECT organization_id, problem_id, user_id FROM new_product_eight_d_collaborators
      ) involvement JOIN open_problems problem ON problem.id = involvement.problem_id AND problem.organization_id = involvement.organization_id
        JOIN target ON target.id = involvement.user_id
    ) AS referenced`;
  return result?.referenced ?? true;
}
