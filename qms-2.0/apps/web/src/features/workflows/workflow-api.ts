import type { components } from '@qms/contracts';
import { apiRequest } from '../../api/client';

export type WorkflowGraph = components['schemas']['WorkflowGraphResponseDto'];
export type WorkflowDefinition = components['schemas']['WorkflowDefinitionResponseDto'];
export const getWorkflows = (query: URLSearchParams, signal?: AbortSignal) => apiRequest<components['schemas']['WorkflowPageDto']>(`/api/v1/workflows?${query}`, { signal });
export const getWorkflow = (id: string, signal?: AbortSignal) => apiRequest<components['schemas']['WorkflowDefinitionDetailDto']>(`/api/v1/workflows/${id}`, { signal });
export const getWorkflowVersion = (id: string, version: string, signal?: AbortSignal) => apiRequest<WorkflowDefinition>(`/api/v1/workflows/${id}/versions/${version}`, { signal });
export const getSupplierWorkflowBindings = (signal?: AbortSignal) => apiRequest<components['schemas']['SupplierWorkflowBindingsDto']>('/api/v1/supplier-quality/workflow-bindings', { signal });
