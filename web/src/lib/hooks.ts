import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ApiError } from './api';

/** Simple data-fetching hook with refetch support. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<T>(path);
      if (alive.current) setData(result);
    } catch (err) {
      if (alive.current) setError(err as Error);
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  return { data, error, loading, refetch: load };
}

/** Poll an endpoint on an interval while `active` (used for job progress). */
export function usePolling<T>(path: string | null, intervalMs: number, active = true) {
  const result = useApi<T>(active ? path : null);
  useEffect(() => {
    if (!active || !path) return;
    const t = setInterval(() => void result.refetch(), intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, intervalMs, active]);
  return result;
}
