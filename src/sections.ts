// Interactive content: connector guide, charging estimator, contact actions, network illustration.
import { CONNECTORS, CONTACT_EMAIL, estimate, fmtTime, PRESETS, type Calc } from './content.js';

const $ = <T extends HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function initCompat() {
  const list = $('#conn-list'), detail = $('#conn-detail');
  if (!list || !detail) return;
  let kind: 'car' | 'bike' = 'car';
  let id = 'ccs2';
  const draw = () => {
    const items = CONNECTORS[kind];
    const cur = items.find((c) => c.id === id) || items[0];
    list.innerHTML = items.map((c) => `<button type="button" role="radio" aria-checked="${c.id === cur.id}" data-id="${c.id}"><b>${esc(c.name)}</b><small>${esc(c.tag)}</small></button>`).join('');
    detail.innerHTML = `<h4>${esc(cur.name)}</h4><p>${esc(cur.about)}</p><h5>Usually works with</h5><ul>${cur.fits.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><h5>Typical power</h5><p>${esc(cur.power)}</p><p class="fine">${esc(cur.note)}</p>`;
  };
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) { id = b.dataset.id!; draw(); (list.querySelector(`[data-id="${id}"]`) as HTMLElement)?.focus(); }
  });
  list.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const items = CONNECTORS[kind];
    const i = items.findIndex((c) => c.id === id);
    id = items[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length].id;
    draw();
    (list.querySelector(`[data-id="${id}"]`) as HTMLElement)?.focus();
  });
  document.querySelectorAll<HTMLButtonElement>('#compat [data-kind]').forEach((b) =>
    b.addEventListener('click', () => {
      kind = b.dataset.kind as 'car' | 'bike';
      id = CONNECTORS[kind][0].id;
      document.querySelectorAll('#compat [data-kind]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      draw();
    }),
  );
  draw();
}

export function initCalc() {
  const form = $('#calc-form'), presets = $('#presets');
  if (!form || !presets) return;
  const FIELDS: [keyof Calc, string, number, number, number, string][] = [
    ['cap', 'Usable battery', 1, 100, 0.5, 'kWh'], ['from', 'Charge from', 0, 100, 1, '%'], ['to', 'Charge to', 0, 100, 1, '%'],
    ['charger', 'Charger power', 0.5, 150, 0.5, 'kW'], ['vehicle', 'Vehicle accepts up to', 0.5, 150, 0.5, 'kW'], ['price', 'Example rate per kWh', 1, 40, 0.5, '₹'],
  ];
  let v: Calc = { ...PRESETS[0] };
  form.innerHTML = FIELDS.map(([k, label, min, max, step, unit]) =>
    `<label><span>${label}</span><span class="inp"><input type="number" name="${k}" min="${min}" max="${max}" step="${step}" inputmode="decimal"><em>${unit}</em></span></label>`).join('');
  presets.innerHTML = PRESETS.map((p, i) => `<button type="button" aria-pressed="${i === 0}" data-p="${p.id}">${p.label}</button>`).join('');
  const sync = () => {
    for (const [k] of FIELDS) (form.querySelector(`[name=${k}]`) as HTMLInputElement).value = String(v[k]);
    calc();
  };
  const calc = () => {
    const r = estimate(v);
    $('#r-time')!.textContent = fmtTime(r.hours);
    $('#r-kwh')!.textContent = `${r.kwh.toFixed(1)} kWh`;
    $('#r-cost')!.textContent = `₹ ${Math.round(r.cost).toLocaleString('en-IN')}`;
  };
  form.addEventListener('input', (e) => {
    const i = e.target as HTMLInputElement;
    const f = FIELDS.find((x) => x[0] === i.name)!;
    const n = Number(i.value);
    if (i.value === '' || !Number.isFinite(n)) return;
    v = { ...v, [f[0]]: Math.min(f[3], Math.max(f[2], n)) };
    presets.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    calc();
  });
  form.addEventListener('change', sync);
  presets.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const p = PRESETS.find((x) => x.id === b.dataset.p)!;
    v = { ...p };
    presets.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    sync();
  });
  sync();
}

export function initContact() {
  const box = $('#contact-actions');
  if (!box) return;
  if (CONTACT_EMAIL) {
    const m = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    box.innerHTML = `<div class="cta"><a class="pill" href="${m('NEARVOLT EV host interest')}">Host enquiry</a><a class="pill ghost" href="${m('NEARVOLT EV partnership')}">Partnership enquiry</a></div><p class="fine">Opens your email app, addressed to ${esc(CONTACT_EMAIL)}.</p>`;
  } else {
    box.innerHTML = `<p class="fine">A monitored business email for host, partner and investor enquiries will be published here shortly.</p>`;
  }
}

/** Illustrative city network: nodes (hosts/stations) connected by pulsing emerald routes. */
export function initNetwork(reduced: boolean) {
  const c = $<HTMLCanvasElement>('#network');
  if (!c) return;
  const g = c.getContext('2d')!;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const nodes = Array.from({ length: 34 }, (_, i) => ({ x: 0.08 + rnd() * 0.84, y: 0.1 + rnd() * 0.8, host: i % 4 !== 0, ph: rnd() * 6 }));
  const edges: [number, number][] = [];
  nodes.forEach((a, i) => {
    const near = nodes.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) })).filter((o) => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 2);
    near.forEach((o) => { if (!edges.some(([p, q]) => (p === o.j && q === i))) edges.push([i, o.j]); });
  });
  let visible = false, raf = 0;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); }).observe(c);
  function frame(now: number) {
    raf = 0;
    const dpr = Math.min(2, devicePixelRatio || 1), w = c!.clientWidth, h = c!.clientHeight;
    if (c!.width !== Math.round(w * dpr)) { c!.width = Math.round(w * dpr); c!.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const t = reduced ? 2 : now / 1000;
    g.lineWidth = 1;
    for (const [i, j] of edges) {
      const a = nodes[i], b = nodes[j];
      g.strokeStyle = 'rgba(25,211,143,0.16)';
      g.beginPath(); g.moveTo(a.x * w, a.y * h); g.lineTo(b.x * w, b.y * h); g.stroke();
      const u = (t * 0.35 + a.ph) % 1;
      g.fillStyle = 'rgba(91,240,182,0.9)';
      g.beginPath(); g.arc((a.x + (b.x - a.x) * u) * w, (a.y + (b.y - a.y) * u) * h, 1.6, 0, 6.283); g.fill();
    }
    for (const n of nodes) {
      const p = 0.5 + 0.5 * Math.sin(t * 2 + n.ph);
      g.fillStyle = n.host ? 'rgba(25,211,143,0.18)' : 'rgba(243,247,245,0.14)';
      g.beginPath(); g.arc(n.x * w, n.y * h, 7 + p * 5, 0, 6.283); g.fill();
      g.fillStyle = n.host ? '#19D38F' : '#F3F7F5';
      g.beginPath(); g.arc(n.x * w, n.y * h, n.host ? 3 : 4, 0, 6.283); g.fill();
    }
    if (visible && !reduced) raf = requestAnimationFrame(frame);
  }
}
