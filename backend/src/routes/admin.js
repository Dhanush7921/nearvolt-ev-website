import { Router } from 'express';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { validate } from '../middleware/validate.js';
import { ok } from '../middleware/errors.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { listQuery, latLng } from '../lib/schemas.js';
import { paginate, ts } from '../lib/paginate.js';
import { auditEntry, writeAudit } from '../services/audit.js';
import { enqueue } from '../services/outbox.js';
import { hostSheetRow, invalidateDiscovery } from './hosts.js';
import { applyTransition } from './requests.js';
import { reconcile, backlog } from '../services/sheets.js';

// Inspection checklist an admin must complete (after a real inspection) before a host can go live.
const CHECKLIST = ['earthingVerified', 'rcdTested', 'circuitRatingAdequate', 'cablingAndSocketCondition', 'weatherProtection',
  'clearAccessAndParking', 'fireSafetyClearance', 'documentsReviewed', 'identityVerified'];
const approveSchema = z.object({
  checklist: z.object(Object.fromEntries(CHECKLIST.map((k) => [k, z.literal(true)]))).strict(),
  inspectorName: z.string().trim().min(2).max(80), inspectionDate: z.iso.date(), notes: z.string().max(1000).optional(),
}).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(5).max(1000) }).strict();
const settingsSchema = z.object({
  maintenance: z.object({ enabled: z.boolean(), message: z.string().max(300) }).strict().optional(),
  minSupportedVersionCode: z.number().int().min(1).optional(),
  latestVersionCode: z.number().int().min(1).optional(),
  featureFlags: z.record(z.string().regex(/^[a-zA-Z0-9_]{1,40}$/), z.boolean()).optional(),
  serviceAreas: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{2,30}$/), name: z.string().min(2).max(60), active: z.boolean(), center: latLng, radiusKm: z.number().min(1).max(100) }).strict()).max(50).optional(),
  supportContact: z.object({ email: z.string().max(120), phone: z.string().max(20) }).strict().optional(),
}).strict();
const complaintPatch = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']), resolution: z.string().max(2000).optional() }).strict();

const hostAdminView = (d) => { const h = d.data(); return { uid: d.id, displayName: h.displayName, status: h.status, serviceAreaId: h.serviceAreaId,
  address: h.address, location: h.location, equipment: h.equipment, hours: h.hours, selfDeclaration: h.selfDeclaration, photos: h.photos || [], documents: h.documents || [],
  verification: h.verification ? { ...h.verification, reviewedAt: ts(h.verification.reviewedAt) } : null, available: h.available, activeSessions: h.activeSessions || 0,
  rating: h.rating, submittedAt: ts(h.submittedAt), updatedAt: ts(h.updatedAt) }; };

export function adminRoutes({ db, auth, storage, config, settings, notify, sheetsClient }) {
  const r = Router();
  const audit = (req, action, target, meta) => writeAudit(db, null, auditEntry(req.user, action, target, meta));

  r.get('/overview', async (_req, res, next) => {
    try {
      const c = async (q) => (await q.count().get()).data().count;
      const since = new Date(Date.now() - 24 * 3600e3);
      const [users, hostsApproved, hostsPending, activeReq, req24, completed24, openComplaints, urgent, outbox] = await Promise.all([
        c(db.collection('users')), c(db.collection('hosts').where('status', '==', 'APPROVED')), c(db.collection('hosts').where('status', '==', 'PENDING_REVIEW')),
        c(db.collection('requests').where('status', 'in', ['REQUESTED', 'ACCEPTED', 'ARRIVED', 'CHARGING'])),
        c(db.collection('requests').where('createdAt', '>=', since)), c(db.collection('requests').where('status', '==', 'COMPLETED').where('updatedAt', '>=', since)),
        c(db.collection('complaints').where('status', 'in', ['OPEN', 'IN_PROGRESS'])), c(db.collection('complaints').where('priority', '==', 'URGENT').where('status', '==', 'OPEN')),
        c(db.collection('sheetsOutbox').where('status', '==', 'PENDING'))]);
      ok(res, { users, hostsApproved, hostsPending, activeRequests: activeReq, requestsLast24h: req24, completedLast24h: completed24, openComplaints, urgentComplaints: urgent, sheetsPending: outbox, generatedAt: new Date().toISOString() });
    } catch (e) { next(e); }
  });

  r.get('/users', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const col = db.collection('users');
      const page = await paginate(col.orderBy('createdAt', 'desc'), col, req.q);
      ok(res, { items: page.items.map((d) => { const u = d.data(); return { uid: d.id, name: u.name, role: u.role, phone: u.phone, email: u.email, status: u.status, createdAt: ts(u.createdAt) }; }), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });

  r.post('/users/:uid/disable', validate(reasonSchema), async (req, res, next) => {
    try {
      await auth.updateUser(req.params.uid, { disabled: true }); await auth.revokeRefreshTokens(req.params.uid);
      await db.collection('users').doc(req.params.uid).set({ status: 'DISABLED' }, { merge: true });
      await audit(req, 'user.disable', `users/${req.params.uid}`, { reason: req.body.reason });
      ok(res, { disabled: true });
    } catch (e) { next(e); }
  });
  r.post('/users/:uid/enable', async (req, res, next) => {
    try {
      await auth.updateUser(req.params.uid, { disabled: false });
      await db.collection('users').doc(req.params.uid).set({ status: 'ACTIVE' }, { merge: true });
      await audit(req, 'user.enable', `users/${req.params.uid}`);
      ok(res, { disabled: false });
    } catch (e) { next(e); }
  });

  r.get('/hosts', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const col = db.collection('hosts');
      let q = col; if (req.q.status) q = q.where('status', '==', req.q.status);
      const page = await paginate(q.orderBy('updatedAt', 'desc'), col, req.q);
      ok(res, { items: page.items.map(hostAdminView), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });
  r.get('/hosts/:uid', async (req, res, next) => {
    try {
      const d = await db.collection('hosts').doc(req.params.uid).get();
      if (!d.exists) throw notFound();
      const v = hostAdminView(d);
      if (storage && config.STORAGE_BUCKET) {
        const sign = (p) => storage.bucket(config.STORAGE_BUCKET).file(p).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 10 * 60e3 }).then(([u]) => ({ path: p, url: u }));
        v.photoUrls = await Promise.all(v.photos.map(sign)); v.documentUrls = await Promise.all(v.documents.map(sign));
      }
      await audit(req, 'host.view_private', `hosts/${req.params.uid}`);
      ok(res, v);
    } catch (e) { next(e); }
  });

  const hostDecision = (action, fromStates, toStatus, schema) => [validate(schema), async (req, res, next) => {
    try {
      const ref = db.collection('hosts').doc(req.params.uid);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) throw notFound();
        const h = s.data();
        if (!fromStates.includes(h.status)) throw conflict(`Host is ${h.status}; cannot ${action}.`, 'INVALID_STATE');
        if (action === 'suspend' && (h.activeSessions || 0) > 0) throw conflict('Host has an active session. Resolve it first.', 'ACTIVE_SESSION');
        const verification = { ...(h.verification || {}), reviewedBy: req.user.uid, reviewedAt: FieldValue.serverTimestamp(),
          ...(action === 'approve' ? { checklist: req.body.checklist, inspectorName: req.body.inspectorName, inspectionDate: req.body.inspectionDate, notes: req.body.notes || '' } : { notes: req.body.reason }) };
        tx.update(ref, { status: toStatus, verification, ...(toStatus !== 'APPROVED' ? { available: false } : {}), updatedAt: FieldValue.serverTimestamp() });
        writeAudit(db, tx, auditEntry(req.user, `host.${action}`, `hosts/${req.params.uid}`, action === 'approve' ? { inspector: req.body.inspectorName, date: req.body.inspectionDate } : { reason: req.body.reason }));
        enqueue(db, tx, 'HOSTS', req.params.uid, hostSheetRow(req.params.uid, { ...h, status: toStatus, verification: { reviewedBy: req.user.uid, reviewedAt: new Date().toISOString() } }));
      });
      invalidateDiscovery();
      const msg = { approve: ['Listing approved', 'Your charging point is verified. Go online to receive requests.'], reject: ['Listing needs changes', 'Open NEARVOLT EV to see what needs fixing.'],
        suspend: ['Listing suspended', 'Your listing is paused. Contact support for details.'], restore: ['Listing restored', 'Your listing is active again.'] }[action];
      notify(req.params.uid, { type: `host.${action}`, title: msg[0], body: msg[1] });
      ok(res, { status: toStatus });
    } catch (e) { next(e); }
  }];
  r.post('/hosts/:uid/approve', ...hostDecision('approve', ['PENDING_REVIEW'], 'APPROVED', approveSchema));
  r.post('/hosts/:uid/reject', ...hostDecision('reject', ['PENDING_REVIEW'], 'REJECTED', reasonSchema));
  r.post('/hosts/:uid/suspend', ...hostDecision('suspend', ['APPROVED', 'PENDING_REVIEW'], 'SUSPENDED', reasonSchema));
  // Restoring returns the host to review; it does not skip re-verification.
  r.post('/hosts/:uid/restore', ...hostDecision('restore', ['SUSPENDED'], 'PENDING_REVIEW', reasonSchema));

  r.get('/requests', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const col = db.collection('requests');
      let q = col; if (req.q.status) q = q.where('status', '==', req.q.status);
      const page = await paginate(q.orderBy('createdAt', 'desc'), col, req.q);
      ok(res, { items: page.items.map((d) => { const x = d.data(); return { id: d.id, status: x.status, customerUid: x.customerUid, customerName: x.customerName, hostUid: x.hostUid, hostName: x.hostName, connector: x.connector, vehicleType: x.vehicleType, straightLineKm: x.straightLineKm, createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt), history: (x.history || []).map((e) => ({ ...e, at: ts(e.at) })) }; }), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });
  r.post('/requests/:id/cancel', validate(reasonSchema), async (req, res, next) => {
    try {
      const t = await applyTransition(db, req.params.id, 'expire', 'system', req.body.reason).catch(async (e) => {
        if (e.code !== 'INVALID_STATE') throw e;
        throw bad('Only pending requests can be closed by admin. Use dispute handling for active sessions.');
      });
      await audit(req, 'request.admin_close', `requests/${req.params.id}`, { reason: req.body.reason });
      ok(res, { status: t.to });
    } catch (e) { next(e); }
  });

  r.get('/complaints', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const col = db.collection('complaints');
      let q = col; if (req.q.status) q = q.where('status', '==', req.q.status);
      const page = await paginate(q.orderBy('createdAt', 'desc'), col, req.q);
      ok(res, { items: page.items.map((d) => ({ id: d.id, ...d.data(), createdAt: ts(d.data().createdAt), updatedAt: ts(d.data().updatedAt) })), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });
  r.patch('/complaints/:id', validate(complaintPatch), async (req, res, next) => {
    try {
      const ref = db.collection('complaints').doc(req.params.id);
      const s = await ref.get(); if (!s.exists) throw notFound();
      const b = db.batch();
      b.update(ref, { ...req.body, updatedAt: FieldValue.serverTimestamp(), handledBy: req.user.uid });
      enqueue(db, b, 'COMPLAINTS', req.params.id, { ticketId: req.params.id, uid: s.data().uid, category: s.data().category, status: req.body.status, requestId: s.data().requestId, createdAt: ts(s.data().createdAt) });
      writeAudit(db, b, auditEntry(req.user, 'complaint.update', `complaints/${req.params.id}`, { status: req.body.status }));
      await b.commit();
      notify(s.data().uid, { type: 'support.update', title: 'Support ticket updated', body: `Your ticket is now ${req.body.status.toLowerCase().replace('_', ' ')}.` });
      ok(res, { updated: true });
    } catch (e) { next(e); }
  });

  r.get('/deletion-requests', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const col = db.collection('deletionRequests');
      const page = await paginate(col.orderBy('createdAt', 'desc'), col, req.q);
      ok(res, { items: page.items.map((d) => ({ id: d.id, ...d.data(), createdAt: ts(d.data().createdAt) })), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });

  r.get('/audit', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const col = db.collection('auditLogs');
      const page = await paginate(col.orderBy('at', 'desc'), col, req.q);
      ok(res, { items: page.items.map((d) => ({ id: d.id, ...d.data(), at: ts(d.data().at) })), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });
  r.get('/security-events', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      // Security-relevant audit actions plus OTP lockouts currently in force.
      const col = db.collection('auditLogs');
      const page = await paginate(col.where('action', 'in', ['user.disable', 'user.enable', 'account.delete', 'host.suspend', 'host.view_private', 'settings.update', 'notification.broadcast']).orderBy('at', 'desc'), col, req.q);
      const locks = await db.collection('otpThrottle').where('lockedUntil', '>', new Date()).count().get();
      ok(res, { activeOtpLockouts: locks.data().count, items: page.items.map((d) => ({ id: d.id, ...d.data(), at: ts(d.data().at) })), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });

  r.get('/settings', async (_req, res, next) => { try { settings.invalidate(); ok(res, await settings.get()); } catch (e) { next(e); } });
  r.put('/settings', validate(settingsSchema), async (req, res, next) => {
    try {
      const s = await settings.get();
      if (req.body.minSupportedVersionCode && req.body.minSupportedVersionCode > (req.body.latestVersionCode || s.latestVersionCode)) throw bad('Minimum version cannot be above the latest version.');
      const out = await settings.update(req.body);
      const b = db.batch();
      for (const [k, v] of Object.entries(req.body)) enqueue(db, b, 'SETTINGS', k, { key: k, value: JSON.stringify(v), updatedAt: new Date().toISOString() });
      writeAudit(db, b, auditEntry(req.user, 'settings.update', 'settings/app', { keys: Object.keys(req.body) }));
      await b.commit();
      ok(res, out);
    } catch (e) { next(e); }
  });

  const broadcastSchema = z.object({ title: z.string().min(3).max(60), body: z.string().min(3).max(200), audience: z.enum(['hosts', 'customers', 'uid']), uid: z.string().max(128).optional() }).strict();
  r.post('/notifications', validate(broadcastSchema), async (req, res, next) => {
    try {
      let uids = [];
      if (req.body.audience === 'uid') { if (!req.body.uid) throw bad('uid required'); uids = [req.body.uid]; }
      else {
        const snap = await db.collection('users').where('role', '==', req.body.audience === 'hosts' ? 'host' : 'customer').select().limit(2000).get();
        uids = snap.docs.map((d) => d.id);
      }
      for (const u of uids) await notify(u, { type: 'admin.announcement', title: req.body.title, body: req.body.body });
      await audit(req, 'notification.broadcast', req.body.audience, { count: uids.length });
      ok(res, { sent: uids.length });
    } catch (e) { next(e); }
  });

  r.get('/sheets/status', async (_req, res, next) => {
    try {
      if (!sheetsClient) return ok(res, { configured: false, ...(await backlog(db)) });
      ok(res, { configured: true, ...(await reconcile({ db, client: sheetsClient })) });
    } catch (e) { next(e); }
  });
  r.get('/reports/requests.csv', async (req, res, next) => {
    try {
      const days = Math.min(Number(req.query.days) || 30, 366);
      const snap = await db.collection('requests').where('createdAt', '>=', new Date(Date.now() - days * 86400e3)).orderBy('createdAt', 'desc').limit(5000).get();
      const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const rows = [['id', 'status', 'customerUid', 'hostUid', 'connector', 'vehicleType', 'straightLineKm', 'createdAt']]
        .concat(snap.docs.map((d) => { const x = d.data(); return [d.id, x.status, x.customerUid, x.hostUid, x.connector, x.vehicleType, x.straightLineKm, ts(x.createdAt)]; }));
      await audit(req, 'report.export', 'requests', { days, rows: snap.size });
      res.type('text/csv').set('Content-Disposition', `attachment; filename="nearvolt-requests-${days}d.csv"`).send(rows.map((r) => r.map(esc).join(',')).join('\n'));
    } catch (e) { next(e); }
  });

  return r;
}
