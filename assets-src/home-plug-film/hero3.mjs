// capture the live NEARVOLT V3 hero (desktop + phone portrait) for the film's final frames
import { serve } from '/home/claude/nearvolt-ev-website/scripts/serve.mjs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(require_path());
function require_path() { return process.env.PW || 'playwright'; }
const out = process.argv[2];
const s = await serve('/home/claude/nearvolt-ev-website/dist', 4199, '/nearvolt-ev-website/');
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, vp, dpr, mobile] of [['hero-land', { width: 1920, height: 1080 }, 1, false], ['hero-port', { width: 405, height: 720 }, 1080 / 405, true]]) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  await p.addInitScript(() => sessionStorage.setItem('nv3-intro', '1'));
  await p.goto('http://localhost:4199/nearvolt-ev-website/?nointro', { waitUntil: 'load' });
  await p.waitForFunction(() => !document.getElementById('v3-loader'), null, { timeout: 120000 }).catch(() => console.log('loader still present'));
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 92 });
  console.log('saved', name);
  await p.close();
}
await b.close(); s.close();
