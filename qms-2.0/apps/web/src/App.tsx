import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { LoginPage } from './features/auth/LoginPage';
import { AuthenticatedRoute } from './features/auth/AuthenticatedRoute';
import { InternalLayout } from './layouts/InternalLayout';
import { SupplierLayout } from './layouts/SupplierLayout';

export function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
    </Router>
  );
}
