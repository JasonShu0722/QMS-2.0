import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as dto from '../../src/modules/organization/organization-responsibility.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };
const errors = (Type: new () => object, body: object) => validate(plainToInstance(Type, body), options);

describe('organization responsibility DTO boundary', () => {
  it('accepts only the two fixed responsibility codes, never display names', async () => {
    for (const responsibility of ['SECTION_MANAGER', 'MINISTER']) {
      expect(await errors(dto.CreateManagementBindingDto, { departmentId: randomUUID(), positionId: randomUUID(), responsibility })).toEqual([]);
    }
    for (const responsibility of ['manager', '部长', null, 'ADMIN']) {
      expect(await errors(dto.CreateManagementBindingDto, { departmentId: randomUUID(), positionId: randomUUID(), responsibility })).not.toEqual([]);
    }
  });

  it('requires a positive bounded CAS version and distinguishes omitted updates from null', async () => {
    for (const Type of [dto.UpdateManagementBindingDto, dto.UpdateMinisterScopeDto]) {
      expect(await errors(Type, { expectedVersion: 1 })).toEqual([]);
      for (const expectedVersion of [undefined, null, 0, -1, 1.5, 2147483648]) {
        expect(await errors(Type, { expectedVersion })).not.toEqual([]);
      }
      expect(await errors(Type, { expectedVersion: 1, status: null })).not.toEqual([]);
      expect(await errors(Type, { expectedVersion: 1, status: 'DISABLED' })).toEqual([]);
    }
    expect(await errors(dto.UpdateManagementBindingDto, { expectedVersion: 1, positionId: null })).not.toEqual([]);
    expect(await errors(dto.UpdateManagementBindingDto, { expectedVersion: 1, responsibility: 'MINISTER' })).not.toEqual([]);
  });

  it('accepts omitted default scope dates and an explicitly open-ended interval', async () => {
    const body = { departmentId: randomUUID(), sectionDepartmentId: randomUUID(), ministerAssignmentId: randomUUID() };
    expect(await errors(dto.CreateMinisterScopeDto, body)).toEqual([]);
    expect(await errors(dto.CreateMinisterScopeDto, { ...body, validFrom: '2026-10-24T00:00:00.000Z', validTo: null })).toEqual([]);
    expect(await errors(dto.UpdateMinisterScopeDto, { expectedVersion: 1, validTo: null })).toEqual([]);
    for (const validFrom of [null, 'not-a-date', '2026-10-24', 123]) {
      expect(await errors(dto.CreateMinisterScopeDto, { ...body, validFrom })).not.toEqual([]);
    }
    expect(await errors(dto.UpdateMinisterScopeDto, { expectedVersion: 1, validTo: 'yesterday' })).not.toEqual([]);
  });

  it('requires UUID query targets and bounds searchable appointment pagination', async () => {
    expect(await errors(dto.ResponsibilityAssignmentsQueryDto, {})).not.toEqual([]);
    expect(await errors(dto.ManagementResponsibilitiesQueryDto, {})).not.toEqual([]);
    expect(await errors(dto.ManagementResponsibilitiesQueryDto, { sectionDepartmentId: randomUUID() })).toEqual([]);
    expect(await errors(dto.ResponsibilityAssignmentsQueryDto, { departmentId: randomUUID(), search: 'Quality', limit: '25', offset: '0' })).toEqual([]);
    for (const extra of [{ limit: 101 }, { offset: 10001 }, { search: 'x'.repeat(201) }, { departmentId: null }, { search: null }]) {
      expect(await errors(dto.ResponsibilityAssignmentsQueryDto, { departmentId: randomUUID(), ...extra })).not.toEqual([]);
    }
    expect(await errors(dto.ManagementResponsibilitiesQueryDto, { sectionDepartmentId: randomUUID(), userId: randomUUID() })).not.toEqual([]);
  });
});
