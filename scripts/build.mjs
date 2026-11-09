// Build: TypeScript (tsc, no bundler) + static copy. Relative URLs make it base-path independent (GitHub Pages).
import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
const withRender = process.argv.includes('--with-render');
const OUT = process.env.OUT || 'dist';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
execSync(`tsc -p . --outDir ${OUT}/js`, { stdio: 'inherit' });
if (!withRender) rmSync(`${OUT}/js/render.js`, { force: true });
for (const f of readdirSync('.').filter((f) => f.endsWith('.html'))) if (withRender || f !== 'render.html') cpSync(f, `${OUT}/${f}`);
cpSync('styles', `${OUT}/styles`, { recursive: true });
cpSync('public', OUT, { recursive: true });
if (existsSync(`${OUT}/video/master`)) rmSync(`${OUT}/video/master`, { recursive: true, force: true });
console.log(`built ${OUT}/` + (withRender ? ' (with intro renderer)' : ''));
