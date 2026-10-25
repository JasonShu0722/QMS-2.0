import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateComponentProjectRecordDto, UpdateComponentProjectRecordDto, CreateComponentProjectMappingDto,
  UpdateComponentProjectMappingDto, ComponentProjectListQueryDto, ResolveComponentProjectQueryDto,
  ComponentProjectImportDto,
} from '../../src/modules/platform-configuration/component-project.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };
describe('component project DTO boundaries', () => {
  it('validates import structure strictly while leaving row contents to transactional validation', async () => {
    const row = { rowNumber: 1, componentCode: 123, componentName: { formula: 'A1' } };
    const valid = plainToInstance(ComponentProjectImportDto, { rows: [row] });
    expect(await validate(valid, options)).toEqual([]);
    expect(valid.rows[0]).toMatchObject(row);
    expect(await validate(plainToInstance(ComponentProjectImportDto, { rows: [{ rowNumber: 1 }] }), options)).toEqual([]);
    for (const body of [{ rows: [] }, { rows: [row, row] }, { rows: [null] }, { rows: [[row]] }, { rows: [{ ...row, rowNumber: '1' }] },
      { rows: [{ ...row, rowNumber: Number.MAX_SAFE_INTEGER + 1 }] }, { rows: [{ ...row, stage: 'NEW_PRODUCT' }] }, { rows: [row], MTRL_NAME: 'Alias' },
      { rows: Array.from({ length: 101 }, (_, index) => ({ ...row, rowNumber: index + 1 })) }]) {
      expect((await validate(plainToInstance(ComponentProjectImportDto, body), options)).length).toBeGreaterThan(0);
    }
  });
  it('accepts nullable component names without coercion and counts Unicode codepoints', async () => {
    for (const componentName of [undefined, null, ' Name ^^, (A) ', '\u{20000}'.repeat(200)]) {
      const dto = plainToInstance(UpdateComponentProjectMappingDto, { expectedVersion: 1, componentName });
      expect(await validate(dto, options)).toEqual([]);
      if (typeof componentName === 'string') expect(dto.componentName).toBe(componentName.trim());
    }
    for (const componentName of ['', ' ', 123, { formula: 'A1' }, '\u{20000}'.repeat(201)]) {
      expect((await validate(plainToInstance(UpdateComponentProjectMappingDto, { expectedVersion: 1, componentName }), options)).length).toBeGreaterThan(0);
    }
    const dto = plainToInstance(CreateComponentProjectMappingDto, { componentCode: '0001-A.0', componentName: null, projectRecordId: 'b0652f4a-a6bd-432a-87ad-d713d445c7b9', productCategory: 'Type' });
    expect(await validate(dto, options)).toEqual([]);
  });
  it('trims exact codes and requires explicit stage without coercing case or other types', async () => {
    const valid = plainToInstance(CreateComponentProjectRecordDto, { code: '  aB/12  ', name: ' Project ', stage: 'NEW_PRODUCT' });
    expect(await validate(valid, options)).toEqual([]);
    expect(valid).toMatchObject({ code: 'aB/12', name: 'Project' });
    for (const stage of [undefined, null, 'MASS', 42]) expect((await validate(plainToInstance(CreateComponentProjectRecordDto, { code: 'x', name: 'x', stage }), options)).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateComponentProjectRecordDto, { code: 42, name: 'x', stage: 'NEW_PRODUCT' }), options)).length).toBeGreaterThan(0);
  });

  it('allows omission and explicit clearing only for nullable appointment/subcategory fields', async () => {
    const project = plainToInstance(UpdateComponentProjectRecordDto, { expectedVersion: 1, customerEngineerAssignmentId: null, projectEngineerAssignmentId: null });
    expect(await validate(project, options)).toEqual([]);
    const mapping = plainToInstance(UpdateComponentProjectMappingDto, { expectedVersion: 1, productSubcategory: null });
    expect(await validate(mapping, options)).toEqual([]);
    for (const field of ['code', 'name', 'stage', 'status']) expect((await validate(plainToInstance(UpdateComponentProjectRecordDto, { expectedVersion: 1, [field]: null }), options)).length).toBeGreaterThan(0);
    for (const field of ['componentCode', 'projectRecordId', 'productCategory', 'status']) expect((await validate(plainToInstance(UpdateComponentProjectMappingDto, { expectedVersion: 1, [field]: null }), options)).length).toBeGreaterThan(0);
  });

  it('keeps mapping data separate from stage and engineer owners and bounds pagination/version', async () => {
    for (const field of ['stage', 'customerEngineerAssignmentId', 'projectEngineerAssignmentId']) {
      const dto = plainToInstance(CreateComponentProjectMappingDto, { componentCode: 'C', projectRecordId: 'b0652f4a-a6bd-432a-87ad-d713d445c7b9', productCategory: 'Type', [field]: null });
      expect((await validate(dto, options)).some(({ property }) => property === field)).toBe(true);
    }
    const query = plainToInstance(ComponentProjectListQueryDto, { page: '2', pageSize: '5' });
    expect(await validate(query, options)).toEqual([]);
    expect(query).toMatchObject({ page: 2, pageSize: 5 });
    for (const value of [0, 101, 1.5, null, 'oops']) expect((await validate(plainToInstance(ComponentProjectListQueryDto, { pageSize: value }), options)).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(UpdateComponentProjectRecordDto, { expectedVersion: 2147483648 }), options)).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(ResolveComponentProjectQueryDto, { componentCode: ' ', currentQualityEngineerSource: 'GUESS' }), options)).length).toBeGreaterThan(0);
  });
});
