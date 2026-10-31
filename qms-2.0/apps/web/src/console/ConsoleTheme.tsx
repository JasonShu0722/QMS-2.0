import { App, ConfigProvider, theme } from 'antd';
import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { resolveTokens, type AppearanceMode } from '../theme/tokens';
import './console.css';

export const consolePreferenceKey = 'qms:console:appearance:v1';
const AppearanceContext = createContext({ mode: 'light' as AppearanceMode, dark: false, setMode: (_mode: AppearanceMode) => {} });
export function useConsoleAppearance() { return useContext(AppearanceContext); }

export function ConsoleTheme({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<AppearanceMode>(() => {
    try { const value = localStorage.getItem(consolePreferenceKey); return value === 'dark' || value === 'system' ? value : 'light'; } catch { return 'light'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = mode === 'dark' || mode === 'system' && systemDark;
  const tokens = useMemo(() => ({
    ...resolveTokens(dark, 'blue'),
    accent: dark ? '#e2e8f0' : '#172033', 'accent-action': dark ? '#e2e8f0' : '#172033',
    'accent-text': dark ? '#f1f2f4' : '#181b22', 'accent-soft': dark ? '#282d36' : '#eef0f3', 'accent-border': dark ? '#626b79' : '#b5bdc9',
    background: dark ? '#111318' : '#f8f9fb', surface: dark ? '#191c23' : '#ffffff',
    'surface-tint': dark ? '#22262e' : '#f2f4f7', border: dark ? '#3d434e' : '#dfe2e7',
    text: dark ? '#f1f2f4' : '#181b22', muted: dark ? '#b1b8c5' : '#616773', 'on-accent': dark ? '#111318' : '#ffffff',
  }), [dark]);
  const style = Object.fromEntries(Object.entries(tokens).map(([name, value]) => [`--qms-${name}`, value])) as CSSProperties;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update); update();
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { try { localStorage.setItem(consolePreferenceKey, mode); } catch { /* Storage is optional. */ } }, [mode]);

  return <div ref={setContainer} className="qms-console-theme" data-console-theme={dark ? 'dark' : 'light'} style={{ ...style, colorScheme: dark ? 'dark' : 'light' }}>
    <AppearanceContext.Provider value={{ mode, dark, setMode }}>
      <ConfigProvider getPopupContainer={() => container!} theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: tokens['accent-action'], colorInfo: tokens['accent-action'], colorText: tokens.text, colorTextSecondary: tokens.muted,
          colorBgBase: tokens.surface, colorBgContainer: tokens.surface, colorBgElevated: tokens.surface, colorBgLayout: tokens.background,
          colorBorder: tokens.border, colorBorderSecondary: tokens.border, colorSuccess: tokens.success, colorWarning: tokens.warning, colorError: tokens.danger,
          fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 14, borderRadius: 6, controlHeight: 36 },
        components: { Button: { primaryColor: tokens['on-accent'], defaultShadow: 'none', primaryShadow: 'none', dangerShadow: 'none' },
          Layout: { bodyBg: tokens.background, siderBg: tokens.surface, headerBg: tokens.surface },
          Table: { headerBg: tokens['surface-tint'], headerColor: tokens.text, borderColor: tokens.border, headerSplitColor: tokens.border,
            rowHoverBg: tokens['surface-tint'], rowSelectedBg: tokens['accent-soft'], rowSelectedHoverBg: tokens['accent-soft'],
            cellFontSize: 13, cellFontSizeMD: 13, cellFontSizeSM: 13, cellPaddingBlock: 4, cellPaddingBlockMD: 4, cellPaddingBlockSM: 4 },
          Card: { bodyPadding: 16, headerPadding: 16 } },
      }}>{container && <App>{children}</App>}</ConfigProvider>
    </AppearanceContext.Provider>
  </div>;
}
