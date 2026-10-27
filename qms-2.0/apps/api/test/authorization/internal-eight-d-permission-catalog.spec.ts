import { readFileSync } from 'node:fs';
import { ACTIVE_PERMISSION_CODES, ADMIN_PERMISSIONS, PERMISSION_CATALOG } from '../../src/modules/authorization/permission-catalog.js';

describe('customer and new-product internal 8D permissions and storage', () => {
  const actions = ['read', 'report', 'issue', 'work', 'sources', 'risk', 'reassign', 'deadlines'];
  it.each(['customer', 'new-product'])('registers guarded %s actions without assigning them to ordinary administrators', domain => {
    const codes = actions.map(action => `${domain}-quality:issues:${action}`);
    for (const code of codes) {
      expect(ACTIVE_PERMISSION_CODES.filter(entry => entry === code)).toHaveLength(1);
      expect(ADMIN_PERMISSIONS).not.toContain(code);
    }
    const module = PERMISSION_CATALOG.flatMap(group => group.modules).find(entry => entry.key === `${domain}-issues`);
    expect(module?.status).toBe('active');
    expect(module?.operations.map(entry => entry.code)).toEqual(codes);
    expect(module?.operations.every(entry => entry.enforcement === 'guarded')).toBe(true);
  });

  it('adds independent immutable storage, receipts and notices without automatic grants or activations', () => {
    const sql = readFileSync(new URL('../../prisma/migrations/20261027120000_internal_eight_d_domains/migration.sql', import.meta.url), 'utf8');
    for (const prefix of ['customer_eight_d', 'new_product_eight_d']) {
      for (const table of ['reports', 'bindings', 'collaborators', 'revisions', 'receipts', 'source_confirmations', 'reminder_slots', 'notifications']) {
        expect(sql).toContain(`CREATE TABLE ${prefix}_${table}`);
      }
      expect(sql).toContain(`CREATE TRIGGER ${prefix}_revision_immutable`);
      expect(sql).toContain(`CREATE TRIGGER ${prefix}_confirmation_immutable`);
      expect(sql).toContain(`ALTER TABLE ${prefix}_receipts ADD CONSTRAINT`);
    }
    expect(sql).toContain('REFERENCES customer_quality_complaints(id)');
    expect(sql).toContain('REFERENCES new_product_defect_selections(id)');
    expect(sql).not.toMatch(/INSERT INTO (role_permissions|user_roles|user_positions|.*_bindings)/i);
    for (const domain of ['customer', 'new-product']) for (const action of actions) {
      expect(sql).toContain(`'${domain}-quality:issues:${action}'`);
    }
  });
});
