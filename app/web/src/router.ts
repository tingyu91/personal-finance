import { useEffect, useState } from 'react';

export const SCREEN_IDS = ['overview', 'transactions', 'home-project', 'insights', 'statements'] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export interface Route {
  screen: ScreenId;
  /** Query parameters after the path, e.g. #/transactions?month=2026-08 */
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const [pathPart = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const screen = (SCREEN_IDS as readonly string[]).includes(pathPart) ? (pathPart as ScreenId) : 'overview';
  return { screen, params: new URLSearchParams(query) };
}

export function href(screen: ScreenId, params?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') q.set(k, v);
  const qs = q.toString();
  return `#/${screen}${qs ? `?${qs}` : ''}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
