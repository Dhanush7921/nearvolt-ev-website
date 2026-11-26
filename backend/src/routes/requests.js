import { Router } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { validate } from '../middleware/validate.js';
import { ok } from '../middleware/errors.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { createRequestSchema, transitionSchema, feedbackSchema, listQuery } from '../lib/schemas.js';
import { S, ACTIVE, HOLDS_CAPACITY, LOCATION_VISIBLE, checkTransition } from '../services/stateMachine.js';
import { isHostBookable } from './hosts.js';
import { enqueue } from '../services/outbox.js';
import { distanceKm, roundKm, mapsDirectionsUrl, inServiceArea } from '../lib/geo.js';
import { paginate, ts } from '../lib/paginate.js';
import { hitLimit } from '../lib/limiter.js';

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
export async function applyTransition(db, requestId, action, actor, reason) {
  const reqRef = db.collection('requests').doc(requestId);
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
    const hostRef = db.collection('hosts').doc(q.hostUid);
    const custRef = db.collection('users').doc(q.customerUid);
    const [hs, cs] = await Promise.all([tx.get(hostRef), tx.get(custRef)]);
    const h = hs.data() || {};
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
    return out;
  };

  r.post('/', validate(createRequestSchema), async (req, res, next) => {
    try {
      const key = req.get('Idempotency-Key');
      if (!key || !/^[A-Za-z0-9-]{16,64}$/.test(key)) throw bad('Idempotency-Key header (16–64 chars) is required.');
      await hitLimit(db, `reqcreate_${req.user.uid}`, 10, 3600);
      const { hostId, vehicleType, connector, customerLocation, note } = req.body;
      if (hostId === req.user.uid) throw bad('You cannot request your own charging point.');
      const s = await settings.get();
      if (!inServiceArea(customerLocation, s.serviceAreas || [])) throw bad('NEARVOLT EV is not available in this area yet.');
      const idemRef = db.collection('idempotency').doc(`${req.user.uid}_${key}`);
      const userRef = db.collection('users').doc(req.user.uid);
      const hostRef = db.collection('hosts').doc(hostId);
      const reqRef = col.doc();
      const result = await db.runTransaction(async (tx) => {
        const [idem, us, hs] = await Promise.all([tx.get(idemRef), tx.get(userRef), tx.get(hostRef)]);
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
        const now = Timestamp.now();
        const doc = { customerUid: req.user.uid, customerName: u.name, hostUid: hostId, hostName: h.displayName, vehicleType, connector, note: note || null,
          customerLocation, straightLineKm: roundKm(distanceKm(customerLocation, h.location)), status: S.REQUESTED, compatibilityConfirmed: true,
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
      if (!result.replay) notify(snap.data().hostUid, { type: 'request.new', title: 'New charging request', body: `${snap.data().vehicleType === 'car' ? 'An EV car' : 'An EV'} driver needs charging nearby. Respond soon.`, requestId: result.id });
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
      const t = await applyTransition(db, req.params.id, req.body.action, req.user, req.body.reason);
      const q = t.request;
      const other = t.role === 'customer' ? q.hostUid : q.customerUid;
      const [title, body] = MESSAGES[t.to] || [];
      if (title) notify(other, { type: `request.${t.to.toLowerCase()}`, title, body, requestId: req.params.id });
      const fresh = await col.doc(req.params.id).get();
      const host = req.user.uid === q.customerUid && LOCATION_VISIBLE.has(t.to) ? (await db.collection('hosts').doc(q.hostUid).get()).data() : null;
      ok(res, view(fresh.id, fresh.data(), req.user.uid, host));
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
