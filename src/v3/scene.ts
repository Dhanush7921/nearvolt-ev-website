// NEARVOLT V3 cinematic studio (Three.js, loaded from CDN). One scene plays the intro in real time and
// continues as the homepage hero, so the hand-over is frame-identical by construction.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadVehicle, VEHICLE, type Rig } from './vehicle.js';

type V = [number, number, number];
type Key = { t: number; pos: V; tgt: V; fov: number };
export type Shot = { pos: V; tgt: V; fov: number; head: number; lights: number; rim: number; plug: number; energy: number; flow: number; exposure: number };
export const INTRO = 8;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sm = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Catmull-Rom/Hermite through timed keys, zero velocity at the ends (no camera jolt at hand-over). */
function path(keys: Key[], t: number) {
  t = clamp(t, keys[0].t, keys[keys.length - 1].t);
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1], dt = b.t - a.t || 1, u = (t - a.t) / dt;
  const h = [2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u, -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2];
  const tan = (k: number, f: (x: Key) => number) => (k <= 0 || k >= keys.length - 1 ? 0 : ((f(keys[k + 1]) - f(keys[k - 1])) / (keys[k + 1].t - keys[k - 1].t)) * dt);
  const v = (f: (x: Key) => number) => h[0] * f(a) + h[1] * tan(i, f) + h[2] * f(b) + h[3] * tan(i + 1, f);
  const v3 = (g: 'pos' | 'tgt'): V => [0, 1, 2].map((c) => v((x) => x[g][c])) as V;
  return { pos: v3('pos'), tgt: v3('tgt'), fov: v((x) => x.fov) };
}

export class Studio3 {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  rig: Rig | null = null;
  ready = false;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private env: THREE.Texture;
  private lights: { key: THREE.RectAreaLight; side: THREE.RectAreaLight; rim: THREE.RectAreaLight; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight };
  private charger = new THREE.Group();
  private conn = new THREE.Group();
  private cable: THREE.Mesh;
  private ring: THREE.Mesh;
  private strips: THREE.MeshStandardMaterial;
  private parts: THREE.Points;
  private headSpots: THREE.SpotLight[] = [];
  private placeholder: THREE.Object3D | null = null;
  private dims = new THREE.Vector3(1.88, 1.63, 4.37); // default BE 6-class envelope until a model is loaded
  private port = new THREE.Vector3(0.91, 0.95, 0.5);
  private refAspect = 16 / 9;
  readonly portrait: boolean;

  constructor(canvas: HTMLCanvasElement, opts: { high: boolean; portrait: boolean }) {
    this.portrait = opts.portrait;
    this.refAspect = opts.portrait ? 9 / 16 : 16 / 9;
    const r = new THREE.WebGLRenderer({ canvas, antialias: opts.high, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    RectAreaLightUniformsLib.init();
    const pm = new THREE.PMREMGenerator(r);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.env;
    this.scene.background = new THREE.Color('#050807');
    this.scene.fog = new THREE.Fog('#050807', 12, 30);

    const key = new THREE.RectAreaLight('#ffffff', 0, 6, 2.2); key.position.set(0, 4.2, 0.3); key.lookAt(0, 0, 0.3);
    const side = new THREE.RectAreaLight('#f2f7f5', 0, 5, 0.5); side.position.set(-4.5, 1.6, 1.5); side.lookAt(0, 0.8, 0);
    const rim = new THREE.RectAreaLight('#19d38f', 0, 5, 0.12); rim.position.set(1, 1.3, -4.6); rim.lookAt(0, 0.8, 0);
    const sun = new THREE.DirectionalLight('#ffffff', 0); sun.position.set(2.5, 7, 3.5); sun.castShadow = true;
    sun.shadow.mapSize.set(opts.high ? 2048 : 1024, opts.high ? 2048 : 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 16 });
    sun.shadow.radius = 6; sun.shadow.bias = -0.0004;
    const hemi = new THREE.HemisphereLight('#dfe8e5', '#0b0f0e', 0);
    this.scene.add(key, side, rim, sun, hemi);
    this.lights = { key, side, rim, sun, hemi };

    // glossy studio floor: mirror (high tier) under a semi-transparent satin layer + soft shadow catcher
    if (opts.high) {
      const mirror = new Reflector(new THREE.CircleGeometry(30, 64), { textureWidth: 1024, textureHeight: 1024, color: 0x3a3e3d });
      mirror.rotation.x = -Math.PI / 2; mirror.position.y = -0.001;
      this.scene.add(mirror);
    }
    const satin = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: '#050706', roughness: 0.5, metalness: 0, envMapIntensity: 0.12, transparent: opts.high, opacity: opts.high ? 0.93 : 1 }));
    satin.rotation.x = -Math.PI / 2; satin.receiveShadow = true;
    this.scene.add(satin);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.55 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; shadow.receiveShadow = true;
    this.scene.add(shadow);

    // original charger, connector, cable, inlet ring
    const charcoal = new THREE.MeshPhysicalMaterial({ color: '#111514', roughness: 0.3, metalness: 0.4, clearcoat: 0.6 });
    this.strips = new THREE.MeshStandardMaterial({ color: '#0b3d2b', emissive: '#19d38f', emissiveIntensity: 0 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.28, 1.55, 0.36, 4, 0.04), charcoal); body.position.y = 0.8; body.castShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.15, 0.02), this.strips); strip.position.set(-0.142, 0.82, 0.12);
    const strip2 = strip.clone(); strip2.position.z = -0.12;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.01, 0.35), this.strips); cap.position.y = 1.58;
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.05, 0.5, 2, 0.02), charcoal); base.position.y = 0.025;
    this.charger.add(body, strip, strip2, cap, base);
    this.scene.add(this.charger);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.11, 32).rotateZ(Math.PI / 2), charcoal);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.012, 32).rotateZ(Math.PI / 2), this.strips); lip.position.x = -0.05;
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.05, 0.046, 2, 0.012), charcoal); grip.position.set(0.12, -0.03, 0);
    this.conn.add(head, lip, grip);
    this.conn.traverse((o: THREE.Object3D) => { o.castShadow = true; });
    this.scene.add(this.conn);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.006, 12, 48).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0b3d2b', emissive: '#19d38f', emissiveIntensity: 0 }));
    this.scene.add(this.ring);
    this.cable = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial({ color: '#0b0d0d', roughness: 0.5, clearcoat: 0.3 }));
    this.cable.castShadow = true;
    this.scene.add(this.cable);
    const n = 700, seeds = new Float32Array(n * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); pg.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    this.parts = new THREE.Points(pg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uFlow: { value: 0 }, uB: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] }, uPx: { value: 30 } },
      vertexShader: `attribute vec3 seed; uniform float uT, uFlow, uPx; uniform vec3 uB[4]; varying float vA;
        vec3 bez(float t){ float s=1.0-t; return s*s*s*uB[0]+3.0*s*s*t*uB[1]+3.0*s*t*t*uB[2]+t*t*t*uB[3]; }
        void main(){ float t=fract(seed.x+uT*0.42); float a=seed.y*6.2832+uT*3.0+t*24.0;
          vec3 p=bez(t)+vec3(0.0,cos(a),sin(a))*0.02*(0.4+seed.y); vA=uFlow*smoothstep(0.0,0.08,t)*(1.0-smoothstep(0.9,1.0,t));
          vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=uPx*(0.5+seed.y)/-mv.z; }`,
      fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-0.5); float k=1.0-smoothstep(0.0,0.5,d); gl_FragColor=vec4(vec3(0.2,1.0,0.62)*k*k*vA*3.0,1.0); }`,
    }));
    this.parts.frustumCulled = false;
    this.scene.add(this.parts);
    for (let i = 0; i < 2; i++) {
      const s = new THREE.SpotLight('#e8f0ff', 0, 14, 0.42, 0.6, 1.4); s.castShadow = false;
      this.scene.add(s, s.target); this.headSpots.push(s);
    }

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.55, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.layout();
  }

  /** Load the licensed vehicle, or show an honest placeholder envelope until it exists. */
  async load(url: string | null, onProgress?: (p: number) => void) {
    if (url) {
      this.rig = await loadVehicle(url, this.env, onProgress);
      this.scene.add(this.rig.root);
      this.dims.copy(this.rig.size);
      this.port.copy(this.rig.port);
    } else {
      const g = new THREE.BoxGeometry(this.dims.x, this.dims.y * 0.82, this.dims.z);
      const ph = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: '#19d38f', transparent: true, opacity: 0.35 }));
      ph.position.y = this.dims.y * 0.41;
      this.placeholder = ph;
      this.scene.add(ph);
    }
    this.layout();
    this.ready = true;
  }

  private layout() {
    const d = this.dims;
    this.charger.position.set(d.x / 2 + 1.25, 0, this.port.z - 1.2);
    this.ring.position.copy(this.port).add(new THREE.Vector3(0.006, 0, 0));
    const heads = this.rig?.headPos ?? [-1, 1].map((sx) => new THREE.Vector3(sx * d.x * 0.33, d.y * 0.55, d.z / 2 - 0.08));
    this.headSpots.forEach((s, i) => { s.position.copy(heads[i]); s.target.position.set(heads[i].x * 1.4, 0, heads[i].z + 8); });
  }

  /** Camera keys are expressed relative to the normalised vehicle envelope, so any approved GLB frames correctly. */
  private keys(kind: 'intro' | 'story'): Key[] {
    const d = this.dims, L = d.z, W = d.x, P = this.port, p = this.portrait;
    const hero = this.hero();
    const close: V = [P.x + (p ? 1.7 : 1.45), P.y + 0.15, P.z + (p ? 0.85 : 0.65)];
    if (kind === 'intro')
      return [
        { t: 0, pos: [0.35 * W, 0.52, L * 1.55], tgt: [0, 0.6, L * 0.45], fov: p ? 40 : 30 },
        { t: 2, pos: [0.3 * W, 0.5, L * 1.32], tgt: [0, 0.62, L * 0.45], fov: p ? 40 : 30 },
        { t: 3.9, pos: [W * 2.6, 1.1, L * 0.85], tgt: [0.2, 0.7, 0.1], fov: p ? 38 : 30 },
        { t: 4.7, pos: [P.x + 1.8, P.y + 0.25, P.z + 1.1], tgt: [P.x + 0.1, P.y, P.z], fov: p ? 34 : 27 },
        { t: 6, pos: close, tgt: [P.x + 0.15, P.y, P.z], fov: p ? 30 : 24 },
        { t: 7, pos: [P.x + 2.6, P.y + 0.35, P.z + 2.0], tgt: [P.x - 0.2, P.y - 0.05, P.z - 0.2], fov: p ? 32 : 26 },
        { t: 7.8, ...hero }, { t: 8, ...hero },
      ];
    return [
      { t: 0, ...hero },
      { t: 0.33, pos: p ? [0.2, 2.2, L * 2.1] : [W * 3.8, 1.5, 0.2], tgt: [0, 0.6, 0], fov: p ? 40 : 28 },
      { t: 0.66, pos: close, tgt: [P.x + 0.12, P.y, P.z], fov: p ? 32 : 24 },
      { t: 1, pos: [W * 3, 5.5, L * 1.6], tgt: [0.6, 0.2, 0], fov: p ? 42 : 30 },
    ];
  }
  private hero(): { pos: V; tgt: V; fov: number } {
    const d = this.dims;
    return this.portrait
      ? { pos: [d.x * 3.2, 2.2, d.z * 2.35], tgt: [0.5, d.y * 0.36, 0], fov: 46 }
      : { pos: [d.x * 3.3, 1.35, d.z * 1.2], tgt: [-0.15 * d.x, d.y * 0.42, -0.05 * d.z], fov: 28 };
  }

  introShot(t: number): Shot {
    const c = path(this.keys('intro'), t);
    const flash = t > 5.22 ? Math.exp(-(t - 5.22) * 5) * 0.9 : 0;
    return {
      ...c,
      head: t < 0.55 ? 0 : t < 0.63 ? 0.55 : t < 0.72 ? 0.04 : sm(0.72, 1.5, t),
      lights: sm(2.1, 3.1, t), rim: sm(2.9, 3.7, t), plug: sm(4.3, 5.25, t),
      energy: t < 5.2 ? 0 : t < 7.2 ? Math.min(1, sm(5.2, 5.4, t)) + flash : 1 - 0.45 * sm(7.2, 7.9, t),
      flow: t < 7.2 ? sm(5.4, 5.95, t) : 1 - 0.45 * sm(7.2, 7.9, t),
      exposure: 1 - 0.55 * (sm(6.1, 6.6, t) - sm(7.15, 7.85, t)),
    };
  }
  heroShot(el: number, px = 0, py = 0): Shot {
    const h = this.hero(), ramp = sm(0, 2.5, el), a = Math.sin(el * 0.22) * 0.06 * ramp + px * 0.05;
    const cx = h.pos[0] - h.tgt[0], cz = h.pos[2] - h.tgt[2];
    return {
      pos: [h.tgt[0] + cx * Math.cos(a) - cz * Math.sin(a), h.pos[1] + Math.sin(el * 0.31) * 0.04 * ramp - py * 0.06, h.tgt[2] + cx * Math.sin(a) + cz * Math.cos(a)],
      tgt: h.tgt, fov: h.fov, head: 1, lights: 1, rim: 1, plug: 1, energy: 0.55 + Math.sin(el * 1.6) * 0.12 * ramp, flow: 0.55, exposure: 1,
    };
  }
  storyShot(p: number, el: number): Shot {
    const c = path(this.keys('story'), p);
    return { ...this.heroShot(el), ...c, energy: 0.45 + 0.6 * sm(0.4, 0.66, p), flow: 0.4 + 0.6 * sm(0.45, 0.68, p) };
  }

  setSize(w: number, h: number, dpr: number) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
  }

  render(s: Shot, time: number) {
    const L = this.lights, c = this.camera, a = this.renderer.domElement.width / this.renderer.domElement.height;
    // cover-fit framing against the reference aspect (keeps the recorded film and live view aligned)
    const f = 1 / Math.tan(THREE.MathUtils.degToRad(s.fov) / 2);
    const fy = a < this.refAspect ? f * (a / this.refAspect) : f;
    c.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1 / fy));
    c.aspect = a;
    c.position.set(...s.pos); c.lookAt(...s.tgt); c.updateProjectionMatrix();
    L.key.intensity = 7 * s.lights; L.side.intensity = 5 * s.lights; L.rim.intensity = 8 * s.rim;
    L.sun.intensity = 1.6 * s.lights; L.hemi.intensity = 0.08 * s.lights + 0.01;
    this.scene.environmentIntensity = 0.03 + 0.67 * s.lights;
    this.renderer.toneMappingExposure = s.exposure;
    this.headSpots.forEach((sp) => { sp.intensity = 60 * s.head; });
    this.rig?.heads.forEach((m) => { m.emissiveIntensity = 6 * s.head; });
    this.rig?.tails.forEach((m) => { m.emissiveIntensity = 2.5 * s.head; });
    this.strips.emissiveIntensity = (0.6 + 2.4 * s.energy) * s.rim;
    (this.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 * s.rim + s.energy * 6;
    // connector travel + cable
    const holster = new THREE.Vector3().copy(this.charger.position).add(new THREE.Vector3(-0.2, 1.02, 0));
    const seated = this.port.clone().add(new THREE.Vector3(0.05, 0, 0));
    const e = s.plug * s.plug * (3 - 2 * s.plug);
    this.conn.position.lerpVectors(holster, seated, e); this.conn.position.y += Math.sin(Math.PI * e) * 0.22;
    const outlet = this.charger.position.clone().add(new THREE.Vector3(-0.14, 0.6, 0));
    const exit = this.conn.position.clone().add(new THREE.Vector3(0.21, -0.05, 0));
    const b = [outlet, outlet.clone().add(new THREE.Vector3(-0.12, -0.55, 0.05)).setY(Math.max(0.03, outlet.y - 0.55)), exit.clone().add(new THREE.Vector3(0.35, -0.62, -0.1)).setY(Math.max(0.03, exit.y - 0.62)), exit];
    if (!this.cable.userData.key || this.cable.userData.key !== e.toFixed(3)) {
      this.cable.geometry.dispose();
      this.cable.geometry = new THREE.TubeGeometry(new THREE.CubicBezierCurve3(...b), 64, 0.014, 10);
      this.cable.userData.key = e.toFixed(3);
    }
    const pm = this.parts.material as THREE.ShaderMaterial;
    pm.uniforms.uT.value = time; pm.uniforms.uFlow.value = s.flow; pm.uniforms.uPx.value = this.renderer.domElement.height * 0.012;
    b.forEach((v, i) => pm.uniforms.uB.value[i].copy(v));
    if (this.placeholder) (this.placeholder as THREE.LineSegments).material.opacity = 0.12 + 0.3 * Math.max(s.lights, s.head);
    this.composer.render();
  }

  /** Screen position of a world point (for hotspots and the logo-particle origin). */
  project(p: THREE.Vector3 | V, w: number, h: number) {
    const v = (Array.isArray(p) ? new THREE.Vector3(...p) : p.clone()).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * w, y: (0.5 - v.y * 0.5) * h, visible: v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 };
  }
  get portPoint() { return this.port.clone().add(new THREE.Vector3(0.08, 0, 0)); }
  get vehicleEnabled() { return VEHICLE.enabled; }
}
