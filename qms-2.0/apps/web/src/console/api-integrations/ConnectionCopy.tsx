import { useRef, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import type { components } from '@qms/contracts';
import { useLanguage } from '../../i18n/Language';
import { integrationError, integrationPath, isAborted, useScopedIntegrationRequests, type Endpoint, type IntegrationScope } from './integration-ui';

type Connection = components['schemas']['IntegrationConnectionDto'];

export function ConnectionCopy({ scope, endpoint, credentialId, credentialName, disabled = false }: {
  scope: IntegrationScope; endpoint: Endpoint; credentialId?: string; credentialName?: string; disabled?: boolean;
}) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const { read, current } = useScopedIntegrationRequests(scope);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string }>();
  const canCopy = scope.permissions.includes('integration:manage') && scope.permissions.includes('integration:credentials:manage');
  async function copy() {
    if (!canCopy || disabled || pending.current || !current()) return;
    pending.current = true; setBusy(true); setFeedback(undefined);
    let clipboardStarted = false;
    try {
      const result = await read<Connection>(`${integrationPath}/${endpoint.id}/connection`, credentialId ? { credentialId } : {});
      if (result.endpoint.organizationId !== scope.organizationId || result.endpoint.id !== endpoint.id || credentialId && result.credentialId !== credentialId) { scope.deny(); return; }
      const content = [
        `${text('接口名称', 'Interface')}: ${result.endpoint.name}`,
        `${text('接口地址', 'URL')}: ${result.endpoint.publicUrl}`,
        `${text('请求方式', 'Method')}: POST`,
        'Content-Type: application/json',
        `Authorization: ${result.authorization}`,
        `${text('凭据名称', 'Credential')}: ${result.credentialName}`,
        `${text('有效期', 'Validity')}: ${result.expiresAt ?? text('永久有效', 'Permanent')}`,
        text('正文：JSON对象。', 'Body: a JSON object.'),
        text('消息编号由系统分配。', 'Message IDs are assigned by the server.'),
        text(result.endpoint.returnReceipt ? '接收成功返回201及本次接收编号。' : '接收成功返回204空正文。', result.endpoint.returnReceipt ? 'Success: 201 with this receipt ID.' : 'Success: 204 with an empty body.'),
        text('每次请求独立保存，重试可能新增记录；网络中断或5xx后先检索接收记录再决定重试。', 'Each request is saved independently. Retrying may create another record; after network failure or 5xx, check received records before retrying.'),
      ].join('\n');
      if (!current()) return;
      clipboardStarted = true;
      await navigator.clipboard.writeText(content);
      if (current()) setFeedback({ success: true, message: text('已复制对接配置', 'Connection configuration copied') });
    } catch (cause) {
      if (current() && !isAborted(cause)) setFeedback({ success: false, message: clipboardStarted
        ? text('复制失败，请重试或允许浏览器访问剪贴板', 'Copy failed. Retry or allow clipboard access in your browser.')
        : text(integrationError(cause), 'Unable to read the connection configuration. Retry or check the credential.') });
    } finally { pending.current = false; if (current()) setBusy(false); }
  }
  if (!canCopy) return null;
  return <Space orientation="vertical" size="small">
    <Button size="small" disabled={disabled} loading={busy} aria-label={credentialName ? text(`复制${credentialName}对接配置`, `Copy ${credentialName} connection configuration`) : text('复制对接配置', 'Copy connection configuration')} onClick={() => void copy()}>{text('复制对接配置', 'Copy connection configuration')}</Button>
    {feedback && <Alert role={feedback.success ? 'status' : 'alert'} showIcon type={feedback.success ? 'success' : 'error'} title={feedback.message} />}
  </Space>;
}
