// V3 intro film test (production build): source selection, poster, playback, controls, hand-off, fallbacks, cost.
// usage: node scripts/test-intro.mjs [baseUrl]   (serves dist/ itself when no URL is given)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { serve } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
let base = process.argv[2], server = null;
if (!base) { server = await serve('dist', 4174, '/nearvolt-ev-website/'); base = 'http://localhost:4174/nearvolt-ev-website/'; }
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const res = {}; let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const film = (p) => p.evaluate(() => {
  const w = document.getElementById('v3-film'), v = document.getElementById('v3-film-video');
  const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
  return { shown: !w.hidden && !w.classList.contains('out'), src: (v.currentSrc || '').split('/').pop(), poster: (v.poster || '').split('/').pop(), t: v.currentTime, paused: v.paused, muted: v.muted, w: v.videoWidth, h: v.videoHeight,
    dropped: q.droppedVideoFrames, total: q.totalVideoFrames, introOn: document.body.classList.contains('intro-on'), seen: sessionStorage.getItem('nv3-intro'), overflowX: document.documentElement.scrollWidth - innerWidth };
});
async function page(ctxOpts, opts = {}) {
  const ctx = await b.newContext(ctxOpts);
  if (opts.block) await ctx.route(/\.(mp4|webm)$/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [], reqs = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebGL|GL Driver|GPU stall/.test(m.text()) && errors.push(m.text()));
  const t0 = Date.now();
  p.on('requestfinished', async (r) => { const s = await r.sizes().catch(() => null); reqs.push({ url: r.url(), at: Date.now() - t0, bytes: s ? s.responseBodySize + s.responseHeadersSize : 0 }); });
  if (opts.cpu) { const c = await ctx.newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu }); }
  await p.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true }); } catch {} });
  return { ctx, p, errors, reqs, t0 };
}

// 1. desktop: full play, hand-off, session memory
{
  const { ctx, p, errors, reqs } = await page({ viewport: { width: 1440, height: 900 } });
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(150);
  const early = await film(p);
  check('Desktop: film overlay and poster shown immediately', early.shown && /poster-land\.jpg/.test(early.poster), early.poster);
  await p.waitForFunction(() => document.getElementById('v3-film-video').currentTime > 1, null, { timeout: 15000 }).catch(() => {});
  const mid = await film(p);
  res.desktop = mid;
  check('Desktop: landscape 1080p film playing, muted', /home-plug-land-1080\.(mp4|webm)$/.test(mid.src) && !mid.paused && mid.t > 1 && mid.muted && mid.w === 1920 && mid.h === 1080, `${mid.src} ${mid.w}x${mid.h}`);
  const modelEarly = reqs.find((r) => /models\/vehicle/.test(r.url));
  await p.click('#v3-sound');
  check('Sound control unmutes the film', !(await film(p)).muted && (await p.getAttribute('#v3-sound', 'aria-pressed')) === 'true');
  await p.click('#v3-sound');
  await p.waitForFunction(() => document.getElementById('v3-film').hidden, null, { timeout: 40000 }).catch(() => {});
  const end = await film(p);
  const lt = await p.evaluate(() => window.__lt);
  res.desktopEnd = { ...end, droppedPct: mid.total ? +(100 * end.dropped / Math.max(1, end.total)).toFixed(1) : null };
  check('Desktop: film ends and hands over to the hero', !end.shown && !end.introOn && end.seen === '1');
  const heroVisible = await p.evaluate(() => getComputedStyle(document.querySelector('.v3-hero h1')).opacity === '1' && getComputedStyle(document.querySelector('.nav')).opacity === '1');
  check('Hero headline and navigation visible after the film', heroVisible);
  const model = reqs.find((r) => /models\/vehicle/.test(r.url));
  check('3D model downloads only after the film has started (no competition at start-up)', !!model && model.at > 1500, model ? `model finished ${(model.at / 1000).toFixed(1)} s` : 'not loaded');
  res.desktopTransferMB = +(reqs.reduce((a, r) => a + r.bytes, 0) / 1048576).toFixed(2);
  res.desktopLongTasks = { count: lt.length, totalMs: lt.reduce((a, [, d]) => a + d, 0), worst: Math.max(0, ...lt.map(([, d]) => d)) };
  check('Desktop: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('Desktop: no horizontal overflow', end.overflowX <= 0);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
  check('Film does not replay on the next page view in the session', !(await film(p)).shown);
  await p.click('#v3-replay');
  await p.waitForTimeout(1500);
  const rep = await film(p);
  check('Replay intro plays the film again', rep.shown && rep.t > 0.2, `t=${rep.t.toFixed(2)}`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(900);
  check('Esc skips the film', !(await film(p)).shown);
  void modelEarly;
  await ctx.close();
}
// 2. phone (portrait), throttled CPU: portrait film, skip
{
  const { ctx, p, errors, reqs } = await page({ ...devices['Pixel 7'] }, { cpu: 4 });
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(150);
  const early = await film(p);
  check('Phone: overlay + portrait poster shown immediately', early.shown && /poster-port\.jpg/.test(early.poster), early.poster);
  await p.waitForFunction(() => document.getElementById('v3-film-video').currentTime > 2, null, { timeout: 20000 }).catch(() => {});
  const mid = await film(p);
  res.phone = mid;
  check('Phone: portrait film playing (separate 9:16 composition)', /home-plug-port-(1080|720)\.(mp4|webm)$/.test(mid.src) && !mid.paused && mid.h > mid.w, `${mid.src} ${mid.w}x${mid.h}`);
  await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/phone-mid.png` : '/tmp/phone-mid.png' });
  const skipBox = await p.locator('#v3-skip').boundingBox();
  check('Phone: Skip button visible and inside the screen', !!skipBox && skipBox.y + skipBox.height <= 915 && skipBox.x >= 0, JSON.stringify(skipBox));
  await p.waitForTimeout(3000);
  const q2 = await film(p);
  res.phoneQuality = { dropped: q2.dropped, total: q2.total, droppedPct: q2.total ? +(100 * q2.dropped / q2.total).toFixed(1) : null };
  await p.tap('#v3-skip'); await p.waitForTimeout(900);
  const after = await film(p);
  check('Phone: Skip hands over to the hero', !after.shown && !after.introOn);
  res.phoneTransferMB = +(reqs.reduce((a, r) => a + r.bytes, 0) / 1048576).toFixed(2);
  check('Phone: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('Phone: no horizontal overflow', after.overflowX <= 0, `${after.overflowX}px`);
  await ctx.close();
}
// 3. video blocked -> page must not be held
{
  const { ctx, p } = await page({ viewport: { width: 1280, height: 720 } }, { block: true });
  await p.goto(base); await p.waitForTimeout(7000);
  const s = await film(p);
  check('Video unavailable: hands over to the page within 7 s', !s.shown && !s.introOn);
  await ctx.close();
}
// 4. reduced motion -> no film
{
  const { ctx, p } = await page({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  await p.goto(base); await p.waitForTimeout(1200);
  const s = await film(p);
  check('Reduced motion: film bypassed, no video requested', !s.shown && !s.src);
  await ctx.close();
}
await b.close(); server?.close();
console.log(JSON.stringify(res, null, 1));
writeFileSync(process.env.OUT_JSON || '/tmp/intro-test.json', JSON.stringify({ pass, fail, ...res }, null, 1));
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
