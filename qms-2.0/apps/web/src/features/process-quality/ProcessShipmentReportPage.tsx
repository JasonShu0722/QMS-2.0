import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessShipmentReportPanel } from './ProcessShipmentReportPanel';
import './process-quality.css';

export function ProcessShipmentReportPage() {
  const { t } = useLanguage();
  const scope = useWorkTabsStore(state => state.sessionScope);
  return <main className="process-quality-page">
    <h1 className="sr-only">{t('出货报告')}</h1>
    <ProcessShipmentReportPanel key={scope ?? 'unbound'} />
  </main>;
}
