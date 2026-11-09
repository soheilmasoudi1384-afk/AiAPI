import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Button, IconButton } from './Button';
import styles from './Modal.module.css';

type ModalProps = {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** اگر داده شود محتوا و دکمه‌ها داخل یک فرم قرار می‌گیرند. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  size?: 'sm' | 'md';
};

export const Modal = ({ title, description, onClose, children, footer, onSubmit, size = 'md' }: ModalProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const content = (
    <>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[size]}`}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 id="modal-title" className={styles.title}>{title}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        <IconButton icon="x" label="بستن" size="sm" onClick={onClose} />
      </header>
      {onSubmit ? (
        <form onSubmit={onSubmit} className={styles.form}>{content}</form>
      ) : (
        content
      )}
    </dialog>
  );
};

type ConfirmDialogProps = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

export const ConfirmDialog = ({ title, message, confirmLabel, danger, busy, error, onConfirm, onClose }: ConfirmDialogProps) => (
  <Modal
    title={title}
    size="sm"
    onClose={onClose}
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>انصراف</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </>
    }
  >
    <p className={styles.message}>{message}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </Modal>
);
