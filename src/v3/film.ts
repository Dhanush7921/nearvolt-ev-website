// NEARVOLT EV V3 — "Home Plug" intro film. A pre-rendered video played by the browser's native (hardware) decoder,
// replacing the real-time WebGL intro. No dependencies, so the poster and film start before three.js has loaded.
// Plays once per session (muted, playsinline), Skip / Esc / Replay / Sound, bypassed for reduced motion, and it
// hands over to the live hero on any failure (autoplay blocked, decode error, stalled network).

const q = new URLSearchParams(location.search);
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const wrap = el<HTMLDivElement>('v3-film');
const video = el<HTMLVideoElement>('v3-film-video');
const bar = el<HTMLElement>('v3-film-bar');
const skipBtn = el<HTMLButtonElement>('v3-skip');
const soundBtn = el<HTMLButtonElement>('v3-sound');
const replayBtn = el<HTMLButtonElement>('v3-replay');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

/** Larger desktop file only when the screen and connection can use it. */
const HAS_1440 = false;

type Conn = { saveData?: boolean; effectiveType?: string; downlink?: number };
export function filmSource() {
  const c = (navigator as Navigator & { connection?: Conn }).connection;
  const slow = !!c?.saveData || /(^|-)(2g|3g)$/.test(c?.effectiveType || '');
  const port = innerHeight > innerWidth * 1.05;
  const px = Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 3);
  const ext = video.canPlayType('video/mp4; codecs="avc1.640028"') ? 'mp4' : 'webm';
  let name: string;
  if (port) name = slow || px < 1500 || (c?.downlink ?? 10) < 5 ? 'port-720' : 'port-1080';
  else if (slow || px < 1100) name = 'land-720';
  else name = HAS_1440 && px >= 2300 && (c?.downlink ?? 10) >= 8 ? 'land-1440' : 'land-1080';
  return { name, port, src: `video/v3/home-plug-${name}.${ext}`, poster: `video/v3/poster-${port ? 'port' : 'land'}.jpg` };
}

let active = false;
let leaving = false;
let playing = false;
let muted = store.get('nv3-sound') !== 'on';
let end: ((seamless: boolean) => void) | null = null;
const emit = (name: string) => dispatchEvent(new Event(name));

function setSoundUi() {
  soundBtn.setAttribute('aria-pressed', String(!muted));
  const lbl = soundBtn.querySelector('.lbl');
  if (lbl) lbl.textContent = muted ? 'Sound off' : 'Sound on';
}

export function play() {
  if (active) return;
  const s = filmSource();
  active = true;
  leaving = false;
  wrap.dataset.src = s.name;
  wrap.classList.toggle('port', s.port);
  wrap.classList.remove('out');
  wrap.hidden = false;
  document.body.classList.add('intro-on', 'film-on');
  video.poster = s.poster;
  video.muted = muted;
  video.src = s.src;
  setSoundUi();
  const prevFocus = document.activeElement as HTMLElement | null;
  skipBtn.focus({ preventScroll: true });
  emit('nv3:film-start');

  let started = false;
  let lastT = -1;
  let lastMove = performance.now();
  let done = false;
  const onTime = () => {
    if (video.currentTime !== lastT) { lastT = video.currentTime; lastMove = performance.now(); }
    if (video.duration) bar.style.transform = `scaleX(${video.currentTime / video.duration})`;
  };
  const onPlaying = () => { if (!started) { started = true; playing = true; emit('nv3:film-playing'); } };
  const onEnded = () => finish(true);
  const onError = () => finish(false);
  // never hold the page: give up if the film cannot start promptly, or if playback stalls
  const guard = setTimeout(() => { if (!started) finish(false); }, 6000);
  const watch = setInterval(() => { if (started && !video.ended && !video.paused && performance.now() - lastMove > 5000) finish(false); }, 1000);

  function finish(seamless: boolean) {
    if (done) return;
    done = true;
    leaving = true;
    playing = false;
    clearTimeout(guard);
    clearInterval(watch);
    video.removeEventListener('timeupdate', onTime);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('ended', onEnded);
    video.removeEventListener('error', onError);
    store.set('nv3-intro', '1');
    document.body.classList.remove('intro-on', 'film-on');
    wrap.classList.add('out');
    end = null;
    emit('nv3:film-end');
    setTimeout(() => {
      wrap.hidden = true;
      video.pause();
      video.removeAttribute('src');
      video.load(); // release the decoder and buffered data
      active = false;
      leaving = false;
      bar.style.transform = 'scaleX(0)';
    }, seamless ? 700 : 450);
    if (prevFocus && prevFocus !== document.body && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
  }
  end = finish;
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('ended', onEnded);
  video.addEventListener('error', onError);
  video.play().catch(() => {
    // autoplay with sound can be refused: retry muted once, otherwise hand over to the page
    if (!video.muted) { muted = true; video.muted = true; setSoundUi(); video.play().catch(() => finish(false)); } else finish(false);
  });
}

skipBtn.addEventListener('click', () => end?.(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && end) end(false); });
soundBtn.addEventListener('click', () => {
  muted = !muted;
  video.muted = muted;
  store.set('nv3-sound', muted ? 'off' : 'on');
  setSoundUi();
});
replayBtn.addEventListener('click', () => { scrollTo({ top: 0, behavior: 'auto' }); play(); });

(window as unknown as { __nvFilm: unknown }).__nvFilm = { active: () => active && !leaving, started: () => playing, play, source: filmSource };

const auto = !q.has('nointro') && !q.has('rec') && (q.has('intro') || (!reduced && store.get('nv3-intro') !== '1'));
if (auto) play();
