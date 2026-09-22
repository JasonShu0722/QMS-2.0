import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { LoginPage } from './features/auth/LoginPage';
import { AuthenticatedRoute } from './features/auth/AuthenticatedRoute';
import { InternalLayout } from './layouts/InternalLayout';
import { SupplierLayout } from './layouts/SupplierLayout';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { LanguageProvider, LanguageSwitcher } from './i18n/Language';
import { SecurityPage } from './features/auth/SecurityPage';
import { ReauthenticationProvider } from './features/auth/ReauthenticationProvider';
import { PasswordRecoveryPage } from './features/auth/PasswordRecoveryPage';

function AuthLanguageSwitcher() {
  const { pathname } = useLocation();
  return pathname.startsWith('/app') || pathname.startsWith('/supplier') ? null : <div className="auth-language-switcher"><LanguageSwitcher /></div>;
}

export function App() {
  return (
    <LanguageProvider><ThemeProvider><Router><ReauthenticationProvider>
      <AuthLanguageSwitcher />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/mfa" element={<SecurityPage />} />
        <Route path="/password-recovery" element={<PasswordRecoveryPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/app/*"
          element={
            <AuthenticatedRoute accountType="INTERNAL">
              <InternalLayout />
            </AuthenticatedRoute>
          }
        />
        <Route
          path="/supplier/*"
          element={
            <AuthenticatedRoute accountType="SUPPLIER">
              <SupplierLayout />
            </AuthenticatedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </ReauthenticationProvider></Router></ThemeProvider></LanguageProvider>
  );
}
