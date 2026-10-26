import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { WorkflowClosureAdapter } from './workflow-closure-round.types.js';
import { workflowError } from './workflow-runtime-policy.js';

export const WORKFLOW_CLOSURE_ADAPTERS = Symbol('WORKFLOW_CLOSURE_ADAPTERS');

@Injectable()
export class WorkflowClosureRegistry implements OnApplicationBootstrap {
  private readonly adapters = new Map<string, WorkflowClosureAdapter>();
  private bootstrapped = false;

  constructor(@Inject(WORKFLOW_CLOSURE_ADAPTERS) adapters: readonly WorkflowClosureAdapter[]) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: WorkflowClosureAdapter): void {
    if (this.bootstrapped) throw new Error('WORKFLOW_CLOSURE_REGISTRY_FROZEN');
    if (!adapter.domainCode || adapter.domainCode.trim() !== adapter.domainCode || this.adapters.has(adapter.domainCode)) {
      throw new Error('Closure adapters require distinct exact nonempty domain codes');
    }
    this.adapters.set(adapter.domainCode, adapter);
  }

  onApplicationBootstrap(): void { this.bootstrapped = true; }

  hasDomain(domainCode: string): boolean { return this.adapters.has(domainCode); }

  get(domainCode: string): WorkflowClosureAdapter {
    return this.adapters.get(domainCode) ?? workflowError('WORKFLOW_ACTION_INVALID', 409);
  }
}
