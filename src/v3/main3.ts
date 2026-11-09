// V3 hero lab: real-time 8 s intro → identical live hero → GSAP scroll choreography.
import { LogoFx } from '../logoFx.js';
import { INTRO, Studio3, type Shot } from './scene.js';
import { VEHICLE } from './vehicle.js';

const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const rec = q.has('rec');
const portrait = innerWidth / innerHeight < 0.8;
const high = !q.has('low') && (fine || innerWidth >= 900);
const ss = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* blocked */ } } };

const canvas = $<HTMLCanvasElement>('#v3-gl');
const fxCanvas = $<HTMLCanvasElement>('#v3-fx');
const studio = new Studio3(canvas, { high, portrait });
let dpr = rec ? 1 : Math.min(devicePixelRatio || 1, high ? 1.75 : 1.25);
const size = () => {
  studio.setSize(innerWidth, innerHeight, dpr);
  fxCanvas.width = Math.round(innerWidth * dpr); fxCanvas.height = Math.round(innerHeight * dpr);
};
size();
addEventListener('resize', size);
const logo = new LogoFx(fxCanvas.getContext('2d')!, fxCanvas.width, fxCanvas.height, portrait);

const modelUrl = q.get('model') || (VEHICLE.enabled ? (high ? VEHICLE.url : VEHICLE.urlLite) : null);
$('#v3-status').textContent = modelUrl ? 'Loading vehicle…' : 'Awaiting the approved licensed vehicle model — placeholder envelope shown.';
const ready = studio.load(modelUrl, (p) => { $('#v3-status').textContent = `Loading vehicle ${Math.round(p * 100)}%`; })
  .then(() => { $('#v3-status').textContent = modelUrl ? '' : $('#v3-status').textContent; })
  .catch((e) => { $('#v3-status').textContent = `Vehicle failed to load: ${e.message}`; return studio.load(null); });

// optional composition guide: ?ref=<image url> (never shipped as an asset)
const ref = q.get('ref');
if (ref) { const g = $<HTMLImageElement>('#v3-ref'); g.src = ref; g.hidden = false; addEventListener('keydown', (e) => { if (e.key === 'g') g.hidden = !g.hidden; }); }

// ---------- timeline ----------
type Mode = 'intro' | 'hero';
let mode: Mode = 'hero', t0 = performance.now(), heroStart = performance.now();
const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
if (fine && !reduced) addEventListener('pointermove', (e) => { ptr.tx = e.clientX / innerWidth * 2 - 1; ptr.ty = e.clientY / innerHeight * 2 - 1; }, { passive: true });
let story = 0;
const audio = $<HTMLAudioElement>('#v3-audio');

function frame(shot: Shot, time: number, introT: number | null) {
  studio.render(shot, time);
  const p = studio.project(studio.portPoint, fxCanvas.width, fxCanvas.height);
  logo.draw(introT ?? -1, p); // clears itself outside the logo window
}

function startIntro() {
  mode = 'intro'; t0 = performance.now();
  document.body.classList.add('intro-on');
  if (!audio.muted) { audio.currentTime = 0; audio.play().catch(() => {}); }
}
function endIntro() {
  if (mode !== 'intro') return;
  mode = 'hero'; heroStart = performance.now(); ss.set('nv3-intro', '1');
  document.body.classList.remove('intro-on');
  audio.pause();
}
$('#v3-skip').addEventListener('click', endIntro);
$('#v3-replay').addEventListener('click', () => { scrollTo({ top: 0 }); startIntro(); });
$('#v3-sound').addEventListener('click', (e) => {
  audio.muted = !audio.muted;
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(!audio.muted));
  (e.currentTarget as HTMLElement).querySelector('.lbl')!.textContent = audio.muted ? 'Sound off' : 'Sound on';
  if (!audio.muted && mode === 'intro') { audio.currentTime = (performance.now() - t0) / 1000; audio.play().catch(() => {}); }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') endIntro(); });

// ---------- scroll choreography (GSAP ScrollTrigger when available, manual fallback) ----------
const storyEl = $('#v3-story');
const chapters = [...document.querySelectorAll<HTMLElement>('.v3-chapter')];
function setStory(p: number) {
  story = p;
  const k = Math.min(chapters.length - 1, Math.floor(p * chapters.length));
  chapters.forEach((c, i) => c.classList.toggle('on', i === k));
}
if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined' && !reduced) {
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.create({ trigger: storyEl, start: 'top top', end: 'bottom bottom', scrub: 0.8, onUpdate: (s: { progress: number }) => setStory(s.progress) });
  document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
    el.innerHTML = el.textContent!.split(' ').map((w) => `<span class="w"><span>${w}</span></span>`).join(' ');
    gsap.from(el.querySelectorAll('.w > span'), { yPercent: 110, opacity: 0, duration: 1.1, ease: 'power4.out', stagger: 0.06, scrollTrigger: { trigger: el, start: 'top 85%' } });
  });
  gsap.utils.toArray('.v3-rise').forEach((el: HTMLElement) => gsap.from(el, { y: 40, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } }));
} else {
  addEventListener('scroll', () => { const r = storyEl.getBoundingClientRect(); setStory(Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)))); }, { passive: true });
}

// ---------- loop ----------
function loop(now: number) {
  requestAnimationFrame(loop);
  if (!studio.ready || document.hidden) return;
  ptr.x += (ptr.tx - ptr.x) * 0.05; ptr.y += (ptr.ty - ptr.y) * 0.05;
  if (mode === 'intro') {
    const t = (now - t0) / 1000;
    if (t >= INTRO) { frame(studio.heroShot(0), INTRO, null); endIntro(); return; }
    frame(studio.introShot(t), t, t);
    return;
  }
  const el = reduced ? 0 : (now - heroStart) / 1000;
  const r = storyEl.getBoundingClientRect();
  const shot = r.top < innerHeight * 0.98 ? studio.storyShot(story, el) : studio.heroShot(el, ptr.x, ptr.y);
  frame(shot, INTRO + el, null);
}

if (rec) {
  // recorder mode for exporting the low-end fallback film: deterministic frames, no UI
  document.body.classList.add('rec');
  Object.assign(window, { __ready: ready, __len: INTRO, __frame: (t: number) => { const s = t >= INTRO ? studio.heroShot(0) : studio.introShot(t); frame(s, t, t); } });
} else {
  ready.then(() => {
    if (!reduced && !q.has('nointro') && (q.has('intro') || ss.get('nv3-intro') !== '1')) startIntro();
    requestAnimationFrame(loop);
  });
}
