// NEARVOLT EV V2 — boot: cinematic intro, live 3D hero, scroll story, UI.
import { heroState, storyState } from './engine/director.js';
import { clamp } from './engine/math.js';
import { HEADLIGHTS, PORT, Studio } from './engine/studio.js';
import { initMap } from './map.js';
import { initCalc, initCompat, initContact } from './sections.js';
const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const nav = navigator;
const saveData = !!nav.connection?.saveData;
const store = {
    get: (k) => { try {
        return sessionStorage.getItem(k);
    }
    catch {
        return null;
    } },
    set: (k, v) => { try {
        sessionStorage.setItem(k, v);
    }
    catch { /* storage blocked */ } },
};
const framingFor = () => (innerWidth / innerHeight < 0.8 ? 'port' : 'land');
let framing = framingFor();
// ---------- 3D hero ----------
const canvas = $('#scene');
const fallback = $('#scene-fallback');
let studio = null;
const lowEnd = saveData || (nav.deviceMemory !== undefined && nav.deviceMemory < 4) || (!finePointer && innerWidth < 900) || q.has('low');
let dpr = Math.min(devicePixelRatio || 1, lowEnd ? 1.25 : 1.75);
function showFallback() {
    fallback.src = `video/hero-${framing}.jpg`;
    fallback.hidden = false;
    canvas.style.visibility = 'hidden';
}
try {
    if (q.has('nowebgl'))
        throw new Error('forced fallback');
    studio = new Studio(canvas, { quality: lowEnd ? 'low' : 'high' });
    studio.setSize(innerWidth, innerHeight, dpr);
    studio.load('models/ev-concept.glb').catch(() => { studio = null; showFallback(); });
}
catch {
    studio = null;
    showFallback();
}
const modelReady = () => !studio || studio.ready || studio.lost;
let heroStart = performance.now();
const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
if (finePointer && !reduced)
    addEventListener('pointermove', (e) => { ptr.tx = (e.clientX / innerWidth) * 2 - 1; ptr.ty = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
const heroEl = $('#top'), storyEl = $('#experience');
let heroVisible = true, storyVisible = false;
new IntersectionObserver((es) => es.forEach((e) => {
    if (e.target === heroEl)
        heroVisible = e.isIntersecting;
    else
        storyVisible = e.isIntersecting;
}), { rootMargin: '10% 0px' }).observe(heroEl);
new IntersectionObserver(([e]) => { storyVisible = e.isIntersecting; }).observe(storyEl);
const spots = { port: [PORT[0] + 0.06, PORT[1] + 0.02, PORT[2]], light: HEADLIGHTS[0], charger: [2.2, 1.3, -0.55] };
const spotEls = [...document.querySelectorAll('.hotspot')];
const storySteps = [...document.querySelectorAll('#story-steps article')];
const storyBar = $('#story-progress');
let frames = 0, slow = 0, last = 0;
function loop(now) {
    requestAnimationFrame(loop);
    const dt = now - last;
    last = now;
    if (!studio || !studio.ready || studio.lost || document.hidden) {
        if (studio?.lost)
            showFallback();
        return;
    }
    if (!heroVisible && !storyVisible && !introHolding)
        return;
    const f = framingFor();
    if (f !== framing)
        framing = f;
    studio.setSize(innerWidth, innerHeight, dpr);
    ptr.x += (ptr.tx - ptr.x) * 0.05;
    ptr.y += (ptr.ty - ptr.y) * 0.05;
    const elapsed = reduced ? 0 : (now - heroStart) / 1000;
    const r = storyEl.getBoundingClientRect();
    const inStory = r.top < innerHeight * 0.98;
    let st;
    if (inStory) {
        const p = clamp(-r.top / Math.max(1, r.height - innerHeight));
        st = storyState(p, framing, elapsed);
        storyBar.style.transform = `scaleX(${p})`;
        let best = storySteps[0], bd = 9;
        for (const a of storySteps) {
            const d = Math.abs(Number(a.dataset.at) - p);
            if (d < bd) {
                bd = d;
                best = a;
            }
        }
        storySteps.forEach((a) => a.classList.toggle('on', a === best));
    }
    else {
        st = heroState(elapsed, framing, ptr);
    }
    studio.render(st);
    const showSpots = !inStory && !document.body.classList.contains('intro-on');
    for (const b of spotEls) {
        const s = studio.toScreen(spots[b.dataset.spot], innerWidth, innerHeight);
        b.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
        b.hidden = !(showSpots && s.visible);
    }
    // adaptive resolution: drop pixel ratio if frames are consistently slow
    if (dt > 0 && dt < 200) {
        frames++;
        if (dt > 26)
            slow++;
        if (frames >= 90) {
            if (slow > 45 && dpr > 0.8)
                dpr = Math.max(0.75, dpr - 0.25);
            frames = slow = 0;
        }
    }
}
requestAnimationFrame(loop);
// ---------- intro film ----------
const intro = $('#intro'), video = $('#intro-video');
const soundBtn = $('#intro-sound');
let introHolding = false;
let introDone = null;
function setSound(on) {
    video.muted = !on;
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.querySelector('.lbl').textContent = on ? 'Sound on' : 'Sound off';
    store.set('nv-sound', on ? '1' : '0');
}
soundBtn.addEventListener('click', () => setSound(video.muted));
function sources() {
    const big = innerWidth * (devicePixelRatio || 1) > 1400 && !saveData && !lowEnd;
    const name = framing === 'port' ? 'portrait' : big ? '1080' : '720';
    return `<source src="video/nearvolt-intro-${name}.webm" type="video/webm"><source src="video/nearvolt-intro-${name}.mp4" type="video/mp4">`;
}
function playIntro(userInitiated) {
    if (introDone)
        return;
    document.body.classList.add('intro-on');
    intro.hidden = false;
    intro.classList.remove('out');
    video.innerHTML = sources();
    video.poster = '';
    video.load();
    setSound(userInitiated && store.get('nv-sound') === '1');
    let finished = false, started = false;
    const watchdog = setTimeout(() => { if (!started)
        finish(false); }, 4500);
    const cap = setTimeout(() => finish(false), 16000);
    const onPlaying = () => { started = true; };
    const finish = async (seamless) => {
        if (finished)
            return;
        finished = true;
        clearTimeout(watchdog);
        clearTimeout(cap);
        video.removeEventListener('playing', onPlaying);
        store.set('nv-intro', '1');
        if (seamless) {
            // hold the last film frame until the live scene is ready, then cross-fade identical frames
            introHolding = true;
            const t0 = performance.now();
            while (!modelReady() && performance.now() - t0 < 5000)
                await new Promise((r) => setTimeout(r, 50));
            if (studio && !studio.ready)
                showFallback();
        }
        else {
            video.pause();
        }
        heroStart = performance.now();
        introHolding = false;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        intro.classList.add('out');
        document.body.classList.remove('intro-on');
        setTimeout(() => { intro.hidden = true; video.pause(); video.removeAttribute('src'); video.innerHTML = ''; video.load(); introDone = null; }, seamless ? 700 : 450);
    };
    introDone = () => finish(false);
    video.addEventListener('playing', onPlaying);
    video.onended = () => finish(true);
    video.onerror = () => finish(false);
    video.querySelectorAll('source')[1]?.addEventListener('error', () => finish(false));
    video.play().catch(() => finish(false));
}
$('#intro-skip').addEventListener('click', () => introDone?.());
addEventListener('keydown', (e) => { if (e.key === 'Escape' && introDone)
    introDone(); });
$('#replay-intro').addEventListener('click', () => { scrollTo({ top: 0, behavior: 'auto' }); playIntro(true); });
const autoplay = q.has('intro') || (!reduced && !q.has('nointro') && store.get('nv-intro') !== '1');
if (autoplay)
    playIntro(false);
// ---------- UI ----------
const navEl = $('#nav');
addEventListener('scroll', () => navEl.classList.toggle('scrolled', scrollY > 40), { passive: true });
const menuBtn = $('#menu-btn');
menuBtn.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') !== 'true';
    menuBtn.setAttribute('aria-expanded', String(open));
    navEl.classList.toggle('open', open);
});
document.querySelectorAll('#menu a').forEach((a) => a.addEventListener('click', () => { menuBtn.setAttribute('aria-expanded', 'false'); navEl.classList.remove('open'); }));
spotEls.forEach((b) => {
    const card = document.getElementById(b.getAttribute('aria-describedby'));
    const place = () => {
        const r = b.getBoundingClientRect();
        card.style.left = `${clamp(r.left + r.width / 2 - 130, 12, innerWidth - 272)}px`;
        card.style.top = `${r.top > innerHeight * 0.55 ? r.top - card.offsetHeight - 14 : r.bottom + 14}px`;
    };
    const open = (on) => { if (on)
        place(); card.classList.toggle('show', on); b.setAttribute('aria-expanded', String(on)); };
    b.addEventListener('pointerenter', () => open(true));
    b.addEventListener('pointerleave', () => open(false));
    b.addEventListener('focus', () => open(true));
    b.addEventListener('blur', () => open(false));
    b.addEventListener('click', () => open(!card.classList.contains('show')));
});
if (reduced || !('IntersectionObserver' in window))
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
    } }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}
if (finePointer && !reduced) {
    const light = $('.cursor-light');
    addEventListener('pointermove', (e) => { light.style.transform = `translate(${e.clientX - 300}px, ${e.clientY - 300}px)`; light.style.opacity = '1'; }, { passive: true });
    document.querySelectorAll('.gcard').forEach((c) => {
        c.addEventListener('pointermove', (e) => {
            const r = c.getBoundingClientRect();
            c.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -6}deg`);
            c.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 6}deg`);
        });
        c.addEventListener('pointerleave', () => { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); });
    });
}
initCompat();
initCalc();
initContact();
initMap();
