import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compileTokens, type TokensJson } from './compile';

const dsDir = path.resolve(__dirname, '../../../design-system');
const json = JSON.parse(fs.readFileSync(path.join(dsDir, 'tokens.json'), 'utf8')) as TokensJson;

describe('compileTokens', () => {
  const css = compileTokens(json);

  it('emits every colour token, with light in :root and dark under both dark selectors', () => {
    for (const t of json.color.tokens) expect(css).toContain(`--${t.name}:`);
    expect(css).toContain('--surface: #f5f6f8;');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css.match(/--surface: #0f1115;/g)?.length).toBe(2);
  });

  it('resolves aliases like link → accent', () => {
    expect(css).toContain('--link: var(--accent);');
  });

  it('emits type styles, spacing, radius, shadows and font families', () => {
    expect(css).toContain('--space-4: 16px;');
    expect(css).toContain('--radius-md: 6px;');
    expect(css).toContain('--focus-ring: 0 0 0 2px #ffffff, 0 0 0 4px #2447b8;');
    expect(css).toContain('--font-sans: "Geist"');
    expect(css).toContain('--font-mono: "Geist Mono"');
    expect(css).toContain('--type-figure-display-size: 44px;');
    expect(css).toContain('--type-label-tracking: 0.04em;');
  });

  it('matches the committed tokens.css (run `npm run tokens` if this fails)', () => {
    const committed = fs.readFileSync(path.resolve(__dirname, '../../web/src/styles/tokens.css'), 'utf8');
    expect(committed).toBe(css);
  });
});
