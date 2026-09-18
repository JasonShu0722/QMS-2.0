import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { LoginPage } from './features/auth/LoginPage';
import { InternalLayout } from './layouts/InternalLayout';
import { SupplierLayout } from './layouts/SupplierLayout';

export function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app/*" element={<InternalLayout />} />
        <Route path="/supplier/*" element={<SupplierLayout />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}
