import { Injectable, Module } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { adminError, type AdminTransaction } from '../../common/security/admin-mutation.service.js';

const roleSelect = { id: true, organizationId: true, code: true, name: true, mfaRequired: true, archivedAt: true,
  permissions: { select: { permission: { select: { id: true, code: true } } }, orderBy: { permission: { code: 'asc' as const } } } } as const;

export type LegacyAuthorizationHistoryFilter = { organizationId: string; roleId?: string; userId?: string; positionId?: string };

function historyWhere(filter: LegacyAuthorizationHistoryFilter) {
  const userId = filter.userId?.toLowerCase();
  const positionId = filter.positionId?.toLowerCase();
  return Prisma.sql`organization_id = ${filter.organizationId}::uuid
    ${filter.roleId ? Prisma.sql`AND role_id = ${filter.roleId}::uuid` : Prisma.empty}
    ${userId ? Prisma.sql`AND (snapshot->'preview'->'affectedUsers' @> ${JSON.stringify([{ userId }])}::jsonb
      OR snapshot->'preview'->'directSources' @> ${JSON.stringify([{ userId, selected: true }])}::jsonb
      OR snapshot->'preview'->'mappedSources' @> ${JSON.stringify([{ selected: true, assignments: [{ userId }] }])}::jsonb)` : Prisma.empty}
    ${positionId ? Prisma.sql`AND (snapshot->'preview'->'target'->>'positionId' = ${positionId}
      OR snapshot->'preview'->'mappedSources' @> ${JSON.stringify([{ positionId, selected: true }])}::jsonb)` : Prisma.empty}`;
}

// Transaction ownership, actor authorization and source selection belong to the organization command.
@Injectable()
export class LegacyAuthorizationOwnerService {
  async historyScopes(tx: AdminTransaction, filter: LegacyAuthorizationHistoryFilter) {
    return tx.$queryRaw<{ organizationId: string }[]>(Prisma.sql`SELECT DISTINCT value #>> '{}' AS "organizationId"
      FROM legacy_authorization_archives, LATERAL jsonb_array_elements(jsonb_path_query_array(snapshot, '$.**.organizationId')
        || jsonb_path_query_array(snapshot, '$.preview.labels.organizations[*].id')) AS value
      WHERE ${historyWhere(filter)} AND jsonb_typeof(value) = 'string' ORDER BY "organizationId"`);
  }

  async history(tx: AdminTransaction, filter: LegacyAuthorizationHistoryFilter, page: { pageSize: number; offset: number }) {
    const [items, totals] = await Promise.all([
      tx.$queryRaw<{ id: string; organizationId: string; roleId: string; actorUserId: string; operation: string; createdAt: Date; snapshot: Prisma.JsonValue }[]>(Prisma.sql`SELECT id, organization_id AS "organizationId", role_id AS "roleId", actor_user_id AS "actorUserId", operation, created_at AS "createdAt", snapshot
        FROM legacy_authorization_archives WHERE ${historyWhere(filter)} ORDER BY created_at DESC, id ASC LIMIT ${page.pageSize} OFFSET ${page.offset}`),
      tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) FROM legacy_authorization_archives WHERE ${historyWhere(filter)}`),
    ]);
    return { items, total: Number(totals[0]!.count), ...page };
  }

  sourceQuery(query: { userId?: string; positionId?: string }, memberships: Prisma.Sql, positions: Prisma.Sql, userAvailable: boolean) {
    const definition = Prisma.sql`jsonb_build_object('id', r.id, 'organizationId', r.organization_id, 'code', r.code, 'name', r.name,
      'mfaRequired', r.mfa_required, 'permissionCodes', COALESCE((SELECT jsonb_agg(p.code ORDER BY p.code) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id), '[]'::jsonb),
      'platformMarker', EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code = 'platform:admin'))`;
    return Prisma.sql`WITH appointments AS (${memberships}), position_projection AS (${positions}), sources AS (
      SELECT d.organization_id AS "organizationId", d.user_id AS "userId", NULL::uuid AS "positionId", NULL::uuid AS "assignmentId", NULL::timestamptz AS "startedAt", NULL::timestamptz AS "endedAt",
        CASE WHEN EXISTS(SELECT 1 FROM organization_initializations i WHERE i.role_id = d.role_id AND i.grant_user_id = d.user_id AND i.grant_role_id = d.role_id AND i.grant_organization_id = d.organization_id) THEN 'SYSTEM_INITIALIZATION' ELSE 'LEGACY_DIRECT' END AS kind,
        CASE WHEN r.archived_at IS NOT NULL OR NOT ${userAvailable} THEN 'UNAVAILABLE' ELSE 'CURRENT' END AS "temporalState", ${definition} AS role,
        NULL::text AS username, NULL::text AS "fullName", NULL::uuid AS "userOrganizationId", NULL::text AS "userStatus", NULL::boolean AS "userAvailable", NULL::jsonb AS position
      FROM user_roles d JOIN roles r ON r.id = d.role_id WHERE ${query.userId ? Prisma.sql`d.user_id = ${query.userId}::uuid` : Prisma.sql`FALSE`}
      UNION ALL
      SELECT m.organization_id, a.user_id, m.position_id, a.id, a.started_at, a.ended_at,
        CASE WHEN m.is_canonical THEN 'POSITION_CANONICAL' ELSE 'LEGACY_MAPPING' END,
        CASE WHEN a.ended_at <= CURRENT_TIMESTAMP THEN 'ENDED' WHEN a.started_at > CURRENT_TIMESTAMP THEN 'FUTURE'
          WHEN r.archived_at IS NOT NULL OR NOT p.available OR (a.id IS NOT NULL AND NOT a.user_available) THEN 'UNAVAILABLE' ELSE 'CURRENT' END,
        ${definition}, a.username, a.full_name, a.user_organization_id, a.user_status, a.user_available, p.label
      FROM position_roles m JOIN roles r ON r.id = m.role_id JOIN position_projection p ON p.id = m.position_id AND p.organization_id = m.organization_id
      LEFT JOIN appointments a ON a.position_id = m.position_id AND a.organization_id = m.organization_id
      WHERE ${query.positionId ? Prisma.sql`m.position_id = ${query.positionId}::uuid` : Prisma.sql`a.user_id = ${query.userId}::uuid`}
    )`;
  }

  async sourceScopes(tx: AdminTransaction, query: Prisma.Sql) {
    return tx.$queryRaw<{ organizationId: string }[]>(Prisma.sql`${query} SELECT DISTINCT value AS "organizationId" FROM sources,
      LATERAL (VALUES ("organizationId"::text), (role->>'organizationId'), ("userOrganizationId"::text)) AS scopes(value) WHERE value IS NOT NULL ORDER BY value`);
  }

  async sources(tx: AdminTransaction, query: Prisma.Sql, page: { pageSize: number; offset: number }) {
    const [items, totals] = await Promise.all([
      tx.$queryRaw<{ organizationId: string; userId: string | null; positionId: string | null; assignmentId: string | null; startedAt: Date | null; endedAt: Date | null; kind: string; temporalState: string; role: unknown; username: string | null; fullName: string | null; userOrganizationId: string | null; userStatus: string | null; userAvailable: boolean | null; position: unknown }[]>(Prisma.sql`${query} SELECT * FROM sources ORDER BY "organizationId", kind, role->>'id', "positionId" NULLS FIRST, "assignmentId" NULLS FIRST LIMIT ${page.pageSize} OFFSET ${page.offset}`),
      tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`${query} SELECT count(*) FROM sources`),
    ]);
    return { items, total: Number(totals[0]!.count), ...page };
  }

  async replayRequirements(tx: AdminTransaction, input: { organizationId: string; actorUserId: string; roleId: string; operation: 'MIGRATE' | 'REMOVE'; authorizationBaseline: string; key: string }) {
    const receipt = await tx.adminMutation.findUnique({ where: { actorUserId_organizationId_key: { actorUserId: input.actorUserId, organizationId: input.organizationId, key: input.key } }, select: { action: true } });
    if (!receipt || receipt.action !== 'LEGACY_AUTHORIZATION_COMMITTED') return undefined;
    const facts = await tx.legacyAuthorizationArchive.findMany({ where: { organizationId: input.organizationId, actorUserId: input.actorUserId, roleId: input.roleId, operation: input.operation,
      snapshot: { path: ['preview', 'authorizationBaseline'], equals: input.authorizationBaseline } }, select: { snapshot: true }, take: 2 });
    if (facts.length !== 1) adminError('CONCURRENCY_CONFLICT', 409);
    const object = (value: Prisma.JsonValue | undefined): Prisma.JsonObject => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) adminError('CONCURRENCY_CONFLICT', 409);
      return value;
    };
    const strings = (value: Prisma.JsonValue | undefined): string[] => {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) adminError('CONCURRENCY_CONFLICT', 409);
      return value as string[];
    };
    const rows = (value: Prisma.JsonValue | undefined) => {
      if (!Array.isArray(value)) adminError('CONCURRENCY_CONFLICT', 409);
      return value.map(object);
    };
    const fact = object(facts[0]!.snapshot);
    const preview = object(fact.preview);
    const role = object(preview.role);
    if (fact.actorId !== input.actorUserId || fact.scopeOrganizationId !== input.organizationId || role.id !== input.roleId || typeof role.platformMarker !== 'boolean') adminError('CONCURRENCY_CONFLICT', 409);
    const target = preview.target === null ? undefined : object(preview.target);
    if ((input.operation === 'MIGRATE') !== !!target) adminError('CONCURRENCY_CONFLICT', 409);
    const permissions = [...new Set([...strings(role.permissionCodes), ...(target ? strings(target.permissionCodes) : [])])].sort();
    const scopes = [...new Set([input.organizationId, ...rows(preview.directSources).map(row => row.organizationId), ...rows(preview.mappedSources).map(row => row.organizationId), ...rows(preview.affectedUsers).map(row => row.organizationId)])];
    if (scopes.some(scope => typeof scope !== 'string')) adminError('CONCURRENCY_CONFLICT', 409);
    return { permissionCodes: permissions, platformMarker: role.platformMarker || permissions.includes('platform:admin'), organizationIds: scopes as string[] };
  }

  async list(tx: AdminTransaction, organizationId: string) {
    const roles = await tx.role.findMany({ where: { archivedAt: null, OR: [{ organizationId }, { organizationId: null, userRoles: { some: { organizationId } } }], positions: { none: { isCanonical: true } } }, select: roleSelect, orderBy: { id: 'asc' } });
    return roles.map(role => this.project(role));
  }

  async snapshot(tx: AdminTransaction, organizationId: string, roleId: string) {
    const role = await tx.role.findFirst({ where: { id: roleId, archivedAt: null, OR: [{ organizationId }, { organizationId: null }] }, select: roleSelect });
    if (!role) adminError('ADMIN_ROLE_NOT_FOUND', 404);
    const direct = await tx.userRole.findMany({ where: { roleId }, orderBy: [{ organizationId: 'asc' }, { userId: 'asc' }] });
    const mappings = await tx.positionRole.findMany({ where: { roleId }, orderBy: [{ organizationId: 'asc' }, { positionId: 'asc' }] });
    if (role.organizationId === null && !direct.some(source => source.organizationId === organizationId)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const initialization = await tx.$queryRaw<{ organizationId: string; userId: string; roleId: string }[]>`SELECT grant_organization_id AS "organizationId", grant_user_id AS "userId", grant_role_id AS "roleId" FROM organization_initializations WHERE role_id = ${roleId}::uuid`;
    return { role: this.project(role), direct, mappings, initialization };
  }

  async roles(tx: AdminTransaction, roleIds: string[]) {
    return (await tx.role.findMany({ where: { id: { in: roleIds }, archivedAt: null }, select: roleSelect, orderBy: { id: 'asc' } })).map(role => this.project(role));
  }

  async scopedCodeExists(tx: AdminTransaction, organizationId: string, code: string) {
    return !!await tx.role.findFirst({ where: { organizationId, code }, select: { id: true } });
  }

  async lock(tx: AdminTransaction, roleIds: string[]) {
    if (roleIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM roles WHERE id IN (${Prisma.join([...new Set(roleIds)].sort().map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
  }

  private project(role: Prisma.RoleGetPayload<{ select: typeof roleSelect }>) {
    return { id: role.id, organizationId: role.organizationId, code: role.code, name: role.name, mfaRequired: role.mfaRequired,
      permissionCodes: role.permissions.map(({ permission }) => permission.code), platformMarker: role.permissions.some(({ permission }) => permission.code === 'platform:admin') };
  }

  async apply(tx: AdminTransaction, input: { organizationId: string; roleId: string; directUserIds: string[]; sourcePositionIds: string[]; targetPositionId?: string;
    strategy: string; canonicalId?: string; targetName?: string; permissionCodes: string[]; mfaRequired: boolean; stableRoleCode?: string }) {
    const { organizationId, roleId, targetPositionId } = input;
    await tx.userRole.deleteMany({ where: { organizationId, roleId, userId: { in: input.directUserIds } } });
    await tx.positionRole.deleteMany({ where: { organizationId, roleId, positionId: { in: input.sourcePositionIds } } });
    if (!targetPositionId) return;
    if (input.strategy === 'ADOPT') {
      await tx.role.update({ where: { id: roleId }, data: { organizationId } });
      await tx.positionRole.create({ data: { organizationId, positionId: targetPositionId, roleId, isCanonical: true } });
      return;
    }
    const hex = createHash('sha256').update(`legacy-canonical:${targetPositionId}`).digest('hex');
    const nextId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const canonicalId = input.canonicalId ?? (await tx.role.create({ data: { id: nextId, organizationId, code: input.strategy === 'INDEPENDENT_CANONICAL' ? input.stableRoleCode! : `POS_${nextId}`, name: [...input.targetName!].slice(0, 150).join(''), mfaRequired: input.mfaRequired } })).id;
    if (!input.canonicalId) await tx.positionRole.create({ data: { organizationId, positionId: targetPositionId, roleId: canonicalId, isCanonical: true } });
    const permissions = await tx.permission.findMany({ where: { code: { in: input.permissionCodes } }, select: { id: true } });
    await tx.rolePermission.deleteMany({ where: { roleId: canonicalId } });
    if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: canonicalId, permissionId: permission.id })) });
    await tx.role.update({ where: { id: canonicalId }, data: { mfaRequired: input.mfaRequired } });
    if (input.strategy === 'MERGE_WITH_QUALIFICATION') await tx.positionRole.upsert({ where: { organizationId_positionId_roleId: { organizationId, positionId: targetPositionId, roleId } }, create: { organizationId, positionId: targetPositionId, roleId, isCanonical: false }, update: {} });
  }

  async archive(tx: AdminTransaction, input: { organizationId: string; roleId: string; actorUserId: string; operation: 'MIGRATE' | 'REMOVE'; snapshot: Prisma.InputJsonValue; canDelete: boolean }) {
    await tx.legacyAuthorizationArchive.create({ data: { organizationId: input.organizationId, roleId: input.roleId, actorUserId: input.actorUserId, operation: input.operation, snapshot: input.snapshot } });
    const remains = await tx.userRole.count({ where: { roleId: input.roleId } }) + await tx.positionRole.count({ where: { roleId: input.roleId } });
    if (remains) return { archived: false, deleted: false };
    if (input.canDelete) { await tx.role.delete({ where: { id: input.roleId } }); return { archived: false, deleted: true }; }
    await tx.role.update({ where: { id: input.roleId }, data: { archivedAt: new Date() } });
    return { archived: true, deleted: false };
  }
}

@Module({ providers: [LegacyAuthorizationOwnerService], exports: [LegacyAuthorizationOwnerService] })
export class LegacyAuthorizationOwnerModule {}
