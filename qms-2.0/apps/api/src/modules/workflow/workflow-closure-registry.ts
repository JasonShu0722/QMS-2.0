import { Inject, Injectable } from '@nestjs/common';
import type { WorkflowClosureAdapter } from './workflow-closure-round.types.js';
import { workflowError } from './workflow-runtime-policy.js';

export const WORKFLOW_CLOSURE_ADAPTERS = Symbol('WORKFLOW_CLOSURE_ADAPTERS');

@Injectable()
export class WorkflowClosureRegistry {
  private readonly adapters: ReadonlyMap<string, WorkflowClosureAdapter>;

  constructor(@Inject(WORKFLOW_CLOSURE_ADAPTERS) adapters: readonly WorkflowClosureAdapter[]) {
    const entries = new Map<string, WorkflowClosureAdapter>();
    for (const adapter of adapters) {
      if (!adapter.domainCode || adapter.domainCode.trim() !== adapter.domainCode || entries.has(adapter.domainCode)) {
        throw new Error('Closure adapters require distinct exact nonempty domain codes');
      }
      entries.set(adapter.domainCode, adapter);
    }
    this.adapters = entries;
  }

  hasDomain(domainCode: string): boolean { return this.adapters.has(domainCode); }

  get(domainCode: string): WorkflowClosureAdapter {
    return this.adapters.get(domainCode) ?? workflowError('WORKFLOW_ACTION_INVALID', 409);
  }
}
