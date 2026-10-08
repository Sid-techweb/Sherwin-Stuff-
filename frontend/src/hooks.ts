import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { Meta } from './api';

/** Runs an async loader whenever deps change; ignores stale responses. */
export function useFetch<T>(loader: () => Promise<{ data: T; meta?: Meta }>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<Meta>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    loader()
      .then((r) => {
        if (id !== seq.current) return;
        setData(r.data);
        setMeta(r.meta ?? {});
        setError(null);
      })
      .catch((e: Error) => id === seq.current && setError(e.message))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(run, [run]);
  return { data, meta, loading, error, reload: run };
}
