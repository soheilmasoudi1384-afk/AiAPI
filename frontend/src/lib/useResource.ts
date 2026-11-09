import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

type Options = { interval?: number };

type Resource<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  updatedAt: number | null;
  reload: () => Promise<void>;
};

/**
 * بارگذاری داده با نگه‌داشتن آخرین مقدار موفق هنگام بارگذاری دوباره،
 * و polling اختیاری که وقتی تب پنهان است متوقف می‌شود.
 */
export const useResource = <T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], options: Options = {}): Resource<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const mine = ++generation.current;
    setRefreshing(true);
    try {
      const result = await loadRef.current(current.signal);
      if (mine !== generation.current) return;
      setData(result);
      setError(null);
      setUpdatedAt(Date.now() / 1000);
    } catch (caught) {
      if (mine !== generation.current || current.signal.aborted) return;
      setError(errorMessage(caught));
    } finally {
      if (mine === generation.current) setRefreshing(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void run();
    return () => controller.current?.abort();
  }, deps);

  const interval = options.interval;
  useEffect(() => {
    if (!interval) return;
    const timer = setInterval(() => {
      if (!document.hidden) void run();
    }, interval);
    return () => clearInterval(timer);
  }, [interval, run]);

  return { data, error, loading: data === null && error === null, refreshing, updatedAt, reload: run };
};
