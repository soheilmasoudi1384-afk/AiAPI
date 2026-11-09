import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isUnauthorized, request } from './api';

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };

export type Session<TInfo> = {
  token: string;
  info: TInfo;
  api: <T>(path: string, options?: RequestOptions) => Promise<T>;
  refresh: () => Promise<void>;
  logout: () => void;
};

export type LoginControl = { submit: (token: string) => Promise<void> };

type Config<TInfo> = {
  storageKey: string;
  /** توکن را با یک درخواست واقعی می‌سنجد و اطلاعات نشست را برمی‌گرداند. */
  verify: (token: string) => Promise<TInfo>;
};

type Phase<TInfo> = { kind: 'checking' } | { kind: 'out' } | { kind: 'in'; token: string; info: TInfo };

const readStored = (key: string): string => {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

const writeStored = (key: string, value: string | null): void => {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* ذخیره‌سازی در دسترس نیست؛ نشست فقط در حافظه می‌ماند */
  }
};

/**
 * برای هر ناحیه (کاربر / ادمین) یک نشست مستقل می‌سازد.
 * توکن فقط در sessionStorage همین تب نگه داشته می‌شود.
 */
export const createSession = <TInfo,>(config: Config<TInfo>) => {
  const Context = createContext<Session<TInfo> | null>(null);

  const SessionGate = ({
    login,
    checking,
    children,
  }: {
    login: (control: LoginControl) => ReactNode;
    checking: ReactNode;
    children: ReactNode;
  }) => {
    const [phase, setPhase] = useState<Phase<TInfo>>(() =>
      readStored(config.storageKey) ? { kind: 'checking' } : { kind: 'out' },
    );

    const logout = useCallback(() => {
      writeStored(config.storageKey, null);
      setPhase({ kind: 'out' });
    }, []);

    useEffect(() => {
      const stored = readStored(config.storageKey);
      if (!stored) return;
      let cancelled = false;
      config
        .verify(stored)
        .then((info) => !cancelled && setPhase({ kind: 'in', token: stored, info }))
        .catch(() => {
          if (cancelled) return;
          writeStored(config.storageKey, null);
          setPhase({ kind: 'out' });
        });
      return () => {
        cancelled = true;
      };
    }, []);

    const submit = useCallback(async (raw: string) => {
      const token = raw.trim();
      const info = await config.verify(token);
      writeStored(config.storageKey, token);
      setPhase({ kind: 'in', token, info });
    }, []);

    const token = phase.kind === 'in' ? phase.token : '';

    const api = useCallback(
      async <T,>(path: string, options?: RequestOptions): Promise<T> => {
        try {
          return await request<T>(path, token, options);
        } catch (error) {
          if (isUnauthorized(error)) logout();
          throw error;
        }
      },
      [token, logout],
    );

    const refresh = useCallback(async () => {
      if (!token) return;
      const info = await config.verify(token);
      setPhase({ kind: 'in', token, info });
    }, [token]);

    const value = useMemo<Session<TInfo> | null>(
      () => (phase.kind === 'in' ? { token: phase.token, info: phase.info, api, refresh, logout } : null),
      [phase, api, refresh, logout],
    );

    if (phase.kind === 'checking') return <>{checking}</>;
    if (!value) return <>{login({ submit })}</>;
    return <Context.Provider value={value}>{children}</Context.Provider>;
  };

  const useSession = (): Session<TInfo> => {
    const session = useContext(Context);
    if (!session) throw new Error('useSession باید داخل SessionGate استفاده شود');
    return session;
  };

  return { SessionGate, useSession };
};
