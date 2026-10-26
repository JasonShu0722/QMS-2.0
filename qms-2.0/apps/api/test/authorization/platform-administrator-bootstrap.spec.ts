import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

const ids = { userId: randomUUID(), roleId: randomUUID(), organizationId: randomUUID() };
const input = { ...ids, action: 'grant' as const, source: 'DIRECT' as const };
const snapshot = () => ({ securityVersion: 7, userActive: true, roleScopeValid: true, sourceEffective: true, recipientIds: [ids.userId], markerId: randomUUID(), markerPresent: false, otherMarkerRoleIds: [], targetOrganizations: [{ id: ids.organizationId, status: 'ACTIVE' }], permissionCodes: ['organization:read', 'workflow:act'] });
async function api() {
  return await import('../../scripts/platform-administrator.js').catch(() => ({})) as {
    buildPlan?: (input: object, snapshot: object) => { digest: string; expectedSecurityVersion: number; willChange: boolean; scope: string };
    applyPlatformAdministrator?: (client: Client, input: object, version: number, digest: string, approval: string) => Promise<unknown>;
  };
}

describe('server-only platform administrator bootstrap', () => {
  it('builds an exact-ID preview bound to the actual user version, source, target set and registered permissions', async () => {
    const { buildPlan } = await api();
    expect(typeof buildPlan).toBe('function');
    const current = snapshot();
    const plan = buildPlan!(input, current);
    expect(plan).toMatchObject({ expectedSecurityVersion: 7, willChange: true, scope: 'ALL_INTERNAL_ACTIVE;DISABLED_INTERNAL_ORGANIZATION_READ_MANAGE_AND_AUDIT_READ_EXPORT_ONLY' });
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(buildPlan!(input, { ...current, securityVersion: 8 }).digest).not.toBe(plan.digest);
    expect(buildPlan!({ ...input, roleId: randomUUID() }, current).digest).not.toBe(plan.digest);
    expect(buildPlan!(input, { ...current, permissionCodes: ['organization:read'] }).digest).not.toBe(plan.digest);
  });

  it('rejects usernames, inactive users, a global/wrong-scope role, ineffective source, missing marker registration and shared recipients', async () => {
    const { buildPlan } = await api();
    expect(typeof buildPlan).toBe('function');
    expect(() => buildPlan!({ ...input, userId: 'admin' }, snapshot())).toThrow();
    for (const change of [{ userActive: false }, { roleScopeValid: false }, { sourceEffective: false }, { markerId: null }, { recipientIds: [ids.userId, randomUUID()] }]) {
      expect(() => buildPlan!(input, { ...snapshot(), ...change })).toThrow();
    }
    expect(() => buildPlan!({ ...input, source: 'POSITION' }, snapshot())).toThrow();
  });

  it('does not perform any query without a matching version, preview digest and explicit approval reference', async () => {
    const { applyPlatformAdministrator } = await api();
    expect(typeof applyPlatformAdministrator).toBe('function');
    const client = { query: async () => { throw new Error('UNEXPECTED_DATABASE_ACCESS'); } } as unknown as Client;
    await expect(applyPlatformAdministrator!(client, input, 7, 'bad-digest', 'approval')).rejects.toThrow('PREVIEW_REQUIRED');
    await expect(applyPlatformAdministrator!(client, input, 7, 'a'.repeat(64), '')).rejects.toThrow('APPROVAL_REFERENCE_REQUIRED');
  });
});
