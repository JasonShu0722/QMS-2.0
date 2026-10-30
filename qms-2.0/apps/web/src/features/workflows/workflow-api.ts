import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

export type WorkflowGraph = components['schemas']['WorkflowGraphResponseDto'];
export type WorkflowNode = WorkflowGraph['nodes'][number];
export type WorkflowEdge = WorkflowGraph['transitions'][number];
export type WorkflowDefinition = components['schemas']['WorkflowDefinitionResponseDto'];
export type WorkflowOptions = components['schemas']['WorkflowOptionsDto'];
export type WorkflowClosureTemplateInput = components['schemas']['CreateWorkflowClosureTemplateDto'];
type WriteBody = components['schemas']['CreateWorkflowDto'] | components['schemas']['UpdateWorkflowDraftDto'] | components['schemas']['PublishWorkflowDto'] | components['schemas']['CopyWorkflowDto'] | components['schemas']['WorkflowGraphDto'];
type WriteOptions = { signal?: AbortSignal; key?: string };
async function write<Result>(path: string, body: WriteBody | string, method = 'POST', { signal, key }: WriteOptions = {}): Promise<Result> {
  const session = useWorkTabsStore.getState().sessionScope;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const token = await csrfToken(signal);
  signal?.throwIfAborted();
  if (session !== useWorkTabsStore.getState().sessionScope) throw new DOMException('Workflow scope changed', 'AbortError');
  return apiRequest<Result>(`/api/v1/workflows${path}`, { method, signal, headers: { 'x-csrf-token': token, ...(key ? { 'Idempotency-Key': key } : {}) }, body: payload }, { replayAfterReauthentication: false });
}
export const unknownWorkflowWrite = (cause: unknown) => !(cause instanceof ApiError) || cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || !cause.status || cause.status === 408 || cause.status === 425 || cause.status >= 500;
export const getWorkflows = (query: URLSearchParams, signal?: AbortSignal) => apiRequest<components['schemas']['WorkflowPageDto']>(`/api/v1/workflows?${query}`, { signal });
export const getWorkflow = (id: string, signal?: AbortSignal) => apiRequest<components['schemas']['WorkflowDefinitionDetailDto']>(`/api/v1/workflows/${id}`, { signal });
export const getWorkflowVersion = (id: string, version: string, signal?: AbortSignal) => apiRequest<WorkflowDefinition>(`/api/v1/workflows/${id}/versions/${version}`, { signal });
export const getWorkflowOptions = (search = '', signal?: AbortSignal) => apiRequest<WorkflowOptions>(`/api/v1/workflows/options?${new URLSearchParams({ search, limit: '100' })}`, { signal });
export const getSupplierWorkflowBindings = (signal?: AbortSignal) => apiRequest<components['schemas']['SupplierWorkflowBindingsDto']>('/api/v1/supplier-quality/workflow-bindings', { signal });
export const getWorkflowClosureTemplates = (signal?: AbortSignal) => apiRequest<components['schemas']['WorkflowClosureTemplatesDto']>('/api/v1/workflows/closure-templates', { signal });
export async function createWorkflowClosureTemplate(body: WorkflowClosureTemplateInput, key: string, signal?: AbortSignal): Promise<WorkflowDefinition> {
  const session = useWorkTabsStore.getState().sessionScope;
  const token = await csrfToken(signal);
  signal?.throwIfAborted();
  if (session !== useWorkTabsStore.getState().sessionScope) throw new DOMException('Workflow scope changed', 'AbortError');
  return apiRequest<WorkflowDefinition>('/api/v1/workflows/closure-templates', { method: 'POST', signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': key }, body: JSON.stringify(body) }, { replayAfterReauthentication: false });
}
export const createWorkflow = (body: components['schemas']['CreateWorkflowDto'] | string, options?: WriteOptions) => write<WorkflowDefinition>('', body, 'POST', options);
export const saveWorkflow = (id: string, body: components['schemas']['UpdateWorkflowDraftDto'], options?: WriteOptions) => write<WorkflowDefinition>(`/${id}/draft`, body, 'PATCH', options);
export const publishWorkflow = (id: string, body: components['schemas']['PublishWorkflowDto'], options?: WriteOptions) => write<WorkflowDefinition>(`/${id}/publish`, body, 'POST', options);
export const copyWorkflow = (id: string, body: components['schemas']['CopyWorkflowDto'], options?: WriteOptions) => write<WorkflowDefinition>(`/${id}/copy`, body, 'POST', options);
export const validateWorkflow = (body: components['schemas']['WorkflowGraphDto'], options?: WriteOptions) => write<components['schemas']['WorkflowValidationResponseDto']>('/validate', body, 'POST', options);
export const workflowPath = (definition: WorkflowDefinition) => `/console/workflows/${definition.id}/${definition.version.id}`;

export function initialGraph(): components['schemas']['WorkflowGraphDto'] {
  return { nodes: [{ id: crypto.randomUUID(), type: 'ACTION', name: '处理', config: { isStart: true, editorPosition: { x: 40, y: 80 } } },
    { id: crypto.randomUUID(), type: 'CLOSE', name: '关闭', config: { isEnd: true, editorPosition: { x: 350, y: 80 } } }], transitions: [] };
}
