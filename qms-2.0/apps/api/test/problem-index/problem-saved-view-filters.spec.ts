import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProblemSavedViewConfigurationDto } from '../../src/modules/problem-index/problem-saved-view.dto.js';

const sectionId = '4dc6ae27-22f6-4f9a-99a8-f806fdbbecc4';
const errors = (filters: object, columns = ['reportNumber', 'processStage']) => validateSync(plainToInstance(ProblemSavedViewConfigurationDto, {
  schemaVersion: 1, filters, sort: { sortBy: 'dueAt', sortDirection: 'asc' }, visibleColumns: columns, columnOrder: columns,
}), { whitelist: true, forbidNonWhitelisted: true });

it('preserves process follow-up stage, section and columns in a saved view', () => {
  expect(errors({ stage: 'ANALYSIS', responsibleSectionDepartmentId: sectionId })).toEqual([]);
});

it('rejects unsupported stage and section filter values', () => {
  expect(errors({ stage: 'arbitrary', responsibleSectionDepartmentId: 'invalid' }).map(error => error.property)).toContain('filters');
});
