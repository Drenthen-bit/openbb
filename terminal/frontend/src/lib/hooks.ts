import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/** Run an async loader when deps change, optionally refreshing on an interval. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], refreshMs?: number): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    const run = (initial: boolean) => {
      if (initial) setLoading(true);
      loaderRef
        .current()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(undefined);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setLoading(false));
    };
    run(true);
    const id = refreshMs ? setInterval(() => run(false), refreshMs) : undefined;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, refreshMs]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  }, [key, v]);
  return [v, setV];
}
