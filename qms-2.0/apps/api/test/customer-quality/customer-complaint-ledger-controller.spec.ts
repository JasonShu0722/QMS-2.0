import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ACCESS_CONTEXT_METADATA } from '../../src/modules/authorization/access.decorator.js';
import { CustomerComplaintLedgerController } from '../../src/modules/customer-quality/customer-complaint-ledger.controller.js';

it('publishes a separate ledger route with authorized list/detail/import/receiving/lifecycle actions', () => {
  expect(Reflect.getMetadata(PATH_METADATA, CustomerComplaintLedgerController)).toBe('api/v1/customer-quality/ledger');
  const endpoints = [
    ['list', '/', RequestMethod.GET], ['detail', ':id', RequestMethod.GET], ['candidates', 'candidates', RequestMethod.GET],
    ['create', '/', RequestMethod.POST], ['update', ':id', RequestMethod.PUT], ['preview', 'import/preview', RequestMethod.POST],
    ['commit', 'import/commit', RequestMethod.POST], ['receiving', ':id/receiving', RequestMethod.PUT],
    ['close', ':id/close', RequestMethod.POST], ['reopen', ':id/reopen', RequestMethod.POST],
    ['attachments', ':id/attachments', RequestMethod.GET],
  ] as const;
  for (const [name, path, method] of endpoints) {
    const handler = CustomerComplaintLedgerController.prototype[name];
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(ACCESS_CONTEXT_METADATA, handler)?.featurePermission).toMatch(/^customer-quality:complaints:/);
  }
});
