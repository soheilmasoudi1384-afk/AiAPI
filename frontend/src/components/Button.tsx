import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', icon, loading, block, disabled, className, children, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[styles.button, styles[variant], styles[size], block && styles.block, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

type IconButtonProps = Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, variant = 'ghost', size = 'md', className, ...rest }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      icon={icon}
      aria-label={label}
      title={label}
      className={[styles.iconOnly, className].filter(Boolean).join(' ')}
      {...rest}
    />
  ),
);
IconButton.displayName = 'IconButton';
