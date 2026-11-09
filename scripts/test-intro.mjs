// Intro flow test: plays the film, checks handoff, skip, session memory and broken-video fallback.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const base = process.argv[2];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const res = {};
const state = (p) => p.evaluate(() => ({ introHidden: document.getElementById('intro').hidden, introOn: document.body.classList.contains('intro-on'), t: document.getElementById('intro-video').currentTime, src: document.getElementById('intro-video').currentSrc.split('/').pop(), seen: sessionStorage.getItem('nv-intro') }));
{ // full play
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '?low');
  await p.waitForTimeout(2500); res.playing = await state(p);
  await p.screenshot({ path: '/tmp/intro-mid.jpg', timeout: 120000 });
  await p.waitForFunction(() => document.getElementById('intro').hidden, null, { timeout: 60000 });
  res.afterEnd = await state(p);
  await p.reload(); await p.waitForTimeout(1500); res.secondLoad = await state(p);
  res.errors = errs; await ctx.close();
}
{ // skip
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); p.on('console', (m) => console.log('m:', m.text())); await p.goto(base + '?low'); await p.waitForTimeout(2000);
  res.mobile = await state(p);
  if (res.mobile.introHidden) { await ctx.close(); } else {
  res.mobileClass = await p.evaluate(() => document.getElementById('intro').className + ' / ' + getComputedStyle(document.getElementById('intro-skip')).visibility + ' ' + document.getElementById('intro-skip').getBoundingClientRect().top);
  await p.evaluate(() => document.getElementById('intro-skip').click()); await p.waitForTimeout(1200); res.afterSkip = await state(p); await ctx.close(); }
}
{ // broken video -> must hand over
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.route(/\.(mp4|webm)$/, (r) => r.abort());
  const p = await ctx.newPage(); await p.goto(base + '?low'); await p.waitForTimeout(6500); res.broken = await state(p); await ctx.close();
}
{ // reduced motion -> bypass
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(1000); res.reduced = await state(p); await ctx.close();
}
await b.close();
console.log(JSON.stringify(res, null, 1));
