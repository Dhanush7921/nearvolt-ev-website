// V1.4 dual role: capabilities, mode isolation, self-booking, conflicts, server electrical gate, old clients, migration, deletion.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db, auth, makeApp, clearAll, tokenFor, hostBody, CHECKLIST, NEAR, VIZAG } from './helpers.js';

let app;
const T = {};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const V14 = { 'X-App-Platform': 'android', 'X-App-Version-Code': '6' };
const V13 = { 'X-App-Platform': 'android', 'X-App-Version-Code': '5' };
const reqBody = (over = {}) => ({ hostId: 'host1', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: NEAR, compatibilityConfirmed: true, ...over });
const create = (t, b, h = V14) => request(app).post('/api/v1/requests').set(bearer(t)).set(h).set({ 'Idempotency-Key': randomUUID() }).send(b);
const tr = (id, t, b) => request(app).post(`/api/v1/requests/${id}/transition`).set(bearer(t)).set(V14).send(b);

async function onboard(uid, role) {
  const t = await tokenFor(uid);
  await request(app).put('/api/v1/me/consents').set(bearer(t)).send({ termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: true }).expect(200);
  await request(app).put('/api/v1/me/profile').set(bearer(t)).send({ name: uid, vehicle: { type: 'car', connector: 'TYPE2_AC' } }).expect(200);
  await request(app).post('/api/v1/me/role').set(bearer(t)).send({ role }).expect(200);
  return tokenFor(uid);
}
async function listAndApprove(uid, t, body = hostBody()) {
  await request(app).put('/api/v1/hosts/me').set(bearer(t)).send(body).expect(200);
  await db.collection('hosts').doc(uid).update({ photos: ['a', 'b'], documents: ['c'] });
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(t)).expect(200);
  await request(app).post(`/api/v1/admin/hosts/${uid}/approve`).set(bearer(T.admin)).send({ checklist: CHECKLIST, inspectorName: 'K. Rao (licensed electrician)', inspectionDate: '2026-11-20' }).expect(200);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(t)).send({ available: true }).expect(200);
}
const addCap = async (uid, t, capability) => {
  const r = await request(app).post('/api/v1/me/capabilities').set(bearer(t)).send({ capability }).expect(200);
  return { r, t: await tokenFor(uid) };   // refreshed token carries the new `roles` claim
};

before(async () => { ({ app } = makeApp()); });
beforeEach(async () => {
  await clearAll();
  T.admin = await tokenFor('admin1', { admin: true });
  T.h = await onboard('host1', 'host');
  await listAndApprove('host1', T.h);
  T.c = await onboard('cust1', 'customer');
});

test('existing driver becomes a host on the same UID: pending → rejected → resubmitted → approved; no auto-approval', async () => {
  await request(app).get('/api/v1/hosts/me').set(bearer(T.c)).expect(403);   // no host capability yet
  const { r, t } = await addCap('cust1', T.c, 'host');
  assert.deepEqual(r.body.data.capabilities, { driver: true, host: true });
  const me = await request(app).get('/api/v1/me').set(bearer(t)).expect(200);
  assert.equal(me.body.data.role, 'customer');   // legacy primary role preserved for old clients
  assert.deepEqual(me.body.data.capabilities, { driver: true, host: true });
  assert.equal((await request(app).get('/api/v1/hosts/me').set(bearer(t)).expect(200)).body.data.status, 'DRAFT');
  await request(app).put('/api/v1/hosts/me').set(bearer(t)).send(hostBody({ location: VIZAG })).expect(200);
  await db.collection('hosts').doc('cust1').update({ photos: ['a', 'b'], documents: ['c'] });
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(t)).expect(200);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(t)).send({ available: true }).expect(409);   // pending: cannot go online
  await request(app).post('/api/v1/admin/hosts/cust1/reject').set(bearer(T.admin)).send({ reason: 'Earthing photo unclear' }).expect(200);
  assert.equal((await request(app).get('/api/v1/hosts/me').set(bearer(t)).expect(200)).body.data.status, 'REJECTED');
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(t)).send({ available: true }).expect(409);
  await request(app).post('/api/v1/hosts/me/submit').set(bearer(t)).expect(200);
  await request(app).post('/api/v1/admin/hosts/cust1/approve').set(bearer(T.admin)).send({ checklist: CHECKLIST, inspectorName: 'K. Rao (licensed electrician)', inspectionDate: '2026-11-20' }).expect(200);
  await request(app).put('/api/v1/hosts/me/availability').set(bearer(t)).send({ available: true }).expect(200);
  // Still a driver: can request charging from another host.
  await create(t, reqBody()).expect(201);
  // One user record, one Sheets USERS key.
  const outbox = await db.collection('sheetsOutbox').where('tab', '==', 'USERS').where('key', '==', 'cust1').get();
  assert.ok(outbox.size >= 1);
  assert.equal((await db.collection('users').where('name', '==', 'cust1').get()).size, 1);
});

test('existing host enables driver mode and requests another host; host-only token cannot create requests', async () => {
  T.h2 = await onboard('host2', 'host');
  await create(T.h2, reqBody()).expect(403);   // MODE_NOT_ENABLED
  const { t } = await addCap('host2', T.h2, 'driver');
  const r = await create(t, reqBody()).expect(201);
  assert.equal(r.body.data.role, 'customer');
  // Session isolation: the request appears in host2's driver list, and in host1's incoming list, not host2's incoming list.
  assert.equal((await request(app).get('/api/v1/requests').set(bearer(t)).expect(200)).body.data.items.length, 1);
  assert.equal((await request(app).get('/api/v1/requests?as=host').set(bearer(t)).expect(200)).body.data.items.length, 0);
  assert.equal((await request(app).get('/api/v1/requests?as=host').set(bearer(T.h)).expect(200)).body.data.items.length, 1);
});

test('capability endpoint cannot escalate privileges and is idempotent', async () => {
  await request(app).post('/api/v1/me/capabilities').set(bearer(T.c)).send({ capability: 'admin' }).expect(400);
  await request(app).post('/api/v1/me/capabilities').set(bearer(T.c)).send({ capability: 'host', admin: true }).expect(400);
  await addCap('cust1', T.c, 'host');
  const again = await addCap('cust1', T.c, 'host');
  assert.equal(again.r.body.data.changed, false);
  const claims = (await auth.getUser('cust1')).customClaims;
  assert.equal(claims.admin, undefined); assert.equal(claims.role, 'customer'); assert.deepEqual(claims.roles, ['customer', 'host']);
  // Admin claim on another user is preserved when that user adds a capability.
  await auth.setCustomUserClaims('host1', { ...(await auth.getUser('host1')).customClaims, admin: true });
  await addCap('host1', await tokenFor('host1'), 'driver');
  assert.equal((await auth.getUser('host1')).customClaims.admin, true);
  // Not onboarded: refused.
  const fresh = await tokenFor('nobody');
  await request(app).post('/api/v1/me/capabilities').set(bearer(fresh)).send({ capability: 'host' }).expect(400);
});

test('self-booking is rejected and own listing never appears in discovery', async () => {
  const { t } = await addCap('host1', T.h, 'driver');
  await create(t, reqBody({ hostId: 'host1' })).expect(400);
  const n = await request(app).get('/api/v1/hosts/nearby').set(bearer(t)).query({ lat: NEAR.lat, lng: NEAR.lng }).expect(200);
  assert.ok(n.body.data.items.every((h) => h.hostId !== 'host1'));
});

test('conflicting operations: no driver request while hosting; no accept while on own driver visit', async () => {
  const { t: hostAsDriver } = await addCap('host1', T.h, 'driver');
  T.h2 = await onboard('host2', 'host');
  await listAndApprove('host2', T.h2, hostBody({ location: { lat: 17.7350, lng: 83.3150 } }));
  // host1 drives to host2 and is accepted → host1 cannot accept an incoming request meanwhile.
  const own = (await create(hostAsDriver, reqBody({ hostId: 'host2' })).expect(201)).body.data.id;
  await tr(own, T.h2, { action: 'accept' }).expect(200);
  const incoming = (await create(T.c, reqBody()).expect(201)).body.data.id;
  assert.equal((await tr(incoming, hostAsDriver, { action: 'accept' }).expect(409)).body.error.code, 'DRIVING_ACTIVE');
  await tr(own, hostAsDriver, { action: 'cancel' }).expect(200);
  await tr(incoming, hostAsDriver, { action: 'accept' }).expect(200);
  // host1 now hosts an active session → cannot create a driver request.
  assert.equal((await create(hostAsDriver, reqBody({ hostId: 'host2' })).expect(409)).body.error.code, 'HOSTING_ACTIVE');
});

test('server electrical gate: wall sockets never auto-authorised; old clients cannot bypass', async () => {
  const sock = reqBody({ connector: 'DOMESTIC_15A' });
  // host1: wallbox 32 A / 7.2 kW also listing a 15 A socket → exceeds socket rating.
  assert.equal((await create(T.c, { ...sock, socketConfirmation: true }).expect(409)).body.error.code, 'SOCKET_OVER_RATING');
  // A proper socket host: 230 V × 13 A, 3 kW, single phase.
  const socketEq = { chargerType: 'socket', connectors: ['DOMESTIC_15A'], vehicleTypes: ['car', 'two_wheeler'], voltageV: 230, currentA: 13, phase: 'single', powerKw: 3, capacity: 1 };
  T.s = await onboard('sock1', 'host');
  await listAndApprove('sock1', T.s, hostBody({ location: { lat: 17.7320, lng: 83.3120 }, equipment: socketEq,
    selfDeclaration: { ...hostBody().selfDeclaration, dedicatedCircuit: false } }));
  const s = { ...sock, hostId: 'sock1' };
  assert.equal((await create(T.c, { ...s, socketConfirmation: true }).expect(409)).body.error.code, 'SOCKET_CIRCUIT_UNCONFIRMED');
  const n = await request(app).get('/api/v1/hosts/nearby').set(bearer(T.c)).query({ lat: NEAR.lat, lng: NEAR.lng }).expect(200);
  const listed = n.body.data.items.find((h) => h.hostId === 'sock1');
  assert.equal(listed.dedicatedCircuit, false); assert.equal(listed.currentA, 13);
  await db.collection('hosts').doc('sock1').update({ 'selfDeclaration.dedicatedCircuit': true });
  // Old client (no socketConfirmation field) → refused, regardless of version header.
  assert.equal((await create(T.c, s, V13).expect(409)).body.error.code, 'SOCKET_CONFIRMATION_REQUIRED');
  assert.equal((await create(T.c, s, {}).expect(409)).body.error.code, 'SOCKET_CONFIRMATION_REQUIRED');
  const id = (await create(T.c, { ...s, socketConfirmation: true }).expect(201)).body.data.id;
  assert.equal((await db.collection('requests').doc(id).get()).data().socketConfirmed, true);
  // Listing changed after the request (dedicated circuit withdrawn) → acceptance re-check refuses.
  await db.collection('hosts').doc('sock1').update({ 'selfDeclaration.dedicatedCircuit': false });
  assert.equal((await tr(id, T.s, { action: 'accept' }).expect(409)).body.error.code, 'SOCKET_CIRCUIT_UNCONFIRMED');
  await db.collection('hosts').doc('sock1').update({ 'selfDeclaration.dedicatedCircuit': true });
  await tr(id, T.s, { action: 'accept' }).expect(200);
  // Incomplete electrical data blocks non-socket requests too.
  await db.collection('hosts').doc('host1').update({ 'equipment.phase': null });
  const c2 = await onboard('cust2', 'customer');
  assert.equal((await create(c2, reqBody()).expect(409)).body.error.code, 'ELECTRICAL_SPEC_INCOMPLETE');
});

test('migration: legacy role-only tokens and records keep working; config advertises capabilities', async () => {
  const legacy = await tokenFor('legacy1');
  await request(app).put('/api/v1/me/consents').set(bearer(legacy)).send({ termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: true }).expect(200);
  await request(app).put('/api/v1/me/profile').set(bearer(legacy)).send({ name: 'legacy1', vehicle: { type: 'car', connector: 'TYPE2_AC' } }).expect(200);
  await db.collection('users').doc('legacy1').set({ role: 'customer' }, { merge: true });   // pre-V1.4 record: no capabilities field
  const t = await tokenFor('legacy1', { role: 'customer' });                               // pre-V1.4 claims: no roles array
  assert.deepEqual((await request(app).get('/api/v1/me').set(bearer(t)).expect(200)).body.data.capabilities, { driver: true, host: false });
  await create(t, reqBody()).expect(201);
  await request(app).get('/api/v1/hosts/me').set(bearer(t)).expect(403);
  const cfg = await request(app).get('/api/v1/public/config').expect(200);
  assert.equal(cfg.body.data.capabilities.dualRole, true); assert.equal(cfg.body.data.capabilities.socketGate, true);
  const users = await request(app).get('/api/v1/admin/users').set(bearer(T.admin)).expect(200);
  assert.deepEqual(users.body.data.items.find((u) => u.uid === 'legacy1').capabilities, { driver: true, host: false });
});

test('deleting a dual-role account removes both modes once', async () => {
  const { t } = await addCap('cust1', T.c, 'host');
  await request(app).put('/api/v1/hosts/me').set(bearer(t)).send(hostBody({ location: VIZAG })).expect(200);
  await request(app).delete('/api/v1/me').set(bearer(t)).expect(200);
  assert.equal((await db.collection('users').doc('cust1').get()).exists, false);
  assert.equal((await db.collection('hosts').doc('cust1').get()).data().status, 'DELETED');
  await assert.rejects(auth.getUser('cust1'));
});
