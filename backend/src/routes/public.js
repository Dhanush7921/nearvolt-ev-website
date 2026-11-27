import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { validate } from '../middleware/validate.js';
import { ok } from '../middleware/errors.js';
import { deletionRequestSchema } from '../lib/schemas.js';
import { hitLimit, IP_SHARDS } from '../lib/limiter.js';

export function publicRoutes({ db, settings, config }) {
  const r = Router();
  r.get('/config', async (_req, res, next) => {
    try {
      const s = await settings.get();
      res.set('Cache-Control', 'public, max-age=60');
      ok(res, { maintenance: s.maintenance, minSupportedVersionCode: s.minSupportedVersionCode, latestVersionCode: s.latestVersionCode,
        featureFlags: { ...s.featureFlags, phoneLogin: Boolean(s.featureFlags?.phoneLogin && config.phoneOtpEnabled) },
        serviceAreas: (s.serviceAreas || []).filter((a) => a.active).map(({ id, name, center, radiusKm }) => ({ id, name, center, radiusKm })),
        supportContact: s.supportContact, requestTtlSeconds: config.REQUEST_TTL_SECONDS,
        // Server capabilities (code-defined, not admin-editable). V1.1 apps only use these features when advertised,
        // so a V1.1 APK keeps working against a V1.0 backend during rollout and after a rollback.
        capabilities: { apiLevel: 2, sessionPin: true, batteryPercent: true } });
    } catch (e) { next(e); }
  });
  // Public account-deletion request (Play Store requirement for users who no longer have the app).
  r.post('/deletion-requests', validate(deletionRequestSchema), async (req, res, next) => {
    try {
      if (req.body.website) return ok(res, { received: true }); // honeypot
      await hitLimit(db, `delreq_${req.ip}`, 3, 3600, IP_SHARDS);
      await db.collection('deletionRequests').add({ contact: req.body.contact, details: req.body.details || '', status: 'OPEN', createdAt: FieldValue.serverTimestamp() });
      ok(res, { received: true }, 202);
    } catch (e) { next(e); }
  });
  return r;
}
