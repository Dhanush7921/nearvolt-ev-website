// Camera and lighting choreography shared by the intro film and the live homepage.
// The intro's final frame (t = INTRO_LEN) is exactly heroState(…, elapsed = 0).
import { clamp, smooth } from './math.js';
import { defaultState, PORT } from './studio.js';
export const INTRO_LEN = 8;
export const REF = { land: 16 / 9, port: 9 / 16 };
export const HERO = {
    land: { pos: [6.1, 1.25, 5.0], target: [0.6, 0.58, 0.1], fov: 28, ox: 0.24, oy: -0.08 },
    port: { pos: [6.2, 2.3, 10.4], target: [0.55, 0.45, 0.05], fov: 50, ox: 0.18, oy: -0.3 },
};
const P = PORT;
const INTRO_KEYS = {
    land: [
        { t: 0, pos: [1.55, 0.6, 6.6], target: [0, 0.62, 2], fov: 30, ox: 0, oy: 0 },
        { t: 2, pos: [1.25, 0.58, 5.7], target: [0, 0.62, 2], fov: 30, ox: 0, oy: 0 },
        { t: 3.9, pos: [4.7, 1.05, 3.6], target: [0.4, 0.62, 0.6], fov: 30, ox: 0, oy: 0 },
        { t: 4.7, pos: [2.85, 0.95, 1.95], target: [P[0] + 0.1, 0.75, 0.72], fov: 27, ox: 0, oy: 0 },
        { t: 6, pos: [2.5, 0.84, 1.42], target: [P[0] + 0.15, 0.74, 0.8], fov: 24, ox: 0, oy: 0 },
        { t: 7, pos: [3.4, 1.0, 2.6], target: [0.95, 0.72, 0.6], fov: 26, ox: 0.1, oy: 0 },
        { t: 7.8, ...HERO.land },
        { t: 8, ...HERO.land },
    ],
    port: [
        { t: 0, pos: [1.2, 0.62, 7.4], target: [0, 0.62, 2], fov: 40, ox: 0, oy: 0 },
        { t: 2, pos: [1.0, 0.6, 6.5], target: [0, 0.62, 2], fov: 40, ox: 0, oy: 0 },
        { t: 3.9, pos: [5.6, 1.25, 4.6], target: [0.3, 0.55, 0.4], fov: 38, ox: 0, oy: 0 },
        { t: 4.7, pos: [3.1, 1.0, 2.2], target: [P[0] + 0.1, 0.74, 0.72], fov: 34, ox: 0, oy: 0 },
        { t: 6, pos: [2.65, 0.88, 1.5], target: [P[0] + 0.15, 0.74, 0.8], fov: 30, ox: 0, oy: 0 },
        { t: 7, pos: [4.2, 1.2, 3.4], target: [0.9, 0.7, 0.55], fov: 32, ox: 0, oy: -0.1 },
        { t: 7.8, ...HERO.port },
        { t: 8, ...HERO.port },
    ],
};
function hermite(keys, t) {
    t = clamp(t, keys[0].t, keys[keys.length - 1].t);
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t)
        i++;
    const a = keys[i], b = keys[i + 1];
    const dt = b.t - a.t || 1;
    const u = (t - a.t) / dt;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    const tan = (k, f) => {
        if (k <= 0 || k >= keys.length - 1)
            return 0;
        const p = keys[k - 1], n = keys[k + 1];
        return ((f(n) - f(p)) / (n.t - p.t)) * dt;
    };
    const val = (f) => h00 * f(a) + h10 * tan(i, f) + h01 * f(b) + h11 * tan(i + 1, f);
    const v3 = (g) => [0, 1, 2].map((c) => val((x) => x[g][c]));
    return { pos: v3('pos'), target: v3('target'), fov: val((x) => x.fov), ox: val((x) => x.ox || 0), oy: val((x) => x.oy || 0) };
}
/** Values the homepage holds at rest; the intro converges onto these. */
const HERO_LEVELS = { energy: 0.55, flow: 0.55, lines: 0.6 };
export function introState(t, framing) {
    const s = defaultState();
    s.refAspect = REF[framing];
    s.time = t;
    s.cam = hermite(INTRO_KEYS[framing], t);
    s.headlights = t < 0.55 ? 0 : t < 0.63 ? 0.55 : t < 0.72 ? 0.04 : smooth(0.72, 1.5, t);
    s.lights = [smooth(2.25, 3.0, t), smooth(2.0, 2.6, t), smooth(2.6, 3.25, t), smooth(2.9, 3.7, t)];
    s.connector = smooth(4.3, 5.25, t);
    const flash = t > 5.22 ? Math.exp(-(t - 5.22) * 5) * 0.9 : 0;
    s.energy = t < 5.2 ? 0 : t < 7.2 ? Math.min(1, smooth(5.2, 5.4, t)) + flash : 1 - (1 - HERO_LEVELS.energy) * smooth(7.2, 7.9, t);
    s.flow = t < 7.2 ? smooth(5.4, 5.95, t) : 1 - (1 - HERO_LEVELS.flow) * smooth(7.2, 7.9, t);
    s.exposure = 1 - 0.62 * (smooth(6.1, 6.6, t) - smooth(7.15, 7.85, t));
    s.lines = HERO_LEVELS.lines * smooth(7.1, 7.9, t);
    return s;
}
/** Live homepage state. `elapsed` = seconds since the intro handed over; pointer in [-1, 1]. */
export function heroState(elapsed, framing, pointer) {
    const s = defaultState();
    s.refAspect = REF[framing];
    s.time = INTRO_LEN + elapsed;
    const ramp = smooth(0, 2.5, elapsed);
    const h = HERO[framing];
    const a = Math.sin(elapsed * 0.22) * 0.06 * ramp + pointer.x * 0.05;
    const cx = h.pos[0] - h.target[0], cz = h.pos[2] - h.target[2];
    const ca = Math.cos(a), sa = Math.sin(a);
    s.cam = {
        pos: [h.target[0] + cx * ca - cz * sa, h.pos[1] + Math.sin(elapsed * 0.31) * 0.04 * ramp - pointer.y * 0.06, h.target[2] + cx * sa + cz * ca],
        target: h.target, fov: h.fov, ox: h.ox, oy: h.oy,
    };
    s.headlights = 1;
    s.connector = 1;
    s.energy = HERO_LEVELS.energy + Math.sin(elapsed * 1.6) * 0.12 * ramp;
    s.flow = HERO_LEVELS.flow;
    s.lines = HERO_LEVELS.lines;
    return s;
}
/** Scroll story (0..1) through the charging experience, starting from the hero pose. */
export function storyState(p, framing, time) {
    const s = heroState(time, framing, { x: 0, y: 0 });
    const port = framing === 'port';
    const keys = [
        { t: 0, ...HERO[framing] },
        { t: 0.3, pos: port ? [0.6, 2.2, 7.6] : [7.2, 1.6, 0.6], target: [0, 0.55, 0.2], fov: port ? 38 : 28, ox: port ? 0 : -0.28, oy: port ? -0.2 : 0 },
        { t: 0.62, pos: port ? [2.75, 0.9, 1.7] : [2.55, 0.86, 1.45], target: [P[0] + 0.12, 0.74, 0.8], fov: port ? 32 : 24, ox: port ? 0 : -0.3, oy: port ? -0.18 : 0 },
        { t: 1, pos: port ? [5.5, 6.5, 6.5] : [5.5, 5.2, 6.8], target: [0.8, 0.2, 0.2], fov: port ? 40 : 30, ox: port ? 0 : 0.28, oy: port ? -0.15 : 0 },
    ];
    s.cam = hermite(keys, p);
    s.energy = 0.45 + 0.6 * smooth(0.4, 0.62, p);
    s.flow = 0.4 + 0.6 * smooth(0.45, 0.65, p);
    s.lines = 0.5 + 0.5 * smooth(0.7, 1, p);
    return s;
}
