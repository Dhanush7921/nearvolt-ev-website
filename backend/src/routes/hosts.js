import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.js';
import { ok } from '../middleware/errors.js';
import { bad, conflict, notFound, unavailable } from '../lib/errors.js';
import { hostProfileSchema, availabilitySchema, uploadSchema, nearbyQuery } from '../lib/schemas.js';
import { geohashForLocation, geohashQueryBounds, distanceKm, roundKm, inServiceArea } from '../lib/geo.js';
import { isOpenNow } from '../lib/hours.js';
import { enqueue } from '../services/outbox.js';
import { ts } from '../lib/paginate.js';
import { memoryLimiter, ttlCache } from '../lib/overload.js';
import { tooMany } from '../lib/errors.js';

// Local discovery-cache invalidation hook (admin decisions, listing and availability changes on this instance).
const caches = new Set();
export const invalidateDiscovery = () => caches.forEach((c) => c.clear());

const EDITABLE = new Set(['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED']);
export const hostSheetRow = (uid, h) => ({ uid, displayName: h.displayName, status: h.status, serviceArea: h.serviceAreaId,
  connectors: (h.equipment?.connectors || []).join(' '), powerKw: h.equipment?.powerKw, submittedAt: ts(h.submittedAt),
  reviewedAt: ts(h.verification?.reviewedAt), reviewedBy: h.verification?.reviewedBy });

// What the host sees about their own listing (private fields included).
const ownView = (uid, h) => ({ uid, status: h.status || 'DRAFT', displayName: h.displayName || '', address: h.address || '', location: h.location || null,
  equipment: h.equipment || null, hours: h.hours || null, available: Boolean(h.available), availableUntil: ts(h.availableUntil),
  photos: (h.photos || []).length, documents: (h.documents || []).length, selfDeclaration: h.selfDeclaration || null,
  rejectionReason: h.status === 'REJECTED' ? h.verification?.notes || '' : undefined, rating: h.rating || { sum: 0, count: 0 },
  activeSessions: h.activeSessions || 0, submittedAt: ts(h.submittedAt) });

export function isHostBookable(h, now = new Date()) {
  if (h.status !== 'APPROVED' || !h.available) return false;
  if (h.availableUntil && h.availableUntil.toDate() < now) return false;
  if (!isOpenNow(h.hours, now)) return false;
  return (h.activeSessions || 0) < (h.equipment?.capacity || 1);
}

export function hostRoutes({ db, storage, config, settings }) {
  const r = Router();
  const hosts = db.collection('hosts');
  // Discovery is the hottest read path. A 5 s per-instance cache of the geohash query result absorbs bursts from
  // nearby users; bookable status is recomputed from the snapshot time, every response carries `checkedAt`,
  // and booking always re-checks availability inside a transaction, so cached data can never confirm a booking.
  const snapCache = ttlCache({ ttlMs: config.NEARBY_CACHE_MS, max: 500 });
  caches.add(snapCache);
  const allow = memoryLimiter({ capacity: 30, refillPerSec: 1 }); // per user per instance: burst 30, then 1/s

  // ---- Customer-facing discovery (any signed-in user). Exact coordinates are never returned. ----
  r.get('/nearby', validate(nearbyQuery, 'query'), async (req, res, next) => {
    try {
      const { lat, lng, connector, vehicleType } = req.q;
      const radiusKm = Math.min(req.q.radiusKm, config.MAX_SEARCH_RADIUS_KM);
      const s = await settings.get();
      const area = inServiceArea({ lat, lng }, s.serviceAreas || []);
      if (!area) return ok(res, { serviceArea: null, items: [], message: 'NEARVOLT EV is not available in this area yet.' });
      if (!allow(req.user.uid)) throw tooMany('Searching too often. Please wait a moment.');
      res.set('Cache-Control', 'private, no-store');
      const exclude = new Set((req.q.exclude || '').split(',').filter(Boolean));
      // Cache per geohash range (shared by every user whose search covers that cell), not per user point:
      // bounded memory, high hit rate. Distances are still computed from the user's exact point.
      const bounds = geohashQueryBounds([lat, lng], radiusKm * 1000);
      let oldest = Date.now();
      const parts = await Promise.all(bounds.map(async ([a, b]) => {
        const k = `${a}:${b}`;
        const hit = snapCache.get(k);
        if (hit) { oldest = Math.min(oldest, hit.at); return hit.v; }
        const snap = await hosts.where('status', '==', 'APPROVED').orderBy('geohash').startAt(a).endAt(b).limit(200).get();
        const v = snap.docs.map((d) => [d.id, d.data()]);
        snapCache.set(k, v);
        return v;
      }));
      const merged = new Map(); for (const part of parts) for (const [id, h] of part) merged.set(id, h);
      const entry = { v: [...merged.entries()], at: oldest };
      const now = new Date(entry.at);
      const items = [];
      for (const [id, h] of entry.v) {
        if (exclude.has(id) || id === req.user.uid) continue;
        const d = { id };
        const km = distanceKm({ lat, lng }, h.location);
        if (km > radiusKm) continue;
        const eq = h.equipment || {};
        const compatible = (!connector || eq.connectors?.includes(connector)) && (!vehicleType || eq.vehicleTypes?.includes(vehicleType));
        if (!compatible) continue;
        items.push({
          hostId: d.id, displayName: h.displayName, straightLineKm: roundKm(km),
          connectors: eq.connectors, vehicleTypes: eq.vehicleTypes, powerKw: eq.powerKw, chargerType: eq.chargerType, phase: eq.phase,
          bookableNow: isHostBookable(h, now), openNow: isOpenNow(h.hours, now), hours: h.hours,
          rating: h.rating?.count ? { average: Math.round((h.rating.sum / h.rating.count) * 10) / 10, count: h.rating.count } : null,
          availabilityUpdatedAt: ts(h.availabilityUpdatedAt),
        });
      }
      items.sort((a, b) => Number(b.bookableNow) - Number(a.bookableNow) || a.straightLineKm - b.straightLineKm);
      ok(res, { serviceArea: { id: area.id, name: area.name }, distanceNote: 'Straight-line distance. Road distance will be longer.', checkedAt: now.toISOString(), items: items.slice(0, 50) });
    } catch (e) { next(e); }
  });

  // ---- Host self-management ----
  const host = Router();
  host.use(requireRole('host'));

  host.get('/', async (req, res, next) => {
    try { const s = await hosts.doc(req.user.uid).get(); ok(res, ownView(req.user.uid, s.exists ? s.data() : {})); } catch (e) { next(e); }
  });

  host.put('/', validate(hostProfileSchema), async (req, res, next) => {
    try {
      const s = await settings.get();
      const area = inServiceArea(req.body.location, s.serviceAreas || []);
      if (!area) throw bad('This location is outside our current service area.');
      const ref = hosts.doc(req.user.uid);
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? snap.data() : { status: 'DRAFT' };
        if (!EDITABLE.has(prev.status)) throw conflict('This listing cannot be edited right now.', 'NOT_EDITABLE');
        // Changing location or electrical equipment on an approved listing sends it back for re-verification.
        const material = prev.status === 'APPROVED' && (JSON.stringify(prev.equipment) !== JSON.stringify(req.body.equipment)
          || prev.location?.lat !== req.body.location.lat || prev.location?.lng !== req.body.location.lng);
        const status = material ? 'PENDING_REVIEW' : prev.status === 'REJECTED' ? 'DRAFT' : prev.status;
        const data = { ...req.body, serviceAreaId: area.id, geohash: geohashForLocation([req.body.location.lat, req.body.location.lng]),
          status, ...(material ? { available: false } : {}), updatedAt: FieldValue.serverTimestamp(),
          ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp(), activeSessions: 0, rating: { sum: 0, count: 0 }, photos: [], documents: [], available: false }) };
        tx.set(ref, data, { merge: true });
        const merged = { ...prev, ...data };
        enqueue(db, tx, 'HOSTS', req.user.uid, hostSheetRow(req.user.uid, merged));
        return merged;
      });
      invalidateDiscovery();
      ok(res, ownView(req.user.uid, out));
    } catch (e) { next(e); }
  });

  host.post('/submit', async (req, res, next) => {
    try {
      const ref = hosts.doc(req.user.uid);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) throw bad('Complete your charging details first.');
        const h = s.data();
        if (!['DRAFT', 'REJECTED'].includes(h.status)) throw conflict('Listing is already submitted or approved.', 'ALREADY_SUBMITTED');
        if (!h.equipment || !h.location || !h.selfDeclaration) throw bad('Complete your charging details first.');
        if ((h.photos || []).length < 2) throw bad('Upload at least two photos of the charging point and supply board.');
        if ((h.documents || []).length < 1) throw bad('Upload your electrical safety document (for example an electrician inspection report).');
        tx.update(ref, { status: 'PENDING_REVIEW', submittedAt: FieldValue.serverTimestamp() });
        enqueue(db, tx, 'HOSTS', req.user.uid, hostSheetRow(req.user.uid, { ...h, status: 'PENDING_REVIEW', submittedAt: new Date().toISOString() }));
      });
      ok(res, { status: 'PENDING_REVIEW' });
    } catch (e) { next(e); }
  });

  host.put('/availability', validate(availabilitySchema), async (req, res, next) => {
    try {
      const ref = hosts.doc(req.user.uid);
      const s = await ref.get();
      if (!s.exists || s.data().status !== 'APPROVED') throw conflict('Your listing must be approved before going online.', 'NOT_APPROVED');
      const until = req.body.until ? new Date(req.body.until) : null;
      if (until && (until < new Date() || until - Date.now() > 24 * 3600e3)) throw bad('Choose a time within the next 24 hours.');
      await ref.update({ available: req.body.available, availableUntil: until, availabilityUpdatedAt: FieldValue.serverTimestamp() });
      invalidateDiscovery();
      ok(res, { available: req.body.available, until: until?.toISOString() || null });
    } catch (e) { next(e); }
  });

  // Signed, short-lived upload URL. Size and type are enforced by the signature; the file is checked again on confirm.
  host.post('/uploads', validate(uploadSchema), async (req, res, next) => {
    try {
      if (!storage || !config.STORAGE_BUCKET) throw unavailable('File uploads are not configured.');
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[req.body.contentType];
      if (req.body.kind === 'photo' && ext === 'pdf') throw bad('Photos must be JPEG, PNG or WebP.');
      const path = `hosts/${req.user.uid}/${req.body.kind}s/${randomUUID()}.${ext}`;
      const [url] = await storage.bucket(config.STORAGE_BUCKET).file(path).getSignedUrl({
        version: 'v4', action: 'write', expires: Date.now() + 10 * 60e3, contentType: req.body.contentType,
        extensionHeaders: { 'x-goog-content-length-range': `0,${req.body.sizeBytes}` },
      });
      ok(res, { uploadUrl: url, path, method: 'PUT', headers: { 'Content-Type': req.body.contentType, 'x-goog-content-length-range': `0,${req.body.sizeBytes}` } });
    } catch (e) { next(e); }
  });

  host.post('/uploads/confirm', async (req, res, next) => {
    try {
      const path = String(req.body?.path || '');
      const m = path.match(new RegExp(`^hosts/${req.user.uid}/(photo|document)s/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`));
      if (!m) throw bad('Invalid file reference.');
      if (!storage || !config.STORAGE_BUCKET) throw unavailable('File uploads are not configured.');
      const file = storage.bucket(config.STORAGE_BUCKET).file(path);
      const [exists] = await file.exists();
      if (!exists) throw notFound('Upload not found. Please try again.');
      const [meta] = await file.getMetadata();
      // Magic-byte check: content must match the declared type.
      const [head] = await file.download({ start: 0, end: 11 });
      const sig = head.toString('hex');
      const okType = (meta.contentType === 'application/pdf' && sig.startsWith('25504446'))
        || (meta.contentType === 'image/jpeg' && sig.startsWith('ffd8ff'))
        || (meta.contentType === 'image/png' && sig.startsWith('89504e47'))
        || (meta.contentType === 'image/webp' && sig.startsWith('52494646') && head.subarray(8, 12).toString() === 'WEBP');
      if (!okType || Number(meta.size) > 10 * 1024 * 1024) { await file.delete().catch(() => {}); throw bad('File type or size is not allowed.'); }
      const field = m[1] === 'photo' ? 'photos' : 'documents';
      const ref = hosts.doc(req.user.uid);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const list = s.exists ? s.data()[field] || [] : [];
        if (list.length >= 10) throw bad('Upload limit reached.');
        tx.set(ref, { [field]: FieldValue.arrayUnion(path) }, { merge: true });
      });
      ok(res, { attached: true, kind: m[1] });
    } catch (e) { next(e); }
  });

  r.use('/me', host);
  return r;
}
