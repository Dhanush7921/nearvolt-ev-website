// V3: live 3D hero + GSAP scroll choreography. The intro is the pre-rendered Home Plug film (see film.ts); the hero
// stays idle under it and loads its model only once the film is playing, so the two never compete.
import { LogoFx } from '../logoFx.js';
import { INTRO, Studio3, type Shot } from './scene.js';
import { VEHICLE } from './vehicle.js';

(window as unknown as { __nv3: boolean }).__nv3 = true; // 3D module started (see the fallback timer in index.html)
const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const rec = q.has('rec');
const portrait = innerWidth / innerHeight < 0.8;
/** Integrated GPUs get the 2K vehicle and a lower pixel ratio; discrete GPUs get 4K textures. */
function gpuTier(): 'high' | 'mid' | 'low' {
  if (q.has('low')) return 'low';
  try {
    const g = document.createElement('canvas').getContext('webgl2');
    if (!g) return 'low';
    const ext = g.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    g.getExtension('WEBGL_lose_context')?.loseContext();
    if (!fine && innerWidth < 900) return 'low';
    return /intel|uhd|iris|mali|adreno|powervr|apple gpu|swiftshader|llvmpipe/i.test(name) ? 'mid' : 'high';
  } catch { return 'low'; }
}
const tier = gpuTier();
const high = tier === 'high';

const canvas = $<HTMLCanvasElement>('#v3-gl');
const fxCanvas = $<HTMLCanvasElement>('#v3-fx');
let studio: Studio3;
try { studio = new Studio3(canvas, { high: tier !== 'low', portrait }); } catch (e) { fail(); throw e; }
function fail() { document.body.classList.add('no-gl'); $('#v3-fallback').hidden = false; $('#v3-loader')?.remove(); }
let dpr = rec ? 1 : Math.min(devicePixelRatio || 1, tier === 'high' ? 1.75 : tier === 'mid' ? 1.25 : 1);
const size = () => {
  studio.setSize(innerWidth, innerHeight, dpr);
  fxCanvas.width = Math.round(innerWidth * dpr); fxCanvas.height = Math.round(innerHeight * dpr);
};
size();
addEventListener('resize', size);
const logo = new LogoFx(fxCanvas.getContext('2d')!, fxCanvas.width, fxCanvas.height, portrait);

const modelUrl = q.get('model') || (VEHICLE.enabled ? (high ? VEHICLE.url : VEHICLE.urlLite) : null);
const bar = document.getElementById('v3-load-bar');
type FilmApi = { active: () => boolean; started: () => boolean; play: () => void };
const film = (window as unknown as { __nvFilm?: FilmApi }).__nvFilm;
const filmOn = () => !!film?.active();
// start the model download now, or once the film is playing (its first seconds get the bandwidth)
let kick!: () => void;
const kicked = new Promise<void>((r) => (kick = r));
if (!rec && filmOn()) {
  // this module waits for three.js from the CDN, so the film may already be playing by now
  if (film!.started()) setTimeout(kick, 1200);
  else addEventListener('nv3:film-playing', () => setTimeout(kick, 1200), { once: true });
  addEventListener('nv3:film-end', () => kick(), { once: true });
} else kick();
addEventListener('nv3:film-end', () => { heroStart = performance.now(); });
const ready = kicked.then(() => studio.load(modelUrl, (p) => { if (bar) bar.style.transform = `scaleX(${p})`; }))
  .then(() => { document.getElementById('v3-loader')?.classList.add('done'); setTimeout(() => document.getElementById('v3-loader')?.remove(), 900); })
  .catch(() => { fail(); throw new Error('vehicle'); });

// optional composition guide: ?ref=<image url> (never shipped as an asset)
const ref = q.get('ref');
if (ref) { const g = $<HTMLImageElement>('#v3-ref'); g.src = ref; g.hidden = false; addEventListener('keydown', (e) => { if (e.key === 'g') g.hidden = !g.hidden; }); }

// ---------- timeline ----------
let heroStart = performance.now();
const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
if (fine && !reduced) addEventListener('pointermove', (e) => { ptr.tx = e.clientX / innerWidth * 2 - 1; ptr.ty = e.clientY / innerHeight * 2 - 1; }, { passive: true });
let story = 0;
// drag to orbit (360° exploration) on the hero
let yaw = 0, yawT = 0, dragX: number | null = null;
const heroEl = $('.v3-hero');
heroEl.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('a,button')) return; dragX = e.clientX; heroEl.setPointerCapture(e.pointerId); heroEl.classList.add('dragging'); });
heroEl.addEventListener('pointermove', (e) => { if (dragX === null) return; yawT += (e.clientX - dragX) / innerWidth * 3.2; dragX = e.clientX; });
const endDrag = () => { dragX = null; heroEl.classList.remove('dragging'); };
heroEl.addEventListener('pointerup', endDrag); heroEl.addEventListener('pointercancel', endDrag);

function frame(shot: Shot, time: number, introT: number | null) {
  studio.render(shot, time);
  const p = studio.project(studio.portPoint, fxCanvas.width, fxCanvas.height);
  logo.draw(introT ?? -1, p); // clears itself outside the logo window
}


// ---------- scroll choreography (GSAP ScrollTrigger when available, manual fallback) ----------
const storyEl = document.getElementById('experience') ?? $('#v3-story');
const chapters = [...document.querySelectorAll<HTMLElement>('.v3-chapter')];
const storyBar = document.getElementById('story-progress');
function setStory(p: number) {
  story = p;
  if (storyBar) storyBar.style.transform = `scaleX(${p})`;
  const k = Math.min(chapters.length - 1, Math.floor(p * chapters.length));
  chapters.forEach((c, i) => c.classList.toggle('on', i === k));
}
if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined' && !reduced) {
  gsap.registerPlugin(ScrollTrigger);
  document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
    el.innerHTML = el.textContent!.split(' ').map((w) => `<span class="w"><span>${w}</span></span>`).join(' ');
    gsap.from(el.querySelectorAll('.w > span'), { yPercent: 110, opacity: 0, duration: 1.1, ease: 'power4.out', stagger: 0.06, scrollTrigger: { trigger: el, start: 'top 85%' } });
  });
  gsap.utils.toArray('.v3-rise').forEach((el: HTMLElement) => gsap.from(el, { y: 40, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } }));
}
// story progress is measured directly each frame (robust to late layout changes) and eased for a scrubbed feel
let storyTarget = 0;
const measureStory = () => { const r = storyEl.getBoundingClientRect(); storyTarget = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight))); };
addEventListener('scroll', measureStory, { passive: true });
addEventListener('resize', measureStory);

// ---------- loop ----------
function loop(now: number) {
  requestAnimationFrame(loop);
  if (!studio.ready || document.hidden || filmOn()) return; // idle under the intro film
  ptr.x += (ptr.tx - ptr.x) * 0.05; ptr.y += (ptr.ty - ptr.y) * 0.05;
  const el = reduced ? 0 : (now - heroStart) / 1000;
  const r = storyEl.getBoundingClientRect();
  setStory(reduced ? storyTarget : story + (storyTarget - story) * 0.12);
  yaw += (yawT - yaw) * 0.08;
  if (r.top < innerHeight * 0.98) yawT *= 0.96; // ease back to the authored path when the story takes over
  if (r.bottom < 0) return; // story finished: content sections cover the canvas, skip rendering
  const shot = r.top < innerHeight * 0.98 ? studio.storyShot(story, el) : studio.heroShot(el, ptr.x, ptr.y, yaw);
  frame(shot, INTRO + el, null);
}

if (rec) {
  // recorder mode for exporting the low-end fallback film: deterministic frames, no UI
  document.body.classList.add('rec');
  Object.assign(window, { __ready: ready, __len: INTRO, __frame: (t: number) => { const s = t >= INTRO ? studio.heroShot(0) : studio.introShot(t); frame(s, t, t); } });
} else {
  ready.then(() => {
    requestAnimationFrame(loop);
    if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh(); // page height settles after the model, fonts and map load
  });
  addEventListener('load', () => { if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh(); });
}
