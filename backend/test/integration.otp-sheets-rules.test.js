import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth, makeApp, clearAll, tokenFor, PROJECT } from './helpers.js';
import { enqueue } from '../src/services/outbox.js';
import { syncOutbox, reconcile } from '../src/services/sheets.js';
import { hitLimit } from '../src/lib/limiter.js';

const OTP_ENV = { MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't', OTP_HASH_SALT: 'salt-for-tests' };
function fakeOtp() {
  const sent = new Map();
  return { sent, send: async (p) => { sent.set(p, '482913'); return { ok: true }; }, verify: async (p, o) => ({ ok: sent.get(p) === o }) };
}
beforeEach(clearAll);

test('phone OTP: disabled without provider credentials', async () => {
  const { app } = makeApp();
  const r = await request(app).post('/api/v1/auth/otp/send').send({ phone: '9876543210' }).expect(503);
  assert.equal(r.body.error.code, 'PHONE_AUTH_DISABLED');
});

test('phone OTP: send, cooldown, verify → custom token, replay rejected', async () => {
  const otp = fakeOtp();
  const { app } = makeApp(OTP_ENV, { otp });
  await request(app).post('/api/v1/auth/otp/send').send({ phone: '12345' }).expect(400);
  await request(app).post('/api/v1/auth/otp/send').send({ phone: '98765 43210' }).expect(200);
  await request(app).post('/api/v1/auth/otp/send').send({ phone: '9876543210' }).expect(429); // cooldown
  await request(app).post('/api/v1/auth/otp/verify').send({ phone: '9876543210', otp: '000000' }).expect(400);
  const v = await request(app).post('/api/v1/auth/otp/verify').send({ phone: '9876543210', otp: '482913' }).expect(200);
  assert.ok(v.body.data.customToken);
  await request(app).post('/api/v1/auth/otp/verify').send({ phone: '9876543210', otp: '482913' }).expect(400); // replay
  const u = await auth.getUserByPhoneNumber('+919876543210');
  assert.ok(u.uid);
  const throttle = await db.collection('otpThrottle').get();
  assert.ok(!JSON.stringify(throttle.docs.map((d) => d.data())).includes('9876543210')); // only hashed keys
  assert.ok(!JSON.stringify(throttle.docs.map((d) => d.id)).includes('9876543210'));
});

test('phone OTP: lockout after 5 wrong codes', async () => {
  const { app } = makeApp(OTP_ENV, { otp: fakeOtp() });
  await request(app).post('/api/v1/auth/otp/send').send({ phone: '9123456789' }).expect(200);
  for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/otp/verify').send({ phone: '9123456789', otp: '111111' }).expect(400);
  await request(app).post('/api/v1/auth/otp/verify').send({ phone: '9123456789', otp: '482913' }).expect(429);
});

test('phone OTP: linking refuses a number owned by another account', async () => {
  const otp = fakeOtp();
  const { app } = makeApp(OTP_ENV, { otp });
  await auth.createUser({ uid: 'owner', phoneNumber: '+919000000001' });
  const t = await tokenFor('other');
  await request(app).post('/api/v1/auth/otp/send').send({ phone: '9000000001' }).expect(200);
  const r = await request(app).post('/api/v1/auth/otp/verify').set('Authorization', `Bearer ${t}`).send({ phone: '9000000001', otp: '482913' }).expect(409);
  assert.equal(r.body.error.code, 'PHONE_IN_USE');
});

test('distributed limiter blocks after limit', async () => {
  for (let i = 0; i < 3; i++) await hitLimit(db, 'unit_k', 3, 60);
  await assert.rejects(() => hitLimit(db, 'unit_k', 3, 60), /Too many/);
});

test('sheets outbox: keyed upsert, collapse, retry on outage, reconcile', async () => {
  const sheet = { USERS: [] };
  let down = true;
  const client = {
    readKeys: async (tab) => (sheet[tab] || []).map((r) => r[0]),
    writeRows: async (updates, appends) => {
      if (down) throw new Error('Sheets 503');
      for (const u of updates) sheet[u.tab][u.rowNumber - 2] = u.values;
      for (const [tab, rows] of Object.entries(appends)) (sheet[tab] ||= []).push(...rows);
    },
  };
  await enqueue(db, null, 'USERS', 'uid1', { uid: 'uid1', name: 'First', role: 'customer' });
  await new Promise((r) => setTimeout(r, 20));
  await enqueue(db, null, 'USERS', 'uid1', { uid: 'uid1', name: '=EVIL()', role: 'customer' });
  await enqueue(db, null, 'USERS', 'uid2', { uid: 'uid2', name: 'Second', role: 'host' });
  await new Promise((r) => setTimeout(r, 50));
  const fail = await syncOutbox({ db, client });
  assert.equal(fail.failed, 3); // outage: nothing lost, still pending
  down = false;
  const okRun = await syncOutbox({ db, client });
  assert.equal(okRun.processed, 3);
  assert.equal(sheet.USERS.length, 2);
  assert.equal(sheet.USERS.find((r) => r[0] === 'uid1')[2], "'=EVIL()"); // latest version, injection-escaped
  await enqueue(db, null, 'USERS', 'uid2', { uid: 'uid2', name: 'Second v2', role: 'host' });
  await new Promise((r) => setTimeout(r, 50));
  await syncOutbox({ db, client });
  assert.equal(sheet.USERS.length, 2); // update, not duplicate
  const rep = await reconcile({ db, client: { readKeys: async (t) => (sheet[t] || []).map((r) => r[0]) } });
  assert.deepEqual(rep.tabs.USERS.duplicateKeys, []); assert.equal(rep.pending, 0);
});

test('Firestore rules deny all direct client access', async () => {
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8'),
    host: process.env.FIRESTORE_EMULATOR_HOST.split(':')[0], port: Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]) } });
  const alice = env.authenticatedContext('alice', { role: 'customer', admin: true }).firestore();
  const anon = env.unauthenticatedContext().firestore();
  for (const path of ['users/alice', 'hosts/h1', 'requests/r1', 'settings/app', 'auditLogs/a', 'sheetsOutbox/x']) {
    await assertFails(getDoc(doc(alice, path)));
    await assertFails(setDoc(doc(alice, path), { x: 1 }));
    await assertFails(getDoc(doc(anon, path)));
  }
  await env.cleanup();
});
