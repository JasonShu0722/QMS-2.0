import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { INTERNAL_PLATFORM_PERMISSION_CODES, PLATFORM_ADMINISTRATOR_PERMISSION } from '../src/modules/authorization/permission-catalog.js';

type Input = { action: 'grant' | 'revoke'; userId: string; roleId: string; organizationId: string; source: 'DIRECT' | 'POSITION'; assignmentId?: string };
type Snapshot = { securityVersion: number; userActive: boolean; roleScopeValid: boolean; sourceEffective: boolean; recipientIds: string[]; markerId: string | null; markerPresent: boolean; otherMarkerRoleIds: string[]; targetOrganizations: { id: string; status: string }[]; permissionCodes: string[] };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function validate(input: Input) {
  assert(['grant', 'revoke'].includes(input.action), 'INVALID_ACTION');
  for (const id of [input.userId, input.roleId, input.organizationId]) assert(uuid.test(id), 'EXACT_IDS_REQUIRED');
  assert(['DIRECT', 'POSITION'].includes(input.source), 'EXPLICIT_SOURCE_REQUIRED');
  if (input.source === 'POSITION') assert(input.assignmentId && uuid.test(input.assignmentId), 'EXACT_ASSIGNMENT_REQUIRED');
  else assert(input.assignmentId === undefined, 'DIRECT_SOURCE_USES_COMPOSITE_IDS');
}

export function buildPlan(input: Input, snapshot: Snapshot) {
  validate(input);
  assert(snapshot.userActive, 'ACTIVE_INTERNAL_USER_REQUIRED');
  assert(snapshot.roleScopeValid, 'EXACT_INTERNAL_ROLE_SCOPE_REQUIRED');
  // Revocation may clean an expired appointment, but must still identify the real source.
  assert(snapshot.sourceEffective, 'MATCHING_SOURCE_REQUIRED');
  assert(snapshot.recipientIds.length === 1 && snapshot.recipientIds[0] === input.userId, 'DEDICATED_ROLE_REQUIRED');
  assert(snapshot.markerId, 'MARKER_MIGRATION_REQUIRED');
  assert(Number.isSafeInteger(snapshot.securityVersion) && snapshot.securityVersion > 0 && snapshot.securityVersion < 2147483647, 'INVALID_SECURITY_VERSION');
  const plan = { version: 1, ...input, expectedSecurityVersion: snapshot.securityVersion,
    scope: 'ALL_INTERNAL_ACTIVE;DISABLED_INTERNAL_ORGANIZATION_READ_MANAGE_AND_AUDIT_READ_EXPORT_ONLY',
    willChange: snapshot.markerPresent !== (input.action === 'grant'),
    ...snapshot,
  };
  return { ...plan, digest: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}

async function readPlan(client: Client, input: Input) {
  validate(input);
  const params = [input.userId, input.roleId, input.organizationId];
  const { rows: [identity] } = await client.query(`SELECT u.security_version AS "securityVersion",
    (u.status = 'ACTIVE' AND u.account_type = 'INTERNAL' AND home.status = 'ACTIVE' AND home.type = 'INTERNAL') AS "userActive",
    (r.organization_id = $3::uuid AND scope.type = 'INTERNAL' AND scope.status = 'ACTIVE') AS "roleScopeValid"
    FROM users u JOIN organizations home ON home.id = u.organization_id
    JOIN roles r ON r.id = $2::uuid JOIN organizations scope ON scope.id = $3::uuid WHERE u.id = $1::uuid`, params);
  assert(identity, 'USER_ROLE_OR_SCOPE_NOT_FOUND');
  const { rows: [source] } = input.source === 'DIRECT'
    ? await client.query('SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1::uuid AND role_id = $2::uuid AND organization_id = $3::uuid) AS valid', params)
    : await client.query(`SELECT EXISTS (SELECT 1 FROM user_positions a
      JOIN users u ON u.id = a.user_id AND u.organization_id = a.organization_id
      JOIN positions p ON p.id = a.position_id AND p.organization_id = a.organization_id
      JOIN departments d ON d.id = p.department_id AND d.organization_id = p.organization_id
      JOIN position_roles pr ON pr.position_id = p.id AND pr.organization_id = p.organization_id
      WHERE a.user_id = $1::uuid AND pr.role_id = $2::uuid AND a.organization_id = $3::uuid AND a.id = $4::uuid
      AND ($5::boolean OR (a.started_at <= statement_timestamp() AND (a.ended_at IS NULL OR a.ended_at > statement_timestamp()) AND p.status = 'ACTIVE' AND d.status = 'ACTIVE'))) AS valid`, [...params, input.assignmentId, input.action === 'revoke']);
  const { rows: recipients } = await client.query(`SELECT user_id AS id FROM user_roles WHERE role_id = $1::uuid
    UNION SELECT a.user_id AS id FROM user_positions a JOIN position_roles pr ON pr.position_id = a.position_id AND pr.organization_id = a.organization_id
    WHERE pr.role_id = $1::uuid ORDER BY id`, [input.roleId]);
  const { rows: [marker] } = await client.query(`SELECT p.id, EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id AND rp.role_id = $1::uuid) AS present FROM permissions p WHERE p.code = $2`, [input.roleId, PLATFORM_ADMINISTRATOR_PERMISSION]);
  const { rows: otherMarkers } = await client.query(`SELECT DISTINCT r.id FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE p.code = $2 AND r.id <> $3::uuid AND (EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = $1::uuid AND ur.role_id = r.id)
      OR EXISTS (SELECT 1 FROM user_positions a JOIN position_roles pr ON pr.position_id = a.position_id AND pr.organization_id = a.organization_id WHERE a.user_id = $1::uuid AND pr.role_id = r.id)) ORDER BY r.id`, [input.userId, PLATFORM_ADMINISTRATOR_PERMISSION, input.roleId]);
  const { rows: targets } = await client.query("SELECT id, status FROM organizations WHERE type = 'INTERNAL' ORDER BY id");
  const { rows: permissions } = await client.query('SELECT code FROM permissions WHERE code = ANY($1::text[]) ORDER BY code', [INTERNAL_PLATFORM_PERMISSION_CODES]);
  return buildPlan(input, { ...identity, sourceEffective: source.valid, recipientIds: recipients.map(row => row.id), markerId: marker?.id ?? null, markerPresent: marker?.present ?? false,
    otherMarkerRoleIds: otherMarkers.map(row => row.id), targetOrganizations: targets, permissionCodes: permissions.map(row => row.code) });
}

export async function previewPlatformAdministrator(client: Client, input: Input) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const plan = await readPlan(client, input);
    await client.query('COMMIT');
    return plan;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function applyPlatformAdministrator(client: Client, input: Input, expectedSecurityVersion: number, digest: string, approvalReference: string) {
  validate(input);
  assert(Number.isSafeInteger(expectedSecurityVersion) && expectedSecurityVersion > 0 && /^[a-f0-9]{64}$/.test(digest), 'PREVIEW_REQUIRED');
  assert(approvalReference.trim() && approvalReference.length <= 200, 'APPROVAL_REFERENCE_REQUIRED');
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    // Match existing security mutation barriers; role/position locks also block new FK recipients.
    await client.query('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', [input.userId]);
    await client.query('SELECT id FROM roles WHERE id = $1::uuid FOR UPDATE', [input.roleId]);
    await client.query('SELECT id FROM organizations WHERE id = $1::uuid FOR SHARE', [input.organizationId]);
    const { rows: positions } = await client.query('SELECT p.id, p.role_version AS "roleVersion" FROM positions p JOIN position_roles pr ON pr.position_id = p.id AND pr.organization_id = p.organization_id WHERE pr.role_id = $1::uuid ORDER BY p.id FOR UPDATE OF p', [input.roleId]);
    if (input.assignmentId) await client.query('SELECT id FROM user_positions WHERE id = $1::uuid FOR SHARE', [input.assignmentId]);
    const plan = await readPlan(client, input);
    assert(plan.expectedSecurityVersion === expectedSecurityVersion && plan.digest === digest, 'STALE_PREVIEW');
    if (plan.willChange) {
      assert(positions.every(position => position.roleVersion < 2147483647), 'INVALID_ROLE_VERSION');
      if (input.action === 'grant') await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1::uuid, $2::uuid)', [input.roleId, plan.markerId]);
      else await client.query('DELETE FROM role_permissions WHERE role_id = $1::uuid AND permission_id = $2::uuid', [input.roleId, plan.markerId]);
      // Version every linked position's authorization, including legacy mappings, to prevent permission ABA.
      await client.query('UPDATE positions p SET role_version = p.role_version + 1, updated_at = clock_timestamp() FROM position_roles pr WHERE pr.position_id = p.id AND pr.organization_id = p.organization_id AND pr.role_id = $1::uuid', [input.roleId]);
      const changed = await client.query('UPDATE users SET security_version = security_version + 1, updated_at = clock_timestamp() WHERE id = $1::uuid AND security_version = $2', [input.userId, expectedSecurityVersion]);
      assert(changed.rowCount === 1, 'STALE_SECURITY_VERSION');
      await client.query('UPDATE sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL', [input.userId]);
      await client.query('UPDATE password_resets SET consumed_at = clock_timestamp() WHERE user_id = $1::uuid AND consumed_at IS NULL', [input.userId]);
      await client.query(`INSERT INTO audit_events (id, organization_id, action, resource_type, resource_id, outcome, metadata, trace_id)
        VALUES ($1::uuid, $2::uuid, $3, 'Role', $4, 'SUCCESS', $5::jsonb, $6)`,
      [randomUUID(), input.organizationId, input.action === 'grant' ? 'PLATFORM_ADMINISTRATOR_GRANTED' : 'PLATFORM_ADMINISTRATOR_REVOKED', input.roleId,
        JSON.stringify({ ...input, targetUserId: input.userId, permissionCode: PLATFORM_ADMINISTRATOR_PERMISSION,
          previousResourceVersion: expectedSecurityVersion, resourceVersion: expectedSecurityVersion + 1,
          reasonCode: `EXPLICIT_${input.source}_${input.action.toUpperCase()}`, previewDigest: digest, approvalReference }), `platform-admin-cli:${randomUUID()}`]);
    }
    await client.query('COMMIT');
    return { ...plan, applied: plan.willChange, nextSecurityVersion: expectedSecurityVersion + Number(plan.willChange) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function main() {
  const strings = Object.fromEntries(['action', 'user-id', 'role-id', 'organization-id', 'source', 'assignment-id', 'expected-security-version', 'preview-sha256', 'approval-reference'].map(key => [key, { type: 'string' as const }]));
  const values = parseArgs({ options: { ...strings, apply: { type: 'boolean' } } }).values as Record<string, string | boolean | undefined>;
  const input = { action: values.action, userId: values['user-id'], roleId: values['role-id'], organizationId: values['organization-id'], source: values.source,
    ...(values['assignment-id'] ? { assignmentId: values['assignment-id'] } : {}) } as Input;
  validate(input);
  assert(process.env.DATABASE_URL, 'DATABASE_URL_REQUIRED');
  const url = new URL(process.env.DATABASE_URL);
  assert(['postgres:', 'postgresql:'].includes(url.protocol) && url.port !== '55440', 'PREVIEW_DATABASE_FORBIDDEN');
  const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'qms-platform-administrator-controlled-cli' });
  await client.connect();
  try {
    const plan = values.apply
      ? await applyPlatformAdministrator(client, input, Number(values['expected-security-version']), String(values['preview-sha256'] ?? ''), String(values['approval-reference'] ?? ''))
      : await previewPlatformAdministrator(client, input);
    console.log(JSON.stringify(plan, null, 2));
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'PLATFORM_ADMINISTRATOR_CHANGE_FAILED'); process.exitCode = 1; });
}
