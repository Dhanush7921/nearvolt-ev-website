import { Router, raw } from 'express';
import { ok } from '../middleware/errors.js';
import { unavailable, notFound, ApiError } from '../lib/errors.js';
import { MAX_FIRESTORE_FILE } from '../services/fileStore.js';

// Signed-link file endpoints for the Firestore storage driver. Authorisation is the HMAC token in the URL
// (issued only to the owning host for upload, or to an admin for download; 10-minute expiry).
export function fileRoutes({ fileStore }) {
  const r = Router();
  const types = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  r.put('/upload/:token', raw({ type: types, limit: MAX_FIRESTORE_FILE }), async (req, res, next) => {
    try {
      if (fileStore?.driver !== 'firestore') throw unavailable('Not available.');
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError(400, 'BAD_REQUEST', 'Empty or unsupported file.');
      const out = await fileStore.put(req.params.token, req.get('Content-Type'), req.body);
      if (out.status !== 200) throw new ApiError(out.status, 'UPLOAD_REJECTED', out.message);
      ok(res, { stored: true });
    } catch (e) { next(e); }
  });
  r.get('/download/:token', async (req, res, next) => {
    try {
      if (fileStore?.driver !== 'firestore') throw unavailable('Not available.');
      const f = await fileStore.read(req.params.token);
      if (!f) throw notFound('Link invalid or expired.');
      res.set({ 'Content-Type': f.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
      res.send(f.data);
    } catch (e) { next(e); }
  });
  return r;
}
