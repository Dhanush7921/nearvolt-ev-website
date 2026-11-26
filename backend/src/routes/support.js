import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { validate } from '../middleware/validate.js';
import { ok } from '../middleware/errors.js';
import { notFound } from '../lib/errors.js';
import { ticketSchema, listQuery } from '../lib/schemas.js';
import { enqueue } from '../services/outbox.js';
import { hitLimit } from '../lib/limiter.js';
import { paginate, ts } from '../lib/paginate.js';

export function supportRoutes({ db }) {
  const r = Router();
  const col = db.collection('complaints');
  r.post('/tickets', validate(ticketSchema), async (req, res, next) => {
    try {
      await hitLimit(db, `ticket_${req.user.uid}`, 10, 86400);
      if (req.body.requestId) {
        const q = await db.collection('requests').doc(req.body.requestId).get();
        if (!q.exists || ![q.data().customerUid, q.data().hostUid].includes(req.user.uid)) throw notFound('Request not found.');
      }
      const ref = col.doc();
      const priority = req.body.category === 'unsafe_charging' ? 'URGENT' : 'NORMAL';
      const b = db.batch();
      b.set(ref, { ...req.body, uid: req.user.uid, status: 'OPEN', priority, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      enqueue(db, b, 'COMPLAINTS', ref.id, { ticketId: ref.id, uid: req.user.uid, category: req.body.category, status: 'OPEN', requestId: req.body.requestId, createdAt: new Date().toISOString() });
      await b.commit();
      ok(res, { ticketId: ref.id, priority }, 201);
    } catch (e) { next(e); }
  });
  r.get('/tickets', validate(listQuery, 'query'), async (req, res, next) => {
    try {
      const page = await paginate(col.where('uid', '==', req.user.uid).orderBy('createdAt', 'desc'), col, req.q);
      ok(res, { items: page.items.map((d) => { const t = d.data(); return { id: d.id, category: t.category, status: t.status, message: t.message, resolution: t.resolution || null, createdAt: ts(t.createdAt) }; }), nextCursor: page.nextCursor });
    } catch (e) { next(e); }
  });
  return r;
}
