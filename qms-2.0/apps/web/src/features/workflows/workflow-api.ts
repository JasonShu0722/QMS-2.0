import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';

export type WorkflowGraph = components['schemas']['WorkflowGraphResponseDto'];
export type WorkflowNode = WorkflowGraph['nodes'][number];
export type WorkflowEdge = WorkflowGraph['transitions'][number];
export type WorkflowDefinition = components['schemas']['WorkflowDefinitionResponseDto'];
export type WorkflowOptions = components['schemas']['WorkflowOptionsDto'];
type WriteBody = components['schemas']['CreateWorkflowDto'] | components['schemas']['UpdateWorkflowDraftDto'] | components['schemas']['PublishWorkflowDto'] | components['schemas']['CopyWorkflowDto'] | components['schemas']['WorkflowGraphDto'];
async function write<Result>(path: string, body: WriteBody, method = 'POST'): Promise<Result> {
  const token = await csrfToken();
  return apiRequest<Result>(`/api/v1/workflows${path}`, { method, headers: { 'x-csrf-token': token }, body: JSON.stringify(body) });
}
export const getWorkflows = (query: URLSearchParams, signal?: AbortSignal) => apiRequest<components['schemas']['WorkflowPageDto']>(`/api/v1/workflows?${query}`, { signal });
export const getWorkflow = (id: string, signal?: AbortSignal) => apiRequest<components['schemas']['WorkflowDefinitionDetailDto']>(`/api/v1/workflows/${id}`, { signal });
export const getWorkflowVersion = (id: string, version: string, signal?: AbortSignal) => apiRequest<WorkflowDefinition>(`/api/v1/workflows/${id}/versions/${version}`, { signal });
export const getWorkflowOptions = (search = '', signal?: AbortSignal) => apiRequest<WorkflowOptions>(`/api/v1/workflows/options?${new URLSearchParams({ search, limit: '100' })}`, { signal });
export const createWorkflow = (body: components['schemas']['CreateWorkflowDto']) => write<WorkflowDefinition>('', body);
export const saveWorkflow = (id: string, body: components['schemas']['UpdateWorkflowDraftDto']) => write<WorkflowDefinition>(`/${id}/draft`, body, 'PATCH');
export const publishWorkflow = (id: string, body: components['schemas']['PublishWorkflowDto']) => write<WorkflowDefinition>(`/${id}/publish`, body);
export const copyWorkflow = (id: string, body: components['schemas']['CopyWorkflowDto']) => write<WorkflowDefinition>(`/${id}/copy`, body);
export const validateWorkflow = (body: components['schemas']['WorkflowGraphDto']) => write<components['schemas']['WorkflowValidationResponseDto']>('/validate', body);
export const workflowPath = (definition: WorkflowDefinition) => `/app/workflow-designer/${definition.id}/${definition.version.id}`;

export function initialGraph(): components['schemas']['WorkflowGraphDto'] {
  return { nodes: [{ id: crypto.randomUUID(), type: 'ACTION', name: '处理', config: { isStart: true, editorPosition: { x: 40, y: 80 } } },
    { id: crypto.randomUUID(), type: 'CLOSE', name: '关闭', config: { isEnd: true, editorPosition: { x: 350, y: 80 } } }], transitions: [] };
}
