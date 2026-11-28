import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { validate } from '../middleware/validate.js';
import { ok } from '../middleware/errors.js';
import { conflict, bad } from '../lib/errors.js';
import { profileSchema, consentSchema, roleSchema, capabilitySchema, deviceSchema, sessionSchema, listQuery } from '../lib/schemas.js';
import { keyedMutex } from '../lib/keyedMutex.js';
import { enqueue } from '../services/outbox.js';
import { auditEntry, writeAudit } from '../services/audit.js';
import { paginate, ts } from '../lib/paginate.js';
import { hitLimit } from '../lib/limiter.js';
import { ACTIVE } from '../services/stateMachine.js';

/**
 * V1.4 capabilities. Source of truth = users/{uid}.capabilities (server-written only); the legacy `role` field implies its own
 * capability, so records created before V1.4 need no migration. 'driver' == legacy role 'customer'.
 */
export function capsOf(u = {}) {
  const c = u.capabilities || {};
  return { driver: c.driver === true || u.role === 'customer', host: c.host === true || u.role === 'host' };
}
export const rolesOf = (u) => { const c = capsOf(u); return [...(c.driver ? ['customer'] : []), ...(c.host ? ['host'] : [])]; };
export function userSheetRow(uid, u, status = 'ACTIVE') {
  const c = capsOf(u);
  return { uid, role: u.role, name: u.name, phone: u.phone, email: u.email, vehicleType: u.vehicle?.type,
    connector: u.vehicle?.connector, createdAt: ts(u.createdAt) || new Date().toISOString(), updatedAt: new Date().toISOString(), status,
    capabilities: [c.driver && 'driver', c.host && 'host'].filter(Boolean).join(' ') };
}
const publicUser = (uid, u) => ({ uid, name: u.name || '', role: u.role || null, phone: u.phone || null, email: u.email || null,
  vehicle: u.vehicle || null, consents: u.consents || null, activeRequestId: u.activeRequestId || null, createdAt: ts(u.createdAt),
  capabilities: capsOf(u) });
const capLock = keyedMutex();

export function meRoutes({ db, auth, fileStore }) {
  const r = Router();
  const users = db.collection('users');

  r.get('/', async (req, res, next) => {
    try {
      const s = await users.doc(req.user.uid).get();
      ok(res, { ...publicUser(req.user.uid, s.exists ? s.data() : {}), admin: req.user.admin, profileComplete: s.exists && Boolean(s.data().name && s.data().consents) });
    } catch (e) { next(e); }
  });

  // Consent must be recorded before anything else (terms + privacy).
  r.put('/consents', validate(consentSchema), async (req, res, next) => {
    try {
      await users.doc(req.user.uid).set({ consents: { ...req.body, at: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      ok(res, { saved: true });
    } catch (e) { next(e); }
  });

  r.put('/profile', validate(profileSchema), async (req, res, next) => {
    try {
      const ref = users.doc(req.user.uid);
      const out = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const prev = s.exists ? s.data() : {};
        if (!prev.consents) throw bad('Please accept the terms and privacy policy first.');
        const merged = { ...prev, ...req.body, phone: req.user.phone || prev.phone || null, email: req.user.email || prev.email || null };
        tx.set(ref, { ...req.body, phone: merged.phone, email: merged.email, updatedAt: FieldValue.serverTimestamp(),
          ...(s.exists && prev.createdAt ? {} : { createdAt: FieldValue.serverTimestamp(), status: 'ACTIVE' }) }, { merge: true });
        enqueue(db, tx, 'USERS', req.user.uid, userSheetRow(req.user.uid, merged));
        return merged;
      });
      ok(res, publicUser(req.user.uid, out));
    } catch (e) { next(e); }
  });

  // Role is a server-set custom claim. Users may choose once; changing later goes through support.
  r.post('/role', validate(roleSchema), async (req, res, next) => {
    try {
      if (req.user.role && req.user.role !== req.body.role) throw conflict('Account type is already set. Contact support to change it.', 'ROLE_LOCKED');
      const cap = req.body.role === 'customer' ? 'driver' : 'host';
      await users.doc(req.user.uid).set({ role: req.body.role, capabilities: { [cap]: true }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await syncClaims(req.user.uid, req.body.role);
      ok(res, { role: req.body.role, refreshToken: true });
    } catch (e) { next(e); }
  });

  /** Claims are always DERIVED from the Firestore record (never accumulated from the request), so concurrent calls converge. */
  async function syncClaims(uid, primaryRole) {
    const doc = (await users.doc(uid).get()).data() || {};
    const u = await auth.getUser(uid);
    const claims = { ...(u.customClaims || {}), roles: rolesOf(doc) };
    if (!claims.role && primaryRole) claims.role = primaryRole;
    await auth.setCustomUserClaims(uid, claims);   // admin and other claims are preserved untouched
    return claims;
  }

  // V1.4: add Driver or Host mode to the SAME account/UID. Host mode does not create or approve a listing: the listing starts as
  // DRAFT and still needs submission, documents and admin approval. Capabilities are never removed here.
  r.post('/capabilities', validate(capabilitySchema), async (req, res, next) => {
    try {
      const uid = req.user.uid, cap = req.body.capability;
      await hitLimit(db, `caps_${uid}`, 10, 86400);
      const out = await capLock(uid, async () => {
        const merged = await db.runTransaction(async (tx) => {
          const s = await tx.get(users.doc(uid));
          const u = s.exists ? s.data() : {};
          if (!u.consents || !u.name) throw bad('Complete your profile first.');
          if (!u.role) throw bad('Choose how you will use NEARVOLT first.');
          if (capsOf(u)[cap]) return { u, changed: false };
          const next = { ...u, capabilities: { ...(u.capabilities || {}), [cap]: true } };
          tx.set(users.doc(uid), { capabilities: { [cap]: true }, [`capabilityAt.${cap}`]: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          enqueue(db, tx, 'USERS', uid, userSheetRow(uid, next));
          writeAudit(db, tx, auditEntry(req.user, 'account.capability.add', `users/${uid}`, { capability: cap }));
          return { u: next, changed: true };
        });
        await syncClaims(uid, merged.u.role);
        return merged;
      });
      ok(res, { capabilities: capsOf(out.u), changed: out.changed, refreshToken: true });
    } catch (e) { next(e); }
  });

  r.post('/session', validate(sessionSchema), async (req, res, next) => {
    try {
      await hitLimit(db, `session_${req.user.uid}`, 30, 3600);
      const ref = db.collection('loginLogs').doc();
      const b = db.batch();
      b.set(ref, { uid: req.user.uid, method: req.body.method, at: FieldValue.serverTimestamp() });
      enqueue(db, b, 'LOGIN_LOGS', ref.id, { eventId: ref.id, uid: req.user.uid, method: req.body.method, at: new Date().toISOString() });
      await b.commit();
      ok(res, { logged: true });
    } catch (e) { next(e); }
  });

  r.post('/devices', validate(deviceSchema), async (req, res, next) => {
    try {
      // Doc id = token so the same device never registers twice; token refresh simply adds the new one.
      const devs = users.doc(req.user.uid).collection('devices');
      await devs.doc(req.body.token).set({ platform: req.body.platform, at: FieldValue.serverTimestamp() });
      ok(res, { registered: true });
    } catch (e) { next(e); }
  });
  r.delete('/devices/:token', async (req, res, next) => {
    try { await users.doc(req.user.uid).collection('devices').doc(req.params.token).delete(); ok(res, { removed: true }); } catch (e) { next(e); }
  });

  r.get('/notifications', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const col = users.doc(req.user.uid).collection('notifications');
      const page = await paginate(col.orderBy('at', 'desc'), col, req.q);
      ok(res, { items: page.items.map((d) => ({ id: d.id, ...d.data(), at: ts(d.data().at) })), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });
  r.post('/notifications/read-all', async (req, res, next) => {
    try {
      const snap = await users.doc(req.user.uid).collection('notifications').where('read', '==', false).limit(400).get();
      const b = db.batch(); snap.docs.forEach((d) => b.update(d.ref, { read: true })); await b.commit();
      ok(res, { updated: snap.size });
    } catch (e) { next(e); }
  });

  // Account deletion (Play policy). Blocked while a charging request is active.
  r.delete('/', async (req, res, next) => {
    try {
      const uid = req.user.uid;
      const us = await users.doc(uid).get();
      const active = us.exists && us.data().activeRequestId;
      if (active) {
        const rq = await db.collection('requests').doc(active).get();
        if (rq.exists && ACTIVE.has(rq.data().status)) throw conflict('Finish or cancel your active charging request before deleting your account.', 'ACTIVE_REQUEST');
      }
      const hostRef = db.collection('hosts').doc(uid);
      const host = await hostRef.get();
      if (host.exists && (host.data().activeSessions || 0) > 0) throw conflict('You have an active charging session. Complete it first.', 'ACTIVE_SESSION');
      const b = db.batch();
      if (host.exists) {
        b.set(hostRef, { status: 'DELETED', available: false, displayName: 'Deleted host', address: FieldValue.delete(), location: FieldValue.delete(),
          geohash: FieldValue.delete(), phone: FieldValue.delete(), photos: [], documents: [], deletedAt: FieldValue.serverTimestamp() }, { merge: true });
        enqueue(db, b, 'HOSTS', uid, { uid, displayName: 'Deleted host', status: 'DELETED' });
      }
      enqueue(db, b, 'USERS', uid, { uid, role: us.data()?.role, status: 'DELETED', updatedAt: new Date().toISOString() });
      writeAudit(db, b, auditEntry(req.user, 'account.delete', `users/${uid}`));
      await b.commit();
      await db.recursiveDelete(users.doc(uid));
      if (fileStore) await fileStore.removeOwner(uid).catch(() => {});
      await auth.deleteUser(uid);
      ok(res, { deleted: true });
    } catch (e) { next(e); }
  });

  return r;
}
