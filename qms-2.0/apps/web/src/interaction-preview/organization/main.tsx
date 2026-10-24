import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { OrganizationPreview } from './OrganizationPreview';
import './organization.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><LanguageProvider><ThemeProvider><OrganizationPreview /></ThemeProvider></LanguageProvider></StrictMode>,
);
