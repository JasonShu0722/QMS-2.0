import 'reflect-metadata';
import { AuditManagementController } from '../../src/modules/audit-management/audit-management.controller.js';

it('publishes the formal problem response for an issued audit import row', () => {
  const response = Reflect.getMetadata('swagger/apiResponse', AuditManagementController.prototype.issueImport)?.[201];
  expect(response?.type?.name).toBe('AuditImportIssueResultDto');
});
