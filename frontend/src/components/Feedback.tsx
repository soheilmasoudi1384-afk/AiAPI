import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import styles from './Feedback.module.css';

export const Skeleton = ({ height = 16, width = '100%', radius }: { height?: number; width?: number | string; radius?: number }) => (
  <span className={styles.skeleton} style={{ height, width, borderRadius: radius }} aria-hidden="true" />
);

export const PageLoader = ({ label = 'در حال بارگذاری…' }: { label?: string }) => (
  <div className={styles.loader} role="status">
    <span className={styles.spinner} aria-hidden="true" />
    <span>{label}</span>
  </div>
);

type EmptyStateProps = { icon: IconName; title: string; description?: ReactNode; action?: ReactNode };

export const EmptyState = ({ icon, title, description, action }: EmptyStateProps) => (
  <div className={styles.empty}>
    <span className={styles.emptyIcon}><Icon name={icon} size={22} /></span>
    <h3 className={styles.emptyTitle}>{title}</h3>
    {description && <p className={styles.emptyText}>{description}</p>}
    {action}
  </div>
);

type AlertProps = {
  tone: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
};

const ALERT_ICONS: Record<AlertProps['tone'], IconName> = { info: 'info', warning: 'alert', danger: 'alert', success: 'check' };

export const Alert = ({ tone, title, children, action }: AlertProps) => (
  <div className={`${styles.alert} ${styles[tone]}`} role={tone === 'danger' ? 'alert' : 'status'}>
    <Icon name={ALERT_ICONS[tone]} size={19} />
    <div className={styles.alertBody}>
      {title && <strong>{title}</strong>}
      {children && <span>{children}</span>}
    </div>
    {action}
  </div>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className={styles.empty} role="alert">
    <span className={`${styles.emptyIcon} ${styles.emptyIconDanger}`}><Icon name="alert" size={22} /></span>
    <h3 className={styles.emptyTitle}>بارگذاری انجام نشد</h3>
    <p className={styles.emptyText}>{message}</p>
    {onRetry && <Button icon="refresh" onClick={onRetry}>تلاش دوباره</Button>}
  </div>
);
