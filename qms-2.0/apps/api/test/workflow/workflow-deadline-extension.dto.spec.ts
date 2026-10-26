import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DecideWorkflowDeadlineExtensionDto, RequestWorkflowDeadlineExtensionDto } from '../../src/modules/workflow/workflow-deadline-extension.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };
describe('deadline extension DTO boundary', () => {
  it('requires an explicit stage/date/reason and both request CAS versions', async () => {
    const valid = { expectedRowVersion: 1, expectedInstanceVersion: 1, stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Explicit request' };
    expect(await validate(plainToInstance(RequestWorkflowDeadlineExtensionDto, valid), options)).toHaveLength(0);
    for (const key of Object.keys(valid)) {
      const missing = { ...valid } as Record<string, unknown>; delete missing[key];
      expect((await validate(plainToInstance(RequestWorkflowDeadlineExtensionDto, missing), options)).length).toBeGreaterThan(0);
    }
  });
  it('rejects client-supplied approvers, unknown actions, invalid dates and integer overflow', async () => {
    const input = { expectedRowVersion: 1, expectedInstanceVersion: 1, stage: 'CLOSURE', requestedDueAt: '2026-02-30', reason: 'Explicit request', professionalUserId: 'forged' };
    expect((await validate(plainToInstance(RequestWorkflowDeadlineExtensionDto, input), options)).map(e => e.property)).toEqual(expect.arrayContaining(['professionalUserId', 'requestedDueAt']));
    expect((await validate(plainToInstance(DecideWorkflowDeadlineExtensionDto, { expectedVersion: 2147483648, decision: 'CLOSE' }), options)).length).toBeGreaterThan(0);
  });
  it('does not add a mandatory approval comment or accept arbitrary completion JSON', async () => {
    expect(await validate(plainToInstance(DecideWorkflowDeadlineExtensionDto, { expectedVersion: 1, decision: 'APPROVE' }), options)).toHaveLength(0);
    expect((await validate(plainToInstance(DecideWorkflowDeadlineExtensionDto, { expectedVersion: 1, decision: 'APPROVE', complete: true }), options)).length).toBeGreaterThan(0);
  });
});
