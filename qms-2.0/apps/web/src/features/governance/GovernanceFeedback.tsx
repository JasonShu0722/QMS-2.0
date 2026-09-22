import { Alert, Button } from 'antd';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';

export function GovernanceFeedback({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useLanguage();
  if (!error) return null;
  return <div role="alert"><Alert type="error" showIcon title={t(safeAccountError(error))} description={error instanceof ApiError && error.traceId ? <span>{t('追踪标识')}：<code>{error.traceId}</code></span> : undefined} action={retry ? <Button onClick={retry}>{t('重试')}</Button> : undefined} /></div>;
}
