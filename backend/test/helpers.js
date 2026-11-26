import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createSettings } from '../src/services/settings.js';

export const PROJECT = 'demo-nearvolt';
if (!getApps().length) initializeApp({ projectId: PROJECT });
export const db = getFirestore();
try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already set */ }
export const auth = getAuth();

export const notifications = [];
export function makeApp(env = {}, extra = {}) {
  const config = loadConfig({ NODE_ENV: 'test', APP_ENV: 'test', REQUIRE_ADMIN_MFA: 'false', CORS_ORIGINS: 'https://nearvolt-ev-prod.web.app', ...env });
  const settings = createSettings(db, 0);
  const notify = async (uid, n) => { notifications.push({ uid, ...n }); };
  return { app: createApp({ config, db, auth, appCheck: null, messaging: null, storage: null, settings, notify, ...extra }), config, settings };
}

export async function clearAll() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  notifications.length = 0;
}

export async function tokenFor(uid, claims) {
  try { await auth.getUser(uid); } catch { await auth.createUser({ uid, email: `${uid}@example.test`, emailVerified: true }); }
  if (claims) await auth.setCustomUserClaims(uid, claims);
  const custom = await auth.createCustomToken(uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error(JSON.stringify(j));
  return j.idToken;
}

export const VIZAG = { lat: 17.7231, lng: 83.3013 };      // inside service area
export const NEAR = { lat: 17.7300, lng: 83.3100 };       // ~1.2 km away
export const ALL_DAY = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '00:00', close: '00:00' }]]));
export const hostBody = (over = {}) => ({
  displayName: 'Sai Home Charging', address: 'Door 12-3, MVP Colony, Visakhapatnam', location: VIZAG,
  equipment: { chargerType: 'wallbox', connectors: ['TYPE2_AC', 'DOMESTIC_15A'], vehicleTypes: ['car', 'two_wheeler'], voltageV: 230, currentA: 32, phase: 'single', powerKw: 7.2, capacity: 1 },
  hours: ALL_DAY,
  selfDeclaration: { earthing: true, rcdOrElcb: true, dedicatedCircuit: true, ratedCabling: true, dryCoveredArea: true, accurateInformation: true },
  ...over,
});
export const CHECKLIST = { earthingVerified: true, rcdTested: true, circuitRatingAdequate: true, cablingAndSocketCondition: true, weatherProtection: true,
  clearAccessAndParking: true, fireSafetyClearance: true, documentsReviewed: true, identityVerified: true };
