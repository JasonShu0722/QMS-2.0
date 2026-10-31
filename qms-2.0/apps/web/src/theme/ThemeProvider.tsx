import { ConfigProvider, theme } from 'antd';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { defaultPreferences, parsePreferences, preferenceKey, resolveTokens, type Preferences } from './tokens';
import './theme.css';

const AppearanceContext = createContext({ preferences: defaultPreferences, setPreferences: (_value: Preferences) => {}, dark: false });
export const useAppearance = () => useContext(AppearanceContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try { return parsePreferences(JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')); } catch { return defaultPreferences; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = preferences.mode === 'dark' || (preferences.mode === 'system' && systemDark);
  const tokens = useMemo(() => resolveTokens(dark, preferences.accent), [dark, preferences.accent]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.qmsAppearance = dark ? 'dark' : 'light';
    root.dataset.qmsAccent = preferences.accent;
    root.style.colorScheme = dark ? 'dark' : 'light';
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--qms-${name}`, value);
  }, [dark, preferences.accent, tokens]);
  useEffect(() => { try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Storage may be disabled; the active preference still works. */ } }, [preferences]);
  return <AppearanceContext.Provider value={{ preferences, setPreferences, dark }}>
    <ConfigProvider theme={{
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: tokens['accent-action'], colorInfo: tokens['accent-action'], colorSuccess: tokens.success,
        colorWarning: tokens.warning, colorError: tokens.danger, colorText: tokens.text,
        colorTextSecondary: tokens.muted, colorBgBase: tokens.surface, colorBgContainer: tokens.surface,
        colorBgElevated: tokens.surface, colorBgLayout: tokens.background, colorBorder: tokens.border,
        colorBorderSecondary: tokens.border, borderRadius: 7, controlHeight: 36, fontSize: 14,
        fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
      },
      components: {
        Button: { primaryColor: tokens['on-accent'], paddingInline: 14, fontWeight: 500, defaultShadow: 'none', primaryShadow: 'none', dangerShadow: 'none' },
        Card: { bodyPadding: 8, bodyPaddingSM: 8, headerPadding: 8, headerPaddingSM: 8, headerHeight: 44, headerHeightSM: 44 },
        Table: { headerBg: tokens['surface-tint'], headerColor: tokens.text, borderColor: tokens.border, headerSplitColor: tokens.border,
          rowHoverBg: tokens['surface-tint'], rowSelectedBg: tokens['accent-soft'], rowSelectedHoverBg: tokens['accent-soft'],
          cellFontSize: 13, cellFontSizeMD: 13, cellFontSizeSM: 13, cellPaddingBlock: 4, cellPaddingBlockMD: 4, cellPaddingBlockSM: 4 },
        Layout: { bodyBg: tokens.background, siderBg: tokens.surface, headerBg: tokens.surface },
      },
    }}>{children}</ConfigProvider>
  </AppearanceContext.Provider>;
}
