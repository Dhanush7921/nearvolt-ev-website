// Session PIN security: atomicity, concurrency, replay, expiry, lockout, authorization, migration, secrecy.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { db, makeApp, clearAll, tokenFor, hostBody, CHECKLIST, NEAR, notifications } from './helpers.js';

let app;
const T = {};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const V11 = { 'X-App-Platform': 'android', 'X-App-Version-Code': '2' };
const V10 = { 'X-App-Platform': 'android', 'X-App-Version-Code': '1' };
const body = { hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true, batteryPercent: 30 };

async function onboard(uid, role) {
  const t = await tokenFor(uid);
  await request(app).put('/api/v1/me/consents').set(bearer(t)).send({ termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: true }).expect(200);
  await request(app).put('/api/v1/me/profile').set(bearer(t)).send({ name: uid, vehicle: { type: 'car', connector: 'TYPE2_AC' } }).expect(200);
  await request(app).post('/api/v1/me/role').set(bearer(t)).send({ role }).expect(200);
  return tokenFor(uid);
}
async function approvedHost(uid) {
  const t = await onboard(uid, 'host');
  await request(app).put('/api/v1/hosts/me').set(bearer(t)).send(hostBody()).expect(200);
  await db.collection('hosts').doc(uid).update({ photos: ['a', 'b'], documents: ['c'] });
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(t)).expect(200);
  await request(app).post(`/api/v1/admin/hosts/${uid}/approve`).set(bearer(T.admin)).send({ checklist: CHECKLIST, inspectorName: 'K. Rao (licensed electrician)', inspectionDate: '2026-11-20' }).expect(200);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(t)).send({ available: true }).expect(200);
  return t;
}
const tr = (id, t, b, h = V11) => request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(t)).set(h).send(b);
/** Creates a request and drives it to ARRIVED; returns { id, pin }. */
async function arrived() {
  const r = await request(app).post('/api/v1/requests').set(bearer(T.c)).set(V11).set({ 'Idempotency-Key': randomUUID() }).send(body).expect(201);
  const id = r.body.data.id;
  await tr(id, T.h, { action: 'accept' }).expect(200);
  await tr(id, T.c, { action: 'arrive' }).expect(200);
  const v = await request(app).get(`/api/v1/requests/${id}`).set(bearer(T.c)).expect(200);
  return { id, pin: v.body.data.pin };
}
const wrongOf = (pin) => (pin === '0000' ? '1111' : '0000');

before(async () => { ({ app } = makeApp()); });
beforeEach(async () => {
  await clearAll();
  T.admin = await tokenFor('admin1', { admin: true });
  T.c = await onboard('cust1', 'customer');
  T.h = await approvedHost('host1');
});

test('concurrent correct-PIN starts: exactly one succeeds, capacity counted once; replay is refused', async () => {
  const { id, pin } = await arrived();
  const rs = await Promise.all(Array.from({ length: 8 }, () => tr(id, T.h, { action: 'start', pin })));
  const okN = rs.filter((r) => r.status === 200).length;
  assert.equal(okN, 1, `statuses: ${rs.map((r) => r.status)}`);
  assert.ok(rs.filter((r) => r.status !== 200).every((r) => [409, 503].includes(r.status)));
  const doc = (await db.collection('requests').doc(id).get()).data();
  assert.equal(doc.status, 'CHARGING'); assert.equal(doc.pin, undefined);
  assert.equal((await db.collection('hosts').doc('host1').get()).data().activeSessions, 1);
  const replay = await tr(id, T.h, { action: 'start', pin }).expect(409);
  assert.equal(replay.body.error.code, 'INVALID_STATE');
});

test('concurrent wrong-PIN burst is durably counted and locks; then even the right PIN is refused', async () => {
  const { id, pin } = await arrived();
  const rs = await Promise.all(Array.from({ length: 10 }, () => tr(id, T.h, { action: 'start', pin: wrongOf(pin) })));
  assert.ok(rs.every((r) => r.status === 400 || r.status === 409 || r.status === 503));
  const doc = (await db.collection('requests').doc(id).get()).data();
  assert.equal(doc.status, 'ARRIVED'); // never started
  assert.ok(doc.pin.attempts >= 5 && doc.pin.attempts <= 10);
  const e = await tr(id, T.h, { action: 'start', pin }).expect(409);
  assert.equal(e.body.error.code, 'PIN_LOCKED');
});

test('expired PIN is refused; refresh issues a different, working PIN; refresh races with start safely', async () => {
  const { id, pin } = await arrived();
  await db.collection('requests').doc(id).update({ 'pin.expiresAt': Timestamp.fromMillis(Date.now() - 1000) });
  let e = await tr(id, T.h, { action: 'start', pin }).expect(409);
  assert.equal(e.body.error.code, 'PIN_EXPIRED');
  const cv = await request(app).get(`/api/v1/requests/${id}`).set(bearer(T.c)).expect(200);
  assert.equal(cv.body.data.pinStatus, 'EXPIRED'); assert.equal(cv.body.data.pin, undefined);
  const re = await request(app).post(`/api/v1/requests/${id}/pin`).set(bearer(T.c)).expect(200);
  assert.notEqual(re.body.data.pin, pin);
  // The old PIN can never start the session after a refresh, even if both requests race.
  const [oldTry, refresh] = await Promise.all([tr(id, T.h, { action: 'start', pin }), request(app).post(`/api/v1/requests/${id}/pin`).set(bearer(T.c))]);
  assert.notEqual(oldTry.status, 200);
  const latest = refresh.status === 200 ? refresh.body.data.pin : re.body.data.pin;
  await tr(id, T.h, { action: 'start', pin: latest }).expect(200);
});

test('authorization: only the host starts, only the customer sees and refreshes the PIN', async () => {
  const { id, pin } = await arrived();
  const other = await onboard('cust2', 'customer');
  await tr(id, T.c, { action: 'start', pin }).expect(403);            // customer cannot start
  await tr(id, other, { action: 'start', pin }).expect(404);          // stranger: no oracle
  await request(app).post(`/api/v1/requests/${id}/pin`).set(bearer(T.h)).expect(404);
  await request(app).post(`/api/v1/requests/${id}/pin`).set(bearer(other)).expect(404);
  await request(app).get(`/api/v1/requests/${id}`).set(bearer(other)).expect(404);
  const hv = await request(app).get(`/api/v1/requests/${id}`).set(bearer(T.h)).expect(200);
  assert.equal(hv.body.data.pin, undefined);
  const missing = await tr(id, T.h, { action: 'start' }).expect(400);
  assert.equal(missing.body.error.code, 'PIN_REQUIRED');
  for (let i = 0; i < 3; i++) await request(app).post(`/api/v1/requests/${id}/pin`).set(bearer(T.c)).expect(200);
  const lim = await request(app).post(`/api/v1/requests/${id}/pin`).set(bearer(T.c)).expect(409);
  assert.equal(lim.body.error.code, 'PIN_REISSUE_LIMIT');
});

test('missing PIN on a V1.1 request is never a bypass', async () => {
  const { id } = await arrived();
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection('requests').doc(id).update({ pin: FieldValue.delete() });
  const e = await tr(id, T.h, { action: 'start' }).expect(409);
  assert.equal(e.body.error.code, 'PIN_UNAVAILABLE');
  assert.equal((await db.collection('requests').doc(id).get()).data().status, 'ARRIVED');
});

test('migration: legacy V1.0 sessions finish without a PIN; V1.0 clients cannot open or accept new requests', async () => {
  // A request accepted by the V1.0 server: no pin, no pinPolicy.
  const { id } = await arrived();
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection('requests').doc(id).update({ pin: FieldValue.delete(), pinPolicy: FieldValue.delete() });
  await tr(id, T.h, { action: 'start' }, V10).expect(200);              // legacy session continues on a V1.0 app
  await tr(id, T.c, { action: 'complete' }, V10).expect(200);
  // New work from a V1.0 build is refused with an explicit upgrade code.
  const c = await request(app).post('/api/v1/requests').set(bearer(T.c)).set(V10).set({ 'Idempotency-Key': randomUUID() }).send(body).expect(426);
  assert.equal(c.body.error.code, 'UPGRADE_REQUIRED');
  const r = await request(app).post('/api/v1/requests').set(bearer(T.c)).set(V11).set({ 'Idempotency-Key': randomUUID() }).send(body).expect(201);
  const a = await tr(r.body.data.id, T.h, { action: 'accept' }, V10).expect(426);
  assert.equal(a.body.error.code, 'UPGRADE_REQUIRED');
  await tr(r.body.data.id, T.h, { action: 'accept' }, V11).expect(200);
});

test('PIN never leaves the server through notifications, Sheets outbox, history or admin views', async () => {
  const { id, pin } = await arrived();
  await tr(id, T.h, { action: 'start', pin: wrongOf(pin) }).expect(400);
  await tr(id, T.h, { action: 'start', pin }).expect(200);
  const outbox = await db.collection('sheetsOutbox').get();
  const blobs = [JSON.stringify(notifications), JSON.stringify(outbox.docs.map((d) => d.data())),
    JSON.stringify((await db.collection('requests').doc(id).get()).data().history),
    JSON.stringify((await request(app).get('/api/v1/admin/requests?limit=25').set(bearer(T.admin)).expect(200)).body),
    JSON.stringify((await request(app).get('/api/v1/admin/analytics?days=7').set(bearer(T.admin)).expect(200)).body)];
  for (const b of blobs) assert.ok(!b.includes(`"${pin}"`) && !/"pin"\s*:/.test(b), b.slice(0, 200));
});
