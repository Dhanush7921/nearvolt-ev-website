// Offline intro renderer (render.html). Driven frame by frame by scripts/render-intro.mjs.
import { introState, INTRO_LEN, type Framing } from './engine/director.js';
import { PORT, Studio } from './engine/studio.js';
import { LogoFx } from './logoFx.js';

const q = new URLSearchParams(location.search);
const framing = (q.get('framing') as Framing) || 'land';
const W = Number(q.get('w') || 1920), H = Number(q.get('h') || 1080);
const gl = document.getElementById('gl') as HTMLCanvasElement;
const fx = document.getElementById('fx') as HTMLCanvasElement;
for (const c of [gl, fx]) { c.style.width = W + 'px'; c.style.height = H + 'px'; }
fx.width = W; fx.height = H;
const studio = new Studio(gl, { quality: 'high', preserve: true });
studio.setSize(W, H, 1);
const logo = new LogoFx(fx.getContext('2d')!, W, H, framing === 'port');
declare global { interface Window { __ready: Promise<void>; __frame: (t: number) => void; __len: number } }
window.__len = INTRO_LEN;
window.__ready = studio.load('models/ev-concept.glb');
window.__frame = (t: number) => {
  const st = introState(t, framing);
  studio.render(st);
  studio.gl.finish();
  const p = studio.toScreen([PORT[0] + 0.08, PORT[1], PORT[2]], W, H);
  logo.draw(t, p);
};
