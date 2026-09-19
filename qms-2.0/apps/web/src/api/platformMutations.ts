import { apiRequest } from './client';
export const publishWorkflow = (id: string, body: unknown, idempotencyKey: string) => apiRequest(`/api/v1/workflows/${id}/publish`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': idempotencyKey } });
export const completeTask = (id: string, body: unknown, idempotencyKey: string) => apiRequest(`/api/v1/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': idempotencyKey } });
