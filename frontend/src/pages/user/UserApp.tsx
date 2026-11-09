import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, type NavItem } from '../../components/AppShell';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { UserGate, useUserSession } from '../../lib/sessions';
import { LoginPage } from './LoginPage';
import styles from './UserApp.module.css';

const OverviewPage = lazy(() => import('./OverviewPage').then((module) => ({ default: module.OverviewPage })));
const KeysPage = lazy(() => import('./KeysPage').then((module) => ({ default: module.KeysPage })));
const UsagePage = lazy(() => import('./UsagePage').then((module) => ({ default: module.UsagePage })));
const ModelsPage = lazy(() => import('./ModelsPage').then((module) => ({ default: module.ModelsPage })));
const QuickstartPage = lazy(() => import('./QuickstartPage').then((module) => ({ default: module.QuickstartPage })));

const NAV: NavItem[] = [
  { to: '/panel', label: 'نمای کلی', icon: 'dashboard', end: true },
  { to: '/panel/keys', label: 'کلیدهای API', icon: 'key' },
  { to: '/panel/usage', label: 'مصرف', icon: 'chart' },
  { to: '/panel/models', label: 'مدل‌ها', icon: 'layers' },
  { to: '/panel/quickstart', label: 'شروع سریع', icon: 'terminal' },
];

const UserLayout = () => {
  const { info: me, logout } = useUserSession();

  useEffect(() => {
    document.title = `${me.site} | پنل کاربر`;
  }, [me.site]);

  return (
    <AppShell
      brand={me.site}
      badge="پنل کاربر"
      nav={NAV}
      topbarActions={
        <>
          <a className={styles.topLink} href="/docs">
            <Icon name="book" size={16} />
            مستندات API
          </a>
          <a className={styles.topLink} href="/status">
            <Icon name="activity" size={16} />
            وضعیت سرویس
          </a>
        </>
      }
      sidebarFooter={
        <>
          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">{me.name.trim().charAt(0).toUpperCase() || '؟'}</span>
            <span className={styles.accountText}>
              <strong>{me.name}</strong>
              <small>پلن {me.plan}</small>
            </span>
          </div>
          <Button variant="ghost" icon="logout" block onClick={logout} className={styles.logout}>خروج</Button>
        </>
      }
    >
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="keys" element={<KeysPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="quickstart" element={<QuickstartPage />} />
          <Route path="*" element={<Navigate to="/panel" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
};

export const UserApp = () => (
  <UserGate login={(control) => <LoginPage {...control} />} checking={<PageLoader />}>
    <UserLayout />
  </UserGate>
);
