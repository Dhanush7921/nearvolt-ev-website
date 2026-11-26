import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
export function errorHandler(err, req, res, _next) {
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
