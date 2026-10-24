import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as dtos from '../../src/modules/organization/organization.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };

describe('organization lifecycle DTOs', () => {
  it.each([dtos.UpdateOrganizationDto, dtos.UpdateDepartmentDto])('accepts an editable code on %p', async (Dto) => {
    expect(await validate(plainToInstance(Dto, { expectedVersion: 1, code: 'QMS-2.0_edit' }), options)).toEqual([]);
  });

  it.each([dtos.UpdateOrganizationDto, dtos.UpdateDepartmentDto])('uses creation code validation on %p', async (Dto) => {
    for (const code of ['', ' ', '-bad', 'bad/code', 'a'.repeat(65), null, 23]) {
      const errors = await validate(plainToInstance(Dto, { expectedVersion: 1, code }), options);
      expect(errors.some(({ property }) => property === 'code')).toBe(true);
    }
    expect(await validate(plainToInstance(Dto, { expectedVersion: 1 }), options)).toEqual([]);
  });

  it('exports the frozen lifecycle and deletion contracts', () => {
    const exports = dtos as unknown as Record<string, unknown>;
    expect(exports.OrganizationLifecycleDto).toEqual(expect.any(Function));
    expect(exports.DeleteStructureDto).toEqual(expect.any(Function));
    expect(exports.DeleteStructureResultDto).toEqual(expect.any(Function));
  });
});
