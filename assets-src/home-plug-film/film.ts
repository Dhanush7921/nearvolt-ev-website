// NEARVOLT EV — "Home Plug" client film. Deterministic: window.__film.seek(t, frame) draws the frame at t seconds.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { loadCar } from '/home/claude/green-plug-ev-website/src/three/car';
import { COLLAR_DEPTH, createConnector, createConnectorMaterials } from '/home/claude/green-plug-ev-website/src/three/connector';
import { ARC_WIDTH, EV, LAYOUT, MARK, WORD } from '/home/claude/green-plug-ev-website/src/brand/brandPaths';

export const DURATION = 18;
const QS = new URLSearchParams(location.search);
const W = +(QS.get('w') || 1920);
const H = +(QS.get('h') || 1080);
const DPR = +(QS.get('dpr') || 1);
const PORTRAIT = H > W;
{
  const st = document.getElementById('stage')!;
  st.style.width = W + 'px';
  st.style.height = H + 'px';
  const gl = document.getElementById('gl')!;
  gl.style.width = W + 'px';
  gl.style.height = H + 'px';
  if (PORTRAIT) document.body.classList.add('portrait');
}
const EMERALD = new THREE.Color('#2fd68f');

// ---------------------------------------------------------------- helpers
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lin = (a: number, b: number, t: number) => clamp((t - a) / (b - a));
const ss = (a: number, b: number, t: number) => {
  const x = lin(a, b, t);
  return x * x * (3 - 2 * x);
};
const eio = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eout = (x: number) => 1 - Math.pow(1 - x, 3);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const vmix = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

function smallestEigen(m: number[]) {
  const a = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++)
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-12) continue;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
      const c = Math.cos(th);
      const s = Math.sin(th);
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  let i = 0;
  for (let k = 1; k < 3; k++) if (a[k][k] < a[i][i]) i = k;
  return new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize();
}

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(base: string, amt: number, n: number) {
  return (g: CanvasRenderingContext2D, s: number) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) {
      const l = rnd() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${l},${l},${l},${rnd() * amt})`;
      const r = rnd() * 2.2 + 0.4;
      g.fillRect(rnd() * s, rnd() * s, r, r);
    }
  };
}

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(DPR);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, W / H, 0.05, 900);

// sky dome: warm late-afternoon gradient with a soft sun
const SUN_DIR = v3(-0.55, 0.42, -0.72).normalize();
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: { uSun: { value: SUN_DIR } },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uSun; varying vec3 vD;
    void main(){ float h = clamp(vD.y, -0.2, 1.0);
      vec3 zen = vec3(0.30,0.52,0.80); vec3 hor = vec3(0.96,0.84,0.70); vec3 low = vec3(0.80,0.78,0.74);
      vec3 c = mix(hor, zen, pow(max(h,0.0), 0.55)); if (h < 0.0) c = mix(hor, low, -h*5.0);
      float sd = max(dot(normalize(vD), uSun), 0.0); c += vec3(1.0,0.82,0.55) * (pow(sd, 400.0)*6.0 + pow(sd, 12.0)*0.35);
      gl_FragColor = vec4(c, 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), skyMat);
scene.add(sky);
scene.fog = new THREE.Fog('#dcd2c4', 70, 420);
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: '#6b6a64' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  envScene.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.75;
}

const sun = new THREE.DirectionalLight('#ffe1b8', 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(DPR > 1 ? 4096 : 2048, DPR > 1 ? 4096 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#cfe2f5', '#8a7a62', 1.0);
scene.add(hemi);
function aimSun(center: THREE.Vector3, half: number) {
  sun.position.copy(center).addScaledVector(SUN_DIR, 120);
  sun.target.position.copy(center);
  const c = sun.shadow.camera;
  c.left = c.bottom = -half;
  c.right = c.top = half;
  c.near = 20;
  c.far = 260;
  c.updateProjectionMatrix();
  sun.shadow.bias = -0.0004 * Math.max(1, half / 20);
  sun.shadow.normalBias = 0.03 * Math.max(1, half / 20);
}

// ---------------------------------------------------------------- materials
const M: Record<string, THREE.Material> = {};
const plaster = (k: string, col: string) => (M[k] = new THREE.MeshStandardMaterial({ color: col, roughness: 0.92, map: canvasTex(256, speckle('#ffffff', 0.05, 2500), 1) }));
plaster('cream', '#efe4cf');
plaster('white', '#f3f1ec');
plaster('terracotta', '#d79a74');
plaster('sage', '#b9c8b2');
plaster('sand', '#e2cba2');
plaster('grey', '#c9c7c2');
plaster('blush', '#e9c6b6');
M.trim = new THREE.MeshStandardMaterial({ color: '#fbfaf6', roughness: 0.6 });
M.charcoal = new THREE.MeshStandardMaterial({ color: '#2b2f30', roughness: 0.55, metalness: 0.3 });
M.glass = new THREE.MeshStandardMaterial({ color: '#28393b', roughness: 0.06, metalness: 0.8, envMapIntensity: 1.4 });
M.wood = new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.6, map: canvasTex(256, (g, s) => {
  g.fillStyle = '#9a6a48';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(60,30,15,${0.08 + rnd() * 0.12})`;
    g.fillRect(0, rnd() * s, s, 1 + rnd() * 3);
  }
}) });
M.stone = new THREE.MeshStandardMaterial({ color: '#b8ab96', roughness: 0.9, map: canvasTex(256, (g, s) => {
  g.fillStyle = '#bdb09a';
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? -20 : 0; x < s; x += 42) {
    g.fillStyle = `hsl(36,${10 + rnd() * 12}%,${58 + rnd() * 14}%)`;
    g.fillRect(x + 1, y + 1, 40, 14);
  }
}) });
M.tank = new THREE.MeshStandardMaterial({ color: '#1d1f1f', roughness: 0.5 });
M.metal = new THREE.MeshStandardMaterial({ color: '#3a3f40', roughness: 0.4, metalness: 0.8 });
M.trunk = new THREE.MeshStandardMaterial({ color: '#6a5442', roughness: 1 });
M.leaf1 = new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 0.9 });
M.leaf2 = new THREE.MeshStandardMaterial({ color: '#3f6a34', roughness: 0.9 });
M.leaf3 = new THREE.MeshStandardMaterial({ color: '#6b8f42', roughness: 0.9 });
M.frond = new THREE.MeshStandardMaterial({ color: '#557f35', roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5, map: canvasTex(256, (g, s) => {
  g.clearRect(0, 0, s, s);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(s / 2, 0);
  g.lineTo(s / 2, s);
  g.stroke();
  for (let y = 6; y < s; y += 7) {
    const len = Math.sin((y / s) * Math.PI) * s * 0.48;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(s / 2, y);
    g.lineTo(s / 2 - len, y + 18);
    g.moveTo(s / 2, y);
    g.lineTo(s / 2 + len, y + 18);
    g.stroke();
  }
}, 1) });
M.asphalt = new THREE.MeshStandardMaterial({ color: '#4a4b4c', roughness: 0.95, map: canvasTex(512, speckle('#5a5b5c', 0.25, 26000), 40) });
M.paver = new THREE.MeshStandardMaterial({ color: '#b9b1a5', roughness: 0.9, map: canvasTex(256, (g, s) => {
  g.fillStyle = '#c4bcb0';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(80,70,60,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= s; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, s);
    g.moveTo(0, i);
    g.lineTo(s, i);
    g.stroke();
  }
}, 60) });
M.curb = new THREE.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.8 });
M.grass = new THREE.MeshStandardMaterial({ color: '#7d9a52', roughness: 1, map: canvasTex(256, speckle('#86a35a', 0.3, 9000), 30) });
M.tile = new THREE.MeshStandardMaterial({ color: '#cfc6b8', roughness: 0.7, map: canvasTex(256, (g, s) => {
  g.fillStyle = '#d6cdbf';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(90,80,70,0.3)';
  g.lineWidth = 2;
  for (let i = 0; i <= s; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, s);
    g.moveTo(0, i);
    g.lineTo(s, i);
    g.stroke();
  }
}, 4) });
M.line = new THREE.MeshStandardMaterial({ color: '#e9e4d6', roughness: 0.7 });
M.lamp = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#fff1d0', emissiveIntensity: 0.6 });
for (const m of Object.values(M)) if ((m as THREE.MeshStandardMaterial).map) (m as THREE.MeshStandardMaterial).map!.needsUpdate = true;

// ---------------------------------------------------------------- geometry batching (merge everything static per material)
const batch: Record<string, THREE.BufferGeometry[]> = {};
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
function put(mat: string, geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) {
  tmpQ.setFromAxisAngle(v3(0, 1, 0), ry);
  tmpM.compose(v3(x, y, z), tmpQ, v3(sx, sy, sz));
  const g = geo.clone().applyMatrix4(tmpM);
  (batch[mat] ||= []).push(g);
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
// a box given by min/max corners in a local frame (lx along facade, lz depth), placed via plot transform
type Plot = { ox: number; oz: number; ry: number };
function boxIn(p: Plot, mat: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const c = Math.cos(p.ry), s = Math.sin(p.ry);
  put(mat, BOX, p.ox + cx * c + cz * s, cy, p.oz - cx * s + cz * c, p.ry, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
}
function cylIn(p: Plot, mat: string, x: number, y: number, z: number, r: number, h: number, seg = 16) {
  const c = Math.cos(p.ry), s = Math.sin(p.ry);
  put(mat, new THREE.CylinderGeometry(r, r, h, seg), p.ox + x * c + z * s, y + h / 2, p.oz - x * s + z * c, p.ry);
}

// house in local plot frame: facade faces local -z (towards the street), width along x in [0, w], depth z in [0, d]
type HouseOpt = { w: number; d: number; floors: number; col: string; accent: 'wood' | 'stone' | 'charcoal'; tank: boolean; carport: boolean; gateGap: [number, number]; setback?: number };
function house(p: Plot, o: HouseOpt) {
  const fh = 3.1;
  const setback = o.setback ?? 5.5; // front yard / car porch depth
  const x0 = 0.6, x1 = o.w - 0.6;
  // compound wall with gate opening
  const wallH = 1.2;
  boxIn(p, o.col, 0, 0, 0, o.gateGap[0], wallH, 0.2);
  boxIn(p, o.col, o.gateGap[1], 0, 0, o.w, wallH, 0.2);
  boxIn(p, 'trim', 0, wallH, -0.02, o.gateGap[0], wallH + 0.06, 0.22);
  boxIn(p, 'trim', o.gateGap[1], wallH, -0.02, o.w, wallH + 0.06, 0.22);
  boxIn(p, o.col, 0, 0, 0, 0.2, wallH, setback);
  boxIn(p, o.col, o.w - 0.2, 0, 0, o.w, wallH, setback);
  // gate pillars + open gate leaves folded against the wall
  boxIn(p, 'charcoal', o.gateGap[0] - 0.35, 0, -0.05, o.gateGap[0], 1.6, 0.3);
  boxIn(p, 'charcoal', o.gateGap[1], 0, -0.05, o.gateGap[1] + 0.35, 1.6, 0.3);
  for (let i = 0; i < 9; i++) boxIn(p, 'metal', o.gateGap[0] + 0.02, 0.1, 0.35 + i * 0.16, o.gateGap[0] + 0.06, 1.45, 0.38 + i * 0.16);
  // ground floor yard paving
  boxIn(p, 'tile', 0.2, 0, 0.2, o.w - 0.2, 0.06, setback);
  // floors
  for (let f = 0; f < o.floors; f++) {
    const y0 = f * fh, y1 = y0 + fh;
    const front = f === 0 && o.carport ? setback + 0.2 : setback - (f > 0 ? 1.4 : 0);
    const fx1 = f === o.floors - 1 && o.floors > 2 ? x0 + (x1 - x0) * 0.6 : x1;
    boxIn(p, o.col, x0, y0, front, fx1, y1, o.d);
    // slab with overhang
    boxIn(p, 'trim', x0 - 0.25, y1 - 0.22, front - 0.45, fx1 + 0.25, y1, o.d + 0.2);
    // windows on facade
    const n = Math.max(1, Math.floor((fx1 - x0) / 3.2));
    for (let i = 0; i < n; i++) {
      const wx = x0 + ((i + 0.5) * (fx1 - x0)) / n;
      const ww = f === 0 ? 1.5 : 1.7;
      boxIn(p, 'glass', wx - ww / 2, y0 + 0.9, front - 0.04, wx + ww / 2, y0 + 2.35, front + 0.02);
      boxIn(p, 'charcoal', wx - ww / 2 - 0.06, y0 + 0.84, front - 0.08, wx + ww / 2 + 0.06, y0 + 0.9, front + 0.02);
      boxIn(p, 'charcoal', wx - 0.03, y0 + 0.9, front - 0.07, wx + 0.03, y0 + 2.35, front - 0.03);
    }
    // accent cladding column
    boxIn(p, o.accent, fx1 - 1.1, y0, front - 0.06, fx1 - 0.2, y1 - 0.22, front + 0.02);
    // balcony on upper floors
    if (f > 0) {
      boxIn(p, 'trim', x0 + 0.4, y0 - 0.02, front - 1.3, x0 + 4.2, y0 + 0.16, front);
      boxIn(p, 'glass', x0 + 0.45, y0 + 0.16, front - 1.28, x0 + 4.15, y0 + 1.1, front - 1.22);
      boxIn(p, 'charcoal', x0 + 0.42, y0 + 1.06, front - 1.32, x0 + 4.18, y0 + 1.12, front - 1.2);
    }
    if (f === 0) {
      // main door
      const dx = o.carport ? x1 - 2.2 : x0 + (x1 - x0) / 2;
      boxIn(p, 'wood', dx - 0.6, 0.06, front - 0.05, dx + 0.6, 2.3, front + 0.02);
    }
  }
  // car porch pillars under the first floor
  if (o.carport) {
    boxIn(p, 'trim', x0, 0, setback - 1.4, x0 + 0.35, fh, setback - 1.05);
    boxIn(p, 'trim', x1 - 4.6, 0, setback - 1.4, x1 - 4.25, fh, setback - 1.05);
  }
  // terrace parapet
  const top = o.floors * fh;
  const fxTop = o.floors > 2 ? x0 + (x1 - x0) * 0.6 : x1;
  boxIn(p, o.col, x0 - 0.25, top - (o.floors > 2 ? fh : 0), setback - 1.85, x1 + 0.25, top - (o.floors > 2 ? fh : 0) + 0.9, setback - 1.65);
  boxIn(p, o.col, x0, top, o.d - 0.2, fxTop, top + 0.9, o.d);
  if (o.tank) cylIn(p, 'tank', x0 + 1.4, top, o.d - 1.6, 0.62, 1.15, 18);
}

// trees
const ICO = new THREE.IcosahedronGeometry(1, 2);
function blob(r: number, seedN: number) {
  let g = ICO.clone();
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pa = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const n = 1 + 0.18 * Math.sin(x * 4.1 + seedN) * Math.cos(y * 3.7 + seedN * 1.3) + 0.12 * Math.sin(z * 5.3 + seedN * 2.1);
    pa.setXYZ(i, x * r * n, y * r * n * 0.82, z * r * n);
  }
  g.computeVertexNormals();
  return g;
}
function tree(x: number, z: number, s = 1) {
  const h = (3.2 + rnd() * 1.6) * s;
  put('trunk', new THREE.CylinderGeometry(0.12 * s, 0.2 * s, h, 8), x, h / 2, z);
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 1.4 * s;
    put(pick(['leaf1', 'leaf2', 'leaf3']), blob((1.1 + rnd() * 0.8) * s, rnd() * 10), x + Math.cos(a) * r, h + (rnd() - 0.2) * 1.5 * s, z + Math.sin(a) * r);
  }
}
function palm(x: number, z: number) {
  const h = 6 + rnd() * 3;
  const bend = v3((rnd() - 0.5) * 1.2, 0, (rnd() - 0.5) * 1.2);
  const curve = new THREE.QuadraticBezierCurve3(v3(x, 0, z), v3(x + bend.x * 0.3, h * 0.55, z + bend.z * 0.3), v3(x + bend.x, h, z + bend.z));
  (batch.trunk ||= []).push(new THREE.TubeGeometry(curve, 10, 0.17, 7, false));
  const top = curve.getPoint(1);
  const fr = new THREE.PlaneGeometry(1.1, 3.6, 1, 6);
  fr.translate(0, 1.8, 0);
  const pa = fr.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i);
    pa.setZ(i, -0.09 * y * y);
  }
  fr.computeVertexNormals();
  for (let i = 0; i < 11; i++) {
    const g = fr.clone();
    g.rotateX(-1.05 - rnd() * 0.4);
    g.rotateY((i / 11) * Math.PI * 2 + rnd() * 0.3);
    g.translate(top.x, top.y, top.z);
    (batch.frond ||= []).push(g);
  }
}

// ---------------------------------------------------------------- neighbourhood layout
// main street along Z at x=0 (7 m road, 1.6 m footpaths); two parallel streets at x=±62; cross streets at z=±75
const STREETS_X = [-62, 0, 62];
const CROSS_Z = [-75, 75];
const ROAD_HALF = 3.5;
const FOOT = 1.8;
const HERO_Z = 18; // the destination home, on the +x side of the main street
const HERO_W = 14;
const heroPlot: Plot = { ox: ROAD_HALF + FOOT, oz: HERO_Z + HERO_W / 2, ry: Math.PI / 2 };
const chargerHomes: THREE.Vector3[] = [];
function buildTown() {
  // ground and roads
  put('grass', new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), 0, -0.02, 0);
  for (const sx of STREETS_X) {
    put('asphalt', new THREE.PlaneGeometry(ROAD_HALF * 2, 360).rotateX(-Math.PI / 2), sx, 0.0, 0);
    for (const side of [-1, 1]) {
      put('paver', new THREE.BoxGeometry(FOOT, 0.15, 360), sx + side * (ROAD_HALF + FOOT / 2), 0.075, 0);
      put('curb', new THREE.BoxGeometry(0.18, 0.18, 360), sx + side * (ROAD_HALF + 0.09), 0.09, 0);
    }
    for (let z = -170; z < 170; z += 6) put('line', new THREE.PlaneGeometry(0.12, 2.6).rotateX(-Math.PI / 2), sx, 0.01, z);
  }
  for (const cz of CROSS_Z) put('asphalt', new THREE.PlaneGeometry(360, ROAD_HALF * 2).rotateX(-Math.PI / 2), 0, 0.005, cz);
  // plots on both sides of every street
  const cols = ['cream', 'white', 'terracotta', 'sage', 'sand', 'grey', 'blush'];
  for (const sx of STREETS_X)
    for (const side of [-1, 1]) {
      let z = -165;
      while (z < 165) {
        const w = 11 + Math.floor(rnd() * 4);
        const nearCross = CROSS_Z.some((cz) => Math.abs(z + w / 2 - cz) < w / 2 + ROAD_HALF + 1);
        const isHero = sx === 0 && side === 1 && Math.abs(z + w / 2 - HERO_Z) < 9;
        if (isHero) {
          z = HERO_Z + HERO_W / 2 + 0.5;
          continue;
        }
        if (!nearCross) {
          // facade faces the street: plot frame local -z points towards the street
          const p: Plot = side === 1 ? { ox: sx + ROAD_HALF + FOOT, oz: z + w, ry: Math.PI / 2 } : { ox: sx - ROAD_HALF - FOOT, oz: z, ry: -Math.PI / 2 };
          const g0 = 1 + rnd() * 2;
          house(p, { w, d: 15 + rnd() * 3, floors: 2 + (rnd() < 0.4 ? 1 : 0), col: pick(cols), accent: pick(['wood', 'stone', 'charcoal']), tank: rnd() < 0.7, carport: rnd() < 0.5, gateGap: [w - g0 - 3.6, w - g0] });
          if (rnd() < 0.55) tree(sx + side * (ROAD_HALF + 0.9), z + w * 0.5, 0.9 + rnd() * 0.3);
          if (rnd() < 0.25) palm(sx + side * (ROAD_HALF + FOOT + 2.2), z + 2 + rnd() * (w - 4));
          if (sx !== 0 || Math.abs(z - HERO_Z) > 20) if (rnd() < 0.16) chargerHomes.push(v3(sx + side * (ROAD_HALF + FOOT + 9), 0, z + w / 2));
        }
        z += w + 0.4;
      }
    }
  // destination home: modern, two floors + terrace room, car porch with wall charger
  house(heroPlot, { w: HERO_W, d: 19, floors: 3, col: 'white', accent: 'wood', tank: true, carport: true, gateGap: [1.2, 6.2], setback: 7.5 });
  palm(ROAD_HALF + FOOT + 1.2, HERO_Z - HERO_W / 2 + 0.8);
  tree(ROAD_HALF + 0.9, HERO_Z + 9, 1.05);
  // street lights
  for (const sx of STREETS_X)
    for (let z = -160; z < 160; z += 26) {
      const x = sx - ROAD_HALF - 0.4;
      put('metal', new THREE.CylinderGeometry(0.06, 0.09, 7, 8), x, 3.5, z);
      put('metal', new THREE.BoxGeometry(1.4, 0.08, 0.12), x + 0.7, 7, z);
      put('lamp', new THREE.BoxGeometry(0.5, 0.1, 0.22), x + 1.35, 6.93, z);
    }
  // bake
  for (const [k, geos] of Object.entries(batch)) {
    const groups: THREE.BufferGeometry[][] = [[], []];
    for (const g of geos) groups[g.index ? 0 : 1].push(g);
    for (const gs of groups) {
      if (!gs.length) continue;
      gs.forEach((g) => {
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      });
      const merged = mergeGeometries(gs, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, M[k]);
      mesh.castShadow = !['asphalt', 'grass', 'line', 'paver', 'tile'].includes(k);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}

// ---------------------------------------------------------------- wall charger (7.4 kW AC wallbox, Type 2 tethered) in the car porch
const cm = createConnectorMaterials();
const wallbox = new THREE.Group();
const wbShell = new THREE.MeshPhysicalMaterial({ color: '#f4f6f4', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
const wbFace = new THREE.MeshStandardMaterial({ color: '#13201d', roughness: 0.35 });
const wbLed = new THREE.MeshStandardMaterial({ color: '#0b2b26', emissive: EMERALD, emissiveIntensity: 0.4 });
{
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.46, 0.13, 4, 0.05), wbShell);
  body.castShadow = true;
  wallbox.add(body);
  const face = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.3, 0.02, 3, 0.03), wbFace);
  face.position.set(0, 0.04, 0.066);
  wallbox.add(face);
  const led = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.014, 0.01, 2, 0.006), wbLed);
  led.position.set(0, -0.14, 0.072);
  led.name = 'led';
  wallbox.add(led);
  // conduit up into the slab, and the holster cup beside the unit
  const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.7, 10), new THREE.MeshStandardMaterial({ color: '#e8e6e0', roughness: 0.6 }));
  conduit.position.set(0.09, 1.08, -0.02);
  wallbox.add(conduit);
  const holster = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.14, 0.1, 3, 0.03), wbShell);
  holster.position.set(-0.32, -0.12, 0.03);
  wallbox.add(holster);
}
async function wallboxBadge() {
  const img = new Image();
  img.src = '/brand/mark.svg';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#13201d';
  g.fillRect(0, 0, 256, 256);
  g.drawImage(img, 68, 44, 120, 120);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  wbFace.map = t;
  wbFace.needsUpdate = true;
}
const connector = createConnector(cm);
scene.add(wallbox, connector.group);
const cableMat = new THREE.MeshStandardMaterial({ color: '#141716', roughness: 0.55 });
const cable = new THREE.Mesh(new THREE.BufferGeometry(), cableMat);
cable.castShadow = true;
scene.add(cable);

// ---------------------------------------------------------------- markers for the network reveal
const markers: { g: THREE.Group; ring: THREE.Mesh; ring2: THREE.Mesh; at: number }[] = [];
function buildMarkers() {
  const pinMat = new THREE.MeshStandardMaterial({ color: '#1fbf7a', emissive: EMERALD, emissiveIntensity: 1.6, roughness: 0.35, fog: false });
  const ringMat = () => new THREE.MeshBasicMaterial({ color: EMERALD.clone().multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const homes = [v3(ROAD_HALF + FOOT + 9, 0, HERO_Z + 2), ...chargerHomes.slice(0, 13)];
  homes.forEach((p, i) => {
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16), pinMat);
    head.position.y = 15;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.25, 3.2, 24), pinMat);
    tip.rotation.x = Math.PI;
    tip.position.y = 12.4;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    dot.position.set(0, 15, 1.48);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 11, 6), new THREE.MeshBasicMaterial({ color: EMERALD, transparent: true, opacity: 0.55 }));
    stem.position.y = 5.5;
    g.add(head, tip, stem);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.7, 48), ringMat());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    const ring2 = ring.clone();
    ring2.material = ringMat();
    g.add(ring, ring2);
    g.position.copy(p);
    g.visible = false;
    scene.add(g);
    markers.push({ g, ring, ring2, at: i === 0 ? 0 : 0.12 + (i / homes.length) * 1.1 });
  });
}

// ---------------------------------------------------------------- the car
type Rig = Awaited<ReturnType<typeof loadCar>>;
let car: Rig;
const carRoot = new THREE.Group();
scene.add(carRoot);
const spinners: { pivot: THREE.Group; axis: THREE.Vector3 }[] = [];
let wheelR = 0.38;
let S = 1;
let lampMats: THREE.MeshStandardMaterial[] = [];
let brakeMats: THREE.MeshStandardMaterial[] = [];
async function initCar() {
  car = await loadCar('/models/ev-concept.glb', cm);
  const g = car.group;
  carRoot.add(g);
  g.updateMatrixWorld(true);
  const lamps: THREE.Vector3[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.material as THREE.MeshStandardMaterial | undefined;
    if (!m.isMesh || !mat) return;
    if (/Headlight/.test(mat.name)) {
      lamps.push(new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()));
      if (!lampMats.includes(mat)) lampMats.push(mat);
    }
    if (/Brakelight/.test(mat.name) && !brakeMats.includes(mat)) brakeMats.push(mat);
  });
  let b = new THREE.Box3().setFromObject(g);
  const c0 = b.getCenter(new THREE.Vector3());
  const la = lamps.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(Math.max(1, lamps.length));
  g.rotation.y = -Math.atan2(la.x - c0.x, la.z - c0.z);
  g.updateMatrixWorld(true);
  b = new THREE.Box3().setFromObject(g);
  const c1 = b.getCenter(new THREE.Vector3());
  g.position.x -= c1.x;
  g.position.z -= c1.z;
  g.updateMatrixWorld(true);
  S = car.port.getWorldPosition(new THREE.Vector3()).x >= 0 ? 1 : -1;
  // wheels pivot at the car origin in the model: give each a pivot at its tyre centre about the measured axle
  for (const w of car.wheels) {
    const p = w.parent!;
    const pts: THREE.Vector3[] = [];
    w.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !/Tire/.test((m.material as THREE.Material).name)) return;
      const pa = m.geometry.getAttribute('position');
      for (let i = 0; i < pa.count; i += 3) pts.push(new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld));
    });
    if (pts.length < 30) continue;
    const hub = pts.reduce((a, q) => a.add(q), new THREE.Vector3()).divideScalar(pts.length);
    let minY = Infinity;
    const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const q of pts) {
      minY = Math.min(minY, q.y);
      const d = [q.x - hub.x, q.y - hub.y, q.z - hub.z];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k] += d[r] * d[k];
    }
    wheelR = hub.y - minY;
    const axle = smallestEigen(C);
    if (axle.x < 0) axle.negate();
    const pivot = new THREE.Group();
    pivot.position.copy(p.worldToLocal(hub.clone()));
    p.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(w);
    w.children.filter((ch) => /BrakePad/.test(ch.name)).forEach((ch) => p.attach(ch));
    spinners.push({ pivot, axis: axle.applyQuaternion(p.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize() });
  }
  car.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  car.paint.color.set('#eef4f0');
  car.paint.normalScale.set(0.1, 0.1);
}

// car pose: position on the ground, heading yaw (0 = +Z), distance travelled (for wheel spin)
function placeCar(x: number, z: number, yaw: number, dist: number) {
  carRoot.position.set(x, 0, z);
  carRoot.rotation.y = yaw;
  for (const s of spinners) s.pivot.quaternion.setFromAxisAngle(s.axis, dist / wheelR);
  carRoot.updateMatrixWorld(true);
}

// porch layout: car parks facing +X (into the plot); its port side faces world -Z*S
const PARK = v3(ROAD_HALF + FOOT + 3.9, 0, HERO_Z + HERO_W / 2 - 3.7);
function setupWallbox() {
  placeCar(PARK.x, PARK.z, Math.PI / 2, 0);
  const portW = car.port.getWorldPosition(new THREE.Vector3());
  // mount on the porch side wall: 1.9 m to the port side of the car, 1.25 m high, slightly ahead of the inlet
  const side = portW.z < PARK.z ? -1 : 1;
  wallbox.position.set(portW.x + 0.6, 1.25, PARK.z + side * 2.05);
  wallbox.rotation.y = side < 0 ? 0 : Math.PI;
  // wall behind it (porch side wall)
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.1, 0.25), M.white);
  wall.position.set(portW.x + 0.4, 1.55, PARK.z + side * 2.22);
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);
  return side;
}
let wallSide = -1;

// cable from the wallbox outlet (bottom) to the connector boot, sagging under gravity
const tmpA = new THREE.Vector3();
function updateCable() {
  const start = wallbox.localToWorld(v3(0, -0.24, 0.02));
  connector.group.updateMatrixWorld(true);
  const end = connector.cableExit.clone().applyMatrix4(connector.group.matrixWorld);
  const dir = connector.cableDir.clone().transformDirection(connector.group.matrixWorld);
  const span = start.distanceTo(end);
  const sag = Math.max(0.35, 1.6 - span) * 0.8;
  const mid = start.clone().lerp(end, 0.5);
  mid.y = Math.max(0.05, Math.min(start.y, end.y) - sag);
  const c = new THREE.CatmullRomCurve3([start, start.clone().add(v3(0, -0.25, 0)), mid, end.clone().addScaledVector(dir, 0.25), end], false, 'centripetal');
  cable.geometry.dispose();
  cable.geometry = new THREE.TubeGeometry(c, 60, 0.014, 8, false);
}

// ---------------------------------------------------------------- overlay DOM
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const capWrap = $('#cap');
const capLine = $('#capline');
const capText = $('#captext');
function caption(text: string, t: number, a: number, b: number) {
  if (t < a - 0.01 || t > b + 0.01) return false;
  if (capText.dataset.text !== text) {
    capText.dataset.text = text;
    capText.innerHTML = text
      .split('\n')
      .map((line) => `<span class="ln">${line.split(' ').map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ')}</span>`)
      .join('');
  }
  const out = ss(b - 0.35, b, t);
  capText.querySelectorAll<HTMLElement>('.wi').forEach((el, i) => {
    const k = eout(lin(a + i * 0.07, a + i * 0.07 + 0.55, t));
    el.style.transform = `translateY(${(1 - k) * 110 - out * 40}%)`;
    el.style.opacity = String(k * (1 - out));
  });
  capLine.style.transform = `scaleX(${eout(lin(a - 0.1, a + 0.5, t)) * (1 - out)})`;
  capWrap.style.visibility = 'visible';
  return true;
}
const battery = $('#battery');
const batPct = $('#batpct');
const mapEl = $('#map');
const phone = $('#phone');
const charge = $('#charge');
const chargePct = $('#chargepct');
const chargeBar = $('#chargebar');
const logo = $('#logo');
const hero = $('#hero');
const fade = $('#fade');
const vig = $('#vig');

// map: SVG generated from the same street layout as the 3D town
function buildMap() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '-110 -95 220 190');
  svg.setAttribute('preserveAspectRatio', PORTRAIT ? 'xMidYMid slice' : 'xMidYMid meet');
  let html = `<rect x="-200" y="-200" width="400" height="400" fill="#101a18"/>`;
  // blocks / buildings
  for (const sx of STREETS_X)
    for (const side of [-1, 1])
      for (let z = -90; z < 90; z += 7) {
        if (CROSS_Z.some((cz) => Math.abs(z - cz) < 7)) continue;
        const x = sx + side * (ROAD_HALF + FOOT + 2) + (side < 0 ? -14 : 0);
        html += `<rect x="${x}" y="${-z - 6}" width="14" height="6" rx="0.8" fill="#1a2a27"/>`;
      }
  for (const sx of STREETS_X) html += `<line x1="${sx}" y1="-200" x2="${sx}" y2="200" stroke="#2b3d39" stroke-width="7"/>`;
  for (const cz of CROSS_Z) html += `<line x1="-200" y1="${-cz}" x2="200" y2="${-cz}" stroke="#2b3d39" stroke-width="7"/>`;
  for (const sx of STREETS_X) html += `<line x1="${sx}" y1="-200" x2="${sx}" y2="200" stroke="#3b504b" stroke-width="0.4" stroke-dasharray="2 3"/>`;
  // route from the car to the destination home
  html += `<path id="route" d="M 1.75 40 L 1.75 ${-HERO_Z} L 14 ${-HERO_Z}" fill="none" stroke="#2fd68f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  // pins
  const pins = [v3(14, 0, HERO_Z), ...chargerHomes.slice(0, 9).filter((p) => Math.abs(p.x) < 100 && Math.abs(p.z) < 85)];
  pins.forEach((p, i) => {
    html += `<g class="pin" data-i="${i}" transform="translate(${p.x} ${-p.z})"><circle class="pr" r="3" fill="none" stroke="#2fd68f" stroke-width="0.6"/><path d="M0 0 C-3.2 -4 -3.4 -6.2 -3.4 -7.6 A3.4 3.4 0 0 1 3.4 -7.6 C3.4 -6.2 3.2 -4 0 0Z" fill="${i ? '#1fbf7a' : '#2fd68f'}"/><circle cx="0" cy="-7.6" r="1.3" fill="#fff"/></g>`;
  });
  // the car
  html += `<g id="mcar" transform="translate(1.75 40)"><circle r="4.2" fill="#2fd68f" opacity="0.18"/><path d="M0 -3 L2.4 2.6 L0 1.4 L-2.4 2.6Z" fill="#ffffff"/></g>`;
  svg.innerHTML = html;
  $('#mapsvg').appendChild(svg);
}

async function buildLogo() {
  const txt = await (await fetch('/brand/logo-on-dark.svg')).text();
  $('#logomark').innerHTML = txt;
  const svg = $('#logomark').querySelector('svg')!;
  svg.removeAttribute('role');
  const paths = svg.querySelectorAll(':scope > path');
  paths[0].id = 'lg-pin';
  paths[1].id = 'lg-n';
  paths[1].setAttribute('pathLength', '1');
  paths[1].setAttribute('stroke-dasharray', '1');
  const word = svg.querySelector(':scope > g')!;
  const ns = 'http://www.w3.org/2000/svg';
  const defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(ns, 'defs'), svg.firstChild);
  defs.insertAdjacentHTML('beforeend', '<clipPath id="lgclip"><rect id="lgrect" x="-8" y="-50" width="0" height="72"/></clipPath>');
  word.setAttribute('clip-path', 'url(#lgclip)');
  (paths[0] as SVGElement).style.transformOrigin = '32px 61px';
}
function buildLogoUnused() {
  const svg = `<svg viewBox="0 0 ${LAYOUT.total} 64">
    <path id="lg-arc" d="${MARK.arc}" fill="none" stroke="#2fd68f" stroke-width="${ARC_WIDTH}" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>
    <path id="lg-plug" d="${MARK.plug}" fill="#ffffff"/><path id="lg-prongs" d="${MARK.prongs}" fill="#ffffff"/><path id="lg-spark" d="${MARK.spark}" fill="#2fd68f"/>
    <defs><clipPath id="lgclip"><rect id="lgrect" x="${LAYOUT.wordX - 4}" y="0" width="0" height="64"/></clipPath></defs>
    <g clip-path="url(#lgclip)"><g transform="translate(${LAYOUT.wordX} ${LAYOUT.baseline})" fill="#ffffff">${WORD.map((g) => `<path d="${g.d}"/>`).join('')}</g>
    <rect x="${LAYOUT.pill.x}" y="${LAYOUT.pill.y}" width="${LAYOUT.pill.w}" height="${LAYOUT.pill.h}" rx="${LAYOUT.pill.h / 2}" fill="#2fd68f"/>
    <g transform="translate(${LAYOUT.evX} ${LAYOUT.evBaseline})" fill="#051F20">${EV.map((g) => `<path d="${g.d}"/>`).join('')}</g></g></svg>`;
  $('#logomark').innerHTML = svg;
}

// ---------------------------------------------------------------- init
async function init() {
  buildTown();
  await initCar();
  wallSide = setupWallbox();
  buildMarkers();
  buildMap();
  await buildLogo();
  await wallboxBadge();
  // the host's home, photographed from the street, for the app listing
  placeCar(-30, -60, 0, 0);
  look(v3(-2.6, 1.7, PARK.z - 4.5), v3(PARK.x + 3, 3.4, PARK.z + 0.5), 46);
  aimSun(v3(PARK.x, 0, PARK.z), 25);
  wbLed.emissiveIntensity = 0.9;
  renderer.render(scene, camera);
  $('#photo').style.backgroundImage = `url(${canvas.toDataURL('image/jpeg', 0.85)})`;
  await document.fonts.ready;
  return { S, wheelR, spinners: spinners.length, chargerHomes: chargerHomes.length, wallSide };
}

// ---------------------------------------------------------------- seek
function look(pos: THREE.Vector3, tgt: THREE.Vector3, fov: number) {
  if (PORTRAIT) fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 1.8) * 180) / Math.PI;
  camera.position.copy(pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(tgt);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

let lastRendered = -1;
function seek(t: number) {
  // reset overlays
  capWrap.style.visibility = 'hidden';
  battery.style.opacity = '0';
  mapEl.style.opacity = '0';
  phone.style.opacity = '0';
  charge.style.opacity = '0';
  logo.style.opacity = '0';
  hero.style.opacity = '0';
  fade.style.opacity = '0';
  canvas.style.filter = '';
  canvas.style.transform = '';
  let draw3d = true;
  markers.forEach((m) => (m.g.visible = false));
  for (const m of lampMats) {
    m.emissive.set('#e8fff4');
    m.emissiveIntensity = 1.2;
  }
  wbLed.emissiveIntensity = 0.4;
  car.inlet.led.material.emissive.set('#ffffff');
  car.inlet.led.material.emissiveIntensity = 0;
  car.inlet.door.rotation.y = 0;
  connector.group.visible = true;

  // connector rests in the holster unless the plug-in shot moves it
  const holsterPos = wallbox.localToWorld(v3(-0.32, -0.05, 0.12));
  connector.group.position.copy(holsterPos);
  connector.group.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, wallbox.rotation.y, 0, 'YXZ'));

  if (t < 3.0) {
    // ---- 01 driving through the neighbourhood, low battery
    const v = 7.5;
    const z = -42 + t * v;
    placeCar(1.75 + 0.0, z, 0, t * v);
    const k = t / 3;
    const cam = v3(-2.9 + k * 0.5, 1.35, z + mix(8.5, 4.6, eio(k)));
    look(cam, v3(2.4, 1.1, z + mix(0.2, -1.2, k)), mix(36, 32, k));
    aimSun(v3(0, 0, z), 40);
    battery.style.opacity = String(ss(0.5, 0.85, t) * (1 - ss(2.75, 3.0, t)));
    batPct.textContent = '8%';
    battery.classList.toggle('blink', Math.floor(t * 2.2) % 2 === 0 && t > 1);
    caption('Low on charge?', t, 0.7, 3.0);
    fade.style.background = '#000';
    fade.style.opacity = String(1 - ss(0, 0.4, t));
  } else if (t < 9.0) {
    // ---- 02/03 app: the map, then the reservation (3D street behind, blurred)
    draw3d = lastRendered < 0 || Math.floor(t * 30) % 3 === 0; // the blurred plate barely changes
    const z = -42 + 3 * 7.5 + (t - 3) * 2.2;
    placeCar(1.75, z, 0, 22.5 + (t - 3) * 2.2);
    look(v3(-4.2, 1.6, z + 6), v3(3, 1.6, z - 4), 40);
    aimSun(v3(0, 0, z), 40);
    canvas.style.filter = 'blur(22px) brightness(0.45) saturate(0.9)';
    canvas.style.transform = 'scale(1.08)';
    if (t < 6.0) {
      const lt = t - 3;
      mapEl.style.opacity = String(ss(0, 0.35, lt) * (1 - ss(2.75, 3.0, lt)));
      const zoom = mix(1.18, 1.0, eout(lin(0, 2.2, lt)));
      $('#mapsvg').style.transform = `perspective(1600px) rotateX(${mix(38, 28, eout(lin(0, 2.6, lt)))}deg) scale(${zoom * 1.25}) translateY(${mix(4, 0, eout(lin(0, 2.2, lt)))}%)`;
      document.querySelectorAll<SVGGElement>('.pin').forEach((p) => {
        const i = +(p.dataset.i || 0);
        const k = eout(lin(0.45 + i * 0.12, 0.8 + i * 0.12, lt));
        p.style.opacity = String(k);
        const ring = p.querySelector<SVGCircleElement>('.pr')!;
        const ph = ((lt * 0.9 + i * 0.23) % 1);
        ring.setAttribute('r', String(3 + ph * 6));
        ring.style.opacity = String((1 - ph) * k);
        (p as unknown as HTMLElement).style.transformBox = 'fill-box';
      });
      const route = document.getElementById('route') as unknown as SVGPathElement;
      const L = route.getTotalLength();
      route.style.strokeDasharray = `${L}`;
      route.style.strokeDashoffset = String(L * (1 - eio(lin(1.4, 2.6, lt))));
      $('#sheet').style.transform = `translateY(${(1 - eout(lin(0.9, 1.5, lt))) * 120}%)`;
      document.querySelectorAll<HTMLElement>('.row').forEach((r, i) => {
        const k = eout(lin(1.25 + i * 0.12, 1.7 + i * 0.12, lt));
        r.style.opacity = String(k);
        r.style.transform = `translateY(${(1 - k) * 14}px)`;
      });
      caption('Find charging nearby.', t, 3.35, 6.0);
    } else {
      const lt = t - 6;
      phone.style.opacity = String(ss(0, 0.3, lt) * (1 - ss(2.8, 3.0, lt)));
      phone.style.transform = `translate(-50%, -50%) translateY(${(1 - eout(lin(0, 0.6, lt))) * 60}px) rotateY(${mix(-14, -6, eout(lin(0, 2.5, lt)))}deg) rotateX(4deg)`;
      const sel = lt > 1.05;
      document.querySelectorAll<HTMLElement>('.slot').forEach((s, i) => s.classList.toggle('on', sel && i === 1));
      const tap = $('#tap');
      const tapAt = (a: number, x: string, y: string) => {
        const k = lin(a, a + 0.45, lt);
        if (k > 0 && k < 1) {
          tap.style.left = x;
          tap.style.top = y;
          tap.style.opacity = String(1 - k);
          tap.style.transform = `translate(-50%,-50%) scale(${0.4 + k * 1.4})`;
          return true;
        }
        return false;
      };
      tap.style.opacity = '0';
      tapAt(0.85, '52%', '63.5%') || tapAt(1.65, '50%', '82%');
      const confirmed = lt > 1.95;
      $('#confirm').style.opacity = String(ss(1.95, 2.25, lt));
      $('#confirm').style.transform = `scale(${mix(0.9, 1, eout(lin(1.95, 2.3, lt)))})`;
      $('#cta').classList.toggle('press', lt > 1.65 && lt < 1.95);
      $('#cta').textContent = confirmed ? 'Reserved' : 'Reserve 7:00 PM slot';
      caption('Reserve your slot.', t, 6.3, 9.0);
    }
  } else if (t < 13.0) {
    // ---- 04 arrival in the driveway and plug-in
    wbLed.emissiveIntensity = 0.9;
    if (t < 10.8) {
      const lt = t - 9;
      const k = eout(lin(0, 1.7, lt)); // decelerate to a stop
      const travel = 9.5;
      const x = PARK.x - travel * (1 - k);
      placeCar(x, PARK.z, Math.PI / 2, travel * k);
      const cam = vmix(v3(-3.2, 2.5, PARK.z - 5.6), v3(-2.2, 2.2, PARK.z - 4.6), eio(lin(0, 2, lt)));
      look(cam, v3(Math.max(x, 1) + 1.8, 1.0, PARK.z + 0.3), 40);
      aimSun(v3(PARK.x, 0, PARK.z), 22);
      for (const m of brakeMats) m.emissiveIntensity = lt > 0.6 && lt < 1.8 ? 3 : 0.6;
    } else {
      const lt = t - 10.8;
      placeCar(PARK.x, PARK.z, Math.PI / 2, 9.5);
      car.inlet.door.rotation.y = 1.95;
      // connector: comes in from off-frame (the driver's hand), aligns, inserts and latches
      const port = car.port;
      port.updateMatrixWorld(true);
      const pq = port.getWorldQuaternion(new THREE.Quaternion());
      const pn = v3(0, 0, 1).applyQuaternion(pq);
      const seatQ = pq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), Math.PI));
      const seatP = port.localToWorld(v3(0, 0, COLLAR_DEPTH - 0.012 + 0.003));
      const preP = seatP.clone().addScaledVector(pn, 0.22);
      const farP = preP.clone().addScaledVector(pn, 0.2).add(v3(0.42, -0.55, 0));
      const a = eio(lin(0.0, 0.75, lt));
      const ins = Math.pow(lin(0.78, 1.05, lt), 2);
      if (ins > 0) connector.group.position.lerpVectors(preP, seatP, ins);
      else connector.group.position.lerpVectors(farP, preP, a);
      connector.group.quaternion.copy(seatQ);
      const on = ss(1.1, 1.35, lt);
      car.inlet.led.material.emissive.copy(EMERALD);
      car.inlet.led.material.emissiveIntensity = on * (2.2 + 0.5 * Math.sin(lt * 9));
      wbLed.emissiveIntensity = 0.9 + on * (1.6 + 0.6 * Math.sin(lt * 6));
      if (lt < 1.15) {
        const camP = seatP.clone().addScaledVector(pn, mix(0.95, 0.85, lt)).add(v3(mix(0.42, 0.34, lt), 0.2, 0));
        look(camP, seatP.clone().add(v3(-0.08, -0.04, 0)), 29);
      } else {
        // medium: the wall-mounted charger, its cable and the car, charging
        const m = lt - 1.15;
        const camP = v3(PARK.x + 3.05, 1.55 + m * 0.08, PARK.z + wallSide * mix(1.25, 1.15, m));
        look(camP, v3(seatP.x - 0.55, 0.95, PARK.z + wallSide * 1.25), 52);
      }
      aimSun(v3(PARK.x, 0, PARK.z), 12);
      charge.style.opacity = String(ss(1.3, 1.6, lt) * (1 - ss(2.05, 2.2, lt)));
      const pct = Math.round(mix(8, 14, ss(1.3, 2.2, lt)));
      chargePct.textContent = `${pct}%`;
      chargeBar.style.transform = `scaleX(${pct / 100})`;
    }
    updateCable();
    caption('Plug in. Power up.', t, 9.45, 13.0);
  } else if (t < 16.0) {
    // ---- 05 the neighbourhood from above: a network of home chargers
    const lt = t - 13;
    placeCar(PARK.x, PARK.z, Math.PI / 2, 9.5);
    const port = car.port;
    const pq = port.getWorldQuaternion(new THREE.Quaternion());
    connector.group.position.copy(port.localToWorld(v3(0, 0, COLLAR_DEPTH - 0.009)));
    connector.group.quaternion.copy(pq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), Math.PI)));
    updateCable();
    car.inlet.door.rotation.y = 1.95;
    car.inlet.led.material.emissive.copy(EMERALD);
    car.inlet.led.material.emissiveIntensity = 2.4;
    wbLed.emissiveIntensity = 2.2;
    const k = eio(lin(0, 2.9, lt));
    const start = v3(PARK.x - 9, 5.5, PARK.z - 11);
    const end = v3(PARK.x - 70, 150, PARK.z - 95);
    const cam = vmix(start, end, k);
    const tgt = vmix(v3(PARK.x, 1.2, PARK.z), v3(PARK.x - 22, 0, PARK.z - 6), k);
    look(cam, tgt, mix(38, 34, k));
    aimSun(tgt, mix(25, 130, k));
    markers.forEach((m, i) => {
      const s = eout(lin(0.55 + m.at, 0.95 + m.at, lt));
      m.g.visible = s > 0.001;
      m.g.scale.setScalar(Math.max(0.001, s * mix(0.35, 2.3, k)) * (1 + Math.sin(Math.PI * clamp(s)) * 0.15));
      const ph = (lt * 0.8 + i * 0.17) % 1;
      m.ring.scale.setScalar(1 + ph * 3);
      (m.ring.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * s * 0.9;
      const ph2 = (ph + 0.5) % 1;
      m.ring2.scale.setScalar(1 + ph2 * 3);
      (m.ring2.material as THREE.MeshBasicMaterial).opacity = (1 - ph2) * s * 0.9;
    });
    caption('Your neighborhood.\nYour charging network.', t, 13.55, 16.0);
  } else {
    // ---- 06 logo, then the website hero
    const lt = t - 16;
    draw3d = false;
    logo.style.opacity = String(ss(0, 0.25, lt) * (1 - ss(1.25, 1.5, lt)));
    const pin = document.getElementById('lg-pin') as unknown as SVGElement;
    const pk = eout(lin(0.02, 0.4, lt));
    pin.style.transform = `translateY(${(1 - pk) * -18}px) scale(${mix(0.55, 1, pk)})`;
    pin.style.opacity = String(ss(0.02, 0.18, lt));
    (document.getElementById('lg-n') as unknown as SVGElement).style.strokeDashoffset = String(1 - eio(lin(0.22, 0.6, lt)));
    (document.getElementById('lgrect') as unknown as SVGRectElement).setAttribute('width', String(285 * eio(lin(0.42, 0.95, lt))));
    const tg = $('#tagline');
    tg.style.opacity = String(ss(0.75, 1.0, lt));
    tg.style.transform = `translateY(${(1 - eout(lin(0.75, 1.1, lt))) * 14}px)`;
    $('#logomark').style.transform = `scale(${mix(0.96, 1.0, eout(lin(0, 1.2, lt)))})`;
    hero.style.opacity = String(ss(1.25, 1.65, lt));
    hero.style.transform = `scale(${mix(1.05, 1.0, eout(lin(1.25, 2.0, lt)))})`;
  }
  vig.style.opacity = t >= 16 ? '0' : '1';
  if (draw3d) {
    renderer.render(scene, camera);
    lastRendered = t;
  }
  if (t >= 16) canvas.style.opacity = '0';
  else canvas.style.opacity = '1';
  return { t };
}

const ready = init();
(window as unknown as { __film: unknown }).__film = { ready, seek, duration: DURATION };
