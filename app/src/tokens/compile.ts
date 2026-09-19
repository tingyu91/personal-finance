/**
 * Compiles design-system/tokens.json (read-only) into CSS custom properties.
 * Light values sit on :root; dark values apply under [data-theme="dark"] and,
 * unless the user forced light, under prefers-color-scheme: dark.
 */

type Themed = string | { light: string; dark: string };

interface NamedToken {
  name: string;
  value: Themed;
}

interface TypeStyle {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
}

export interface TokensJson {
  color: { tokens: NamedToken[] };
  type: {
    families: Record<string, string>;
    groups: { name: string; styles: TypeStyle[] }[];
  };
  spacing: { tokens: NamedToken[] };
  radius: { tokens: NamedToken[] };
  shadow: { tokens: NamedToken[] };
}

const ALIAS = /^\{([a-z0-9-]+)\}$/;

function resolve(v: string): string {
  const m = ALIAS.exec(v);
  return m ? `var(--${m[1]})` : v;
}

function light(v: Themed): string {
  return resolve(typeof v === 'string' ? v : v.light);
}

function dark(v: Themed): string | null {
  return typeof v === 'string' ? null : resolve(v.dark);
}

export function compileTokens(json: TokensJson): string {
  const themed = [...json.color.tokens, ...json.shadow.tokens];
  const rootLines: string[] = [];
  const darkLines: string[] = [];

  for (const t of themed) {
    rootLines.push(`  --${t.name}: ${light(t.value)};`);
    const d = dark(t.value);
    if (d !== null) darkLines.push(`  --${t.name}: ${d};`);
  }
  for (const [name, stack] of Object.entries(json.type.families)) {
    rootLines.push(`  --font-${name}: ${stack};`);
  }
  for (const group of json.type.groups) {
    for (const s of group.styles) {
      rootLines.push(`  --type-${s.name}-size: ${s.fontSize};`);
      rootLines.push(`  --type-${s.name}-line: ${s.lineHeight};`);
      rootLines.push(`  --type-${s.name}-weight: ${s.fontWeight};`);
      if (s.letterSpacing) rootLines.push(`  --type-${s.name}-tracking: ${s.letterSpacing};`);
    }
  }
  for (const t of [...json.spacing.tokens, ...json.radius.tokens]) {
    rootLines.push(`  --${t.name}: ${light(t.value)};`);
  }

  const darkBlock = darkLines.join('\n');
  const indentedDark = darkLines.map((l) => '  ' + l).join('\n');
  return [
    '/* Generated from design-system/tokens.json by `npm run tokens`. Do not edit. */',
    ':root {',
    '  color-scheme: light;',
    ...rootLines,
    '}',
    '',
    '[data-theme="dark"] {',
    '  color-scheme: dark;',
    darkBlock,
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    '    color-scheme: dark;',
    indentedDark,
    '  }',
    '}',
    '',
  ].join('\n');
}
