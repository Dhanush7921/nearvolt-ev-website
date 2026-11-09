// NEARVOLT studio renderer: WebGL2, HDR, analytic softbox lighting, floor reflection, bloom.
// The same class renders the homepage hero live and the intro film offline, so both match.
import { loadGLB } from './glb.js';
import { coverProjection, fromTRS, ident, lerp3, lookAt, mul, normalMatrix, norm, project } from './math.js';
import * as S from './shaders.js';
export const PORT = [1.094, 0.706, 0.815];
export const HEADLIGHTS = [[0.62, 0.66, 2.22], [-0.62, 0.66, 2.22]];
const CHARGER = [2.2, 0, -0.55];
const OUTLET = [2.065, 0.6, -0.55];
const HOLSTER = [1.98, 1.02, -0.55];
const SEATED = [PORT[0] + 0.05, PORT[1], PORT[2]];
export const defaultState = () => ({
    cam: { pos: [5.4, 1.3, 5.2], target: [0.25, 0.55, 0.3], fov: 28 },
    refAspect: 16 / 9, time: 0, lights: [1, 1, 1, 1], headlights: 1, connector: 1, energy: 0.6, flow: 0.6, exposure: 1, fade: 1, lines: 0.6,
});
const MIRROR = new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const mat = (o) => ({
    name: 'prop', base: [0.02, 0.025, 0.025, 1], metal: 0.2, rough: 0.4, baseTex: null, mrTex: null, normalTex: null, normalScale: 1,
    occTex: null, occStrength: 1, emissive: [0, 0, 0], emissiveTex: null, clearcoat: 0, alpha: 1, doubleSided: false, tag: 'other', ...o,
});
export class Studio {
    gl;
    canvas;
    ready = false;
    lost = false;
    viewProj = ident();
    hdr;
    samples;
    reflections;
    car = [];
    props = [];
    pbr;
    floor;
    bgp;
    part;
    bright;
    blur;
    comp;
    floorVao;
    partVao;
    partCount = 700;
    cable;
    msaa = null;
    scene;
    depth = null;
    b = [];
    w = 1;
    h = 1;
    paintColor = [0.5, 0.53, 0.52, 1];
    constructor(canvas, opts) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
        if (!gl)
            throw new Error('WebGL2 unavailable');
        this.gl = gl;
        this.hdr = !!gl.getExtension('EXT_color_buffer_float');
        this.samples = opts.quality === 'high' ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES)) : 0;
        this.reflections = true; // kept on all tiers so the live hero matches the film's final frame
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
        this.pbr = this.prog(S.PBR_VS, S.PBR_FS);
        this.floor = this.prog(S.FLOOR_VS, S.FLOOR_FS);
        this.bgp = this.prog(S.QUAD_VS, S.BG_FS);
        this.part = this.prog(S.PART_VS, S.PART_FS);
        this.bright = this.prog(S.QUAD_VS, S.BRIGHT_FS);
        this.blur = this.prog(S.QUAD_VS, S.BLUR_FS);
        this.comp = this.prog(S.QUAD_VS, S.COMP_FS);
        this.floorVao = this.vao(new Float32Array([-40, 0, -40, 40, 0, -40, -40, 0, 40, 40, 0, 40]), [[0, 3, 12, 0]]);
        const seeds = new Float32Array(this.partCount * 3);
        let s = 7;
        const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < seeds.length; i++)
            seeds[i] = rnd();
        this.partVao = this.vao(seeds, [[0, 3, 12, 0]]);
        this.buildProps();
    }
    async load(url, onProgress) {
        const ext = this.gl.getExtension('EXT_texture_filter_anisotropic');
        const items = await loadGLB(this.gl, url, ext ? 8 : 1, onProgress);
        for (const it of items) {
            const m = it.mat;
            if (m.tag === 'paint') {
                m.base = this.paintColor;
                m.metal = 0.8;
                m.rough = 0.24;
                m.clearcoat = 1;
                m.normalTex = null;
            }
            else if (m.tag === 'accent') {
                m.base = [0.012, 0.015, 0.015, 1];
                m.metal = 0.6;
                m.rough = 0.28;
                m.clearcoat = 1;
            }
            else if (m.tag === 'glass') {
                m.base = [0.004, 0.012, 0.01, 1];
                m.metal = 0;
                m.rough = 0.04;
                m.clearcoat = 1;
                m.alpha = 0.86;
            }
            else if (m.tag === 'dash') {
                m.emissive = [0.02, 0.3, 0.18];
            }
            const mw = mul(MIRROR, it.world);
            this.car.push({ ...it, mw, mn: normalMatrix(mw) });
        }
        // opaque first, glass last
        this.car.sort((a, b) => a.mat.alpha - b.mat.alpha < 0 ? 1 : a.mat.alpha - b.mat.alpha > 0 ? -1 : 0);
        this.ready = true;
    }
    setSize(cssW, cssH, dpr) {
        const w = Math.max(2, Math.round(cssW * dpr)), h = Math.max(2, Math.round(cssH * dpr));
        if (w === this.w && h === this.h && this.scene)
            return;
        this.w = w;
        this.h = h;
        this.canvas.width = w;
        this.canvas.height = h;
        const gl = this.gl;
        const fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
        const target = (tw, th) => {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, tw, th);
            for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
                gl.texParameteri(gl.TEXTURE_2D, k, v);
            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            return { fb, tex, w: tw, h: th };
        };
        this.scene = target(w, h);
        if (this.samples) {
            const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer(), db = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
            gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, fmt, w, h);
            gl.bindRenderbuffer(gl.RENDERBUFFER, db);
            gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
            this.msaa = { fb, rb, db };
        }
        else {
            this.depth = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
        }
        const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
        this.b = [target(hw, hh), target(hw, hh), target(qw, qh), target(qw, qh)];
    }
    /** Screen position (CSS px) of a world point, for hotspots and the logo particle origin. */
    toScreen(p, cssW, cssH) {
        const [x, y, w] = project(this.viewProj, p);
        return { x: (x * 0.5 + 0.5) * cssW, y: (0.5 - y * 0.5) * cssH, visible: w > 0 && Math.abs(x) < 1.05 && Math.abs(y) < 1.05 };
    }
    render(st) {
        const gl = this.gl;
        if (this.lost || !this.scene)
            return;
        const aspect = this.w / this.h;
        const view = lookAt(st.cam.pos, st.cam.target);
        const proj = coverProjection(st.cam.fov, st.refAspect, aspect, st.cam.ox || 0, st.cam.oy || 0);
        this.viewProj = mul(proj, view);
        this.updateRig(st);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaa ? this.msaa.fb : this.scene.fb);
        gl.viewport(0, 0, this.w, this.h);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const L = st.lights;
        const bgA = [0.0024, 0.003, 0.0029], bgB = [0.0052, 0.0066, 0.0064];
        const haze = 0.35 + L[3] * 0.65;
        gl.useProgram(this.bgp.p);
        gl.uniform3fv(this.bgp.u('uBgA'), bgA);
        gl.uniform3fv(this.bgp.u('uBgB'), bgB);
        gl.uniform1f(this.bgp.u('uHaze'), haze);
        gl.bindVertexArray(null);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        const plPos = [PORT[0] + 0.16, PORT[1], PORT[2]];
        const plCol = [0.12 * st.energy * 1.4, 1.0 * st.energy * 1.4, 0.6 * st.energy * 1.4];
        this.setupPbr(st, plPos, plCol);
        if (this.reflections && this.ready) {
            gl.frontFace(gl.CW);
            gl.uniform1f(this.pbr.u('uMirror'), 1);
            this.drawCar(st, true, false);
            this.drawProps(true);
            gl.frontFace(gl.CCW);
            gl.uniform1f(this.pbr.u('uMirror'), 0);
        }
        // floor
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        const f = this.floor;
        gl.useProgram(f.p);
        gl.uniformMatrix4fv(f.u('uVP'), false, this.viewProj);
        gl.uniform2f(f.u('uRes'), this.w, this.h);
        gl.uniform1f(f.u('uTop'), L[0]);
        gl.uniform3fv(f.u('uHL'), new Float32Array([...HEADLIGHTS[0], ...HEADLIGHTS[1]]));
        gl.uniform1f(f.u('uHead'), st.headlights * (this.ready ? 1 : 0));
        gl.uniform3fv(f.u('uPL'), plPos);
        gl.uniform3fv(f.u('uPLCol'), plCol);
        gl.uniform1f(f.u('uLines'), st.lines);
        gl.uniform1f(f.u('uTime'), st.time);
        gl.uniform3fv(f.u('uBgA'), bgA);
        gl.uniform3fv(f.u('uBgB'), bgB);
        gl.uniform1f(f.u('uHaze'), haze);
        gl.bindVertexArray(this.floorVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disable(gl.BLEND);
        gl.useProgram(this.pbr.p);
        if (this.ready)
            this.drawCar(st, false, false);
        this.drawProps(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        if (this.ready)
            this.drawCar(st, false, true);
        // energy particles
        if (st.flow > 0.001 || st.energy > 0.001) {
            const p = this.part;
            gl.blendFunc(gl.ONE, gl.ONE);
            gl.useProgram(p.p);
            gl.uniformMatrix4fv(p.u('uVP'), false, this.viewProj);
            const [b0, b1, b2, b3] = this.cablePts;
            gl.uniform3fv(p.u('uB0'), b0);
            gl.uniform3fv(p.u('uB1'), b1);
            gl.uniform3fv(p.u('uB2'), b2);
            gl.uniform3fv(p.u('uB3'), b3);
            gl.uniform3fv(p.u('uPort'), PORT);
            gl.uniform1f(p.u('uTime'), st.time);
            gl.uniform1f(p.u('uFlow'), st.flow);
            gl.uniform1f(p.u('uAura'), st.energy);
            gl.uniform1f(p.u('uPx'), this.h * 0.012);
            gl.bindVertexArray(this.partVao);
            gl.drawArrays(gl.POINTS, 0, this.partCount);
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        if (this.msaa) {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaa.fb);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.scene.fb);
            gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        }
        this.post(st);
    }
    // ---------- internals ----------
    cablePts = [OUTLET, OUTLET, OUTLET, OUTLET];
    updateRig(st) {
        const t = Math.min(1, Math.max(0, st.connector));
        const e = t * t * (3 - 2 * t);
        const pos = lerp3(HOLSTER, SEATED, e);
        pos[1] += Math.sin(Math.PI * e) * 0.22;
        const tilt = Math.sin(Math.PI * e) * 0.25;
        const connW = fromTRS(pos, [0, 0, Math.sin(tilt / 2), Math.cos(tilt / 2)]);
        for (const p of this.props)
            if (p.part === 'conn') {
                p.world = mul(connW, p.local);
                p.nrm = normalMatrix(p.world);
            }
        const ex = [pos[0] + 0.21, pos[1] - 0.05, pos[2]];
        const b0 = OUTLET, b3 = ex;
        const b1 = [b0[0] - 0.12, Math.max(0.03, b0[1] - 0.55), b0[2] + 0.05];
        const b2 = [b3[0] + 0.35, Math.max(0.03, b3[1] - 0.62), b3[2] - 0.1];
        this.cablePts = [b0, b1, b2, b3];
        this.updateCable();
        const ring = this.props.find((p) => p.part === 'ring');
        const rim = st.lights[3]; // charger and inlet lights wake with the studio rig
        const rk = 0.15 * rim + st.energy * 9, sk = 3 * (0.3 + st.energy) * rim;
        if (ring)
            ring.mat.emissive = [0.1 * rk, 1.0 * rk, 0.6 * rk];
        for (const p of this.props)
            if (p.mat.tag === 'signal')
                p.mat.emissive = [0.08 * sk, 1.0 * sk, 0.55 * sk];
    }
    setupPbr(st, plPos, plCol) {
        const gl = this.gl, u = this.pbr.u;
        gl.useProgram(this.pbr.p);
        gl.uniformMatrix4fv(u('uVP'), false, this.viewProj);
        gl.uniform3fv(u('uEye'), st.cam.pos);
        const L = st.lights;
        const rig = [
            { c: [0, 1, 0], r: [1, 0, 0], up: [0, 0, 1], s: [0.5, 1.15], col: [2.4 * L[0], 2.45 * L[0], 2.4 * L[0]] },
            { c: norm([-1, 0.38, 0.35]), r: norm([0.35, 0, 1]), up: [0, 1, 0], s: [0.9, 0.09], col: [2.6 * L[1], 2.6 * L[1], 2.6 * L[1]] },
            { c: norm([1, 0.45, -0.55]), r: norm([0.55, 0, 1]), up: [0, 1, 0], s: [0.85, 0.07], col: [2.4 * L[2], 2.45 * L[2], 2.4 * L[2]] },
            { c: norm([0.3, 0.12, -1]), r: [1, 0, 0.3], up: [0, 1, 0], s: [1.4, 0.05], col: [0.15 * L[3] * 3, 1.0 * L[3] * 3, 0.62 * L[3] * 3] },
        ];
        const flat = (k) => new Float32Array(rig.flatMap((x) => x[k]));
        rig.forEach((x) => { x.r = norm(x.r); });
        gl.uniform3fv(u('uLC[0]'), flat('c'));
        gl.uniform3fv(u('uLR[0]'), flat('r'));
        gl.uniform3fv(u('uLU[0]'), flat('up'));
        gl.uniform2fv(u('uLS[0]'), new Float32Array(rig.flatMap((x) => x.s)));
        gl.uniform3fv(u('uLCol[0]'), flat('col'));
        gl.uniform1f(u('uAmb'), 0.25 + 0.75 * Math.max(L[0], L[1]));
        gl.uniform3fv(u('uPL'), plPos);
        gl.uniform3fv(u('uPLCol'), plCol);
        gl.uniform1i(u('tBase'), 0);
        gl.uniform1i(u('tMR'), 1);
        gl.uniform1i(u('tNrm'), 2);
        gl.uniform1i(u('tOcc'), 3);
        gl.uniform1i(u('tEmis'), 4);
        gl.uniform1f(u('uMirror'), 0);
        gl.vertexAttrib3f(1, 0, 1, 0);
    }
    bindMat(m, emisMul = 1) {
        const gl = this.gl, u = this.pbr.u;
        let has = 0;
        const tex = (unit, r, bit) => {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, r ? r.tex : null); // never leave a render target bound (feedback loop)
            if (r)
                has |= bit;
        };
        tex(0, m.baseTex, 1);
        tex(1, m.mrTex, 2);
        tex(2, m.normalTex, 4);
        tex(3, m.occTex, 8);
        tex(4, m.emissiveTex, 16);
        gl.uniform1i(u('uHas'), has);
        gl.uniform4fv(u('uBase'), m.base);
        gl.uniform1f(u('uMetal'), m.metal);
        gl.uniform1f(u('uRough'), m.rough);
        gl.uniform1f(u('uCC'), m.clearcoat);
        gl.uniform1f(u('uOccS'), m.occStrength);
        gl.uniform1i(u('uOccSet'), m.occTex?.set || 0);
        gl.uniform1f(u('uNrmS'), m.normalScale);
        gl.uniform4fv(u('uNrmXf'), m.normalTex?.xf || [1, 1, 0, 0]);
        gl.uniform3f(u('uEmis'), m.emissive[0] * emisMul, m.emissive[1] * emisMul, m.emissive[2] * emisMul);
        gl.uniform1f(u('uAlpha'), m.alpha);
        if (m.doubleSided)
            gl.disable(gl.CULL_FACE);
        else
            gl.enable(gl.CULL_FACE);
    }
    drawCar(st, mirror, transparent) {
        const gl = this.gl, u = this.pbr.u;
        for (const it of this.car) {
            if ((it.mat.alpha < 1) !== transparent)
                continue;
            if (mirror && it.mat.alpha < 1)
                continue;
            const tag = it.mat.tag;
            let em = 1;
            if (tag === 'head') {
                it.mat.emissive = [0.85, 0.93, 1];
                em = 16 * st.headlights;
            }
            else if (tag === 'tail')
                em = 3 * st.headlights;
            else if (tag === 'signal')
                em = 0;
            this.bindMat(it.mat, em);
            gl.uniformMatrix4fv(u('uModel'), false, mirror ? it.mw : it.world);
            gl.uniformMatrix3fv(u('uNrmM'), false, mirror ? it.mn : it.nrm);
            gl.bindVertexArray(it.vao);
            gl.drawElements(gl.TRIANGLES, it.count, it.indexType, 0);
        }
        gl.enable(gl.CULL_FACE);
    }
    drawProps(mirror) {
        const gl = this.gl, u = this.pbr.u;
        const all = [...this.props, { ...this.cable, world: ident(), nrm: normalMatrix(ident()) }];
        for (const p of all) {
            this.bindMat(p.mat);
            const w = mirror ? mul(MIRROR, p.world) : p.world;
            gl.uniformMatrix4fv(u('uModel'), false, w);
            gl.uniformMatrix3fv(u('uNrmM'), false, mirror ? normalMatrix(w) : p.nrm);
            gl.bindVertexArray(p.vao);
            gl.drawArrays(gl.TRIANGLES, 0, p.count);
        }
        gl.enable(gl.CULL_FACE);
    }
    post(st) {
        const gl = this.gl;
        const [h1, h2, q1, q2] = this.b;
        const pass = (pr, dst, src, set) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
            gl.viewport(0, 0, dst ? dst.w : this.w, dst ? dst.h : this.h);
            gl.useProgram(pr.p);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, src);
            gl.uniform1i(pr.u('t'), 0);
            set();
            gl.bindVertexArray(null);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        pass(this.bright, h1, this.scene.tex, () => { gl.uniform2f(this.bright.u('uTexel'), 1 / this.w, 1 / this.h); gl.uniform1f(this.bright.u('uTh'), 0.9); });
        pass(this.blur, h2, h1.tex, () => gl.uniform2f(this.blur.u('uDir'), 1 / h1.w, 0));
        pass(this.blur, h1, h2.tex, () => gl.uniform2f(this.blur.u('uDir'), 0, 1 / h1.h));
        pass(this.blur, q1, h1.tex, () => gl.uniform2f(this.blur.u('uDir'), 1.5 / q1.w, 0));
        pass(this.blur, q2, q1.tex, () => gl.uniform2f(this.blur.u('uDir'), 0, 1.5 / q1.h));
        pass(this.blur, q1, q2.tex, () => gl.uniform2f(this.blur.u('uDir'), 3 / q1.w, 0));
        pass(this.blur, q2, q1.tex, () => gl.uniform2f(this.blur.u('uDir'), 0, 3 / q1.h));
        const c = this.comp;
        pass(c, null, this.scene.tex, () => {
            gl.uniform1i(c.u('tS'), 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, h1.tex);
            gl.uniform1i(c.u('tB1'), 1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, q2.tex);
            gl.uniform1i(c.u('tB2'), 2);
            gl.uniform1f(c.u('uBloom'), 1);
            gl.uniform1f(c.u('uExposure'), st.exposure);
            gl.uniform1f(c.u('uFade'), st.fade);
            gl.uniform1f(c.u('uGrain'), 0.018);
            gl.uniform1f(c.u('uTime'), st.time);
            gl.uniform2f(c.u('uRes'), this.w, this.h);
        });
    }
    prog(vs, fs) {
        const gl = this.gl;
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost())
                throw new Error(gl.getShaderInfoLog(s) || 'shader');
            return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost())
            throw new Error(gl.getProgramInfoLog(p) || 'link');
        const cache = new Map();
        return { p, u: (n) => { if (!cache.has(n))
                cache.set(n, gl.getUniformLocation(p, n)); return cache.get(n); } };
    }
    vao(data, attrs, usage) {
        const gl = this.gl;
        const v = gl.createVertexArray();
        gl.bindVertexArray(v);
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
        for (const [loc, n, stride, off] of attrs) {
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
        }
        gl.bindVertexArray(null);
        return v;
    }
    meshVao(tris) {
        return { vao: this.vao(new Float32Array(tris), [[0, 3, 32, 0], [1, 3, 32, 12], [2, 2, 32, 24]]), count: tris.length / 8 };
    }
    buildProps() {
        const charcoal = mat({ base: [0.018, 0.022, 0.022, 1], metal: 0.3, rough: 0.32, clearcoat: 0.8 });
        const satin = mat({ base: [0.05, 0.058, 0.056, 1], metal: 0.7, rough: 0.38 });
        const screen = mat({ base: [0.002, 0.004, 0.004, 1], metal: 0, rough: 0.06, clearcoat: 1, emissive: [0.004, 0.05, 0.03] });
        const strip = mat({ base: [0.02, 0.2, 0.12, 1], metal: 0, rough: 0.4, tag: 'signal', emissive: [0.24, 3, 1.65] });
        const ring = mat({ base: [0.02, 0.2, 0.12, 1], metal: 0, rough: 0.4, emissive: [0.1, 1, 0.6] });
        const inletFace = mat({ base: [0.006, 0.007, 0.007, 1], metal: 0.2, rough: 0.5 });
        const add = (tris, m, world, part = 'static') => {
            const g = this.meshVao(tris);
            const p = { ...g, mat: m, world, nrm: normalMatrix(world), part };
            if (part === 'conn')
                p.local = world;
            this.props.push(p);
        };
        const C = CHARGER;
        add(box(0.5, 0.05, 0.46), satin, fromTRS([C[0], 0.025, C[2]]));
        add(box(0.25, 1.52, 0.34, 0.03), charcoal, fromTRS([C[0], 0.81, C[2]]));
        add(box(0.012, 1.1, 0.018), strip, fromTRS([C[0] - 0.126, 0.8, C[2] + 0.15]));
        add(box(0.012, 1.1, 0.018), strip, fromTRS([C[0] - 0.126, 0.8, C[2] - 0.15]));
        add(box(0.022, 1.15, 0.012), strip, fromTRS([C[0] - 0.08, 0.82, C[2] + 0.172]));
        add(box(0.255, 0.012, 0.345), strip, fromTRS([C[0], 1.574, C[2]]));
        add(box(0.01, 0.2, 0.24), screen, fromTRS([C[0] - 0.126, 1.3, C[2]]));
        add(box(0.07, 0.12, 0.14), satin, fromTRS([C[0] - 0.15, 1.02, C[2]])); // holster
        // inlet on the car body (recess + status ring)
        const rotZ = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // cylinder Y -> X
        add(cylinder(0.05, 0.02, 28), inletFace, fromTRS([PORT[0] - 0.004, PORT[1], PORT[2]], rotZ));
        add(torus(0.058, 0.0055, 40, 10), ring, fromTRS([PORT[0] + 0.006, PORT[1], PORT[2]], rotZ), 'ring');
        // connector (local space: head centre at origin, plugs towards -X)
        add(cylinder(0.042, 0.11, 28), charcoal, fromTRS([0, 0, 0], rotZ), 'conn');
        add(cylinder(0.047, 0.014, 28), strip, fromTRS([-0.046, 0, 0], rotZ), 'conn');
        add(box(0.17, 0.05, 0.046, 0.012), charcoal, fromTRS([0.12, -0.03, 0]), 'conn');
        const data = new Float32Array(48 * 10 * 6 * 8);
        const vbo = this.gl.createBuffer();
        const vao = this.gl.createVertexArray();
        const gl = this.gl;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        for (const [loc, n, off] of [[0, 3, 0], [1, 3, 12], [2, 2, 24]]) {
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 32, off);
        }
        gl.bindVertexArray(null);
        this.cable = { vao, vbo, count: data.length / 8, data, mat: mat({ base: [0.01, 0.012, 0.012, 1], metal: 0, rough: 0.55, clearcoat: 0.3 }) };
    }
    updateCable() {
        const [p0, p1, p2, p3] = this.cablePts;
        const SEG = 48, RAD = 10, r = 0.014;
        const pt = (t) => { const s = 1 - t; return [0, 1, 2].map((i) => s * s * s * p0[i] + 3 * s * s * t * p1[i] + 3 * s * t * t * p2[i] + t * t * t * p3[i]); };
        const rings = [];
        for (let i = 0; i <= SEG; i++) {
            const t = i / SEG, c = pt(t), d = norm(sub(pt(Math.min(1, t + 0.01)), pt(Math.max(0, t - 0.01))));
            const n = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
            rings.push({ c, n, b: cross(d, n) });
        }
        const out = this.cable.data;
        let k = 0;
        const vtx = (i, j) => {
            const a = (j / RAD) * Math.PI * 2, R = rings[i];
            const nx = R.n[0] * Math.cos(a) + R.b[0] * Math.sin(a), ny = R.n[1] * Math.cos(a) + R.b[1] * Math.sin(a), nz = R.n[2] * Math.cos(a) + R.b[2] * Math.sin(a);
            out[k++] = R.c[0] + nx * r;
            out[k++] = R.c[1] + ny * r;
            out[k++] = R.c[2] + nz * r;
            out[k++] = nx;
            out[k++] = ny;
            out[k++] = nz;
            out[k++] = i / SEG;
            out[k++] = j / RAD;
        };
        for (let i = 0; i < SEG; i++)
            for (let j = 0; j < RAD; j++) {
                vtx(i, j);
                vtx(i + 1, j);
                vtx(i + 1, j + 1);
                vtx(i, j);
                vtx(i + 1, j + 1);
                vtx(i, j + 1);
            }
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cable.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
    }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// --- procedural geometry (interleaved pos3 nrm3 uv2, CCW) ---
function quad(out, a, b, c, d, n) {
    for (const [p, uv] of [[a, [0, 0]], [b, [1, 0]], [c, [1, 1]], [a, [0, 0]], [c, [1, 1]], [d, [0, 1]]])
        out.push(...p, ...n, ...uv);
}
function box(w, h, d, bevel = 0) {
    const x = w / 2, y = h / 2, z = d / 2, o = [];
    void bevel;
    quad(o, [x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], [1, 0, 0]);
    quad(o, [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], [-1, 0, 0]);
    quad(o, [-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], [0, 1, 0]);
    quad(o, [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], [0, -1, 0]);
    quad(o, [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1]);
    quad(o, [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1]);
    return o;
}
function cylinder(r, h, seg) {
    const o = [], y = h / 2;
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
        const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
        for (const [p, n, yy] of [[p0, n0, -y], [p0, n0, y], [p1, n1, y], [p0, n0, -y], [p1, n1, y], [p1, n1, -y]])
            o.push(p[0], yy, p[2], ...n, 0, 0);
        o.push(0, y, 0, 0, 1, 0, 0, 0, p1[0], y, p1[2], 0, 1, 0, 0, 0, p0[0], y, p0[2], 0, 1, 0, 0, 0);
        o.push(0, -y, 0, 0, -1, 0, 0, 0, p0[0], -y, p0[2], 0, -1, 0, 0, 0, p1[0], -y, p1[2], 0, -1, 0, 0, 0);
    }
    return o;
}
function torus(R, r, seg, rs) {
    const o = [];
    const v = (i, j) => {
        const a = (i / seg) * Math.PI * 2, b = (j / rs) * Math.PI * 2;
        const n = [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)];
        o.push(Math.cos(a) * (R + r * Math.cos(b)), r * Math.sin(b), Math.sin(a) * (R + r * Math.cos(b)), ...n, 0, 0);
    };
    for (let i = 0; i < seg; i++)
        for (let j = 0; j < rs; j++) {
            v(i, j);
            v(i, j + 1);
            v(i + 1, j + 1);
            v(i, j);
            v(i + 1, j + 1);
            v(i + 1, j);
        }
    return o;
}
