import { Typography } from 'antd';
import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessShipmentReportPanel } from './ProcessShipmentReportPanel';
import './process-quality.css';

export function ProcessShipmentReportPage() {
  const { t } = useLanguage();
  const scope = useWorkTabsStore(state => state.sessionScope);
  return <main className="process-quality-page">
    <header className="process-quality-heading"><div><Typography.Text type="secondary">{t('制程质量')}</Typography.Text><Typography.Title level={1}>{t('出货报告')}</Typography.Title></div></header>
    <ProcessShipmentReportPanel key={scope ?? 'unbound'} />
  </main>;
}
