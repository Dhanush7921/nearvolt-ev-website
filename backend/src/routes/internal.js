import { Router } from 'express';
import { ok } from '../middleware/errors.js';
import { unauth } from '../lib/errors.js';
import { S } from '../services/stateMachine.js';
import { applyTransition } from './requests.js';
import { syncOutbox, reconcile, backlog } from '../services/sheets.js';
import { logger } from '../lib/logger.js';

// Jobs triggered by Cloud Scheduler with an OIDC token for a dedicated service account.
export function internalRoutes({ db, config, oidc, notify, sheetsClient, kicker }) {
  const r = Router();
  r.use(async (req, _res, next) => {
    try {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m || !oidc) throw unauth();
      const ticket = await oidc.verifyIdToken({ idToken: m[1], audience: config.INTERNAL_OIDC_AUDIENCE }).catch(() => null);
      const p = ticket?.getPayload();
      if (!p || p.email !== config.INTERNAL_OIDC_SA_EMAIL || !p.email_verified) throw unauth();
      next();
    } catch (e) { next(e); }
  });

  r.post('/expire-requests', async (_req, res, next) => {
    try {
      let n = 0;
      const started = Date.now();
      // Bounded batches with a time budget: never an unbounded scan.
      for (let page = 0; page < 10 && Date.now() - started < 20000; page++) {
      const snap = await db.collection('requests').where('status', '==', S.REQUESTED).where('expiresAt', '<=', new Date()).orderBy('expiresAt').limit(100).get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        try {
          await applyTransition(db, d.id, 'expire', 'system');
          n++;
          notify(d.data().customerUid, { type: 'request.expired', title: 'Request expired', body: 'The host did not respond in time. See other nearby hosts.', requestId: d.id });
          notify(d.data().hostUid, { type: 'request.expired', title: 'Request expired', body: 'A charging request expired before it was answered.', requestId: d.id });
        } catch (e) { logger.info({ id: d.id, err: e.message }, 'expire skipped'); }
      }
      if (snap.size < 100) break;
      }
      // Availability windows that have ended.
      const ended = await db.collection('hosts').where('available', '==', true).where('availableUntil', '<=', new Date()).limit(200).get();
      const b = db.batch(); ended.docs.forEach((d) => b.update(d.ref, { available: false })); if (!ended.empty) await b.commit();
      ok(res, { expired: n, availabilityClosed: ended.size });
    } catch (e) { next(e); }
  });
  // Called by Cloud Tasks (kicks) and Cloud Scheduler (recovery sweep). Non-2xx makes Cloud Tasks retry with backoff.
  r.post('/sheets-sync', async (_req, res, next) => {
    try {
      if (!sheetsClient) return ok(res, { configured: false });
      const out = await syncOutbox({ db, client: sheetsClient });
      const b = await backlog(db);
      logger.info({ metric: 'sheets_backlog', pending: b.pending, oldestPendingSeconds: b.oldestPendingSeconds, processed: out.processed, failed: out.failed || 0 }, 'sheets sync');
      if (out.more && kicker) await kicker.kick(1);
      if (out.error) return res.status(503).json({ ok: false, error: { code: 'SHEETS_UNAVAILABLE', message: 'Sheets write failed; will retry.' } });
      ok(res, { ...out, ...b });
    } catch (e) { next(e); }
  });
  r.post('/sheets-reconcile', async (_req, res, next) => {
    try { if (!sheetsClient) return ok(res, { configured: false }); ok(res, await reconcile({ db, client: sheetsClient })); } catch (e) { next(e); }
  });
  r.post('/sheets-setup', async (_req, res, next) => {
    try { if (!sheetsClient) return ok(res, { configured: false }); await sheetsClient.ensureTabs(); ok(res, { ready: true }); } catch (e) { next(e); }
  });
  return r;
}
