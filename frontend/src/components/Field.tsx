import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon } from './Icon';
import styles from './Field.module.css';

type FieldProps = { label: string; hint?: ReactNode; optional?: boolean; children: ReactNode };

export const Field = ({ label, hint, optional, children }: FieldProps) => (
  <label className={styles.field}>
    <span className={styles.label}>
      {label}
      {optional && <span className={styles.optional}>اختیاری</span>}
    </span>
    {children}
    {hint && <span className={styles.hint}>{hint}</span>}
  </label>
);

type InputProps = InputHTMLAttributes<HTMLInputElement> & { mono?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(({ mono, className, ...rest }, ref) => (
  <input
    ref={ref}
    className={[styles.control, mono && styles.mono, className].filter(Boolean).join(' ')}
    dir={mono ? 'ltr' : undefined}
    {...rest}
  />
));
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...rest }, ref) => (
  <span className={styles.selectWrap}>
    <select ref={ref} className={[styles.control, styles.select, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
    <Icon name="chevronDown" size={16} className={styles.chevron} />
  </span>
));
Select.displayName = 'Select';

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const SearchInput = ({ className, ...rest }: SearchInputProps) => (
  <span className={[styles.searchWrap, className].filter(Boolean).join(' ')}>
    <Icon name="search" size={16} className={styles.searchIcon} />
    <input type="search" className={`${styles.control} ${styles.search}`} {...rest} />
  </span>
);
