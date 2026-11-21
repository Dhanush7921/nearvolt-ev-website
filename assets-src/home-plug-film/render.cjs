// usage: node render.cjs <outDir> <fps> [t ...]   (explicit times => stills s<t>.jpg)
const path = require('path'), fs = require('fs'), http = require('http');
const REPO = '/home/claude/green-plug-ev-website';
const { chromium } = require('playwright');
const esbuild = require(path.join(REPO, 'node_modules/esbuild'));
const HERE = __dirname;
const out = path.resolve(process.argv[2]);
const fps = +process.argv[3] || 30;
const W = +(process.env.W || 1920), H = +(process.env.H || 1080), DPR = +(process.env.DPR || 1);
const HERO = process.env.HERO || (H > W ? 'hero-port.jpg' : 'hero-land.jpg');
const stills = process.argv.slice(4).map(Number);
const from = +(process.env.FROM || 0), to = process.env.TO ? +process.env.TO : Infinity;
fs.mkdirSync(out, { recursive: true });
(async () => {
  await esbuild.build({ entryPoints: [path.join(HERE, 'film.ts')], bundle: true, outfile: path.join(HERE, 'film.js'), format: 'iife', nodePaths: [path.join(REPO, 'node_modules')], logLevel: 'error', target: 'es2020' });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.woff': 'font/woff', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const srv = http.createServer((q, r) => {
    const u = q.url.split('?')[0];
    const f = u === '/' ? path.join(HERE, 'index.html') : u === '/film.js' ? path.join(HERE, 'film.js') : u === '/hero.jpg' ? path.join(HERE, HERO) : u.startsWith('/brand/') ? path.join('/home/claude/nearvolt-ev-website/public', u) : u.startsWith('/models/') ? path.join(REPO, 'public', u) : u.startsWith('/fonts/') ? path.join(REPO, 'src/assets', u) : null;
    if (!f || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    r.end(fs.readFileSync(f));
  }).listen(+(process.env.PORT || 4811));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  await page.goto(`http://localhost:${process.env.PORT || 4811}/?w=${W}&h=${H}&dpr=${DPR}`);
  console.log('INFO', JSON.stringify(await page.evaluate(() => window.__film.ready)));
  await page.evaluate(() => { document.getElementById('hero').style.backgroundImage = 'url(/hero.jpg)'; });
  const stage = await page.$('#stage');
  const all = stills.length ? stills : Array.from({ length: Math.round(18 * fps) }, (_, i) => i / fps);
  const t0 = Date.now(); let n = 0;
  for (let i = 0; i < all.length; i++) {
    if (!stills.length && (i < from || i >= to)) continue;
    await page.evaluate((t) => window.__film.seek(t), all[i]);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const name = stills.length ? `s${all[i].toFixed(2)}.jpg` : `f${String(i).padStart(4, '0')}.jpg`;
    await stage.screenshot({ path: path.join(out, name), type: 'jpeg', quality: 90 });
    n++;
    if (n % 15 === 0 || stills.length) console.log(`frame ${i} (${n}) ${((Date.now() - t0) / 1000 / n).toFixed(1)}s/frame`);
  }
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
