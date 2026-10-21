import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import { LanguageProvider } from '../i18n/Language';
import { ThemeProvider } from '../theme/ThemeProvider';
import { InteractionPreview } from './InteractionPreview';
import './preview.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider><ThemeProvider><InteractionPreview /></ThemeProvider></LanguageProvider>
  </StrictMode>,
);
