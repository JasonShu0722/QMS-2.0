import { Radio } from 'antd';
import { useLanguage } from './Language';

export function TopbarLanguageSwitcher() {
  const { locale, setLocale } = useLanguage();
  return <Radio.Group className="qms-topbar-language" aria-label="Language / 语言" value={locale} onChange={(event) => setLocale(event.target.value)} optionType="button" buttonStyle="solid" options={[{ label: 'EN', value: 'en-US' }, { label: 'CN', value: 'zh-CN' }]} />;
}
