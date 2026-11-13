import { ACTIVE_PERMISSION_CODES, INTERNAL_PLATFORM_PERMISSION_CODES, PERMISSION_CATALOG } from '../../src/modules/authorization/permission-catalog.js';
import { CONSOLE_MODULE_KEYS } from '../../src/modules/identity/dto/console-context.dto.js';

describe('new ingestion capabilities default to active platform administrators', () => {
  it('registers each ingestion operation once and includes every operation in the administrator projection', () => {
    for (const permission of ['ingestion:read', 'ingestion:manage', 'ingestion:run']) {
      expect(ACTIVE_PERMISSION_CODES.filter(code => code === permission)).toHaveLength(1);
      expect(INTERNAL_PLATFORM_PERMISSION_CODES).toContain(permission);
    }
    expect(CONSOLE_MODULE_KEYS).toContain('api-ingestion');
  });

  it('keeps all active guarded internal operations available by default except existing explicit exclusions', () => {
    const exceptions = new Set(['console:api:read', 'console:exchanges:read', 'console:services:read', 'supplier-quality:responses:read', 'supplier-quality:responses:write', 'supplier-admission:submissions:read', 'supplier-admission:submissions:write', 'supplier-performance:portal:cards:read', 'supplier-performance:portal:appeals:read', 'supplier-performance:portal:appeals:write', 'supplier-pcn:submissions:read', 'supplier-pcn:submissions:write']);
    for (const group of PERMISSION_CATALOG.filter(group => group.status === 'active')) {
      for (const module of group.modules.filter(module => module.status === 'active')) {
        for (const operation of module.operations.filter(operation => operation.enforcement === 'guarded' && !exceptions.has(operation.code))) expect(INTERNAL_PLATFORM_PERMISSION_CODES).toContain(operation.code);
      }
    }
  });
});
