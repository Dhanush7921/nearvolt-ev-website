// V3 hero lab: real-time 8 s intro → identical live hero → GSAP scroll choreography.
import { LogoFx } from '../logoFx.js';
import { INTRO, Studio3 } from './scene.js';
import { VEHICLE } from './vehicle.js';
window.__nv3 = true; // 3D module started (see the fallback timer in index.html)
const q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const rec = q.has('rec');
const portrait = innerWidth / innerHeight < 0.8;
/** Integrated GPUs get the 2K vehicle and a lower pixel ratio; discrete GPUs get 4K textures. */
function gpuTier() {
    if (q.has('low'))
        return 'low';
    try {
        const g = document.createElement('canvas').getContext('webgl2');
        if (!g)
            return 'low';
        const ext = g.getExtension('WEBGL_debug_renderer_info');
        const name = ext ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
        g.getExtension('WEBGL_lose_context')?.loseContext();
        if (!fine && innerWidth < 900)
            return 'low';
        return /intel|uhd|iris|mali|adreno|powervr|apple gpu|swiftshader|llvmpipe/i.test(name) ? 'mid' : 'high';
    }
    catch {
        return 'low';
    }
}
const tier = gpuTier();
const high = tier === 'high';
const ss = { get: (k) => { try {
        return sessionStorage.getItem(k);
    }
    catch {
        return null;
    } }, set: (k, v) => { try {
        sessionStorage.setItem(k, v);
    }
    catch { /* blocked */ } } };
const canvas = $('#v3-gl');
const fxCanvas = $('#v3-fx');
let studio;
try {
    studio = new Studio3(canvas, { high: tier !== 'low', portrait });
}
catch (e) {
    fail();
    throw e;
}
function fail() { document.body.classList.add('no-gl'); $('#v3-fallback').hidden = false; $('#v3-loader')?.remove(); }
let dpr = rec ? 1 : Math.min(devicePixelRatio || 1, tier === 'high' ? 1.75 : tier === 'mid' ? 1.25 : 1);
const size = () => {
    studio.setSize(innerWidth, innerHeight, dpr);
    fxCanvas.width = Math.round(innerWidth * dpr);
    fxCanvas.height = Math.round(innerHeight * dpr);
};
size();
addEventListener('resize', size);
const logo = new LogoFx(fxCanvas.getContext('2d'), fxCanvas.width, fxCanvas.height, portrait);
const modelUrl = q.get('model') || (VEHICLE.enabled ? (high ? VEHICLE.url : VEHICLE.urlLite) : null);
const bar = document.getElementById('v3-load-bar');
const ready = studio.load(modelUrl, (p) => { if (bar)
    bar.style.transform = `scaleX(${p})`; })
    .then(() => { document.getElementById('v3-loader')?.classList.add('done'); setTimeout(() => document.getElementById('v3-loader')?.remove(), 900); })
    .catch(() => { fail(); throw new Error('vehicle'); });
// optional composition guide: ?ref=<image url> (never shipped as an asset)
const ref = q.get('ref');
if (ref) {
    const g = $('#v3-ref');
    g.src = ref;
    g.hidden = false;
    addEventListener('keydown', (e) => { if (e.key === 'g')
        g.hidden = !g.hidden; });
}
let mode = 'hero', t0 = performance.now(), heroStart = performance.now();
const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
if (fine && !reduced)
    addEventListener('pointermove', (e) => { ptr.tx = e.clientX / innerWidth * 2 - 1; ptr.ty = e.clientY / innerHeight * 2 - 1; }, { passive: true });
let story = 0;
// drag to orbit (360° exploration) on the hero
let yaw = 0, yawT = 0, dragX = null;
const heroEl = $('.v3-hero');
heroEl.addEventListener('pointerdown', (e) => { if (e.target.closest('a,button'))
    return; dragX = e.clientX; heroEl.setPointerCapture(e.pointerId); heroEl.classList.add('dragging'); });
heroEl.addEventListener('pointermove', (e) => { if (dragX === null)
    return; yawT += (e.clientX - dragX) / innerWidth * 3.2; dragX = e.clientX; });
const endDrag = () => { dragX = null; heroEl.classList.remove('dragging'); };
heroEl.addEventListener('pointerup', endDrag);
heroEl.addEventListener('pointercancel', endDrag);
const audio = $('#v3-audio');
function frame(shot, time, introT) {
    studio.render(shot, time);
    const p = studio.project(studio.portPoint, fxCanvas.width, fxCanvas.height);
    logo.draw(introT ?? -1, p); // clears itself outside the logo window
}
function startIntro() {
    mode = 'intro';
    t0 = performance.now();
    document.body.classList.add('intro-on');
    if (!audio.muted) {
        audio.currentTime = 0;
        audio.play().catch(() => { });
    }
}
function endIntro() {
    if (mode !== 'intro')
        return;
    mode = 'hero';
    heroStart = performance.now();
    ss.set('nv3-intro', '1');
    document.body.classList.remove('intro-on');
    audio.pause();
}
$('#v3-skip').addEventListener('click', endIntro);
$('#v3-replay').addEventListener('click', () => { scrollTo({ top: 0 }); startIntro(); });
$('#v3-sound').addEventListener('click', (e) => {
    audio.muted = !audio.muted;
    e.currentTarget.setAttribute('aria-pressed', String(!audio.muted));
    e.currentTarget.querySelector('.lbl').textContent = audio.muted ? 'Sound off' : 'Sound on';
    if (!audio.muted && mode === 'intro') {
        audio.currentTime = (performance.now() - t0) / 1000;
        audio.play().catch(() => { });
    }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape')
    endIntro(); });
// ---------- scroll choreography (GSAP ScrollTrigger when available, manual fallback) ----------
const storyEl = document.getElementById('experience') ?? $('#v3-story');
const chapters = [...document.querySelectorAll('.v3-chapter')];
const storyBar = document.getElementById('story-progress');
function setStory(p) {
    story = p;
    if (storyBar)
        storyBar.style.transform = `scaleX(${p})`;
    const k = Math.min(chapters.length - 1, Math.floor(p * chapters.length));
    chapters.forEach((c, i) => c.classList.toggle('on', i === k));
}
if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined' && !reduced) {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.create({ trigger: storyEl, start: 'top top', end: 'bottom bottom', scrub: 0.8, onUpdate: (s) => setStory(s.progress) });
    document.querySelectorAll('[data-split]').forEach((el) => {
        el.innerHTML = el.textContent.split(' ').map((w) => `<span class="w"><span>${w}</span></span>`).join(' ');
        gsap.from(el.querySelectorAll('.w > span'), { yPercent: 110, opacity: 0, duration: 1.1, ease: 'power4.out', stagger: 0.06, scrollTrigger: { trigger: el, start: 'top 85%' } });
    });
    gsap.utils.toArray('.v3-rise').forEach((el) => gsap.from(el, { y: 40, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } }));
}
else {
    addEventListener('scroll', () => { const r = storyEl.getBoundingClientRect(); setStory(Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)))); }, { passive: true });
}
// ---------- loop ----------
function loop(now) {
    requestAnimationFrame(loop);
    if (!studio.ready || document.hidden)
        return;
    ptr.x += (ptr.tx - ptr.x) * 0.05;
    ptr.y += (ptr.ty - ptr.y) * 0.05;
    if (mode === 'intro') {
        const t = (now - t0) / 1000;
        if (t >= INTRO) {
            frame(studio.heroShot(0), INTRO, null);
            endIntro();
            return;
        }
        frame(studio.introShot(t), t, t);
        return;
    }
    const el = reduced ? 0 : (now - heroStart) / 1000;
    const r = storyEl.getBoundingClientRect();
    yaw += (yawT - yaw) * 0.08;
    if (r.top < innerHeight * 0.98)
        yawT *= 0.96; // ease back to the authored path when the story takes over
    if (r.bottom < 0)
        return; // story finished: content sections cover the canvas, skip rendering
    const shot = r.top < innerHeight * 0.98 ? studio.storyShot(story, el) : studio.heroShot(el, ptr.x, ptr.y, yaw);
    frame(shot, INTRO + el, null);
}
if (rec) {
    // recorder mode for exporting the low-end fallback film: deterministic frames, no UI
    document.body.classList.add('rec');
    Object.assign(window, { __ready: ready, __len: INTRO, __frame: (t) => { const s = t >= INTRO ? studio.heroShot(0) : studio.introShot(t); frame(s, t, t); } });
}
else {
    ready.then(() => {
        if (!reduced && !q.has('nointro') && (q.has('intro') || ss.get('nv3-intro') !== '1'))
            startIntro();
        requestAnimationFrame(loop);
        if (typeof ScrollTrigger !== 'undefined')
            ScrollTrigger.refresh(); // page height settles after the model, fonts and map load
    });
    addEventListener('load', () => { if (typeof ScrollTrigger !== 'undefined')
        ScrollTrigger.refresh(); });
}
