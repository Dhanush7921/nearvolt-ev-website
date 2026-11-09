// Browser QA: screenshots at several viewports, console errors, overflow, anchor and asset checks.
// node scripts/qa.mjs <baseUrl> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const base = process.argv[2], out = process.argv[3] || 'qa';
const only = process.argv[4];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const VP = { desktop: [1440, 900, false], laptop: [1280, 720, false], tablet: [768, 1024, true], mobile: [390, 844, true], small: [360, 740, true] };
const report = [];
for (const [name, [w, h, touch]] of Object.entries(VP)) {
  if (only && !only.split(',').includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, reducedMotion: process.env.REDUCED ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('requestfailed', (r) => errs.push('failed ' + r.url()));
  page.on('response', (r) => r.status() >= 400 && errs.push(r.status() + ' ' + r.url()));
  await page.goto(base + (process.env.QS || '?nointro&low'), { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/${name}-hero.jpg`, quality: 70, type: 'jpeg', timeout: 180000 });
  const info = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.querySelector(h));
    return { overflow: document.documentElement.scrollWidth - innerWidth, missingAnchors: ids, oldBrand: /green\s*plug/i.test(document.body.innerText) };
  });
  if (name === 'desktop' || name === 'mobile') {
    for (const id of ['experience', 'drivers', 'app', 'vision']) {
      await page.evaluate((id) => { const el = document.getElementById(id); scrollTo(0, el.offsetTop + (id === 'experience' ? el.offsetHeight * 0.5 : 0)); }, id);
      await page.waitForTimeout(2200);
      await page.screenshot({ path: `${out}/${name}-${id}.jpg`, quality: 70, type: 'jpeg', timeout: 180000 });
    }
  }
  report.push({ name, ...info, errors: errs });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
