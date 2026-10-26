import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import '../../styles/global.css';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { ProcessEightDPreview } from './ProcessEightDPreview';

createRoot(document.getElementById('root')!).render(
  <StrictMode><LanguageProvider><ThemeProvider><ProcessEightDPreview /></ThemeProvider></LanguageProvider></StrictMode>,
);
