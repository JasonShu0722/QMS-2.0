import { useEffect, useState } from 'react';
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { LoginPage } from './features/auth/LoginPage';
import { AuthenticatedRoute } from './features/auth/AuthenticatedRoute';
import { InternalLayout } from './layouts/InternalLayout';
import { SupplierLayout } from './layouts/SupplierLayout';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { LanguageProvider } from './i18n/Language';
import { SecurityPage } from './features/auth/SecurityPage';
import { ReauthenticationProvider } from './features/auth/ReauthenticationProvider';
import { PasswordRecoveryPage } from './features/auth/PasswordRecoveryPage';
import { AuthToolbar } from './features/auth/AuthToolbar';
import { RequiredPasswordChangePage } from './features/auth/RequiredPasswordChangePage';

export function App() {
  const [router, setRouter] = useState<ReturnType<typeof createBrowserRouter>>();
  useEffect(() => {
    const next = createBrowserRouter([{ path: '*', element: <ReauthenticationProvider><AppRoutes /></ReauthenticationProvider> }]);
    setRouter(next);
    return () => next.dispose();
  }, []);
  return <LanguageProvider><ThemeProvider>{router && <RouterProvider router={router} />}</ThemeProvider></LanguageProvider>;
}

function AppRoutes() {
  return (
    <>
      <AuthToolbar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/mfa" element={<SecurityPage />} />
        <Route path="/change-password" element={<RequiredPasswordChangePage />} />
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
    </>
  );
}
