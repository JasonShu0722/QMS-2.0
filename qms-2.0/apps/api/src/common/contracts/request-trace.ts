import { randomUUID } from 'node:crypto';

const REQUEST_TRACE = Symbol('REQUEST_TRACE');
type TracedRequest = { [REQUEST_TRACE]?: string };

export function requestTraceId(request?: object): string {
  if (!request) return randomUUID();
  const traced = request as TracedRequest;
  return traced[REQUEST_TRACE] ??= randomUUID();
}
