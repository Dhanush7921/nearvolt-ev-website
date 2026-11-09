// Tiny static server for dist/ (preview + intro rendering). Usage: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff': 'font/woff', '.txt': 'text/plain', '.json': 'application/json' };
export function serve(root = 'dist', port = 4173, base = '/') {
  return new Promise((res) => {
    const s = createServer(async (req, out) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (!p.startsWith(base)) { out.writeHead(404); return out.end(); }
      p = normalize(join(root, p.slice(base.length)));
      try { if ((await stat(p)).isDirectory()) p = join(p, 'index.html'); } catch { p = join(root, '404.html'); }
      try {
        const body = await readFile(p);
        const range = req.headers.range;
        const type = TYPES[extname(p)] || 'application/octet-stream';
        if (range) {
          const [a, b] = range.replace('bytes=', '').split('-');
          const start = Number(a), end = b ? Number(b) : body.length - 1;
          out.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
          return out.end(body.subarray(start, end + 1));
        }
        out.writeHead(p.endsWith('404.html') ? 404 : 200, { 'Content-Type': type, 'Accept-Ranges': 'bytes' });
        out.end(body);
      } catch { out.writeHead(404); out.end('not found'); }
    }).listen(port, () => res(s));
  });
}
if (process.argv[1].endsWith('serve.mjs')) serve(process.env.ROOT || 'dist', Number(process.argv[2] || 4173), process.argv[3] || '/').then(() => console.log('serving dist'));
