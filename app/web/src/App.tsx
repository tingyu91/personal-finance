import { useEffect, useState, type ComponentType } from 'react';
import { FileStack, House, LayoutDashboard, Lightbulb, ReceiptText, type LucideProps } from 'lucide-react';
import { href, useRoute, type ScreenId } from './router';
import { applyTheme, nextThemePref, readThemePref, saveThemePref, type ThemePref } from './theme';
import { Overview } from './screens/Overview';
import { Transactions } from './screens/Transactions';
import { HomeProject } from './screens/HomeProject';
import { Insights } from './screens/Insights';
import { Statements } from './screens/Statements';

export interface ScreenDef {
  id: ScreenId;
  label: string;
  icon: ComponentType<LucideProps>;
  component: ComponentType;
}

export const SCREENS: ScreenDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, component: Overview },
  { id: 'transactions', label: 'Transactions', icon: ReceiptText, component: Transactions },
  { id: 'home-project', label: 'Home project', icon: House, component: HomeProject },
  { id: 'insights', label: 'Insights', icon: Lightbulb, component: Insights },
  { id: 'statements', label: 'Statements', icon: FileStack, component: Statements },
];

const THEME_LABEL: Record<ThemePref, string> = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

function ThemeButton() {
  const [pref, setPref] = useState<ThemePref>(() => readThemePref());
  useEffect(() => applyTheme(pref), [pref]);
  return (
    <button
      type="button"
      className="ty-btn ty-btn-quiet theme-btn"
      onClick={() => {
        const next = nextThemePref(pref);
        saveThemePref(next);
        setPref(next);
      }}
    >
      {THEME_LABEL[pref]}
    </button>
  );
}

export function App() {
  const route = useRoute();
  const current = SCREENS.find((s) => s.id === route.screen) ?? SCREENS[0]!;
  const Screen = current.component;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Tally</span>
        <ThemeButton />
      </header>
      <aside className="rail">
        <span className="brand rail-brand">Tally</span>
        <nav aria-label="Screens" className="rail-nav">
          {SCREENS.map((s) => {
            const Icon = s.icon;
            const active = s.id === current.id;
            return (
              <a key={s.id} href={href(s.id)} aria-current={active ? 'page' : undefined} className="rail-link">
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                <span>{s.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="rail-foot">
          <ThemeButton />
          <p className="ty-note">Your statements stay on this computer.</p>
        </div>
      </aside>
      <main className="content" id="main">
        <Screen />
      </main>
    </div>
  );
}
