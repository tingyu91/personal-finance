import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api as realApi, type Api } from './api';

/**
 * The API client and a "data changed" counter shared by every screen. Tests pass a stub API.
 * After an import or a decision, screens call `changed()` and everything that shows totals
 * refetches, so the numbers always agree.
 */
interface DataContext {
  api: Api;
  version: number;
  changed: () => void;
}

const Ctx = createContext<DataContext>({ api: realApi, version: 0, changed: () => undefined });

export function DataProvider({ api = realApi, children }: { api?: Api; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  return <Ctx.Provider value={{ api, version, changed }}>{children}</Ctx.Provider>;
}

export function useData(): DataContext {
  return useContext(Ctx);
}

export interface Loaded<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

/** Loads with the API; keeps the previous data while reloading so nothing jumps. */
export function useLoad<T>(load: (api: Api) => Promise<T>, deps: unknown[]): Loaded<T> {
  const { api, version } = useData();
  const [state, setState] = useState<Loaded<T>>({ data: undefined, error: undefined, loading: true });
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    load(api).then(
      (data) => mine === seq.current && setState({ data, error: undefined, loading: false }),
      (e: unknown) => mine === seq.current && setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e), loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version, ...deps]);
  return state;
}
