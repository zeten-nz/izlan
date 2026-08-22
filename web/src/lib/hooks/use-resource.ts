'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: unknown | null;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * Minimal read-resource loader with loading/error/reload. No global cache, no automatic retry — mutations refetch
 * explicitly (keeps OCC token authority correct). `loader` should be stable or wrapped in useCallback by the caller.
 */
export function useResource<T>(loader: () => Promise<T>, deps: readonly unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loader()
      .then((res) => {
        if (active && mounted.current) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active && mounted.current) {
          setError(e);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setDataCb = useCallback((updater: (prev: T | null) => T | null) => setData((prev) => updater(prev)), []);
  return { data, loading, error, reload, setData: setDataCb };
}
