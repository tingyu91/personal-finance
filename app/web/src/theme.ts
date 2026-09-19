export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'tally.theme';
const ORDER: ThemePref[] = ['system', 'light', 'dark'];

export function readThemePref(): ThemePref {
  const forced = new URLSearchParams(window.location.search).get('theme');
  if (forced === 'light' || forced === 'dark') return forced;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // Storage can be unavailable; fall back to the system theme.
  }
  return 'system';
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function saveThemePref(pref: ThemePref): void {
  try {
    window.localStorage.setItem(KEY, pref);
  } catch {
    // Not fatal: the choice just will not be remembered.
  }
}

export function nextThemePref(pref: ThemePref): ThemePref {
  return ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length] ?? 'system';
}
