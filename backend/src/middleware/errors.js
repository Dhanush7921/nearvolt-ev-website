import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
// Firestore lock contention / transaction aborts are transient: answer 503 + Retry-After so clients retry with jitter.
const isContention = (e) => e?.code === 10 || /ABORTED|contention|lock timeout/i.test(String(e?.message || ''));
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) { logger.warn({ err: { message: err?.message }, path: req.path, rid: req.id }, 'error after response (deadline already answered)'); return; }
  if (isContention(err)) {
    logger.warn({ metric: 'firestore_contention', path: req.path, err: { message: err.message } }, 'contention');
    res.set('Retry-After', '1');
    return res.status(503).json({ ok: false, error: { code: 'BUSY_RETRY', message: 'Busy right now. Please retry.' } });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } });
  }
  logger.error({ err: { message: err?.message, stack: err?.stack }, path: req.path, rid: req.id }, 'unhandled');
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}
export const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
