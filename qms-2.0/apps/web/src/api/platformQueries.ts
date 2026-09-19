import { apiRequest } from './client';
export const getProblemCenter = (params: Record<string, string> = {}) => apiRequest('/api/v1/problem-center?' + new URLSearchParams(params));
export const getProblemReport = (id: string) => apiRequest(`/api/v1/reports/problems/${id}`);
export const getProblemAuditTrail = (id: string) => apiRequest(`/api/v1/problems/${id}/audit-trail`);
