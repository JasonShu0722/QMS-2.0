import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../i18n/Language';
import { ConsolePreview } from './ConsolePreview';

createRoot(document.getElementById('root')!).render(
  <StrictMode><LanguageProvider><ConsolePreview /></LanguageProvider></StrictMode>,
);
