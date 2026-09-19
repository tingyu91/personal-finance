// Compiles ../design-system/tokens.json (read-only) into web/src/styles/tokens.css.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTokens, type TokensJson } from '../src/tokens/compile';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(appDir, '..', 'design-system', 'tokens.json');
const out = path.join(appDir, 'web', 'src', 'styles', 'tokens.css');

// The design system lives beside app/ and is not in this repo. Without it, keep the compiled
// tokens.css that is committed, so a fresh clone still builds.
if (!fs.existsSync(src)) {
  if (!fs.existsSync(out)) throw new Error(`No ${path.relative(appDir, src)} and no compiled tokens.css to fall back on.`);
  console.log('design-system/tokens.json not found beside app/; keeping the committed tokens.css');
  process.exit(0);
}

const json = JSON.parse(fs.readFileSync(src, 'utf8')) as TokensJson;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, compileTokens(json));
console.log(`tokens.css written from ${path.relative(appDir, src)}`);
