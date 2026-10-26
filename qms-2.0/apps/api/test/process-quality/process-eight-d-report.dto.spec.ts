import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { validateSync } from 'class-validator';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { ProcessEightDReportQueryDto } from '../../src/modules/process-quality/process-eight-d-report.dto.js';
import { ProcessEightDReportController } from '../../src/modules/process-quality/process-eight-d-report.controller.js';

it('accepts only optional UUID scope/revision and explicit supported view values', () => {
  expect(validateSync(Object.assign(new ProcessEightDReportQueryDto(), {}))).toHaveLength(0);
  expect(validateSync(Object.assign(new ProcessEightDReportQueryDto(), { revisionId: randomUUID(), view: 'APPROVED' }))).toHaveLength(0);
  for (const value of [{ view: null }, { view: 'ANY' }, { revisionId: null }, { revisionId: 'file:///local' }, { organizationId: 'other' }]) {
    expect(validateSync(Object.assign(new ProcessEightDReportQueryDto(), value)).length).toBeGreaterThan(0);
  }
});

it('exposes distinct controlled JSON and PDF endpoints for the same problem', () => {
  expect(Reflect.getMetadata(PATH_METADATA, ProcessEightDReportController)).toBe('api/v1/process-quality/eight-d');
  expect(Reflect.getMetadata(PATH_METADATA, ProcessEightDReportController.prototype.read)).toBe(':problemId/report');
  expect(Reflect.getMetadata(PATH_METADATA, ProcessEightDReportController.prototype.pdf)).toBe(':problemId/report/pdf');
});
