import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { ThemeToggle } from './AppShell';
import styles from './AuthLayout.module.css';

type AuthLayoutProps = {
  brand: string;
  headline: string;
  points: { icon: IconName; text: string }[];
  links: ReactNode;
  children: ReactNode;
};

export const AuthLayout = ({ brand, headline, points, links, children }: AuthLayoutProps) => (
  <div className={styles.layout}>
    <div className={styles.formSide}>
      <div className={styles.top}>
        <span className={styles.brand}>
          <span className={styles.logo} aria-hidden="true"><Icon name="zap" size={18} strokeWidth={2.2} /></span>
          {brand}
        </span>
        <ThemeToggle />
      </div>
      <main className={styles.card}>{children}</main>
      <nav className={styles.links}>{links}</nav>
    </div>
    <aside className={styles.hero} aria-hidden="true">
      <div className={styles.heroInner}>
        <h2 className={styles.headline}>{headline}</h2>
        <ul className={styles.points}>
          {points.map((point) => (
            <li key={point.text}>
              <span><Icon name={point.icon} size={18} /></span>
              {point.text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  </div>
);
