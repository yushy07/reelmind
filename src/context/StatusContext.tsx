import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Status } from '../../shared/types';

interface StatusContextValue {
  data: Status | null;
  refresh: () => Promise<void>;
  busy: boolean;
  busyById: Record<string, boolean>;
  isBusy: (id?: string) => boolean;
  act: <T = void>(actionIdOrFn: string | (() => Promise<T>), fn?: () => Promise<T>) => Promise<T | undefined>;
  error: string;
  setError: (err: string) => void;
  toast: string;
  setToast: (msg: string) => void;
}

const StatusContext = createContext<StatusContextValue | null>(null);

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyById, setBusyById] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    try {
      if (window.reelmind) {
        const next = await window.reelmind.status();
        setData(next);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch studio status');
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = window.reelmind?.subscribe(() => refresh());
    const timer = setInterval(refresh, 5000);
    return () => {
      unsubscribe?.();
      clearInterval(timer);
    };
  }, [refresh]);

  const isBusy = useCallback((id?: string) => {
    if (!id) return busy;
    return busy || !!busyById[id];
  }, [busy, busyById]);

  const act = useCallback(
    async <T = void>(actionIdOrFn: string | (() => Promise<T>), maybeFn?: () => Promise<T>): Promise<T | undefined> => {
      const actionId = typeof actionIdOrFn === 'string' ? actionIdOrFn : 'global';
      const fn = typeof actionIdOrFn === 'function' ? actionIdOrFn : maybeFn;
      if (!fn) return undefined;

      setBusy(true);
      setBusyById((prev) => ({ ...prev, [actionId]: true }));
      setError('');

      try {
        const result = await fn();
        await refresh();
        return result;
      } catch (e: any) {
        setError(e?.message || 'Operation failed');
        throw e;
      } finally {
        setBusy(false);
        setBusyById((prev) => {
          const next = { ...prev };
          delete next[actionId];
          return next;
        });
      }
    },
    [refresh]
  );

  const value: StatusContextValue = {
    data,
    refresh,
    busy,
    busyById,
    isBusy,
    act,
    error,
    setError,
    toast,
    setToast,
  };

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useStatus(): StatusContextValue {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error('useStatus must be used within a StatusProvider');
  return ctx;
}
