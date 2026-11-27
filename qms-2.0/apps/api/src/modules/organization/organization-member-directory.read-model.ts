import { Prisma } from '../../generated/prisma/client.js';
import { AdministrativeIdentityReadModel } from '../identity/administrative-identity-read-model.js';

type MemberOption = { userId: string; assignmentId: string | null; name: string; username: string; department: string | null; jobTitle: string | null };
type AccountType = 'INTERNAL' | 'SUPPLIER';
type TeamMemberSnapshot = { id: string; userId?: string; assignmentId?: string | null; name: string; department: string; jobTitle?: string };
const identity = new AdministrativeIdentityReadModel();

function organizationMemberDirectory(organizationId: string, accountType: AccountType, filter: Prisma.Sql) {
  return Prisma.sql`
    WITH members AS (${identity.activeDirectoryUsers(organizationId, accountType)}), directory AS (
      SELECT member.id AS "userId", member.username, COALESCE(NULLIF(member.full_name, ''), member.username) AS name,
        appointment.id AS "assignmentId", appointment.department, appointment."jobTitle"
      FROM members member
      JOIN organizations org ON org.id = ${organizationId}::uuid
      LEFT JOIN LATERAL (
        SELECT assignment.id, dept.name AS department, position.name AS "jobTitle"
        FROM user_positions assignment
        JOIN positions position ON position.organization_id = assignment.organization_id AND position.id = assignment.position_id
        LEFT JOIN departments dept ON dept.organization_id = position.organization_id AND dept.id = position.department_id
        WHERE assignment.organization_id = org.id AND assignment.user_id = member.id
          AND assignment.started_at <= statement_timestamp() AND (assignment.ended_at IS NULL OR assignment.ended_at > statement_timestamp())
          AND position.status = 'ACTIVE' AND position.deleted_at IS NULL AND NOT position.configuration_required
          AND (position.department_id IS NULL OR (dept.status = 'ACTIVE' AND dept.deleted_at IS NULL AND NOT dept.configuration_required))
      ) appointment ON TRUE
      WHERE org.status = 'ACTIVE' AND org.deleted_at IS NULL AND NOT org.configuration_required
        AND (appointment.id IS NOT NULL OR (${accountType === 'SUPPLIER'} AND NOT EXISTS (
          SELECT 1 FROM user_positions assignment WHERE assignment.organization_id = org.id AND assignment.user_id = member.id
        )))
        ${filter}
    )`;
}

export async function readOrganizationMemberOptions(tx: Prisma.TransactionClient, organizationId: string,
  accountType: AccountType, query: { page: number; pageSize: number; search?: string }) {
  const search = query.search?.trim();
  const pattern = `%${search?.replace(/[\\%_]/g, '\\$&') ?? ''}%`;
  const filter = search ? Prisma.sql`AND (member.username ILIKE ${pattern} OR member.full_name ILIKE ${pattern}
    OR appointment.department ILIKE ${pattern} OR appointment."jobTitle" ILIKE ${pattern})` : Prisma.empty;
  const [result] = await tx.$queryRaw<{ items: MemberOption[]; total: number }[]>(Prisma.sql`
    ${organizationMemberDirectory(organizationId, accountType, filter)}
    SELECT (SELECT count(*)::int FROM directory) AS total,
      COALESCE((SELECT jsonb_agg(page ORDER BY page.username, page."userId", page."assignmentId")
        FROM (SELECT * FROM directory ORDER BY username, "userId", "assignmentId"
          LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}) page), '[]'::jsonb) AS items`);
  return { items: result?.items ?? [], total: result?.total ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function resolveOrganizationMemberSnapshots(tx: Prisma.TransactionClient, organizationId: string,
  accountType: AccountType, team: TeamMemberSnapshot[] = [], previousTeam: TeamMemberSnapshot[] = []) {
  const previousById = new Map(previousTeam.map(row => [row.id, row]));
  const changed = team.flatMap((row, index) => {
    const previous = previousById.get(row.id);
    const userId = row.userId?.toLowerCase();
    const assignmentId = row.assignmentId?.toLowerCase() ?? row.assignmentId;
    if (!previous || userId !== previous.userId?.toLowerCase()
      || assignmentId !== (previous.assignmentId?.toLowerCase() ?? previous.assignmentId)) return [{ row, index, userId, assignmentId }];
    Object.assign(row, { userId: previous.userId, assignmentId: previous.assignmentId, name: previous.name, department: previous.department, jobTitle: previous.jobTitle });
    return [];
  });
  const userIds = [...new Set(changed.flatMap(({ userId }) => userId ?? []))];
  const options = userIds.length ? await tx.$queryRaw<MemberOption[]>(Prisma.sql`
    ${organizationMemberDirectory(organizationId, accountType, Prisma.sql`AND member.id = ANY(${userIds}::uuid[])`)}
    SELECT * FROM directory`) : [];
  const issues: { path: string; message: string }[] = [];
  for (const { row, index, userId, assignmentId } of changed) {
    const candidates = options.filter(option => option.userId === userId);
    const option = candidates.find(candidate => candidate.assignmentId === assignmentId);
    if (!option) {
      issues.push(candidates.length
        ? { path: `team[${index}].assignmentId`, message: '请选择该系统人员的有效任职' }
        : { path: `team[${index}].userId`, message: '请选择当前组织内有效的系统人员' });
      continue;
    }
    Object.assign(row, { userId: option.userId, assignmentId: option.assignmentId, name: option.name, department: option.department ?? '', jobTitle: option.jobTitle ?? '' });
  }
  return issues;
}
