import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { validateSync } from 'class-validator';
import { HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ACCESS_CONTEXT_METADATA } from '../../src/modules/authorization/access.decorator.js';
import { SupplierEightDReportQueryDto } from '../../src/modules/supplier-quality/supplier-eight-d-report.dto.js';
import { SupplierEightDReportController, SupplierPortalEightDReportController } from '../../src/modules/supplier-quality/supplier-eight-d-report.controller.js';

it('validates optional UUID scope/history and explicit report views without accepting null', () => {
  for (const query of [{}, { revisionId: randomUUID() }, { view: 'APPROVED' }, { organizationId: randomUUID(), view: 'CURRENT' }]) {
    expect(validateSync(Object.assign(new SupplierEightDReportQueryDto(), query))).toHaveLength(0);
  }
  for (const query of [{ view: null }, { view: 'ANY' }, { revisionId: null }, { revisionId: '../local' }, { organizationId: null }]) {
    expect(validateSync(Object.assign(new SupplierEightDReportQueryDto(), query)).length).toBeGreaterThan(0);
  }
});

it.each([
  [SupplierEightDReportController, 'api/v1/supplier-quality/eight-d', 'supplier-quality:issues:report'],
  [SupplierPortalEightDReportController, 'api/v1/supplier-portal/eight-d', 'supplier-quality:responses:read'],
])('exposes no-store authenticated JSON/PDF routes on %s', (controller, path, permission) => {
  expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(path);
  for (const [method, suffix] of [['read', ':id/report'], ['pdf', ':id/report/pdf']] as const) {
    const handler = controller.prototype[method];
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(suffix);
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual(expect.arrayContaining([
      { name: 'Cache-Control', value: 'no-store' }, { name: 'X-Content-Type-Options', value: 'nosniff' },
    ]));
    expect(Reflect.getMetadata(ACCESS_CONTEXT_METADATA, handler)).toMatchObject({ featurePermission: permission, organizationScope: { source: 'session' } });
  }
});
