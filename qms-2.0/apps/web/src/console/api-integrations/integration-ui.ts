import { useCallback, useEffect, useRef } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

export type Endpoint = components['schemas']['IntegrationEndpointDto'];
export type EndpointPage = components['schemas']['IntegrationEndpointPageDto'];
export type Credential = components['schemas']['IntegrationCredentialDto'];
export type CredentialPage = components['schemas']['IntegrationCredentialPageDto'];
export type IntegrationScope = { organizationId: string; session: string; epoch: number; permissions: string[]; deny: () => void };
export const integrationPath = '/api/v1/admin/integrations/endpoints';

export function useScopedIntegrationRequests(scope: IntegrationScope) {
  const active = useRef(true);
  const controllers = useRef(new Set<AbortController>());
  const mutation = useRef(createAdminMutation({ replayAfterReauthentication: false }));
  const current = useCallback(() => active.current && useWorkTabsStore.getState().sessionScope === scope.session && getLedgerSessionEpoch() === scope.epoch, [scope.session, scope.epoch]);
  useEffect(() => {
    active.current = true;
    const unsubscribe = useWorkTabsStore.subscribe(() => {
      if (!current()) { active.current = false; controllers.current.forEach(controller => controller.abort()); }
    });
    return () => { active.current = false; unsubscribe(); controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); };
  }, [current]);
  const run = useCallback(async <Result,>(operation: (signal: AbortSignal) => Promise<Result>) => {
    if (!current()) throw new DOMException('Scope changed', 'AbortError');
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const result = await operation(controller.signal);
      if (!current() || controller.signal.aborted) throw new DOMException('Scope changed', 'AbortError');
      return result;
    } catch (cause) {
      if (current() && cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) scope.deny();
      throw cause;
    } finally { controllers.current.delete(controller); }
  }, [current, scope.deny]);
  const read = useCallback(<Result,>(path: string, query: Record<string, string> = {}) => run<Result>(signal => apiRequest<Result>(`${path}?${new URLSearchParams({ organizationId: scope.organizationId, ...query })}`, { signal })), [scope.organizationId, run]);
  const write = useCallback(<Result,>(path: string, method: 'POST' | 'PATCH', body: Parameters<ReturnType<typeof createAdminMutation>>[2]) => run<Result>(signal => mutation.current<Result>(path, method, body, signal)), [run]);
  return { read, write, current };
}

export function integrationError(cause: unknown): string {
  if (cause instanceof ApiError) {
    const messages: Record<string, string> = {
      INTEGRATION_CREDENTIAL_LIMIT: '请先撤销不再使用的接口凭据',
      INTEGRATION_CREDENTIAL_REQUIRED: '启用前需要有效的接口凭据',
      INTEGRATION_CREDENTIAL_SECRET_UNAVAILABLE: '旧凭据无法复制，请创建一份新凭据；旧凭据仍可继续使用',
      INTEGRATION_CAPACITY_CONFLICT: '容量不能低于当前已用容量',
      INTEGRATION_PAYLOAD_EXPIRED: '接收正文已按保留期限清理',
    };
    if (messages[cause.code]) return messages[cause.code];
    if (cause.status === 409) return '配置已变化，请保留当前输入，刷新后重新编辑';
    if (cause.status === 401 || cause.status === 403) return '管理权限已失效，请重新验证';
    if (cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED') return '身份验证已完成，请重新提交操作';
    if (cause.status === 400) return '请检查输入及接口状态，启用接口前需有有效凭据';
  }
  return '请求结果未确认，请重试或按追踪标识核查';
}
export const isAborted = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError';
