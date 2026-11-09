import type { ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

type BadgeProps = { tone?: BadgeTone; dot?: boolean; children: ReactNode };

export const Badge = ({ tone = 'neutral', dot, children }: BadgeProps) => (
  <span className={`${styles.badge} ${styles[tone]}`}>
    {dot && <span className={styles.dot} aria-hidden="true" />}
    {children}
  </span>
);
