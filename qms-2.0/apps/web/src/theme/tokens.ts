export type AppearanceMode = 'light' | 'dark' | 'system';
export type Accent = 'blue' | 'teal' | 'purple';
export type Preferences = { mode: AppearanceMode; accent: Accent };
export const defaultPreferences: Preferences = { mode: 'light', accent: 'blue' };
export const preferenceKey = 'qms:appearance:v1';

export const accentNames: Record<Accent, string> = { blue: '晴空蓝', teal: '湖水青', purple: '鸢尾紫' };
const palettes = {
  light: {
    blue: ['#277cc4', '#e6f2fd', '#b9d8f2'],
    teal: ['#12847f', '#e0f4f0', '#a9dcd4'],
    purple: ['#7960c5', '#eee9fb', '#d0c2ef'],
  },
  dark: {
    blue: ['#65b0f0', '#203c56', '#355d7c'],
    teal: ['#4bc4b8', '#1c403f', '#306965'],
    purple: ['#b19af0', '#342e50', '#564477'],
  },
};

export function parsePreferences(value: unknown): Preferences {
  const input = value && typeof value === 'object' ? value as Partial<Preferences> : {};
  return {
    mode: ['light', 'dark', 'system'].includes(input.mode ?? '') ? input.mode! : 'light',
    accent: ['blue', 'teal', 'purple'].includes(input.accent ?? '') ? input.accent! : 'blue',
  };
}

export function resolveTokens(dark: boolean, accent: Accent) {
  const [primary, soft, border] = palettes[dark ? 'dark' : 'light'][accent];
  return {
    accent: primary!, 'accent-soft': soft!, 'accent-border': border!,
    'accent-text': dark ? primary! : '#293b50',
    // Slightly deeper blue for small text and white-on-blue actions (>= 4.5:1).
    'accent-action': !dark && accent === 'blue' ? '#2375bb' : primary!,
    background: dark ? '#111b27' : '#f3f6fa',
    surface: dark ? '#1a2838' : '#ffffff',
    'surface-tint': dark ? '#203044' : '#f7f9fc',
    border: dark ? '#33465d' : '#e1e7ef',
    text: dark ? '#e2eaf3' : '#293b50',
    muted: dark ? '#a7b8cb' : '#64758a',
    success: dark ? '#74d1ad' : '#208569',
    'success-soft': dark ? '#1c4038' : '#e5f4ed',
    warning: dark ? '#f0ba72' : '#ac7126',
    'warning-soft': dark ? '#493b28' : '#fff2df',
    danger: dark ? '#ff9b9b' : '#c43c45',
    'danger-soft': dark ? '#482c36' : '#fff0f1',
    'on-accent': dark ? '#111b27' : '#ffffff',
    'chart-blue': dark ? '#75b8ed' : '#5597d1',
    'chart-orange': dark ? '#e9b365' : '#db9c47',
    shadow: dark ? '0 4px 20px #00000018' : '0 4px 20px #16334e0b',
  };
}
