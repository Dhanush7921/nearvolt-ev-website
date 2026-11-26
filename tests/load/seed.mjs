// Seeds SYNTHETIC users/hosts and writes ID tokens for k6. Refuses to run against anything that looks like production.
// Emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 PROJECT_ID=demo-nearvolt node tests/load/seed.mjs
// Staging:  GOOGLE_APPLICATION_CREDENTIALS=… PROJECT_ID=nearvolt-ev-staging WEB_API_KEY=… node tests/load/seed.mjs
// Options:  USERS=10000 HOSTS=200 TOKENS=2000 (tokens are minted for the first TOKENS customers + all hosts; ID tokens expire after 1 hour)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { geohashForLocation } = require('geofire-common');

const PROJECT_ID = process.env.PROJECT_ID || '';
if (!/^(demo-|.*-(dev|staging|test|loadtest)$)/.test(PROJECT_ID)) { console.error(`Refusing: "${PROJECT_ID}" is not a demo/dev/staging/test project.`); process.exit(1); }
const USERS = Number(process.env.USERS || 1000), HOSTS = Number(process.env.HOSTS || 100), TOKENS = Number(process.env.TOKENS || 1000);
const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const idp = emu ? `http://${emu}/identitytoolkit.googleapis.com/v1` : 'https://identitytoolkit.googleapis.com/v1';
const key = emu ? 'fake' : process.env.WEB_API_KEY;
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(); const auth = getAuth();
const ALL_DAY = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '00:00', close: '00:00' }]]));
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };

async function importUsers(list) { // batch import is far faster than createUser one by one
  for (let i = 0; i < list.length; i += 1000) {
    const r = await auth.importUsers(list.slice(i, i + 1000).map((u) => ({ uid: u.uid, email: `${u.uid}@load.test`, emailVerified: true, customClaims: { role: u.role } })));
    if (r.failureCount) console.warn('import failures', r.failureCount);
  }
}
async function token(uid) {
  const custom = await auth.createCustomToken(uid);
  for (let a = 0; a < 5; a++) {
    const r = await fetch(`${idp}/accounts:signInWithCustomToken?key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
    if (r.ok) return (await r.json()).idToken;
    await new Promise((s) => setTimeout(s, 200 * 2 ** a));
  }
  throw new Error('token failed ' + uid);
}

const t0 = Date.now();
const customers = Array.from({ length: USERS }, (_, i) => ({ uid: `lt-c-${i}`, role: 'customer' }));
// Hosts on a grid around central Visakhapatnam (~±4 km), plus one race host with capacity 2.
const hosts = Array.from({ length: HOSTS }, (_, i) => ({ uid: `lt-h-${i}`, role: 'host', lat: 17.70 + ((i % 20) - 10) * 0.004, lng: 83.29 + (Math.floor(i / 20) - 5) * 0.004 }));
hosts.push({ uid: 'lt-race-host', role: 'host', lat: 17.7231, lng: 83.3013, capacity: 2 });
await importUsers([...customers, ...hosts]);
const now = FieldValue.serverTimestamp();
for (let i = 0; i < customers.length; i += 400) {
  const b = db.batch();
  for (const c of customers.slice(i, i + 400)) b.set(db.collection('users').doc(c.uid), { name: `Load ${c.uid}`, role: 'customer', vehicle: { type: 'car', connector: 'TYPE2_AC' },
    consents: { termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: false }, status: 'ACTIVE', createdAt: now, updatedAt: now });
  await b.commit();
}
for (let i = 0; i < hosts.length; i += 200) {
  const b = db.batch();
  for (const h of hosts.slice(i, i + 200)) {
    b.set(db.collection('users').doc(h.uid), { name: `Host ${h.uid}`, role: 'host', consents: { termsVersion: '1.0', privacyVersion: '1.0', locationConsent: true, notificationConsent: false }, status: 'ACTIVE', createdAt: now });
    b.set(db.collection('hosts').doc(h.uid), { displayName: `Synthetic host ${h.uid}`, status: 'APPROVED', address: 'synthetic', location: { lat: h.lat, lng: h.lng },
      geohash: geohashForLocation([h.lat, h.lng]), serviceAreaId: 'vizag', available: true, availableUntil: null, hours: ALL_DAY, activeSessions: 0, rating: { sum: 0, count: 0 },
      equipment: { chargerType: 'wallbox', connectors: ['TYPE2_AC', 'DOMESTIC_15A'], vehicleTypes: ['car', 'two_wheeler'], voltageV: 230, currentA: 32, phase: 'single', powerKw: 7.2, capacity: h.capacity || 1 },
      photos: [], documents: [], createdAt: now, updatedAt: now });
  }
  await b.commit();
}
const tok = [];
await pool([...customers.slice(0, TOKENS), ...hosts], 40, async (u) => { tok.push({ uid: u.uid, role: u.role, token: await token(u.uid) }); });
writeFileSync(new URL('./results/tokens.json', import.meta.url), JSON.stringify(tok));
console.log(JSON.stringify({ seededUsers: customers.length + hosts.length, customers: customers.length, hosts: hosts.length, tokens: tok.length, seconds: Math.round((Date.now() - t0) / 1000) }));
process.exit(0);
