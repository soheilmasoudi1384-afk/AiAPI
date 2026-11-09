import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, type NavItem } from '../../components/AppShell';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { AdminGate, useAdminSession } from '../../lib/sessions';
import { LoginPage } from './LoginPage';
import styles from './AdminApp.module.css';

const PoolPage = lazy(() => import('./PoolPage').then((module) => ({ default: module.PoolPage })));
const UsersPage = lazy(() => import('./UsersPage').then((module) => ({ default: module.UsersPage })));
const StatsPage = lazy(() => import('./StatsPage').then((module) => ({ default: module.StatsPage })));

const NAV: NavItem[] = [
  { to: '/admin-ui', label: 'زیرساخت', icon: 'server', end: true },
  { to: '/admin-ui/users', label: 'کاربران', icon: 'users' },
  { to: '/admin-ui/stats', label: 'آمار و درآمد', icon: 'chart' },
];

const AdminLayout = () => {
  const { logout } = useAdminSession();

  useEffect(() => {
    document.title = 'پنل مدیریت';
  }, []);

  return (
    <AppShell
      brand="پنل مدیریت"
      badge="AI Gateway"
      nav={NAV}
      topbarActions={
        <>
          <Badge tone="warning">مدیر</Badge>
          <a className={styles.topLink} href="/status">
            <Icon name="activity" size={16} />
            وضعیت عمومی
          </a>
        </>
      }
      sidebarFooter={<Button variant="ghost" icon="logout" block onClick={logout} className={styles.logout}>خروج</Button>}
    >
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<PoolPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="*" element={<Navigate to="/admin-ui" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
};

export const AdminApp = () => (
  <AdminGate login={(control) => <LoginPage {...control} />} checking={<PageLoader />}>
    <AdminLayout />
  </AdminGate>
);
