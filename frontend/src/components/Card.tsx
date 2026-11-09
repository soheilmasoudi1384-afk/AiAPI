import type { ReactNode } from 'react';
import styles from './Card.module.css';

type CardProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
};

export const Card = ({ title, description, actions, flush, className, children }: CardProps) => (
  <section className={[styles.card, className].filter(Boolean).join(' ')}>
    {(title || actions) && (
      <header className={styles.header}>
        <div className={styles.heading}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
    )}
    <div className={flush ? styles.flush : styles.body}>{children}</div>
  </section>
);
