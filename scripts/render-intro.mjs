// Renders the intro film frame by frame with the site's own WebGL renderer in headless Chrome.
// node scripts/render-intro.mjs --framing land --w 1920 --h 1080 --fps 30 --out frames/land [--times 0,2,4]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const framing = arg('framing', 'land'), W = +arg('w', 1920), H = +arg('h', 1080), fps = +arg('fps', 30), out = arg('out', `frames/${framing}`);
const from = +arg('from', 0), to = +arg('to', 1e9);
const times = arg('times') ? arg('times').split(',').map(Number) : null;
mkdirSync(out, { recursive: true });
const PORT = +(process.env.PORT || 4199);
const server = await serve('dist', PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => m.type() === 'error' && console.error('page:', m.text()));
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(`http://localhost:${PORT}/render.html?framing=${framing}&w=${W}&h=${H}`);
await page.waitForFunction(() => window.__ready);
await page.evaluate(() => window.__ready);
const len = await page.evaluate(() => window.__len);
const list = times || Array.from({ length: Math.round(len * fps) + 1 }, (_, i) => i / fps);
let n = 0;
for (const t of list) {
  if (!times && (n < from || n > to)) { n++; continue; }
  await page.evaluate((t) => window.__frame(t), t);
  await page.screenshot({ path: times ? `${out}/t${t.toFixed(2)}.jpg` : `${out}/f${String(n).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 95 });
  n++;
  if (n % 30 === 0) console.log(`${framing}: ${n}/${list.length}`);
}
await browser.close();
server.close();
console.log('done', n, 'frames');
