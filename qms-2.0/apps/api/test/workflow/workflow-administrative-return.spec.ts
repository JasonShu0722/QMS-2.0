import 'reflect-metadata';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { administrativeReturnTarget, type WorkflowAdministrativeReturnInput } from '../../src/modules/workflow/workflow-administrative-return.js';
import type { Prisma, WorkflowNode, WorkflowTransition } from '../../src/generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

describe('workflow-owned administrative return port', () => {
  it('exposes a transaction-only owner port without adding constructor dependencies', () => {
    expect(WorkflowRuntimeService.prototype).toHaveProperty('administrativeReturn', expect.any(Function));
    expect(WorkflowRuntimeService.length).toBe(4);
  });

  it.each(['process-quality/process-eight-d', 'supplier-quality/supplier-eight-d'])('%s administrative callback uses the public owner port, not ordinary move/CHANGED', path => {
    const source = readFileSync(new URL(`../../src/modules/${path}.service.ts`, import.meta.url), 'utf8');
    const start = source.indexOf('  async administrativeInvalidation(');
    const hook = source.slice(start, source.indexOf('  async canNotifyClosureRecipient(', start));
    expect(start).toBeGreaterThan(0);
    expect(hook).not.toContain('this.move(');
    expect(hook).toContain('this.runtime.administrativeReturn(');
    expect(hook).not.toContain('this.changed(');
    expect(hook).not.toContain("'ADMINISTRATIVE_INVALIDATION'");
    expect(hook).not.toContain('tx.workflowInstance.');
    expect(hook).not.toContain('tx.workflowMutation.');
  });

  const policy = { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 };
  const edge = (config: Prisma.InputJsonValue = { isStart: true, processEightD: policy }, condition: Prisma.InputJsonValue = {}) => ({
    action: 'RETURN', condition, toNode: { id: randomUUID(), type: 'ACTION', config },
  }) as WorkflowTransition & { toNode: WorkflowNode };

  it.each(['process-quality', 'customer-quality', 'new-product-quality', 'supplier-quality'])('selects the controlled ACTION owner for %s', domainCode => {
    const target = edge(domainCode === 'supplier-quality' ? { isStart: true, supplierEightD: { schemaVersion: 1 } } : undefined);
    expect(administrativeReturnTarget([target], { domainCode })).toBe(target.toNode);
  });

  it('counts matching conditions, not all RETURN edges or the first edge', () => {
    const unmatched = edge(undefined, { field: 'severity', operator: 'eq', value: 'HIGH' });
    const matched = edge(undefined, { field: 'severity', operator: 'eq', value: 'LOW' });
    expect(administrativeReturnTarget([unmatched, matched], { domainCode: 'process-quality', severity: 'LOW' })).toBe(matched.toNode);
    expect(() => administrativeReturnTarget([unmatched], { domainCode: 'process-quality', severity: 'LOW' })).toThrow();
    expect(() => administrativeReturnTarget([matched, matched], { domainCode: 'process-quality', severity: 'LOW' })).toThrow();
  });

  it.each([{}, { isStart: true }, { isStart: true, supplierEightD: { schemaVersion: 1 } },
    { isStart: true, processEightD: { ...policy, schemaVersion: 2 } }, { isStart: true, processEightD: policy, closureReview: {} }])('rejects an untrusted internal owner marker %j', config => {
    expect(() => administrativeReturnTarget([edge(config)], { domainCode: 'process-quality' })).toThrow();
  });

  it('rejects non-owner node types and uncontrolled domains', () => {
    const target = edge();
    target.toNode.type = 'APPROVAL';
    expect(() => administrativeReturnTarget([target], { domainCode: 'process-quality' })).toThrow();
    expect(() => administrativeReturnTarget([edge()], { domainCode: 'unknown' })).toThrow();
  });

  const input = (): WorkflowAdministrativeReturnInput => ({ orgId: randomUUID(), problemId: randomUUID(), actorUserId: randomUUID(),
    expectedInstanceId: randomUUID(), expectedInstanceVersion: 1, reason: 'ADMINISTRATIVE_USER_DELETED' });
  it.each([{ reason: 'RETURN' }, { expectedInstanceVersion: 0 }, { expectedInstanceVersion: 2147483647 },
    { expectedInstanceVersion: 1.5 }, { problemId: 'not-a-uuid' }])('rejects invalid port input before touching storage: %j', invalid => {
    const runtime = new WorkflowRuntimeService(undefined as never, undefined as never, undefined as never, undefined as never);
    return expect(runtime.administrativeReturn({} as Prisma.TransactionClient, { ...input(), ...invalid })).rejects.toMatchObject({ status: 400 });
  });
});
