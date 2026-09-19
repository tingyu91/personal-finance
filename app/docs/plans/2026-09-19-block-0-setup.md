# Block 0 — Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the sign-off, register the domain in the AI OS, and scaffold `app/` so that `npm run dev` shows the empty Tally rail layout in both themes and `npm test` passes.

**Architecture:** One npm package in `personal-finance/app/`. `src/` holds the Node side (config, the Hono API, later the parsers and database). `web/` holds the React UI, served by Vite in development and by the Hono server from `dist/web` in `npm start`. Design tokens are compiled from the read-only `../design-system/tokens.json` into `web/src/styles/tokens.css` by a script, and a test keeps the two in sync.

**Tech Stack:** Node 20.11 (installed), TypeScript 5, React 18, Vite 6, Vitest 3, Hono 4 + @hono/node-server 1, tsx 4, concurrently 9, @fontsource/geist and @fontsource/geist-mono (vendored fonts), lucide-react.

**Spec:** `../../../prd/pending/prd-tally-personal-finance-2026-09-19.md` (§6 Constraints, §7.1 Folder layout, §8 Block 0)

## Global Constraints

- Node 20+ LTS. The machine runs Node 20.11.0, so every dependency must support it: Vite 6 (not 7+), Vitest 3 (not 4+ is fine too, but 3 is chosen), pdfjs-dist 4.x (5+ needs Node 20.16), better-sqlite3 12 (13 needs Node 22).
- The server binds to `127.0.0.1` only. No telemetry. No network calls at runtime. Fonts are vendored via npm, never loaded from Google Fonts.
- Money is integer cents (SGD) everywhere. Format only at render.
- `inputs/` is never written by the app or by Claude. `data/` and `outputs/` are machine-writable.
- `design-system/` is read-only. Tokens are compiled from it, never copied by hand. No raw hex in app code outside the generated `tokens.css`.
- Never write a full account or card number, an NRIC/FIN or a home address in code, tests, plans, commits or fixtures.
- UI copy: sentence case, second person, no emoji, no exclamation marks. Spending is never red.

## Decisions settled for this block

| Question | Choice | Why |
|---|---|---|
| Isolation | One git branch per block in `app/` itself, merged to `main` at block end. No worktree | `better-sqlite3` is a native module and the folder is OneDrive-synced; a second checkout means a second native install and a second sync tree |
| Ports | API on `127.0.0.1:5317`. Vite dev on `127.0.0.1:5173`, proxying `/api` | Fixed, local, unlikely to clash |
| Inbox location | `inputs/statements/`, overridable with `TALLY_INBOX_DIR` | Ting Yu has not yet moved the statements (Block 0.2). The override lets tests and the import run against the current folders without Claude writing to `inputs/` |
| Theme | Follows the system. A rail toggle cycles System → Light → Dark and is remembered in `localStorage`. `?theme=dark` forces it (used for screenshots) | The tokens support both; the toggle is one button |
| Routing | Hash routes (`#/overview` …). No router dependency | Five screens, local app |

---

### Task 1: Record the sign-off (0.1)

**Files:**
- Modify: `personal-finance/prd/pending/prd-tally-personal-finance-2026-09-19.md` (status line, §11)
- Modify: `personal-finance/CLAUDE.md` (status paragraph)

- [ ] **Step 1:** Change the PRD status line to `APPROVED, BUILDING` with the date and the instruction quoted, and note that Ting Yu asked for the blocks to run back to back without check-ins.
- [ ] **Step 2:** In §11, tick both boxes with "approved as written, go-ahead recorded by Claude from Ting Yu's instruction in Claude Code, 2026-09-19".
- [ ] **Step 3:** In `personal-finance/CLAUDE.md`, replace "PRD PENDING SIGN-OFF … No code exists yet" with the approved status and a pointer to `app/`.

### Task 2: Register the domain in the AI OS (0.4)

**Files:**
- Modify: `projects/CLAUDE.md` (active domains table, placeholder line, open threads)
- Create: `projects/memory/personal-finance/context.md`
- Modify: `projects/PRD-ting-yu-ai-os.md` (§11 amendment, footer version)
- Modify: `projects/TASKS.md` (Personal finance open threads)
- Modify: `projects/cowork-project-instructions.md` (active domains line; the Cowork UI paste stays manual)

- [ ] **Step 1:** Root `CLAUDE.md`: add `| Personal finance (Tally) | personal-finance/ | Local files only (no connectors) |` to Active Domains, remove personal-finance from the placeholder line, add an invariant noting personal figures never leave the domain.
- [ ] **Step 2:** `memory/personal-finance/context.md`: stack, isolation rules, decisions from PRD §9, open questions from PRD §10. No amounts, no identifiers.
- [ ] **Step 3:** AI OS PRD §11: an amendment dated 2026-09-19 in the same shape as the Jura one (what, registered in, decisions, outstanding).
- [ ] **Step 4:** `TASKS.md`: a "Personal finance (Tally)" section with Ting Yu's open threads (move statements into `inputs/statements/`, unseen card statements, PRD §10 answers, Cowork UI update).

### Task 3: Scaffold the package and toolchain (0.5)

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/vite.config.ts`, `app/vitest.config.ts`, `app/.gitignore`, `app/README.md`

- [ ] **Step 1:** `git init -b main` in `app/`.
- [ ] **Step 2:** Write `package.json` with scripts:

```json
{
  "scripts": {
    "tokens": "tsx scripts/build-tokens.ts",
    "dev": "npm run tokens && concurrently -k -n api,web \"tsx watch src/server/main.ts\" \"vite\"",
    "build": "npm run tokens && vite build",
    "start": "npm run build && tsx src/server/main.ts --static",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "import": "tsx src/cli/import.ts"
  }
}
```

- [ ] **Step 3:** `.gitignore` covers `node_modules/`, `dist/`, `data/`, `inputs/statements/`, `outputs/`, `*.pdf`, `.env*`.
- [ ] **Step 4:** `npm install` the pinned majors listed in the tech stack. Commit.

### Task 4: Config and data directories

**Files:**
- Create: `app/src/config.ts`
- Test: `app/src/config.test.ts`

**Interfaces:**
- Produces: `getPaths(env?: NodeJS.ProcessEnv): Paths` where `Paths = { root, dataDir, dbFile, vaultDir, rulesDir, inboxDir, outputsDir, reviewsDir, exportsDir }`; `ensureDirs(paths: Paths): void` (creates data and outputs trees, never `inputs/`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPaths, ensureDirs } from './config';

describe('config', () => {
  it('defaults data to personal-finance/data and the inbox to inputs/statements', () => {
    const p = getPaths({});
    expect(p.dataDir).toBe(path.join(p.root, 'data'));
    expect(p.inboxDir).toBe(path.join(p.root, 'inputs', 'statements'));
    expect(p.dbFile).toBe(path.join(p.dataDir, 'tally.db'));
  });
  it('honours TALLY_DATA_DIR and TALLY_INBOX_DIR', () => {
    const p = getPaths({ TALLY_DATA_DIR: '/tmp/x', TALLY_INBOX_DIR: '/tmp/in' });
    expect(p.dataDir).toBe(path.resolve('/tmp/x'));
    expect(p.inboxDir).toBe(path.resolve('/tmp/in'));
  });
  it('creates the data and outputs trees but never inputs/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
    const p = getPaths({ TALLY_DATA_DIR: path.join(tmp, 'data'), TALLY_OUTPUTS_DIR: path.join(tmp, 'outputs'), TALLY_INBOX_DIR: path.join(tmp, 'inputs', 'statements') });
    ensureDirs(p);
    for (const d of [p.dataDir, p.vaultDir, p.rulesDir, p.reviewsDir, p.exportsDir]) expect(fs.existsSync(d)).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'inputs'))).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/config.test.ts`, expect FAIL (module missing).
- [ ] **Step 3:** Implement `config.ts`: `root = path.resolve(__dirname, '..', '..')` (app/src → personal-finance), env overrides resolved with `path.resolve`.
- [ ] **Step 4:** Run, expect PASS. Commit.

### Task 5: Local API server bound to 127.0.0.1

**Files:**
- Create: `app/src/server/app.ts`, `app/src/server/main.ts`
- Test: `app/src/server/app.test.ts`

**Interfaces:**
- Produces: `createApp(ctx: AppContext): Hono` (routes under `/api`), `LISTEN = { hostname: '127.0.0.1', port: 5317 }`. `AppContext = { paths: Paths }` (grows in later blocks).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createApp, LISTEN } from './app';
import { getPaths } from '../config';

describe('server', () => {
  it('answers /api/health', async () => {
    const app = createApp({ paths: getPaths({}) });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: 'tally' });
  });
  it('listens on loopback only', () => {
    expect(LISTEN.hostname).toBe('127.0.0.1');
  });
});
```

- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement `app.ts` with Hono; `main.ts` calls `ensureDirs`, then `serve({ fetch: app.fetch, ...LISTEN })`, and with `--static` also serves `dist/web` via `serveStatic` with an `index.html` fallback.
- [ ] **Step 4:** Run, expect PASS. Commit.

### Task 6: Compile design tokens to CSS

**Files:**
- Create: `app/scripts/build-tokens.ts`, `app/src/tokens/compile.ts`, `app/web/src/styles/tokens.css` (generated, committed)
- Test: `app/src/tokens/compile.test.ts`

**Interfaces:**
- Produces: `compileTokens(json: TokensJson): string` returning CSS with `:root { … }` (light + type, spacing, radius, fonts), `[data-theme="dark"] { … }` and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compileTokens } from './compile';

const dsDir = path.resolve(__dirname, '../../../design-system');
const json = JSON.parse(fs.readFileSync(path.join(dsDir, 'tokens.json'), 'utf8'));

describe('compileTokens', () => {
  const css = compileTokens(json);
  it('emits every colour token for light and dark', () => {
    for (const t of json.color.tokens) {
      expect(css).toContain(`--${t.name}:`);
    }
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('prefers-color-scheme: dark');
  });
  it('resolves aliases like link → accent', () => {
    expect(css).toContain('--link: var(--accent);');
  });
  it('emits spacing, radius, shadows and font families', () => {
    expect(css).toContain('--space-4: 16px;');
    expect(css).toContain('--radius-md: 6px;');
    expect(css).toContain('--focus-ring:');
    expect(css).toContain('--font-sans:');
    expect(css).toContain('--font-mono:');
  });
  it('matches the committed tokens.css (run npm run tokens if this fails)', () => {
    const committed = fs.readFileSync(path.resolve(__dirname, '../../web/src/styles/tokens.css'), 'utf8');
    expect(committed).toBe(css);
  });
});
```

- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement `compile.ts` (light values in `:root`, dark values in both dark selectors, `{name}` aliases become `var(--name)`, type styles become `--type-<name>-size/-line/-weight/-tracking`), and `build-tokens.ts` that writes the file with a "generated, do not edit" header.
- [ ] **Step 4:** Run `npm run tokens`, then the test, expect PASS. Commit.

### Task 7: Port the design-system stylesheet and shell layout

**Files:**
- Create: `app/web/index.html`, `app/web/src/main.tsx`, `app/web/src/App.tsx`, `app/web/src/router.ts`, `app/web/src/theme.ts`, `app/web/src/styles/base.css`, `app/web/src/styles/components.css`, `app/web/src/screens/{Overview,Transactions,HomeProject,Insights,Statements}.tsx`
- Test: `app/web/src/App.test.tsx`

**Interfaces:**
- Produces: `SCREENS` (ordered list of `{ id, label, icon }`), `useRoute(): ScreenId`, `applyTheme(pref: 'system'|'light'|'dark')`.

- [ ] **Step 1: Write the failing test** (jsdom)

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App shell', () => {
  it('shows the five screens in the rail, in order', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Screens' });
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Overview', 'Transactions', 'Home project', 'Insights', 'Statements']);
  });
  it('opens on Overview with one page title', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview');
  });
});
```

- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement. `components.css` is `design-system/components/bundle.css` minus the Google Fonts `@import`. `main.tsx` imports `@fontsource/geist/{400,500,600}.css` and `@fontsource/geist-mono/{400,500}.css`. Rail: 220px, Tally name in Geist 600, Lucide icons at 20px / 1.5 stroke, `aria-current="page"` on the active item with `accent-soft`. Under 640px the rail becomes a bottom bar. Each screen renders a `title` h1 and an empty state that says what to do next.
- [ ] **Step 4:** Run, expect PASS. Commit.

### Task 8: Verify Block 0

- [ ] **Step 1:** `npm test` and `npm run typecheck` pass.
- [ ] **Step 2:** `npm run dev`; screenshot `http://127.0.0.1:5173/` at 1280×800 and 400×800 in light and `?theme=dark` with headless Edge. The rail layout shows in all four.
- [ ] **Step 3:** Merge the branch to `main`.

**Done-check (PRD §8):** `npm run dev` shows the empty rail layout in both themes. `npm test` passes. Steps 0.2 (moving statements) and 0.3 (plugins) are Ting Yu's; 0.3 is already satisfied (superpowers and frontend-design are installed).
