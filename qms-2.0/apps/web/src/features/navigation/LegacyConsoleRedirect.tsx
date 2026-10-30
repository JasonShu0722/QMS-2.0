import { Alert } from 'antd';
import { Navigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../../i18n/Language';
import { legacyConsoleTarget } from './legacy-console-route';

export function LegacyConsoleRedirect() {
  const location = useLocation();
  const { t } = useLanguage();
  const target = legacyConsoleTarget(location);
  return target ? <Navigate to={target} replace />
    : <Alert type="error" showIcon role="alert" title={t('管理定位失败：链接无效，请核对目标组织与定位参数。')} />;
}
