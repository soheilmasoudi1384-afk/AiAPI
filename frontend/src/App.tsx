import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoader } from './components/Feedback';

const UserApp = lazy(() => import('./pages/user/UserApp').then((module) => ({ default: module.UserApp })));
const AdminApp = lazy(() => import('./pages/admin/AdminApp').then((module) => ({ default: module.AdminApp })));
const StatusPage = lazy(() => import('./pages/status/StatusPage').then((module) => ({ default: module.StatusPage })));

export const App = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/panel/*" element={<UserApp />} />
      <Route path="/admin-ui/*" element={<AdminApp />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="*" element={<Navigate to="/panel" replace />} />
    </Routes>
  </Suspense>
);
