import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { db, makeApp, clearAll, tokenFor, hostBody, CHECKLIST, NEAR } from './helpers.js';
import { createShedder, isPriority, memoryLimiter } from '../src/lib/overload.js';
import { loadConfig } from '../src/config.js';
import { syncOutbox, faultySheetsClient, backlog } from '../src/services/sheets.js';

beforeEach(clearAll);
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

async function onboard(app, uid, role) {
  let t = await tokenFor(uid);
  await request(app).put('/api/v1/me/consents').set(bearer(t)).send({ termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: true }).expect(200);
  await request(app).put('/api/v1/me/profile').set(bearer(t)).send({ name: uid, vehicle: { type: 'car', connector: 'TYPE2_AC' } }).expect(200);
  await request(app).post('/api/v1/me/role').set(bearer(t)).send({ role }).expect(200);
  return tokenFor(uid);
}

test('priority classification: emergency paths are never shed', () => {
  const r = (method, path) => ({ method, path });
  assert.equal(isPriority(r('POST', '/api/v1/requests')), true);
  assert.equal(isPriority(r('POST', '/api/v1/requests/abc/transition')), true);
  assert.equal(isPriority(r('POST', '/api/v1/auth/otp/verify')), true);
  assert.equal(isPriority(r('GET', '/api/v1/hosts/nearby')), false);
  assert.equal(isPriority(r('GET', '/api/v1/requests')), false);
});

test('shedder rejects low-priority work when saturated, keeps emergency work', async () => {
  const app = express();
  app.use(createShedder({ maxInflight: 1 }));
  let release; const hold = new Promise((r) => { release = r; });
  app.get('/api/v1/hosts/nearby', async (_q, res) => { await hold; res.json({ ok: true }); });
  app.post('/api/v1/requests', (_q, res) => res.json({ ok: true }));
  const first = request(app).get('/api/v1/hosts/nearby').then((x) => x);
  await new Promise((r) => setTimeout(r, 50));
  const shed = await request(app).get('/api/v1/hosts/nearby');
  assert.equal(shed.status, 503); assert.equal(shed.body.error.code, 'OVERLOADED'); assert.equal(shed.headers['retry-after'], '2');
  await request(app).post('/api/v1/requests').expect(200); // priority passes even when saturated
  release(); assert.equal((await first).status, 200);
});

test('memory limiter bursts then throttles', () => {
  const allow = memoryLimiter({ capacity: 3, refillPerSec: 0.0001 });
  assert.deepEqual([1, 2, 3, 4].map(() => allow('u')), [true, true, true, false]);
  assert.equal(allow('other'), true);
});

test('test switches are refused in prod', () => {
  const base = { NODE_ENV: 'production', APP_ENV: 'prod', CORS_ORIGINS: 'https://x.web.app', INTERNAL_OIDC_AUDIENCE: 'a', INTERNAL_OIDC_SA_EMAIL: 's@x' };
  assert.throws(() => loadConfig({ ...base, OTP_PROVIDER: 'mock' }), /not allowed in prod/);
  assert.throws(() => loadConfig({ ...base, FAULT_SHEETS: 'true' }), /not allowed in prod/);
  assert.equal(loadConfig({ NODE_ENV: 'test', APP_ENV: 'staging', OTP_PROVIDER: 'mock', OTP_HASH_SALT: 's' }).phoneOtpEnabled, true);
});

test('writes kick the Cloud Tasks sync once per window', async () => {
  let kicks = 0;
  const kicker = { enabled: true, kick: async () => { kicks++; return true; } };
  const { app } = makeApp({}, { kicker });
  const t = await tokenFor('k1');
  await request(app).put('/api/v1/me/consents').set(bearer(t)).send({ termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: true }).expect(200);
  assert.equal(kicks, 0); // consent writes no Sheets rows
  await request(app).put('/api/v1/me/profile').set(bearer(t)).send({ name: 'K One' }).expect(200);
  assert.equal(kicks, 1);
});

test('Sheets outage: bookings unaffected, nothing lost, backlog drains after recovery', async () => {
  const { app } = makeApp();
  const admin = await tokenFor('admin1', { admin: true });
  const th = await onboard(app, 'host1', 'host');
  await request(app).put('/api/v1/hosts/me').set(bearer(th)).send(hostBody()).expect(200);
  await db.collection('hosts').doc('host1').update({ photos: ['a', 'b'], documents: ['c'] });
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(th)).expect(200);
  await request(app).post('/api/v1/admin/hosts/host1/approve').set(bearer(admin)).send({ checklist: CHECKLIST, inspectorName: 'K Rao', inspectionDate: '2026-11-20' }).expect(200);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(th)).send({ available: true }).expect(200);
  const tc = await onboard(app, 'cust1', 'customer');
  // Outage: sync fails repeatedly
  for (let i = 0; i < 3; i++) assert.equal((await syncOutbox({ db, client: faultySheetsClient() })).error, true);
  const r = await request(app).post('/api/v1/requests').set(bearer(tc)).set('Idempotency-Key', randomUUID())
    .send({ hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true });
  assert.equal(r.status, 201); // emergency request accepted during the outage
  const before = (await backlog(db)).pending;
  assert.ok(before > 0);
  const sheet = {};
  const okClient = { readKeys: async (t) => (sheet[t] || []).map((x) => x[0]), writeRows: async (u, a) => { for (const [t, rows] of Object.entries(a)) (sheet[t] ||= []).push(...rows); for (const x of u) sheet[x.tab][x.rowNumber - 2] = x.values; } };
  let guard = 0; while ((await backlog(db)).pending > 0 && guard++ < 10) await syncOutbox({ db, client: okClient });
  assert.equal((await backlog(db)).pending, 0);
  assert.ok(sheet.CHARGING_REQUESTS.some((row) => row[0] === r.body.data.id));
  const keys = Object.values(sheet).flatMap((rows) => rows.map((x) => x[0]));
  assert.equal(new Set(Object.entries(sheet).flatMap(([t, rows]) => rows.map((x) => `${t}:${x[0]}`))).size, keys.length); // no duplicate rows
});

test('20 customers race for a host with capacity 2: exactly 2 accepted, counters consistent', async () => {
  const { app } = makeApp();
  const admin = await tokenFor('admin1', { admin: true });
  const th = await onboard(app, 'host1', 'host');
  await request(app).put('/api/v1/hosts/me').set(bearer(th)).send(hostBody({ equipment: { ...hostBody().equipment, capacity: 2 } })).expect(200);
  await db.collection('hosts').doc('host1').update({ photos: ['a', 'b'], documents: ['c'] });
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(th)).expect(200);
  await request(app).post('/api/v1/admin/hosts/host1/approve').set(bearer(admin)).send({ checklist: CHECKLIST, inspectorName: 'K Rao', inspectionDate: '2026-11-20' }).expect(200);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(th)).send({ available: true }).expect(200);
  const tokens = await Promise.all(Array.from({ length: 20 }, (_, i) => onboard(app, `c${i}`, 'customer')));
  const body = { hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true };
  const created = await Promise.all(tokens.map((t) => request(app).post('/api/v1/requests').set(bearer(t)).set('Idempotency-Key', randomUUID()).send(body)));
  const ids = created.filter((x) => x.status === 201).map((x) => x.body.data.id);
  assert.equal(ids.length, 20);
  const acc = await Promise.all(ids.map((id) => request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(th)).send({ action: 'accept' })));
  assert.equal(acc.filter((x) => x.status === 200).length, 2);
  assert.ok(acc.filter((x) => x.status !== 200).every((x) => x.status === 409));
  const h = (await db.collection('hosts').doc('host1').get()).data();
  assert.equal(h.activeSessions, 2);
  const accepted = await db.collection('requests').where('status', '==', 'ACCEPTED').get();
  assert.equal(accepted.size, 2);
});

test('push provider outage: requests still succeed, notifications kept in-app', async () => {
  const { createNotifier } = await import('../src/services/notify.js');
  const notify = createNotifier({ db, messaging: { sendEachForMulticast: async () => { throw new Error('FAULT_FCM'); } } });
  const { app } = makeApp({}, { notify });
  const admin = await tokenFor('admin1', { admin: true });
  const th = await onboard(app, 'host1', 'host');
  await db.collection('users').doc('host1').collection('devices').doc('fake-device-token-0123456789').set({ platform: 'android' });
  await request(app).put('/api/v1/hosts/me').set(bearer(th)).send(hostBody()).expect(200);
  await db.collection('hosts').doc('host1').update({ photos: ['a', 'b'], documents: ['c'] });
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(th)).expect(200);
  await request(app).post('/api/v1/admin/hosts/host1/approve').set(bearer(admin)).send({ checklist: CHECKLIST, inspectorName: 'K Rao', inspectionDate: '2026-11-20' }).expect(200);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(th)).send({ available: true }).expect(200);
  const tc = await onboard(app, 'cust1', 'customer');
  const r = await request(app).post('/api/v1/requests').set(bearer(tc)).set('Idempotency-Key', randomUUID())
    .send({ hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true });
  assert.equal(r.status, 201);
  await new Promise((s) => setTimeout(s, 300));
  const inbox = await db.collection('users').doc('host1').collection('notifications').where('type', '==', 'request.new').get();
  assert.equal(inbox.size, 1); // in-app notification stored even though push failed
});
