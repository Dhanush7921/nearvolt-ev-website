// NEARVOLT EV admin dashboard. All data comes from the authenticated backend (/api/v1/admin/*), which enforces
// the server-side admin claim and MFA. All rendering uses DOM APIs (no innerHTML) to prevent XSS.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, getMultiFactorResolver, TotpMultiFactorGenerator, multiFactor, reauthenticateWithPopup } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

const CFG = window.NV_ADMIN_CONFIG || {};
const $app = document.getElementById('app');
const $who = document.getElementById('who');
if (!CFG.apiBase || !CFG.firebase?.apiKey || !CFG.appCheckSiteKey) {
  $app.textContent = 'Admin dashboard is not configured for this deployment.';
  throw new Error('NV_ADMIN_CONFIG missing');
}
const app = initializeApp(CFG.firebase);
const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(CFG.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
});
const auth = getAuth(app);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '');
const pill = (s) => h('span', { class: `pill ${s}` }, s);
function toast(msg) { const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 3500); }

async function api(path, { method = 'GET', body, raw } = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in required.");
  const { token: appCheckToken } = await getToken(appCheck);
  const r = await fetch(`${CFG.apiBase}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, "X-Firebase-AppCheck": appCheckToken, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return j.data;
}

// ---------- Sign-in (Google + TOTP second factor) ----------
function signInView(err) {
  $app.replaceChildren(h('div', { class: 'center card' },
    h('h1', {}, 'Admin sign-in'), h('p', { class: 'muted' }, 'Restricted to NEARVOLT EV staff. Two-step verification is required.'),
    h('button', { onclick: doSignIn }, 'Sign in with Google'), err ? h('p', { class: 'err', role: 'alert' }, err) : null));
}
async function doSignIn() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) {
    if (e.code === 'auth/multi-factor-auth-required') {
      const resolver = getMultiFactorResolver(auth, e);
      const hint = resolver.hints.find((x) => x.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      if (!hint) return signInView('No authenticator-app factor enrolled for this account.');
      const code = prompt('Enter the 6-digit code from your authenticator app');
      if (!code) return;
      try { await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim())); }
      catch { signInView('Incorrect verification code.'); }
    } else signInView('Sign-in failed. Please try again.');
  }
}

// ---------- Layout ----------
const TABS = { overview: 'Overview', hosts: 'Hosts', requests: 'Requests', complaints: 'Complaints', users: 'Users', deletions: 'Deletion requests',
  security: 'Security', audit: 'Audit log', settings: 'Settings', notify: 'Notifications', sheets: 'Google Sheets', reports: 'Reports' };
let current = location.hash.slice(1) || 'overview';
function shell() {
  const nav = h('nav', { class: 'tabs', role: 'tablist' }, Object.entries(TABS).map(([k, v]) => h('button', { role: 'tab', 'aria-selected': k === current, onclick: () => { current = k; location.hash = k; shell(); } }, v)));
  const body = h('section', { id: 'view' }, h('p', { class: 'muted' }, 'Loading…'));
  $app.replaceChildren(nav, body);
  (VIEWS[current] || VIEWS.overview)(body).catch((e) => body.replaceChildren(h('p', { class: 'err', role: 'alert' }, e.message)));
}
function table(cols, rows) {
  return h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c[0])))), h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, cols.map((c) => h('td', {}, c[1](r))))) : h('tr', {}, h('td', { colspan: cols.length, class: 'muted' }, 'Nothing here.'))));
}
function pager(load) {
  let cursor = null; const wrap = h('div'); const more = h('button', { class: 'ghost', onclick: () => go() }, 'Load more');
  async function go(reset) { if (reset) { cursor = null; wrap.replaceChildren(); } const d = await load(cursor); wrap.append(d.node); cursor = d.nextCursor; more.hidden = !cursor; }
  return { el: h('div', {}, wrap, more), go };
}
function modal(title, ...content) {
  const d = h('dialog', { 'aria-label': title }, h('div', { class: 'body' }, h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, title), h('button', { class: 'ghost', onclick: () => d.close() }, 'Close')), ...content));
  d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); return d;
}
const reasonPrompt = (label) => { const r = prompt(label); return r && r.trim().length >= 5 ? r.trim() : (r != null && toast('Reason must be at least 5 characters.'), null); };

// ---------- Charts (dependency-free SVG; CSP allows no external scripts) ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
function funnelChart(a) {
  const W = 720, H = 220, P = { l: 34, r: 8, t: 12, b: 26 }, n = a.series.length;
  const max = Math.max(1, ...a.series.map((d) => d.created));
  const bw = (W - P.l - P.r) / n, y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Requests per day for ${n} days: ${a.totals.created} created, ${a.totals.completed} completed` , class: 'chart' });
  for (const t of [0, 0.5, 1]) { const v = Math.round(max * t); svg.append(sv('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid-line' }), sv('text', { x: P.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, String(v))); }
  a.series.forEach((d, i) => {
    const x = P.l + i * bw, w = Math.max(3, bw * 0.62);
    const g = sv('g', {}, sv('title', {}, `${d.date}: ${d.created} created, ${d.completed} completed, ${d.lost} expired/declined/cancelled`));
    g.append(sv('rect', { x: x + (bw - w) / 2, y: y(d.created), width: w, height: Math.max(0, H - P.b - y(d.created)), rx: 3, class: 'bar-created' }));
    g.append(sv('rect', { x: x + (bw - w) / 2, y: y(d.completed), width: w, height: Math.max(0, H - P.b - y(d.completed)), rx: 3, class: 'bar-completed' }));
    svg.append(g);
    if (i % Math.ceil(n / 7) === 0 || i === n - 1) svg.append(sv('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis' }, d.date.slice(5)));
  });
  const rate = a.completionRate == null ? '—' : `${a.completionRate}%`;
  return [h('div', { class: 'row chart-head' }, h('h3', {}, `Requests · last ${n} days`), h('span', { class: 'legend created' }, 'Created'), h('span', { class: 'legend completed' }, 'Completed')),
    svg, h('div', { class: 'row kpis' }, h('span', {}, h('b', {}, a.totals.created), ' created'), h('span', {}, h('b', {}, a.totals.completed), ' completed'),
      h('span', {}, h('b', {}, a.totals.lost), ' expired / declined / cancelled'), h('span', {}, h('b', {}, rate), ' completion rate'))];
}

// ---------- Views ----------
const VIEWS = {
  async overview(el) {
    const d = await api('/admin/overview');
    const stats = [['Users', d.users], ['Approved hosts', d.hostsApproved], ['Hosts awaiting review', d.hostsPending], ['Active requests', d.activeRequests],
      ['Requests (24 h)', d.requestsLast24h], ['Completed (24 h)', d.completedLast24h], ['Open complaints', d.openComplaints], ['Urgent safety reports', d.urgentComplaints], ['Sheets rows pending', d.sheetsPending]];
    const chartBox = h('div', { class: 'card chart-card' }, h('p', { class: 'muted' }, 'Loading request trend…'));
    el.replaceChildren(h('div', { class: 'grid' }, stats.map(([k, v]) => h('div', { class: 'card stat' + (k.startsWith('Urgent') && v > 0 ? ' alert' : '') }, h('b', {}, v), k))), chartBox,
      h('p', { class: 'muted' }, `Live data · generated ${fmt(d.generatedAt)}`));
    try { chartBox.replaceChildren(...funnelChart(await api('/admin/analytics?days=14'))); }
    catch (e) { chartBox.replaceChildren(h('p', { class: 'err' }, `Trend unavailable: ${e.message}`)); }
  },
  async hosts(el) {
    const sel = h('select', { 'aria-label': 'Status filter' }, ['PENDING_REVIEW', 'APPROVED', 'SUSPENDED', 'REJECTED', 'DRAFT', ''].map((s) => h('option', { value: s }, s || 'All')));
    const p = pager(async (cursor) => {
      const d = await api(`/admin/hosts?limit=25${sel.value ? `&status=${sel.value}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      return { nextCursor: d.nextCursor, node: table([['Host', (x) => x.displayName || x.uid], ['Status', (x) => pill(x.status)], ['Area', (x) => x.serviceAreaId || ''],
        ['Equipment', (x) => x.equipment ? `${x.equipment.powerKw} kW · ${x.equipment.connectors.join(', ')}` : '—'], ['Files', (x) => `${x.photos.length} photos · ${x.documents.length} docs`],
        ['Updated', (x) => fmt(x.updatedAt)], ['', (x) => h('button', { class: 'ghost', onclick: () => hostDetail(x.uid, () => p.go(true)) }, 'Review')]], d.items) };
    });
    sel.addEventListener('change', () => p.go(true));
    el.replaceChildren(h('div', { class: 'row' }, h('label', {}, 'Status'), sel), p.el); await p.go(true);
  },
  async requests(el) {
    const sel = h('select', { 'aria-label': 'Status filter' }, ['', 'REQUESTED', 'ACCEPTED', 'ARRIVED', 'CHARGING', 'COMPLETED', 'DISPUTED', 'EXPIRED', 'CANCELLED', 'REJECTED'].map((s) => h('option', { value: s }, s || 'All')));
    const p = pager(async (cursor) => {
      const d = await api(`/admin/requests?limit=25${sel.value ? `&status=${sel.value}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      return { nextCursor: d.nextCursor, node: table([['Created', (x) => fmt(x.createdAt)], ['Status', (x) => pill(x.status)], ['Customer', (x) => x.customerName], ['Host', (x) => x.hostName],
        ['Vehicle', (x) => `${x.vehicleType} · ${x.connector}`], ['Distance', (x) => `${x.straightLineKm} km`], ['History', (x) => x.history.map((e) => e.to).join(' → ')],
        ['', (x) => x.status === 'REQUESTED' ? h('button', { class: 'ghost', onclick: async () => { const r = reasonPrompt('Reason for closing this request'); if (r) { await api(`/admin/requests/${x.id}/cancel`, { method: 'POST', body: { reason: r } }); toast('Closed'); p.go(true); } } }, 'Close') : '']], d.items) };
    });
    sel.addEventListener('change', () => p.go(true));
    el.replaceChildren(h('div', { class: 'row' }, h('label', {}, 'Status'), sel), p.el); await p.go(true);
  },
  async complaints(el) {
    const p = pager(async (cursor) => {
      const d = await api(`/admin/complaints?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      return { nextCursor: d.nextCursor, node: table([['Created', (x) => fmt(x.createdAt)], ['Priority', (x) => pill(x.priority)], ['Category', (x) => x.category], ['Status', (x) => pill(x.status)],
        ['Message', (x) => x.message], ['Request', (x) => x.requestId || ''], ['', (x) => h('button', { class: 'ghost', onclick: () => complaintEdit(x, () => p.go(true)) }, 'Update')]], d.items) };
    });
    el.replaceChildren(p.el); await p.go(true);
  },
  async users(el) {
    const p = pager(async (cursor) => {
      const d = await api(`/admin/users?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      return { nextCursor: d.nextCursor, node: table([['Name', (x) => x.name || '—'], ['Role', (x) => x.role || '—'], ['Contact', (x) => [x.email, x.phone].filter(Boolean).join(' · ')], ['Status', (x) => pill(x.status || 'ACTIVE')],
        ['Joined', (x) => fmt(x.createdAt)], ['', (x) => x.status === 'DISABLED'
          ? h('button', { class: 'ghost', onclick: async () => { await api(`/admin/users/${x.uid}/enable`, { method: 'POST' }); toast('Enabled'); p.go(true); } }, 'Enable')
          : h('button', { class: 'danger', onclick: async () => { const r = reasonPrompt('Reason for disabling this account'); if (r) { await api(`/admin/users/${x.uid}/disable`, { method: 'POST', body: { reason: r } }); toast('Disabled'); p.go(true); } } }, 'Disable')]], d.items) };
    });
    el.replaceChildren(p.el); await p.go(true);
  },
  async deletions(el) {
    const d = await api('/admin/deletion-requests?limit=50');
    el.replaceChildren(h('p', { class: 'muted' }, 'Requests from the public deletion page. Verify ownership with the contact before deleting.'), table([['Received', (x) => fmt(x.createdAt)], ['Contact', (x) => x.contact], ['Details', (x) => x.details], ['Status', (x) => pill(x.status)]], d.items));
  },
  async security(el) {
    const d = await api('/admin/security-events?limit=50');
    el.replaceChildren(h('div', { class: 'card stat' }, h('b', {}, d.activeOtpLockouts), 'Phone numbers currently locked after failed OTP attempts'), h('h3', {}, 'Security-relevant admin actions'),
      table([['When', (x) => fmt(x.at)], ['Action', (x) => x.action], ['Actor', (x) => x.actorUid], ['Target', (x) => x.target]], d.items));
  },
  async audit(el) {
    const p = pager(async (cursor) => {
      const d = await api(`/admin/audit?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      return { nextCursor: d.nextCursor, node: table([['When', (x) => fmt(x.at)], ['Actor', (x) => `${x.actorType}: ${x.actorUid}`], ['Action', (x) => x.action], ['Target', (x) => x.target], ['Details', (x) => JSON.stringify(x.meta || {})]], d.items) };
    });
    el.replaceChildren(p.el); await p.go(true);
  },
  async settings(el) {
    const s = await api('/admin/settings');
    const m = h('input', { type: 'checkbox', id: 'mt' }); m.checked = !!s.maintenance?.enabled;
    const mm = h('input', { value: s.maintenance?.message || '', maxlength: 300 });
    const minV = h('input', { type: 'number', min: 1, value: s.minSupportedVersionCode }); const latest = h('input', { type: 'number', min: 1, value: s.latestVersionCode });
    const flags = h('textarea', { rows: 4 }); flags.value = JSON.stringify(s.featureFlags || {}, null, 2);
    const areas = h('textarea', { rows: 8 }); areas.value = JSON.stringify(s.serviceAreas || [], null, 2);
    const se = h('input', { value: s.supportContact?.email || '' }); const sp = h('input', { value: s.supportContact?.phone || '' });
    const msg = h('p', { role: 'status' });
    const save = h('button', { onclick: async () => {
      try {
        await api('/admin/settings', { method: 'PUT', body: { maintenance: { enabled: m.checked, message: mm.value }, minSupportedVersionCode: Number(minV.value), latestVersionCode: Number(latest.value),
          featureFlags: JSON.parse(flags.value), serviceAreas: JSON.parse(areas.value), supportContact: { email: se.value, phone: sp.value } } });
        msg.className = 'ok'; msg.textContent = 'Saved. Apps pick up changes within about a minute.';
      } catch (e) { msg.className = 'err'; msg.textContent = e.message; }
    } }, 'Save settings');
    el.replaceChildren(h('div', { class: 'card' },
      h('h3', {}, 'Maintenance'), h('div', { class: 'check' }, m, h('label', { for: 'mt' }, 'Maintenance mode (blocks the app; admin keeps working)')), h('label', {}, 'Message shown to users'), mm,
      h('h3', {}, 'App versions'), h('label', {}, 'Minimum supported Android versionCode (forces update — use only for critical fixes)'), minV, h('label', {}, 'Latest versionCode (shows optional update)'), latest,
      h('h3', {}, 'Feature flags (JSON)'), flags, h('h3', {}, 'Service areas (JSON: id, name, active, center {lat,lng}, radiusKm)'), areas,
      h('h3', {}, 'Support contact'), h('label', {}, 'Email'), se, h('label', {}, 'Phone'), sp, h('p'), save, msg));
  },
  async notify(el) {
    const aud = h('select', {}, [['hosts', 'All hosts'], ['customers', 'All customers'], ['uid', 'One user (UID)']].map(([v, t]) => h('option', { value: v }, t)));
    const uid = h('input', { placeholder: 'Firebase UID (for one user)' }); const t = h('input', { maxlength: 60 }); const b = h('textarea', { rows: 3, maxlength: 200 }); const msg = h('p', { role: 'status' });
    el.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Do not include addresses or personal details: notifications can appear on lock screens.'),
      h('label', {}, 'Audience'), aud, uid, h('label', {}, 'Title'), t, h('label', {}, 'Message'), b, h('p'),
      h('button', { onclick: async () => { if (!confirm('Send this notification?')) return; try { const r = await api('/admin/notifications', { method: 'POST', body: { audience: aud.value, uid: uid.value || undefined, title: t.value, body: b.value } }); msg.className = 'ok'; msg.textContent = `Sent to ${r.sent} user(s).`; } catch (e) { msg.className = 'err'; msg.textContent = e.message; } } }, 'Send'), msg));
  },
  async sheets(el) {
    const d = await api('/admin/sheets/status');
    if (!d.configured) return el.replaceChildren(h('p', { class: 'muted' }, 'Google Sheets sync is not configured (SHEETS_SPREADSHEET_ID unset).'));
    el.replaceChildren(h('div', { class: 'card stat' }, h('b', {}, d.pending), 'Rows waiting to sync (retried automatically every few minutes)'),
      table([['Tab', (x) => x[0]], ['Rows', (x) => x[1].rows], ['Duplicate keys', (x) => x[1].duplicateKeys.length ? h('span', { class: 'err' }, x[1].duplicateKeys.join(', ')) : 'None']], Object.entries(d.tabs)));
  },
  async reports(el) {
    const days = h('select', {}, [7, 30, 90, 365].map((d) => h('option', { value: d }, `Last ${d} days`)));
    el.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Charging requests export (CSV)'), days, h('p'), h('button', { onclick: async () => {
      const r = await api(`/admin/reports/requests.csv?days=${days.value}`, { raw: true });
      const a = h('a', { href: URL.createObjectURL(await r.blob()), download: `nearvolt-requests-${days.value}d.csv` }); a.click(); URL.revokeObjectURL(a.href);
    } }, 'Download CSV')));
  },
};

const CHECKLIST = [['earthingVerified', 'Earthing verified with tester'], ['rcdTested', 'RCD/ELCB present and trip-tested'], ['circuitRatingAdequate', 'Circuit, breaker and wiring rated for the listed current'],
  ['cablingAndSocketCondition', 'Socket, plug and cable in safe condition'], ['weatherProtection', 'Charging spot protected from rain/water'], ['clearAccessAndParking', 'Safe access and parking'],
  ['fireSafetyClearance', 'No fire hazards near the charging point'], ['documentsReviewed', 'Electrical safety documents reviewed'], ['identityVerified', 'Host identity and property permission verified']];

async function hostDetail(uid, refresh) {
  const x = await api(`/admin/hosts/${uid}`);
  const files = (list, label) => h('div', {}, h('b', {}, label), h('ul', {}, (list || []).map((f) => h('li', {}, h('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer' }, f.path.split('/').pop())))));
  const eq = x.equipment || {};
  const body = [
    h('p', {}, pill(x.status), ' ', x.serviceAreaId || ''),
    h('p', {}, h('b', {}, 'Address: '), x.address || '—', h('br'), h('b', {}, 'Coordinates: '), x.location ? `${x.location.lat}, ${x.location.lng}` : '—'),
    h('p', {}, h('b', {}, 'Equipment: '), `${eq.chargerType || ''} · ${eq.voltageV} V · ${eq.currentA} A · ${eq.phase}-phase · ${eq.powerKw} kW · capacity ${eq.capacity}`, h('br'), `Connectors: ${(eq.connectors || []).join(', ')} · Vehicles: ${(eq.vehicleTypes || []).join(', ')}`),
    h('p', {}, h('b', {}, 'Host self-declaration: '), JSON.stringify(x.selfDeclaration || {})),
    x.photoUrls ? files(x.photoUrls, 'Photos') : h('p', { class: 'muted' }, `${x.photos.length} photos (storage not configured for preview)`),
    x.documentUrls ? files(x.documentUrls, 'Documents') : h('p', { class: 'muted' }, `${x.documents.length} documents`),
    x.verification ? h('p', { class: 'muted' }, `Last review: ${fmt(x.verification.reviewedAt)} by ${x.verification.reviewedBy || ''} ${x.verification.inspectorName ? `· inspector ${x.verification.inspectorName} on ${x.verification.inspectionDate}` : ''} ${x.verification.notes ? `· ${x.verification.notes}` : ''}`) : null,
  ];
  const act = async (path, payload) => { try { await api(`/admin/hosts/${uid}/${path}`, { method: 'POST', body: payload }); toast('Saved'); d.close(); refresh(); } catch (e) { toast(e.message); } };
  if (x.status === 'PENDING_REVIEW') {
    const boxes = CHECKLIST.map(([k, l]) => { const i = h('input', { type: 'checkbox', id: `c_${k}` }); return [k, i, h('div', { class: 'check' }, i, h('label', { for: `c_${k}` }, l))]; });
    const insp = h('input', { placeholder: 'Inspector name and licence/qualification' }); const date = h('input', { type: 'date' }); const notes = h('textarea', { rows: 2 });
    body.push(h('div', { class: 'card' }, h('h3', {}, 'Electrical safety verification'), h('p', { class: 'muted' }, 'Approve only after a physical inspection. Every item is required. This is recorded in the audit log.'),
      boxes.map((b) => b[2]), h('label', {}, 'Inspector'), insp, h('label', {}, 'Inspection date'), date, h('label', {}, 'Notes'), notes, h('p'),
      h('div', { class: 'row' },
        h('button', { onclick: () => { if (!boxes.every((b) => b[1].checked)) return toast('Complete every checklist item.'); if (!insp.value.trim() || !date.value) return toast('Inspector and date are required.');
          act('approve', { checklist: Object.fromEntries(boxes.map((b) => [b[0], true])), inspectorName: insp.value.trim(), inspectionDate: date.value, notes: notes.value || undefined }); } }, 'Approve host'),
        h('button', { class: 'ghost', onclick: () => { const r = reasonPrompt('What must the host fix? (shown to the host)'); if (r) act('reject', { reason: r }); } }, 'Request changes'))));
  }
  if (x.status === 'APPROVED' || x.status === 'PENDING_REVIEW') body.push(h('button', { class: 'danger', onclick: () => { const r = reasonPrompt('Reason for suspension'); if (r) act('suspend', { reason: r }); } }, 'Suspend'));
  if (x.status === 'SUSPENDED') body.push(h('button', { onclick: () => { const r = reasonPrompt('Reason for restoring (host returns to review)'); if (r) act('restore', { reason: r }); } }, 'Restore to review'));
  const d = modal(x.displayName || uid, ...body);
}

function complaintEdit(x, refresh) {
  const st = h('select', {}, ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => h('option', { value: s, selected: s === x.status }, s)));
  const res = h('textarea', { rows: 3 }); res.value = x.resolution || '';
  const d = modal(`Complaint · ${x.category}`, h('p', {}, x.message), h('label', {}, 'Status'), st, h('label', {}, 'Resolution (visible to the user)'), res, h('p'),
    h('button', { onclick: async () => { try { await api(`/admin/complaints/${x.id}`, { method: 'PATCH', body: { status: st.value, resolution: res.value || undefined } }); toast('Updated'); d.close(); refresh(); } catch (e) { toast(e.message); } } }, 'Save'));
}


async function enrollAdminTotp(user) {
    try {
        const claims = (await user.getIdTokenResult(true)).claims;

        if (claims.admin !== true || !user.emailVerified) {
            throw new Error("Verified admin account required.");
        }

        await reauthenticateWithPopup(
            user,
            new GoogleAuthProvider()
        );

        const session = await multiFactor(user).getSession();

        const secret =
            await TotpMultiFactorGenerator.generateSecret(session);

        const code = prompt(
            "Add this private setup key to your authenticator app:\n\n"
            + secret.secretKey +
            "\n\nEnter your generated 6-digit code:"
        );

        if (!code || !/^\d{6}$/.test(code.trim())) {
            return;
        }

        const assertion =
            TotpMultiFactorGenerator.assertionForEnrollment(
                secret,
                code.trim()
            );

        await multiFactor(user).enroll(
            assertion,
            "NEARVOLT EV Admin"
        );

        await signOut(auth);

        signInView(
            "Authenticator enrolled. Sign in again."
        );

    } catch (e) {
        toast(e.code || "Authenticator enrollment failed.");
    }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { $who.replaceChildren(); return signInView(); }
  const claims = (await user.getIdTokenResult()).claims;
  $who.replaceChildren(user.email || '', h('button', { class: 'ghost', onclick: () => signOut(auth) }, 'Sign out'));
  if (claims.admin !== true) return $app.replaceChildren(h('div', { class: 'center card' }, h('h1', {}, 'Not authorised'), h('p', {}, 'This account does not have admin access.')));

  const enrolled = multiFactor(user).enrolledFactors.some(
      factor => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID
  );

  if (!enrolled) {
      return $app.replaceChildren(
          h("div", { class: "center card" },
              h("h1", {}, "Secure your admin account"),
              h("p", {}, "Authenticator verification is mandatory."),
              h("button", {
                  onclick: () => enrollAdminTotp(user)
              }, "Set up authenticator")
          )
      );
  }

  if (claims.firebase?.sign_in_second_factor !== "totp") {
      return $app.replaceChildren(
          h("div", { class: "center card" },
              h("h1", {}, "Verification required"),
              h("p", {}, "Sign in again using your authenticator code."),
              h("button", {
                  onclick: () => signOut(auth)
              }, "Sign out")
          )
      );
  }

  shell();
});
