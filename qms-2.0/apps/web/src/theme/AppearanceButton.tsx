import { Button, Drawer } from 'antd';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '../i18n/Language';
import { useAppearance } from './ThemeProvider';
import { accentNames, resolveTokens, type Accent } from './tokens';

export function AppearanceButton() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const { preferences, setPreferences } = useAppearance();
  return <>
    <Button className="qms-appearance-trigger" type="text" icon={<Palette size={18} />} onClick={() => setOpen(true)} aria-label={t('外观设置')}>{t('外观')}</Button>
    <Drawer title={t('外观设置')} open={open} onClose={() => setOpen(false)} size={360}>
      <section className="qms-appearance-settings">
        <h3>{t('显示模式')}</h3><p>{t('选择适合当前环境的界面亮度')}</p>
        <div className="qms-appearance-options" role="group" aria-label={t('显示模式')}>
          {([{ value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }, { value: 'system', label: '跟随系统', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={preferences.mode === value} onClick={() => setPreferences({ ...preferences, mode: value })}><Icon size={22} /><span>{t(label)}</span>{preferences.mode === value && <Check size={14} />}</button>)}
        </div>
        <h3>{t('品牌主色')}</h3><p>{t('调整导航、按钮与选中状态的强调色')}</p>
        <div className="qms-appearance-options" role="group" aria-label={t('品牌主色')}>
          {(Object.keys(accentNames) as Accent[]).map(accent => <button key={accent} type="button" aria-pressed={preferences.accent === accent} onClick={() => setPreferences({ ...preferences, accent })}><span className="qms-color-swatch" style={{ backgroundColor: resolveTokens(false, accent).accent }}>{preferences.accent === accent && <Check size={14} color="white" />}</span><span>{t(accentNames[accent])}</span></button>)}
        </div>
        <p className="qms-appearance-note">{t('风险和完成状态保持固定含义。偏好保存在当前浏览器。')}</p>
      </section>
    </Drawer>
  </>;
}
