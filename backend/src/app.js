import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import compression from 'compression';
import { createShedder, deadline } from './lib/overload.js';
import { kickAfterWrites } from './services/syncScheduler.js';
import { randomUUID } from 'node:crypto';
import { authenticate, optionalAuth, requireRole, requireAdmin } from './middleware/auth.js';
import { errorHandler, ok } from './middleware/errors.js';
import { gate } from './middleware/maintenance.js';
import { notFound } from './lib/errors.js';
import { createSettings } from './services/settings.js';
import { createNotifier } from './services/notify.js';
import { meRoutes } from './routes/me.js';
import { hostRoutes } from './routes/hosts.js';
import { requestRoutes } from './routes/requests.js';
import { otpRoutes } from './routes/otp.js';
import { supportRoutes } from './routes/support.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';
import { internalRoutes } from './routes/internal.js';
import { fileRoutes } from './routes/files.js';
import { createFileStore } from './services/fileStore.js';
import { logger } from './lib/logger.js';

export const API_VERSION = '1.0.0';

export function createApp(deps) {
  const { config } = deps;
  const settings = deps.settings || createSettings(deps.db);
  const notify = deps.notify || createNotifier(deps);
  const kicker = deps.kicker || { enabled: false, kick: async () => false };
  const fileStore = deps.fileStore !== undefined ? deps.fileStore : createFileStore({ config, db: deps.db, storage: deps.storage });
  const d = { ...deps, settings, notify, kicker, fileStore };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Cloud Run front end
  app.use((req, res, next) => { req.id = req.get('X-Cloud-Trace-Context')?.split('/')[0] || randomUUID(); res.set('X-Request-Id', req.id); next(); });
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Firebase-AppCheck', 'X-App-Version-Code', 'X-App-Platform'], maxAge: 600 }));
  app.use(createShedder({ maxLagMs: config.MAX_LAG_MS, maxInflight: config.MAX_INFLIGHT }));
  app.use(deadline(config.REQUEST_DEADLINE_MS, config.WRITE_DEADLINE_MS));
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: '64kb' }));
  app.use(kickAfterWrites(kicker));
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => logger.info({ rid: req.id, method: req.method, path: req.route?.path || req.path.replace(/[A-Za-z0-9]{20,}/g, ':id'), status: res.statusCode, ms: Date.now() - t }, 'request'));
    next();
  });

  app.get('/healthz', (_req, res) => ok(res, { status: 'ok', version: API_VERSION, env: config.APP_ENV }));
  app.get('/api/v1/health', (_req, res) => ok(res, { status: 'ok', version: API_VERSION, env: config.APP_ENV, time: new Date().toISOString(),
    ready: config.firebaseReady, features: { phoneLogin: config.phoneOtpEnabled, sheetsSync: config.sheetsEnabled, storage: config.STORAGE_DRIVER } }));
  // Fail fast (instead of a 15 s credential lookup) when the deployment has no Firebase credentials yet.
  if (!config.firebaseReady) {
    app.use('/api/v1', (_req, res) => res.status(503).set('Retry-After', '60').json({ ok: false, error: { code: 'SERVER_NOT_CONFIGURED',
      message: 'NEARVOLT EV servers are being set up. Please try again later.' } }));
  }

  const v1 = express.Router();
  v1.use(rateLimit({ windowMs: 15 * 60e3, limit: config.NODE_ENV === 'test' ? 100000 : config.IP_LIMIT_PER_15MIN, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } }) }));
  v1.use('/internal', internalRoutes(d));
  v1.use('/public', publicRoutes(d));
  v1.use('/files', fileRoutes(d));
  v1.use(gate(settings));
  const authn = authenticate(d);
  v1.use('/auth/otp', otpRoutes({ ...d, authOptional: optionalAuth(d) }));
  v1.use('/me', authn, meRoutes(d));
  v1.use('/hosts', authn, hostRoutes(d));
  v1.use('/requests', authn, requireRole('customer', 'host'), requestRoutes(d));
  v1.use('/support', authn, supportRoutes(d));
  v1.use('/admin', authn, requireAdmin(config), adminRoutes(d));
  app.use('/api/v1', v1);
  app.use((_req, _res, next) => next(notFound('Endpoint not found.')));
  app.use(errorHandler);
  return app;
}
