import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Toast.module.css';

type Tone = 'success' | 'danger' | 'info';
type ToastItem = { id: number; tone: Tone; message: string };

type ToastApi = { show: (message: string, tone?: Tone) => void };

const ToastContext = createContext<ToastApi | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((item) => item.id !== id)), []);

  const show = useCallback(
    (message: string, tone: Tone = 'success') => {
      const id = ++counter.current;
      setItems((list) => [...list.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`${styles.toast} ${styles[item.tone]}`}>
            <Icon name={item.tone === 'danger' ? 'alert' : item.tone === 'info' ? 'info' : 'check'} size={17} />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastApi => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast باید داخل ToastProvider استفاده شود');
  return context;
};
