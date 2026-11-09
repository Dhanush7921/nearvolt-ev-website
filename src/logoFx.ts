// Intro overlay: emerald energy particles leave the charge port and assemble the NEARVOLT EV logo.
// Drawn on a 2D canvas above the WebGL frame; only used when rendering the intro film.
import { BRAND } from './brand.js';
import { smooth } from './engine/math.js';

type P = { tx: number; ty: number; sx: number; sy: number; cx: number; cy: number; t0: number; r: number; drift: number };

export class LogoFx {
  private pts: P[] = [];
  private logo: HTMLCanvasElement;
  private lw = 0; private lh = 0;
  constructor(private ctx: CanvasRenderingContext2D, private W: number, private H: number, portrait: boolean) {
    const totalW = 64 + 10 + BRAND.wordWidth + 8 + BRAND.evWidth; // logo units
    const scale = (portrait ? W * 0.84 : W * 0.46) / totalW;
    this.lw = Math.ceil(totalW * scale); this.lh = Math.ceil(64 * scale);
    const c = document.createElement('canvas');
    c.width = this.lw; c.height = this.lh;
    const g = c.getContext('2d')!;
    g.scale(scale, scale);
    const grad = g.createLinearGradient(10, 4, 54, 60);
    grad.addColorStop(0, '#5BF0B6'); grad.addColorStop(0.55, '#19D38F'); grad.addColorStop(1, '#0A8F5E');
    g.fillStyle = grad; g.fill(new Path2D(BRAND.pin));
    g.strokeStyle = '#0B0F0E'; g.lineWidth = 5.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(new Path2D(BRAND.bolt));
    g.translate(74, 43); g.fillStyle = '#F3F7F5'; g.fill(new Path2D(BRAND.word));
    g.translate(BRAND.wordWidth + 12, 0); g.fillStyle = '#19D38F'; g.fill(new Path2D(BRAND.ev));
    this.logo = c;
    // sample target points from the rendered logo
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const step = Math.max(2, Math.round(this.lw / 260));
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ox = (W - this.lw) / 2, oy = (H - this.lh) / 2 - H * (portrait ? 0.02 : 0.04);
    for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) {
      if (data[(y * c.width + x) * 4 + 3] > 128 && rnd() < 0.85) {
        this.pts.push({ tx: ox + x, ty: oy + y, sx: 0, sy: 0, cx: (rnd() - 0.5) * W * 0.5, cy: -rnd() * H * 0.45, t0: 6.0 + rnd() * 0.55 + (x / c.width) * 0.15, r: (0.6 + rnd()) * (W / 1920) * 1.6, drift: rnd() });
      }
    }
    this.oy = oy;
  }
  private oy = 0;

  draw(t: number, port: { x: number; y: number }) {
    const g = this.ctx;
    g.clearRect(0, 0, this.W, this.H);
    if (t < 5.95 || t > 7.9) return;
    const veil = smooth(6.0, 6.5, t) * (1 - smooth(7.2, 7.8, t));
    if (veil > 0) {
      const rg = g.createRadialGradient(this.W / 2, this.oy + this.lh / 2, 0, this.W / 2, this.oy + this.lh / 2, this.W * 0.6);
      rg.addColorStop(0, `rgba(2,4,4,${(0.78 * veil).toFixed(3)})`);
      rg.addColorStop(1, `rgba(2,4,4,${(0.35 * veil).toFixed(3)})`);
      g.fillStyle = rg; g.fillRect(0, 0, this.W, this.H);
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    const out = smooth(7.2, 7.75, t);
    for (const p of this.pts) {
      const u = smooth(p.t0, p.t0 + 0.6, t);
      if (u <= 0) continue;
      const e = 1 - Math.pow(1 - u, 3);
      const sx = port.x, sy = port.y;
      const mx = (sx + p.tx) / 2 + p.cx, my = (sy + p.ty) / 2 + p.cy;
      let x = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * mx + e * e * p.tx;
      let y = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * my + e * e * p.ty;
      x += Math.sin(t * 9 + p.drift * 40) * 0.6 * (1 - e) * 6;
      y -= out * (40 + p.drift * 120) * (this.H / 1080);
      const a = (0.35 + 0.65 * (1 - e) + 0.3) * (1 - out) * Math.min(1, u * 4);
      g.fillStyle = `rgba(70,245,170,${a.toFixed(3)})`;
      g.beginPath(); g.arc(x, y, p.r * (1 + (1 - e) * 1.5), 0, 6.283); g.fill();
    }
    g.restore();
    const solid = smooth(6.65, 6.95, t) * (1 - smooth(7.15, 7.6, t));
    if (solid > 0) {
      g.save();
      g.globalAlpha = solid;
      const s = 1 + smooth(7.15, 7.6, t) * 0.05;
      g.translate(this.W / 2, this.oy + this.lh / 2);
      g.scale(s, s);
      g.shadowColor = 'rgba(25,211,143,0.85)';
      g.shadowBlur = 40 * (this.W / 1920);
      g.drawImage(this.logo, -this.lw / 2, -this.lh / 2);
      g.shadowBlur = 0;
      g.drawImage(this.logo, -this.lw / 2, -this.lh / 2);
      g.restore();
    }
  }
}
