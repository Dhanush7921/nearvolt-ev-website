import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

export const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const all = new SharedArray('tokens', () => JSON.parse(open(__ENV.TOKENS_FILE || '../results/tokens.json')));
export const customers = all.filter((t) => t.role === 'customer');
export const hosts = all.filter((t) => t.role === 'host' && t.uid !== 'lt-race-host');
export const unexpected = new Counter('unexpected_errors'); // 5xx except deliberate 503 OVERLOADED, timeouts, connection errors
export const shed = new Counter('shed_503');
export const busy = new Counter('busy_retry_503'); // Firestore contention / deadline: retryable, reported separately
export const bookingLatency = new Trend('booking_create_ms', true);

const H = (tok, extra = {}) => ({ headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'X-App-Platform': 'android', 'X-App-Version-Code': '1', ...extra }, timeout: '20s' });
// Bodies are discarded by default (k6 memory); pass keep=true when the journey needs to read the response.
export function req(method, path, tok, body, name, extra, keep = false) {
  const r = http.request(method, `${BASE}${path}`, body ? JSON.stringify(body) : null, { ...H(tok, extra), tags: { name: name || path }, responseType: keep ? 'text' : 'none' });
  if (r.status === 503 && r.headers['Retry-After'] === '2') shed.add(1); // OVERLOADED responses carry Retry-After: 2
  else if (r.status === 503 && r.headers['Retry-After'] === '1') busy.add(1, { name: name || path });
  else if (r.status === 0 || r.status >= 500) unexpected.add(1, { name: name || path });
  return r;
}
// Visakhapatnam points near the synthetic host grid; think times model a real person reading the screen.
export const point = () => ({ lat: 17.70 + (Math.random() - 0.5) * 0.06, lng: 83.29 + (Math.random() - 0.5) * 0.06 });
// NOTHINK=1 removes think time (arrival-rate stress tests that find the throughput ceiling).
export const think = (a, b) => { if (__ENV.NOTHINK !== '1') sleep(a + Math.random() * (b - a)); };
export const me = (list) => list[(exec.vu.idInTest - 1) % list.length];
export const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });

// Realistic journeys (weights set in scenarios): mostly browsing nearby hosts, some history/alerts, few bookings.
export function browse(u) {
  group('browse', () => {
    req('GET', '/api/v1/public/config', null, null, 'config');
    req('GET', '/api/v1/me', u.token, null, 'me');
    think(2, 5);
    const p = point();
    const r = req('GET', `/api/v1/hosts/nearby?lat=${p.lat.toFixed(5)}&lng=${p.lng.toFixed(5)}&radiusKm=5`, u.token, null, 'nearby');
    check(r, { 'nearby 200': (x) => x.status === 200 });
    think(3, 8);
    req('GET', `/api/v1/hosts/nearby?lat=${p.lat.toFixed(5)}&lng=${p.lng.toFixed(5)}&radiusKm=5&connector=TYPE2_AC&vehicleType=car`, u.token, null, 'nearby');
  });
}
export function activity(u) {
  group('activity', () => {
    req('GET', '/api/v1/requests?as=customer&limit=20', u.token, null, 'history');
    think(2, 4);
    req('GET', '/api/v1/me/notifications?limit=20', u.token, null, 'notifications');
  });
}
export function hostDashboard(h) {
  group('host', () => {
    req('GET', '/api/v1/hosts/me', h.token, null, 'host_me');
    req('GET', '/api/v1/requests?as=host&status=active', h.token, null, 'host_active');
  });
}
// Booking: create (idempotent) then cancel so synthetic hosts free up. Counts acknowledged requests for integrity checks.
export const acknowledged = new Counter('acknowledged_requests');
export function book(u) {
  group('book', () => {
    const p = point();
    const n = req('GET', `/api/v1/hosts/nearby?lat=${p.lat.toFixed(5)}&lng=${p.lng.toFixed(5)}&radiusKm=5&connector=TYPE2_AC&vehicleType=car`, u.token, null, 'nearby', undefined, true);
    const items = n.status === 200 ? (n.json('data.items') || []).filter((i) => i.bookableNow) : [];
    if (!items.length) return;
    think(2, 4);
    const key = uuid();
    const body = { hostId: items[0].hostId, vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: p, compatibilityConfirmed: true };
    let r = req('POST', '/api/v1/requests', u.token, body, 'request_create', { 'Idempotency-Key': key }, true);
    if (r.status === 0 || r.status >= 500) r = req('POST', '/api/v1/requests', u.token, body, 'request_create_retry', { 'Idempotency-Key': key }, true); // safe retry
    bookingLatency.add(r.timings.duration);
    if (r.status === 201 || r.status === 200) {
      acknowledged.add(1);
      think(1, 3);
      req('POST', `/api/v1/requests/${r.json('data.id')}/transition`, u.token, { action: 'cancel' }, 'request_cancel');
    }
  });
}
export function mixed() {
  const x = Math.random();
  if (x < 0.10) return hostDashboard(me(hosts));
  const u = me(customers);
  if (x < 0.75) return browse(u);
  if (x < 0.95) return activity(u);
  return book(u);
}
