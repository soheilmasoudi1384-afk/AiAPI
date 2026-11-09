import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../lib/theme';
import styles from './AppShell.module.css';

export type NavItem = { to: string; label: string; icon: IconName; end?: boolean };

type AppShellProps = {
  brand: string;
  badge?: string;
  nav: NavItem[];
  sidebarFooter: ReactNode;
  topbarActions?: ReactNode;
  children: ReactNode;
};

export const ThemeToggle = () => {
  const { theme, toggle } = useTheme();
  return (
    <IconButton
      icon={theme === 'dark' ? 'sun' : 'moon'}
      label={theme === 'dark' ? 'تم روشن' : 'تم تاریک'}
      onClick={toggle}
    />
  );
};

export const AppShell = ({ brand, badge, nav, sidebarFooter, topbarActions, children }: AppShellProps) => {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const current = nav.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>رفتن به محتوا</a>
      {open && <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`${styles.sidebar} ${open ? styles.open : ''}`} aria-label="منوی اصلی">
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            <Icon name="zap" size={19} strokeWidth={2.2} />
          </span>
          <span className={styles.brandText}>
            <strong>{brand}</strong>
            {badge && <small>{badge}</small>}
          </span>
        </div>
        <nav className={styles.nav}>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
              <Icon name={item.icon} size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.footer}>{sidebarFooter}</div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <IconButton icon="menu" label="باز کردن منو" className={styles.menuButton} onClick={() => setOpen(true)} />
          <span className={styles.crumb}>{current?.label}</span>
          <div className={styles.topActions}>
            {topbarActions}
            <ThemeToggle />
          </div>
        </header>
        <main id="main" className={styles.main} tabIndex={-1}>
          <div className={styles.page}>{children}</div>
        </main>
      </div>
    </div>
  );
};
