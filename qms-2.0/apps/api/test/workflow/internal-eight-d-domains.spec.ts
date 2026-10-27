import 'reflect-metadata';
import { WorkflowValidationService, type WorkflowDraft } from '../../src/modules/workflow/workflow-validation.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import type { CreateWorkflowClosureTemplateDto } from '../../src/modules/workflow/workflow-closure-template.dto.js';

describe('bounded internal 8D domain graphs', () => {
  const validation = new WorkflowValidationService();
  const template = new WorkflowClosureTemplateService({} as never, {} as never, {} as never);
  const graph = (domainCode: string, policy = 'INTERNAL'): WorkflowDraft => ({
    nodes: [
      { id: 'owner', type: 'ACTION', name: 'Owner', config: { isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null } } },
      { id: 'review', type: 'APPROVAL', name: 'Review', config: { closureReview: { schemaVersion: 1, policy, domainCode } } },
      { id: 'end', type: 'CLOSE', name: 'End', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
    ],
    transitions: [
      { id: 'submit', from: 'owner', to: 'review', action: 'SUBMIT' },
      { id: 'approve', from: 'review', to: 'end', action: 'APPROVE' },
      { id: 'return', from: 'review', to: 'owner', action: 'RETURN' },
    ],
  });

  it.each(['process-quality', 'customer-quality', 'new-product-quality'])('creates and validates an explicitly internal %s graph', domainCode => {
    const draft = (template as unknown as { graph(input: CreateWorkflowClosureTemplateDto): WorkflowDraft }).graph({ domainCode, policy: 'INTERNAL' } as CreateWorkflowClosureTemplateDto);
    expect(draft.nodes[0]!.config).toHaveProperty('processEightD');
    expect(validation.validateDraft(draft)).toEqual({ valid: true, errors: [] });
    expect(validation.validateDraft(graph(domainCode))).toEqual({ valid: true, errors: [] });
  });

  it.each(['supplier-quality', 'audit-management', 'unknown-domain'])('does not make %s a controlled internal 8D domain', domain => {
    expect(validation.validateDraft(graph(domain)).valid).toBe(false);
  });

  it.each(['customer-quality', 'new-product-quality'])('does not use the internal owner policy for a supplier %s gate', domain => {
    expect(validation.validateDraft(graph(domain, 'SUPPLIER')).valid).toBe(false);
  });

  it('does not mix two domain gates behind one controlled owner', () => {
    const draft = graph('customer-quality');
    draft.nodes.push({ id: 'wrong', type: 'APPROVAL', name: 'Wrong gate', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'new-product-quality' } } });
    expect(validation.validateDraft(draft).valid).toBe(false);
  });
});
