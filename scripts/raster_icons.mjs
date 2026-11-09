// Rasterises the SVG app icon to PNG (apple-touch / manifest) with headless Chrome.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const svg = readFileSync('public/brand/app-icon.svg', 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
for (const s of [512, 192]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<style>body{margin:0}svg{width:${s}px;height:${s}px;display:block}</style>${svg}`);
  await p.screenshot({ path: `public/brand/app-icon-${s}.png`, omitBackground: true });
}
const p = await b.newPage({ viewport: { width: 900, height: 260 } });
await p.setContent(`<body style="margin:0;background:#060908;display:grid;gap:20px;padding:20px"><img src="data:image/svg+xml;base64,${Buffer.from(readFileSync('public/brand/logo-on-dark.svg')).toString('base64')}" height="64"><div style="background:#fff;padding:10px"><img src="data:image/svg+xml;base64,${Buffer.from(readFileSync('public/brand/logo-on-light.svg')).toString('base64')}" height="64"></div></body>`);
await p.screenshot({ path: '/tmp/logos.png' });
await b.close();
