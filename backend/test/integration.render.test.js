import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { db, makeApp, clearAll, tokenFor, hostBody } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { withLease } from '../src/services/inlineSync.js';
import { signToken, verifyToken } from '../src/services/fileStore.js';

beforeEach(clearAll);
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const SECRET = 'f'.repeat(48);
const RENDER = { STORAGE_DRIVER: 'firestore', FILE_URL_SECRET: SECRET, PUBLIC_URL: 'https://nearvolt-api.onrender.com', SYNC_DRIVER: 'inline', INTERNAL_TASK_TOKEN: 't'.repeat(40) };
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(900 * 1024, 7)]); // spans 2 chunks
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2000, 1)]);

test('Render production config: token auth or OIDC required; firestore storage needs secret + https URL', () => {
  const base = { NODE_ENV: 'production', APP_ENV: 'prod', CORS_ORIGINS: 'https://x.web.app' };
  assert.throws(() => loadConfig(base), /Internal job auth/);
  assert.throws(() => loadConfig({ ...base, INTERNAL_TASK_TOKEN: 'short' }), /Internal job auth/);
  assert.throws(() => loadConfig({ ...base, ...RENDER, FILE_URL_SECRET: 'x' }), /FILE_URL_SECRET/);
  assert.throws(() => loadConfig({ ...base, ...RENDER, PUBLIC_URL: 'http://x' }), /PUBLIC_URL/);
  assert.equal(loadConfig({ ...base, ...RENDER }).SYNC_DRIVER, 'inline');
});

test('signed links: tamper and expiry rejected', () => {
  const t = signToken(SECRET, { op: 'get', path: 'p', exp: Date.now() + 1000 });
  assert.equal(verifyToken(SECRET, t).path, 'p');
  assert.equal(verifyToken('x'.repeat(48), t), null);
  assert.equal(verifyToken(SECRET, t.slice(0, -2) + 'AA'), null);
  assert.equal(verifyToken(SECRET, signToken(SECRET, { op: 'get', path: 'p', exp: Date.now() - 1 })), null);
});

test('internal jobs accept the secret token (constant-time) and reject others', async () => {
  const { app } = makeApp(RENDER);
  await request(app).post('/api/v1/internal/expire-requests').expect(401);
  await request(app).post('/api/v1/internal/expire-requests').set(bearer('t'.repeat(39) + 'x')).expect(401);
  await request(app).post('/api/v1/internal/expire-requests').set(bearer('t'.repeat(40))).expect(200);
});

test('Firestore file storage: signed upload, magic-byte checks, confirm, admin signed download, owner deletion', async () => {
  const { app } = makeApp(RENDER);
  let t = await tokenFor('h1');
  await request(app).put('/api/v1/me/consents').set(bearer(t)).send({ termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: true }).expect(200);
  await request(app).put('/api/v1/me/profile').set(bearer(t)).send({ name: 'Host One' }).expect(200);
  await request(app).post('/api/v1/me/role').set(bearer(t)).send({ role: 'host' }).expect(200);
  t = await tokenFor('h1');
  await request(app).put('/api/v1/hosts/me').set(bearer(t)).send(hostBody()).expect(200);
  await request(app).post('/api/v1/hosts/me/uploads').set(bearer(t)).send({ kind: 'photo', contentType: 'image/jpeg', sizeBytes: 9 * 1024 * 1024 }).expect(400); // > 5 MB driver cap
  const tk = (await request(app).post('/api/v1/hosts/me/uploads').set(bearer(t)).send({ kind: 'photo', contentType: 'image/jpeg', sizeBytes: JPEG.length }).expect(200)).body.data;
  assert.match(tk.uploadUrl, /^https:\/\/nearvolt-api\.onrender\.com\/api\/v1\/files\/upload\//);
  const path = new URL(tk.uploadUrl).pathname.replace('/api/v1', '');
  // wrong content (PNG header declared as JPEG) rejected; wrong declared type rejected
  await request(app).put('/api/v1' + path).set('Content-Type', 'image/jpeg').send(Buffer.concat([Buffer.from('89504e47', 'hex'), Buffer.alloc(10)])).expect(400);
  await request(app).put('/api/v1' + path).set('Content-Type', 'image/png').send(JPEG).expect(400);
  await request(app).put('/api/v1' + path.slice(0, -3) + 'abc').set('Content-Type', 'image/jpeg').send(JPEG).expect(403); // tampered link
  await request(app).put('/api/v1' + path).set('Content-Type', 'image/jpeg').send(JPEG).expect(200);
  await request(app).put('/api/v1' + path).set('Content-Type', 'image/jpeg').send(JPEG).expect(409); // single use
  await request(app).post('/api/v1/hosts/me/uploads/confirm').set(bearer(t)).send({ path: tk.path }).expect(200);
  const d = (await request(app).post('/api/v1/hosts/me/uploads').set(bearer(t)).send({ kind: 'document', contentType: 'application/pdf', sizeBytes: PDF.length }).expect(200)).body.data;
  await request(app).put('/api/v1' + new URL(d.uploadUrl).pathname.replace('/api/v1', '')).set('Content-Type', 'application/pdf').send(PDF).expect(200);
  await request(app).post('/api/v1/hosts/me/uploads/confirm').set(bearer(t)).send({ path: d.path }).expect(200);
  const other = await tokenFor('h2'); // another user cannot attach someone else's file path
  await request(app).post('/api/v1/hosts/me/uploads/confirm').set(bearer(other)).send({ path: tk.path }).expect(403);
  const admin = await tokenFor('admin1', { admin: true });
  const v = (await request(app).get('/api/v1/admin/hosts/h1').set(bearer(admin)).expect(200)).body.data;
  assert.equal(v.photoUrls.length, 1);
  const dl = await request(app).get(new URL(v.photoUrls[0].url).pathname).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
  assert.equal(dl.headers['content-type'], 'image/jpeg'); assert.ok(Buffer.compare(dl.body, JPEG) === 0); // byte-exact across chunks
  await request(app).get('/api/v1/files/download/garbage.token').expect(404);
  await request(app).delete('/api/v1/me').set(bearer(t)).expect(200);
  assert.equal((await db.collection('hostFiles').where('ownerUid', '==', 'h1').get()).size, 0);
});

test('lease allows only one concurrent holder', async () => {
  let inside = 0, max = 0;
  const work = () => withLease(db, 'test-lease', 5000, async () => { inside++; max = Math.max(max, inside); await new Promise((r) => setTimeout(r, 100)); inside--; return 'ran'; });
  const out = await Promise.all([work(), work(), work()]);
  assert.equal(max, 1);
  assert.ok(out.filter((x) => x === 'ran').length >= 1); // never two holders at once (max === 1); losers skip
});

test('scheduled job purges expired technical records (Spark has no free TTL deletes)', async () => {
  const { app } = makeApp(RENDER);
  await db.collection('rateLimits').doc('old').set({ count: 1, expireAt: new Date(Date.now() - 1000) });
  await db.collection('rateLimits').doc('live').set({ count: 1, expireAt: new Date(Date.now() + 60000) });
  const r = await request(app).post('/api/v1/internal/expire-requests').set(bearer('t'.repeat(40))).expect(200);
  assert.equal(r.body.data.purged, 1);
  assert.equal((await db.collection('rateLimits').doc('live').get()).exists, true);
});

test('auth rejections carry distinct codes; unverified email/password accounts are refused', async () => {
  const { app } = makeApp({ ...RENDER, REQUIRE_APP_CHECK: 'true' }, { appCheck: { verifyToken: async (t) => { if (t !== 'good') throw Object.assign(new Error('bad'), { code: 'app-check/invalid-argument' }); return {}; } } });
  const t = await tokenFor('u1');
  assert.equal((await request(app).get('/api/v1/me').set(bearer(t)).expect(401)).body.error.code, 'APP_CHECK_REQUIRED');
  assert.equal((await request(app).get('/api/v1/me').set(bearer(t)).set('X-Firebase-AppCheck', 'bad').expect(401)).body.error.code, 'APP_CHECK_FAILED');
  assert.equal((await request(app).get('/api/v1/me').set(bearer('garbage')).set('X-Firebase-AppCheck', 'good').expect(401)).body.error.code, 'SESSION_INVALID');
  await request(app).get('/api/v1/me').set(bearer(t)).set('X-Firebase-AppCheck', 'good').expect(200);
  // email/password user, unverified
  const { auth } = await import('./helpers.js');
  await auth.createUser({ uid: 'pw1', email: 'pw1@example.test', password: 'Str0ngPass!', emailVerified: false });
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pw1@example.test', password: 'Str0ngPass!', returnSecureToken: true }) });
  const idToken = (await r.json()).idToken;
  assert.equal((await request(app).get('/api/v1/me').set(bearer(idToken)).set('X-Firebase-AppCheck', 'good').expect(403)).body.error.code, 'EMAIL_NOT_VERIFIED');
  await auth.updateUser('pw1', { emailVerified: true });
  const r2 = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pw1@example.test', password: 'Str0ngPass!', returnSecureToken: true }) });
  await request(app).get('/api/v1/me').set(bearer((await r2.json()).idToken)).set('X-Firebase-AppCheck', 'good').expect(200);
});
