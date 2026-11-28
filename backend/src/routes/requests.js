import { Router } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { validate } from '../middleware/validate.js';
import { ok } from '../middleware/errors.js';
import { bad, conflict, forbidden, notFound, ApiError } from '../lib/errors.js';
import { createRequestSchema, transitionSchema, feedbackSchema, listQuery } from '../lib/schemas.js';
import { S, ACTIVE, HOLDS_CAPACITY, LOCATION_VISIBLE, checkTransition } from '../services/stateMachine.js';
import { isHostBookable } from './hosts.js';
import { enqueue } from '../services/outbox.js';
import { distanceKm, roundKm, mapsDirectionsUrl, inServiceArea, approxArea } from '../lib/geo.js';
import { paginate, ts } from '../lib/paginate.js';
import { hitLimit } from '../lib/limiter.js';
import { keyedMutex } from '../lib/keyedMutex.js';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { hasRole } from '../middleware/auth.js';

// Session verification PIN: issued to the customer when the host accepts; the host must enter it to start charging.
export const PIN_TTL_MS = 2 * 3600e3, PIN_MAX_ATTEMPTS = 5, PIN_MAX_REISSUES = 3;
const PIN_STATES = new Set([S.ACCEPTED, S.ARRIVED]);
// Requests accepted by a V1.1+ server carry pinPolicy; only they (or any request holding a PIN) require one to start.
// Requests accepted before the V1.1 deploy have neither, so active V1.0 sessions finish without interruption.
export const PIN_POLICY = 'v1.1';
export const MIN_PIN_CLIENT = 2; // Android versionCode that can show/enter PINs
const newPin = (previous) => {
  let code;
  do code = String(randomInt(0, 10000)).padStart(4, '0'); while (code === previous);
  return { code, expiresAt: Timestamp.fromMillis(Date.now() + PIN_TTL_MS), attempts: 0 };
};
// Old Android builds cannot display or enter a PIN: they may finish existing sessions but not create or accept new ones.
export function requireCurrentClient(req) {
  if (req.get('X-App-Platform') === 'android' && Number(req.get('X-App-Version-Code') || 0) < MIN_PIN_CLIENT) {
    throw new ApiError(426, 'UPGRADE_REQUIRED', 'Please update NEARVOLT EV to the latest version to make or accept new charging requests.');
  }
}
/**
 * V1.4 server-side electrical gate (applies to every client version). Unknown or insufficient data blocks.
 * Wall sockets are never authorised automatically: host-declared dedicated circuit, single phase, declared current/power within the
 * socket rating, plus the driver's explicit portable-charger confirmation (checked at creation; recorded on the request).
 */
export const SOCKET_RATING = { DOMESTIC_15A: { amps: 15, kw: 3.45 }, INDUSTRIAL_16A: { amps: 16, kw: 3.68 } };
export function electricalCheck(h, connector, { socketConfirmed }) {
  const eq = h.equipment || {};
  if (!(eq.powerKw > 0) || !['single', 'three'].includes(eq.phase) || !(eq.currentA > 0)) {
    return new ApiError(409, 'ELECTRICAL_SPEC_INCOMPLETE', 'This charging point has incomplete electrical details, so it cannot be booked.');
  }
  const sock = SOCKET_RATING[connector];
  if (!sock) return null;
  if (h.selfDeclaration?.dedicatedCircuit !== true) return new ApiError(409, 'SOCKET_CIRCUIT_UNCONFIRMED', 'Wall-socket charging needs a host-confirmed dedicated circuit. This host has not confirmed one.');
  if (eq.phase !== 'single' || eq.currentA > sock.amps || eq.powerKw > sock.kw) return new ApiError(409, 'SOCKET_OVER_RATING', 'This host\'s declared supply does not match a wall-socket rating, so socket charging cannot be booked.');
  if (!socketConfirmed) return new ApiError(409, 'SOCKET_CONFIRMATION_REQUIRED', 'Update NEARVOLT EV and confirm your portable charger is rated for this socket.');
  return null;
}
const DRIVING = new Set([S.ACCEPTED, S.ARRIVED, S.CHARGING]);

const pinEq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const hostLock = keyedMutex();

const MESSAGES = {
  ACCEPTED: ['Host accepted your request', 'Open NEARVOLT EV for directions.'],
  REJECTED: ['Request declined', 'The host could not take your request. See other nearby hosts.'],
  EXPIRED: ['Request expired', 'The host did not respond in time. See other nearby hosts.'],
  CANCELLED: ['Request cancelled', 'A charging request was cancelled.'],
  ARRIVED: ['Arrival confirmed', 'Your charging visit has started.'],
  CHARGING: ['Charging started', 'Charging is in progress.'],
  COMPLETED: ['Charging completed', 'Thanks for using NEARVOLT EV. Rate your visit.'],
  DISPUTED: ['Issue reported', 'Our support team will review this session.'],
};

const reqRow = (id, q) => ({ requestId: id, customerUid: q.customerUid, hostUid: q.hostUid, status: q.status, connector: q.connector,
  createdAt: ts(q.createdAt) || new Date().toISOString(), updatedAt: new Date().toISOString() });

// Applies a transition inside a transaction: capacity bookkeeping, active-request pointer, history, Sheets outbox.
export async function applyTransition(db, requestId, action, actor, reason, opts = {}) {
  const reqRef = db.collection('requests').doc(requestId);
  const pre = await reqRef.get();
  if (!pre.exists) throw notFound('Request not found.');
  // Serialise per host on this instance (hot-document protection); the transaction below remains the source of truth.
  return hostLock(pre.data().hostUid, () => runTx(db, reqRef, requestId, action, actor, reason, opts));
}

async function runTx(db, reqRef, requestId, action, actor, reason, opts) {
  return db.runTransaction(async (tx) => {
    const rs = await tx.get(reqRef);
    if (!rs.exists) throw notFound('Request not found.');
    const q = rs.data();
    let role = 'system';
    if (actor !== 'system') {
      if (actor.uid === q.customerUid) role = 'customer';
      else if (actor.uid === q.hostUid) role = 'host';
      else throw notFound('Request not found.'); // no IDOR oracle
    }
    // Lazy expiry: an overdue REQUESTED cannot be accepted.
    if (q.status === S.REQUESTED && action !== 'expire' && q.expiresAt.toMillis() <= Date.now()) {
      if (action === 'cancel') { /* allow cancel of an expired request */ } else throw conflict('This request has expired.', 'EXPIRED');
    }
    const chk = checkTransition(action, q.status, role);
    if (!chk.ok) throw chk.reason === 'FORBIDDEN' ? forbidden('You cannot do that for this request.') : conflict(`Cannot ${action} a request that is ${q.status.toLowerCase()}.`, 'INVALID_STATE');
    // Session PIN check happens inside the same transaction as the CHARGING transition (atomic; serialised with
    // PIN refresh and concurrent start attempts). A wrong PIN commits only the attempt counter, never the transition.
    if (action === 'start' && (q.pin || q.pinPolicy === PIN_POLICY)) {
      if (!q.pin) throw new ApiError(409, 'PIN_UNAVAILABLE', 'No active PIN for this session. Ask the driver to refresh the PIN in their app.');
      if (!opts.pin) throw new ApiError(400, 'PIN_REQUIRED', 'Enter the 4-digit PIN shown on the driver\'s phone.');
      if (q.pin.expiresAt.toMillis() <= Date.now()) throw conflict('This PIN has expired. Ask the driver to refresh it in their app.', 'PIN_EXPIRED');
      if (q.pin.attempts >= PIN_MAX_ATTEMPTS) throw conflict('Too many wrong PINs. Ask the driver to refresh the PIN in their app.', 'PIN_LOCKED');
      if (!pinEq(opts.pin, q.pin.code)) {
        tx.update(reqRef, { 'pin.attempts': FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
        return { pinRejected: PIN_MAX_ATTEMPTS - q.pin.attempts - 1 };
      }
    }
    if (q.customerUid === q.hostUid) throw forbidden('You cannot charge at your own charging point.');
    const hostRef = db.collection('hosts').doc(q.hostUid);
    const custRef = db.collection('users').doc(q.customerUid);
    const [hs, cs] = await Promise.all([tx.get(hostRef), tx.get(custRef)]);
    const h = hs.data() || {};
    if (action === 'accept') {
      // Re-check electrics at acceptance: the listing may have changed since the request was created.
      const err = electricalCheck(h, q.connector, { socketConfirmed: q.socketConfirmed === true });
      if (err) throw err;
      // Dual role: a host who is currently on their own driver session cannot also take on a hosting session.
      const hostUser = (await tx.get(db.collection('users').doc(q.hostUid))).data() || {};
      if (hostUser.activeRequestId) {
        const own = await tx.get(db.collection('requests').doc(hostUser.activeRequestId));
        if (own.exists && DRIVING.has(own.data().status)) throw conflict('Finish your own charging visit before accepting a request.', 'DRIVING_ACTIVE');
      }
    }
    const wasHolding = HOLDS_CAPACITY.has(q.status), willHold = HOLDS_CAPACITY.has(chk.to);
    if (!wasHolding && willHold) {
      if (h.status !== 'APPROVED') throw conflict('This listing is not active.', 'HOST_INACTIVE');
      if ((h.activeSessions || 0) >= (h.equipment?.capacity || 1)) throw conflict('All charging points are busy.', 'NO_CAPACITY');
      tx.update(hostRef, { activeSessions: FieldValue.increment(1) });
    } else if (wasHolding && !willHold) {
      tx.update(hostRef, { activeSessions: FieldValue.increment(-1) });
    }
    const event = { from: q.status, to: chk.to, by: role, uid: actor === 'system' ? null : actor.uid, reason: reason || null, at: Timestamp.now() };
    const patch = { status: chk.to, updatedAt: FieldValue.serverTimestamp(), history: FieldValue.arrayUnion(event), [`timestamps.${chk.to.toLowerCase()}`]: FieldValue.serverTimestamp() };
    if (chk.to === S.ACCEPTED) { patch.pin = newPin(); patch.pinPolicy = PIN_POLICY; }
    if (!PIN_STATES.has(chk.to)) patch.pin = FieldValue.delete();
    tx.update(reqRef, patch);
    if (!ACTIVE.has(chk.to) && cs.exists && cs.data().activeRequestId === requestId) {
      tx.update(custRef, { activeRequestId: FieldValue.delete() });
    }
    const merged = { ...q, status: chk.to };
    enqueue(db, tx, 'CHARGING_REQUESTS', requestId, reqRow(requestId, merged));
    if ([S.COMPLETED, S.CANCELLED, S.REJECTED, S.EXPIRED, S.DISPUTED].includes(chk.to)) {
      enqueue(db, tx, 'CHARGING_HISTORY', requestId, { requestId, customerUid: q.customerUid, hostUid: q.hostUid, finalStatus: chk.to, completedAt: new Date().toISOString() });
    }
    return { request: merged, role, to: chk.to };
  });
}

export function requestRoutes({ db, config, settings, notify }) {
  const r = Router();
  const col = db.collection('requests');

  const view = (id, q, viewerUid, hostDoc) => {
    const isCustomer = viewerUid === q.customerUid;
    const out = { id, status: q.status, role: isCustomer ? 'customer' : 'host', hostId: q.hostUid, hostName: q.hostName, connector: q.connector,
      vehicleType: q.vehicleType, note: q.note || null, straightLineKm: q.straightLineKm, createdAt: ts(q.createdAt), expiresAt: ts(q.expiresAt),
      updatedAt: ts(q.updatedAt), history: (q.history || []).map((e) => ({ from: e.from, to: e.to, by: e.by, at: ts(e.at) })), feedbackGiven: Boolean(q.feedback?.[isCustomer ? 'customer' : 'host']) };
    // Exact host location is disclosed only to the customer, only after acceptance and only while the visit is active.
    if (isCustomer && LOCATION_VISIBLE.has(q.status) && hostDoc?.location) {
      out.hostLocation = { lat: hostDoc.location.lat, lng: hostDoc.location.lng, address: hostDoc.address, mapsUrl: mapsDirectionsUrl(hostDoc.location.lat, hostDoc.location.lng) };
    }
    if (!isCustomer) out.customerName = q.customerName || 'Customer';
    out.batteryPercent = q.batteryPercent ?? null; out.urgent = q.batteryPercent != null && q.batteryPercent <= 10;
    if (PIN_STATES.has(q.status) && q.pin) {
      const expired = q.pin.expiresAt.toMillis() <= Date.now(), locked = q.pin.attempts >= PIN_MAX_ATTEMPTS;
      out.pinStatus = expired ? 'EXPIRED' : locked ? 'LOCKED' : 'ACTIVE';
      out.pinExpiresAt = ts(q.pin.expiresAt);
      if (isCustomer && out.pinStatus === 'ACTIVE') out.pin = q.pin.code; // never shown to the host
    }
    return out;
  };

  r.post('/', validate(createRequestSchema), async (req, res, next) => {
    try {
      const key = req.get('Idempotency-Key');
      if (!key || !/^[A-Za-z0-9-]{16,64}$/.test(key)) throw bad('Idempotency-Key header (16–64 chars) is required.');
      requireCurrentClient(req);
      await hitLimit(db, `reqcreate_${req.user.uid}`, 10, 3600);
      const { hostId, vehicleType, connector, customerLocation, note, batteryPercent, socketConfirmation } = req.body;
      if (hostId === req.user.uid) throw bad('You cannot request your own charging point.');
      if (!hasRole(req, 'customer')) throw new ApiError(403, 'MODE_NOT_ENABLED', 'Turn on Driver mode to request charging.');
      const s = await settings.get();
      if (!inServiceArea(customerLocation, s.serviceAreas || [])) throw bad('NEARVOLT EV is not available in this area yet.');
      const idemRef = db.collection('idempotency').doc(`${req.user.uid}_${key}`);
      const userRef = db.collection('users').doc(req.user.uid);
      const hostRef = db.collection('hosts').doc(hostId);
      const reqRef = col.doc();
      // The host document is read OUTSIDE the transaction: creation must not lock the (potentially hot) host doc.
      // This check is advisory; capacity and host status are enforced atomically when the host accepts.
      const [hs, ownHost] = await Promise.all([hostRef.get(), db.collection('hosts').doc(req.user.uid).get()]);
      // Dual role: no driver request while hosting an active session at your own charging point.
      if ((ownHost.data()?.activeSessions || 0) > 0) throw conflict('Finish the charging session you are hosting before requesting charging.', 'HOSTING_ACTIVE');
      const result = await db.runTransaction(async (tx) => {
        const [idem, us] = await Promise.all([tx.get(idemRef), tx.get(userRef)]);
        if (idem.exists) return { replay: true, id: idem.data().requestId };
        const u = us.data() || {};
        if (!u.consents || !u.name) throw bad('Complete your profile first.');
        if (u.activeRequestId) {
          const prev = await tx.get(col.doc(u.activeRequestId));
          if (prev.exists && ACTIVE.has(prev.data().status) && !(prev.data().status === S.REQUESTED && prev.data().expiresAt.toMillis() <= Date.now())) {
            throw conflict('You already have an active charging request.', 'ACTIVE_REQUEST_EXISTS');
          }
        }
        if (!hs.exists) throw notFound('Host not found.');
        const h = hs.data();
        if (!isHostBookable(h)) throw conflict('This host is not available right now.', 'HOST_UNAVAILABLE');
        if (!h.equipment.connectors.includes(connector) || !h.equipment.vehicleTypes.includes(vehicleType)) throw conflict('This host does not support your vehicle or connector.', 'INCOMPATIBLE');
        const elec = electricalCheck(h, connector, { socketConfirmed: socketConfirmation === true });
        if (elec) throw elec;
        const now = Timestamp.now();
        const doc = { customerUid: req.user.uid, customerName: u.name, hostUid: hostId, hostName: h.displayName, vehicleType, connector, note: note || null,
          ...(batteryPercent != null ? { batteryPercent } : {}),
          customerLocation, straightLineKm: roundKm(distanceKm(customerLocation, approxArea(h.location))), /* cell-based: no pre-acceptance leak */ status: S.REQUESTED, compatibilityConfirmed: true,
          ...(SOCKET_RATING[connector] ? { socketConfirmed: true } : {}),
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(now.toMillis() + config.REQUEST_TTL_SECONDS * 1000),
          history: [{ from: null, to: S.REQUESTED, by: 'customer', uid: req.user.uid, reason: null, at: now }] };
        tx.set(reqRef, doc);
        tx.set(userRef, { activeRequestId: reqRef.id }, { merge: true });
        tx.set(idemRef, { requestId: reqRef.id, createdAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + 24 * 3600e3) });
        enqueue(db, tx, 'CHARGING_REQUESTS', reqRef.id, reqRow(reqRef.id, doc));
        return { replay: false, id: reqRef.id, doc };
      });
      const snap = await col.doc(result.id).get();
      if (!result.replay) notify(snap.data().hostUid, { type: 'request.new', title: 'New charging request', body: `${snap.data().vehicleType === 'car' ? 'An EV car' : 'An EV'} driver needs charging nearby${snap.data().batteryPercent != null ? ` (battery ${snap.data().batteryPercent}%${snap.data().batteryPercent <= 10 ? ', urgent' : ''})` : ''}. Respond soon.`, requestId: result.id });
      ok(res, view(result.id, snap.data(), req.user.uid), result.replay ? 200 : 201);
    } catch (e) { next(e); }
  });

  r.get('/', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const as = req.query.as === 'host' ? 'hostUid' : 'customerUid';
      let q = col.where(as, '==', req.user.uid);
      if (req.q.status === 'active') q = q.where('status', 'in', [...ACTIVE]);
      const page = await paginate(q.orderBy('createdAt', 'desc'), col, req.q);
      ok(res, { items: page.items.map((d) => view(d.id, d.data(), req.user.uid)), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });

  r.get('/:id', async (req, res, next) => {
    try {
      let s = await col.doc(req.params.id).get();
      if (!s.exists) throw notFound('Request not found.');
      let q = s.data();
      if (req.user.uid !== q.customerUid && req.user.uid !== q.hostUid) throw notFound('Request not found.');
      if (q.status === S.REQUESTED && q.expiresAt.toMillis() <= Date.now()) {
        await applyTransition(db, s.id, 'expire', 'system').then((t) => notify(q.customerUid, { type: 'request.expired', title: MESSAGES.EXPIRED[0], body: MESSAGES.EXPIRED[1], requestId: s.id })).catch(() => {});
        s = await col.doc(req.params.id).get(); q = s.data();
      }
      const host = LOCATION_VISIBLE.has(q.status) && req.user.uid === q.customerUid ? (await db.collection('hosts').doc(q.hostUid).get()).data() : null;
      ok(res, view(s.id, q, req.user.uid, host));
    } catch (e) { next(e); }
  });

  r.post('/:id/transition', validate(transitionSchema), async (req, res, next) => {
    try {
      if (req.body.action === 'accept') requireCurrentClient(req);
      const t = await applyTransition(db, req.params.id, req.body.action, req.user, req.body.reason, { pin: req.body.pin });
      if (t.pinRejected !== undefined) {
        throw new ApiError(400, 'PIN_INVALID', t.pinRejected > 0 ? `Incorrect PIN. ${t.pinRejected} attempt${t.pinRejected === 1 ? '' : 's'} left.` : 'Incorrect PIN. The PIN is now locked; ask the driver to refresh it.');
      }
      const q = t.request;
      const other = t.role === 'customer' ? q.hostUid : q.customerUid;
      const [title, body] = MESSAGES[t.to] || [];
      if (title) notify(other, { type: `request.${t.to.toLowerCase()}`, title, body, requestId: req.params.id });
      const fresh = await col.doc(req.params.id).get();
      const host = req.user.uid === q.customerUid && LOCATION_VISIBLE.has(t.to) ? (await db.collection('hosts').doc(q.hostUid).get()).data() : null;
      ok(res, view(fresh.id, fresh.data(), req.user.uid, host));
    } catch (e) { next(e); }
  });

  // Customer re-issues the PIN (after expiry, lock-out, or if it was seen by someone else). Limited per request.
  r.post('/:id/pin', async (req, res, next) => {
    try {
      await hitLimit(db, `pinreissue_${req.user.uid}`, 10, 3600);
      const ref = col.doc(req.params.id);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) throw notFound('Request not found.');
        const q = s.data();
        if (req.user.uid !== q.customerUid) throw notFound('Request not found.');
        if (!PIN_STATES.has(q.status)) throw conflict('A PIN is only available after the host accepts.', 'INVALID_STATE');
        if ((q.pinReissues || 0) >= PIN_MAX_REISSUES) throw conflict('PIN refresh limit reached. Contact support if you need help.', 'PIN_REISSUE_LIMIT');
        tx.update(ref, { pin: newPin(q.pin?.code), pinReissues: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
      });
      const fresh = await ref.get();
      ok(res, view(fresh.id, fresh.data(), req.user.uid));
    } catch (e) { next(e); }
  });

  r.post('/:id/feedback', validate(feedbackSchema), async (req, res, next) => {
    try {
      const ref = col.doc(req.params.id);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) throw notFound('Request not found.');
        const q = s.data();
        const role = req.user.uid === q.customerUid ? 'customer' : req.user.uid === q.hostUid ? 'host' : null;
        if (!role) throw notFound('Request not found.');
        if (q.status !== S.COMPLETED) throw conflict('Feedback opens after charging is completed.', 'INVALID_STATE');
        if (q.feedback?.[role]) throw conflict('Feedback already submitted.', 'DUPLICATE');
        const fb = { rating: req.body.rating, comment: req.body.comment || null, at: Timestamp.now() };
        tx.update(ref, { [`feedback.${role}`]: fb });
        if (role === 'customer') tx.update(db.collection('hosts').doc(q.hostUid), { 'rating.sum': FieldValue.increment(fb.rating), 'rating.count': FieldValue.increment(1) });
        enqueue(db, tx, 'FEEDBACK', `${req.params.id}_${role}`, { requestId: req.params.id, customerUid: q.customerUid, hostUid: q.hostUid, rating: fb.rating, at: new Date().toISOString() });
      });
      ok(res, { saved: true }, 201);
    } catch (e) { next(e); }
  });

  return r;
}
