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
import { ConsoleLayout } from './console/ConsoleLayout';
import { ConsoleManagementPage } from './console/ConsoleManagementPage';
import { ConsoleWorkflowPage } from './console/ConsoleWorkflowPage';
import { ConsoleHome } from './console/ConsoleHome';
import { ApiMonitoringPage } from './console/ApiMonitoringPage';
import { DataExchangePage } from './console/DataExchangePage';
import { ServiceOperationsPage } from './console/ServiceOperationsPage';
import { LegacyConsoleRedirect } from './features/navigation/LegacyConsoleRedirect';

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
        <Route path="/app/admin/*" element={<AuthenticatedRoute accountType="INTERNAL"><LegacyConsoleRedirect /></AuthenticatedRoute>} />
        <Route path="/app/workflow-designer/*" element={<AuthenticatedRoute accountType="INTERNAL"><LegacyConsoleRedirect /></AuthenticatedRoute>} />
        <Route path="/console/*" element={<AuthenticatedRoute accountType="INTERNAL"><ConsoleLayout /></AuthenticatedRoute>}>
          <Route index element={<ConsoleHome />} />
          <Route path="api-monitoring" element={<ApiMonitoringPage />} />
          <Route path="data-exchanges" element={<DataExchangePage />} />
          <Route path="services" element={<ServiceOperationsPage />} />
          {['users', 'organizations', 'master-data/suppliers', 'master-data/customers', 'master-data/materials', 'master-data/component-projects', 'configuration', 'audit-log', 'outbox', 'reconfiguration', 'problem-reconfiguration', 'supplier-accounts'].map(path => <Route key={path} path={path} element={<ConsoleManagementPage />} />)}
          <Route path="workflows/*" element={<ConsoleWorkflowPage />} />
        </Route>
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
