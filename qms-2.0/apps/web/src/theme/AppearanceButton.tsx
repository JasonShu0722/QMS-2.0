import { Button, Drawer, Radio } from 'antd';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useId, useState } from 'react';
import { useLanguage } from '../i18n/Language';
import { useAppearance } from './ThemeProvider';
import { accentNames, resolveTokens, type Accent } from './tokens';

export function AppearanceButton({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  const choiceId = useId();
  const [open, setOpen] = useState(false);
  const { preferences, setPreferences } = useAppearance();
  return <>
    <Button className="qms-appearance-trigger" type="text" icon={<Palette size={18} aria-hidden="true" />} onClick={() => setOpen(true)} aria-label={t('外观设置')} aria-expanded={open} aria-haspopup="dialog" title={t('外观设置')}>{compact ? null : t('外观')}</Button>
    <Drawer title={t('外观设置')} open={open} onClose={() => setOpen(false)} size={360}>
      <section className="qms-appearance-settings">
        <h3>{t('显示模式')}</h3>
        <Radio.Group name={`${choiceId}-mode`} className="qms-appearance-options" aria-label={t('显示模式')} value={preferences.mode} onChange={event => setPreferences({ ...preferences, mode: event.target.value })}>
          {([{ value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }, { value: 'system', label: '跟随系统', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <Radio key={value} value={value}><span className="qms-appearance-option-content"><Icon size={22} aria-hidden="true" /><span>{t(label)}</span>{preferences.mode === value && <Check size={14} aria-hidden="true" />}</span></Radio>)}
        </Radio.Group>
        <h3>{t('品牌主色')}</h3>
        <Radio.Group name={`${choiceId}-accent`} className="qms-appearance-options" aria-label={t('品牌主色')} value={preferences.accent} onChange={event => setPreferences({ ...preferences, accent: event.target.value })}>
          {(Object.keys(accentNames) as Accent[]).map(accent => <Radio key={accent} value={accent}><span className="qms-appearance-option-content"><span className="qms-color-swatch" aria-hidden="true" style={{ backgroundColor: resolveTokens(false, accent).accent }}>{preferences.accent === accent && <Check size={14} color="white" aria-hidden="true" />}</span><span>{t(accentNames[accent])}</span></span></Radio>)}
        </Radio.Group>
      </section>
    </Drawer>
  </>;
}
