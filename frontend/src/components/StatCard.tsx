import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './StatCard.module.css';

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

type StatCardProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: IconName;
  tone?: Tone;
  children?: ReactNode;
};

export const StatCard = ({ label, value, hint, icon, tone = 'accent', children }: StatCardProps) => (
  <div className={styles.card}>
    <div className={styles.top}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.icon} ${styles[tone]}`}>
        <Icon name={icon} size={17} />
      </span>
    </div>
    <div className={styles.value}>{value}</div>
    {hint && <div className={styles.hint}>{hint}</div>}
    {children}
  </div>
);
