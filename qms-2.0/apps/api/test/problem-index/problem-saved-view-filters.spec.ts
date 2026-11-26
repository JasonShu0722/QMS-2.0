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

it('accepts process conditions with mixed field operators in a personal saved view', () => {
  expect(errors({ search: '划伤', processFollowupFilters: { logic: 'ANY', items: [
    { field: 'stage', operator: 'NE', value: 'ANALYSIS' },
    { field: 'ownerName', operator: 'CONTAINS', value: '质量' },
    { field: 'dueAt', operator: 'EMPTY' },
  ] } })).toEqual([]);
});

it.each([
  { field: 'search', operator: 'CONTAINS', value: '划伤' },
  { field: 'stage', operator: 'CONTAINS', value: 'ANALYSIS' },
  { field: 'status', operator: 'EQ', value: 'made-up' },
  { field: 'dueAt', operator: 'GTE', value: '2026-11-01' },
  { field: 'dueAt', operator: 'EMPTY', value: null },
  { field: 'ownerName', operator: 'EQ', value: '  ' },
  { field: 'ownerName', operator: 'EQ', value: 'Name', extra: 'unexpected' },
])('rejects an invalid saved condition %#', item => {
  expect(errors({ processFollowupFilters: { logic: 'ALL', items: [item] } }).map(error => error.property)).toContain('filters');
});
