import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db, makeApp, clearAll, tokenFor, hostBody, CHECKLIST, NEAR, notifications } from './helpers.js';

let app;
const T = {};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const idem = () => ({ 'Idempotency-Key': randomUUID() });

async function onboard(uid, role) {
  let t = await tokenFor(uid);
  await request(app).put('/api/v1/me/consents').set(bearer(t)).send({ termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: true }).expect(200);
  await request(app).put('/api/v1/me/profile').set(bearer(t)).send({ name: uid, vehicle: { type: 'car', connector: 'TYPE2_AC' } }).expect(200);
  await request(app).post('/api/v1/me/role').set(bearer(t)).send({ role }).expect(200);
  return tokenFor(uid); // refreshed token carries the role claim
}
async function approvedHost(uid, over) {
  const t = await onboard(uid, 'host');
  await request(app).put('/api/v1/hosts/me').set(bearer(t)).send(hostBody(over)).expect(200);
  // Uploads need Cloud Storage; attach file references directly for the emulator test.
  await db.collection('hosts').doc(uid).update({ photos: [`hosts/${uid}/photos/a.jpg`, `hosts/${uid}/photos/b.jpg`], documents: [`hosts/${uid}/documents/c.pdf`] });
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(t)).expect(200);
  await request(app).post(`/api/v1/admin/hosts/${uid}/approve`).set(bearer(T.admin)).send({ checklist: CHECKLIST, inspectorName: 'K. Rao (licensed electrician)', inspectionDate: '2026-11-20' }).expect(200);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(t)).send({ available: true }).expect(200);
  return t;
}

before(async () => { ({ app } = makeApp()); });
beforeEach(async () => {
  await clearAll();
  T.admin = await tokenFor('admin1', { admin: true });
  T.c1 = await onboard('cust1', 'customer');
});

test('health endpoint', async () => {
  const r = await request(app).get('/api/v1/health').expect(200);
  assert.equal(r.body.data.status, 'ok');
});

test('auth required, bad tokens rejected, users cannot self-assign admin', async () => {
  await request(app).get('/api/v1/me').expect(401);
  await request(app).get('/api/v1/me').set(bearer('garbage')).expect(401);
  await request(app).post('/api/v1/me/role').set(bearer(T.c1)).send({ role: 'admin' }).expect(400);
  await request(app).post('/api/v1/me/role').set(bearer(T.c1)).send({ role: 'host' }).expect(409); // role locked
  await request(app).get('/api/v1/admin/overview').set(bearer(T.c1)).expect(403);
  await request(app).get('/api/v1/admin/overview').set(bearer(T.admin)).expect(200);
  await request(app).get('/api/v1/admin/analytics').set(bearer(T.c1)).expect(403);
  const an = await request(app).get('/api/v1/admin/analytics?days=7').set(bearer(T.admin)).expect(200);
  assert.equal(an.body.data.series.length, 7); assert.match(an.body.data.series[6].date, /^\d{4}-\d{2}-\d{2}$/);
});

test('admin MFA is enforced when required', async () => {
  const { app: strict } = makeApp({ REQUIRE_ADMIN_MFA: 'true' });
  const r = await request(strict).get('/api/v1/admin/overview').set(bearer(T.admin)).expect(403);
  assert.match(r.body.error.message, /two-step/);
});

test('unverified hosts are hidden; approval requires full checklist', async () => {
  const th = await onboard('host1', 'host');
  await request(app).put('/api/v1/hosts/me').set(bearer(th)).send(hostBody()).expect(200);
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(th)).expect(400); // no photos/docs
  await db.collection('hosts').doc('host1').update({ photos: ['p1', 'p2'], documents: ['d1'] });
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(th)).expect(200);
  let n = await request(app).get('/api/v1/hosts/nearby').query(NEAR).set(bearer(T.c1)).expect(200);
  assert.equal(n.body.data.items.length, 0);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(th)).send({ available: true }).expect(409);
  await request(app).post('/api/v1/admin/hosts/host1/approve').set(bearer(T.admin)).send({ checklist: { ...CHECKLIST, earthingVerified: false }, inspectorName: 'X Y', inspectionDate: '2026-11-20' }).expect(400);
  await request(app).post('/api/v1/admin/hosts/host1/approve').set(bearer(T.admin)).send({ checklist: CHECKLIST, inspectorName: 'X Y', inspectionDate: '2026-11-20' }).expect(200);
  n = await request(app).get('/api/v1/hosts/nearby').query(NEAR).set(bearer(T.c1)).expect(200);
  assert.equal(n.body.data.items.length, 1);
  assert.equal(n.body.data.items[0].bookableNow, false); // approved but offline
  const item = n.body.data.items[0];
  assert.equal(item.location, undefined);
  // Map shows only a ~1 km grid cell, never the exact host coordinates.
  assert.ok(item.approxArea && item.approxArea.radiusM === 800);
  // Privacy across endpoints: discovery never carries the exact coordinates or the street address.
  const nbJson = JSON.stringify(n.body);
  assert.ok(!nbJson.includes('17.7231') && !nbJson.includes('83.3013') && !nbJson.includes('MVP Colony'));
  // Trilateration resistance: distances from several probe points all match the public cell centre, not the exact point.
  const { distanceKm: dk, roundKm: rk } = await import('../src/lib/geo.js');
  for (const probe of [{ lat: 17.70, lng: 83.29 }, { lat: 17.75, lng: 83.33 }, { lat: 17.72, lng: 83.34 }]) {
    const pr = await request(app).get('/api/v1/hosts/nearby').query({ ...probe, radiusKm: 15 }).set(bearer(T.c1)).expect(200);
    const it = pr.body.data.items.find((x) => x.hostId === 'host1');
    assert.equal(it.straightLineKm, rk(dk(probe, it.approxArea)));
  }
  await request(app).get('/api/v1/hosts/me').set(bearer(T.c1)).expect(403); // host-only and keyed by caller: no host id to tamper with
  assert.ok(Math.abs(((item.approxArea.lat * 1e4) % 100) - 50) < 1e-6 || Math.abs(((item.approxArea.lat * 1e4) % 100) + 50) < 1e-6); assert.equal(item.address, undefined); // no private data in search
  await request(app).post('/api/v1/admin/hosts/host1/suspend').set(bearer(T.admin)).send({ reason: 'Safety complaint under review' }).expect(200);
  n = await request(app).get('/api/v1/hosts/nearby').query(NEAR).set(bearer(T.c1)).expect(200);
  assert.equal(n.body.data.items.length, 0);
  const audit = await db.collection('auditLogs').get();
  assert.ok(audit.docs.some((d) => d.data().action === 'host.approve') && audit.docs.some((d) => d.data().action === 'host.suspend'));
});

test('compatibility filtering and service area', async () => {
  await approvedHost('host1');
  const c = await request(app).get('/api/v1/hosts/nearby').query({ ...NEAR, connector: 'CCS2' }).set(bearer(T.c1)).expect(200);
  assert.equal(c.body.data.items.length, 0);
  const out = await request(app).get('/api/v1/hosts/nearby').query({ lat: 17.385, lng: 78.4867 }).set(bearer(T.c1)).expect(200);
  assert.equal(out.body.data.serviceArea, null);
});

test('full emergency workflow with location privacy, idempotency and feedback', async () => {
  const th = await approvedHost('host1');
  const body = { hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true, batteryPercent: 8 };
  await request(app).post('/api/v1/requests').set(bearer(T.c1)).send(body).expect(400); // missing idempotency key
  const key = idem();
  const r1 = await request(app).post('/api/v1/requests').set(bearer(T.c1)).set(key).send(body).expect(201);
  const r2 = await request(app).post('/api/v1/requests').set(bearer(T.c1)).set(key).send(body).expect(200);
  assert.equal(r1.body.data.id, r2.body.data.id); // replay returns same request
  await request(app).post('/api/v1/requests').set(bearer(T.c1)).set(idem()).send(body).expect(409); // one active request
  const id = r1.body.data.id;
  assert.equal(r1.body.data.hostLocation, undefined); // hidden before acceptance
  assert.equal(r1.body.data.batteryPercent, 8); assert.equal(r1.body.data.urgent, true);
  const lst = await request(app).get('/api/v1/requests?as=customer').set(bearer(T.c1)).expect(200);
  assert.ok(!JSON.stringify(lst.body).includes('MVP Colony') && lst.body.data.items.every((x) => !x.hostLocation && !x.pin)); // nothing before acceptance
  assert.ok(notifications.some((n) => n.uid === 'host1' && n.type === 'request.new' && n.body.includes('battery 8%, urgent')));
  assert.ok(!JSON.stringify(notifications).includes('MVP Colony')); // no address in push

  // IDOR: another customer cannot see or act on it.
  const t2 = await onboard('cust2', 'customer');
  await request(app).get(`/api/v1/requests/${id}`).set(bearer(t2)).expect(404);
  await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(t2)).send({ action: 'cancel' }).expect(404);
  // Customer cannot accept on behalf of host.
  await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(T.c1)).send({ action: 'accept' }).expect(403);

  const acc = await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(th)).send({ action: 'accept' }).expect(200);
  assert.equal(acc.body.data.status, 'ACCEPTED');
  assert.equal(acc.body.data.hostLocation, undefined); // host's own view has no customer-facing location block
  const cv = await request(app).get(`/api/v1/requests/${id}`).set(bearer(T.c1)).expect(200);
  assert.match(cv.body.data.hostLocation.mapsUrl, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=17\.723100,83\.301300$/);
  await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(th)).send({ action: 'start' }).expect(409); // must arrive first
  await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(T.c1)).send({ action: 'arrive' }).expect(200);
  // Session verification PIN: customer sees it, host never does; wrong PINs are counted and locked out.
  assert.match(cv.body.data.pin, /^\d{4}$/);
  assert.equal(cv.body.data.pinStatus, 'ACTIVE');
  const hv = await request(app).get(`/api/v1/requests/${id}`).set(bearer(th)).expect(200);
  assert.equal(hv.body.data.pin, undefined);
  assert.equal(hv.body.data.pinStatus, 'ACTIVE');
  const pin = cv.body.data.pin, wrong = pin === '0000' ? '1111' : '0000';
  let e = await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(th)).send({ action: 'start' }).expect(400);
  assert.equal(e.body.error.code, 'PIN_REQUIRED');
  for (let i = 0; i < 5; i++) {
    e = await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(th)).send({ action: 'start', pin: wrong });
    assert.equal(e.status, 400); assert.equal(e.body.error.code, 'PIN_INVALID');
  }
  e = await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(th)).send({ action: 'start', pin }).expect(409);
  assert.equal(e.body.error.code, 'PIN_LOCKED'); // even the right PIN is refused once locked
  await request(app).post(`/api/v1/requests/${id}/pin`).set(bearer(th)).expect(404); // host cannot re-issue
  const re = await request(app).post(`/api/v1/requests/${id}/pin`).set(bearer(T.c1)).expect(200);
  assert.equal(re.body.data.pinStatus, 'ACTIVE');
  const started = await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(th)).send({ action: 'start', pin: re.body.data.pin }).expect(200);
  assert.equal(started.body.data.pin, undefined); assert.equal(started.body.data.pinStatus, undefined); // PIN cleared after use
  await request(app).post(`/api/v1/requests/${id}/feedback`).set(bearer(T.c1)).send({ rating: 5 }).expect(409); // not completed yet
  const done = await request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(T.c1)).send({ action: 'complete' }).expect(200);
  assert.equal(done.body.data.status, 'COMPLETED');
  assert.equal(done.body.data.hostLocation, undefined); // hidden again after the visit
  await request(app).post(`/api/v1/requests/${id}/feedback`).set(bearer(T.c1)).send({ rating: 5, comment: 'Quick and safe' }).expect(201);
  await request(app).post(`/api/v1/requests/${id}/feedback`).set(bearer(T.c1)).send({ rating: 1 }).expect(409);
  const h = (await db.collection('hosts').doc('host1').get()).data();
  assert.equal(h.activeSessions, 0); assert.deepEqual(h.rating, { sum: 5, count: 1 });
  const u = (await db.collection('users').doc('cust1').get()).data();
  assert.equal(u.activeRequestId, undefined);
  const hist = await request(app).get('/api/v1/requests').set(bearer(T.c1)).expect(200);
  assert.equal(hist.body.data.items.length, 1);
  assert.deepEqual(hist.body.data.items[0].history.map((e) => e.to), ['REQUESTED', 'ACCEPTED', 'ARRIVED', 'CHARGING', 'COMPLETED']);
  const outbox = await db.collection('sheetsOutbox').get();
  const tabs = new Set(outbox.docs.map((d) => d.data().tab));
  for (const t of ['USERS', 'HOSTS', 'CHARGING_REQUESTS', 'CHARGING_HISTORY', 'FEEDBACK']) assert.ok(tabs.has(t), t);
});

test('concurrent accepts cannot double-book capacity', async () => {
  const th = await approvedHost('host1');
  const t2 = await onboard('cust2', 'customer');
  const body = { hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true };
  const [a, b] = await Promise.all([
    request(app).post('/api/v1/requests').set(bearer(T.c1)).set(idem()).send(body),
    request(app).post('/api/v1/requests').set(bearer(t2)).set(idem()).send(body)]);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  const res = await Promise.all([a, b].map((x) => request(app).post(`/api/v1/requests/${x.body.data.id}/transition`).set(bearer(th)).send({ action: 'accept' })));
  const codes = res.map((x) => x.status).sort();
  assert.deepEqual(codes, [200, 409]);
  assert.equal((await db.collection('hosts').doc('host1').get()).data().activeSessions, 1);
  // Host is now full: new requests are refused.
  const t3 = await onboard('cust3', 'customer');
  await request(app).post('/api/v1/requests').set(bearer(t3)).set(idem()).send(body).expect(409);
});

test('expiry, rejection and alternatives', async () => {
  const th = await approvedHost('host1');
  await approvedHost('host2', { location: { lat: 17.7250, lng: 83.3050 } });
  const body = { hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true };
  const r = await request(app).post('/api/v1/requests').set(bearer(T.c1)).set(idem()).send(body).expect(201);
  await db.collection('requests').doc(r.body.data.id).update({ expiresAt: new Date(Date.now() - 1000) });
  await request(app).post(`/api/v1/requests/${r.body.data.id}/transition`).set(bearer(th)).send({ action: 'accept' }).expect(409);
  const g = await request(app).get(`/api/v1/requests/${r.body.data.id}`).set(bearer(T.c1)).expect(200);
  assert.equal(g.body.data.status, 'EXPIRED');
  const alt = await request(app).get('/api/v1/hosts/nearby').query({ ...NEAR, exclude: 'host1' }).set(bearer(T.c1)).expect(200);
  assert.deepEqual(alt.body.data.items.map((i) => i.hostId), ['host2']);
  const r2 = await request(app).post('/api/v1/requests').set(bearer(T.c1)).set(idem()).send(body).expect(201); // can request again
  await request(app).post(`/api/v1/requests/${r2.body.data.id}/transition`).set(bearer(th)).send({ action: 'reject', reason: 'Charger in use' }).expect(200);
});

test('maintenance mode and minimum app version', async () => {
  const { app: a, settings } = makeApp();
  await settings.update({ maintenance: { enabled: true, message: 'Upgrading' } });
  const m = await request(a).get('/api/v1/me').set(bearer(T.c1)).expect(503);
  assert.equal(m.body.error.code, 'MAINTENANCE');
  await request(a).get('/api/v1/public/config').expect(200);
  await settings.update({ maintenance: { enabled: false, message: '' }, minSupportedVersionCode: 5, latestVersionCode: 5 });
  await request(a).get('/api/v1/me').set(bearer(T.c1)).set('X-App-Platform', 'android').set('X-App-Version-Code', '3').expect(426);
  await request(a).get('/api/v1/me').set(bearer(T.c1)).set('X-App-Platform', 'android').set('X-App-Version-Code', '5').expect(200);
});

test('account deletion is blocked during an active request, then removes data', async () => {
  await approvedHost('host1');
  const r = await request(app).post('/api/v1/requests').set(bearer(T.c1)).set(idem()).send({ hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true }).expect(201);
  await request(app).delete('/api/v1/me').set(bearer(T.c1)).expect(409);
  await request(app).post(`/api/v1/requests/${r.body.data.id}/transition`).set(bearer(T.c1)).send({ action: 'cancel' }).expect(200);
  await request(app).delete('/api/v1/me').set(bearer(T.c1)).expect(200);
  assert.equal((await db.collection('users').doc('cust1').get()).exists, false);
  await request(app).get('/api/v1/me').set(bearer(T.c1)).expect(401); // auth user gone
});

test('support tickets, admin complaint handling and public deletion request', async () => {
  const t = await request(app).post('/api/v1/support/tickets').set(bearer(T.c1)).send({ category: 'unsafe_charging', message: 'Sparks seen at socket' }).expect(201);
  assert.equal(t.body.data.priority, 'URGENT');
  const ov = await request(app).get('/api/v1/admin/overview').set(bearer(T.admin)).expect(200);
  assert.equal(ov.body.data.urgentComplaints, 1);
  await request(app).patch(`/api/v1/admin/complaints/${t.body.data.ticketId}`).set(bearer(T.admin)).send({ status: 'RESOLVED', resolution: 'Host suspended pending inspection' }).expect(200);
  await request(app).post('/api/v1/public/deletion-requests').send({ contact: 'user@example.com' }).expect(202);
  const dr = await request(app).get('/api/v1/admin/deletion-requests').set(bearer(T.admin)).expect(200);
  assert.equal(dr.body.data.items.length, 1);
});

test('settings validation and audit', async () => {
  await request(app).put('/api/v1/admin/settings').set(bearer(T.admin)).send({ minSupportedVersionCode: 9, latestVersionCode: 3 }).expect(400);
  await request(app).put('/api/v1/admin/settings').set(bearer(T.admin)).send({ featureFlags: { payments: false, phoneLogin: true } }).expect(200);
  await request(app).put('/api/v1/admin/settings').set(bearer(T.c1)).send({ featureFlags: {} }).expect(403);
  const cfg = await request(app).get('/api/v1/public/config').expect(200);
  assert.equal(cfg.body.data.featureFlags.phoneLogin, false); // provider not configured → never advertised
  assert.equal(cfg.body.data.serviceAreas[0].id, 'vizag');
});

test('CORS allows only configured origins', async () => {
  const ok = await request(app).get('/api/v1/health').set('Origin', 'https://nearvolt-ev-prod.web.app');
  assert.equal(ok.headers['access-control-allow-origin'], 'https://nearvolt-ev-prod.web.app');
  const bad = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
});
