import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

// Private file storage for host photos and safety documents.
//  - 'gcs': Cloud Storage V4 signed URLs (Cloud Run / Blaze).
//  - 'firestore': bytes stored in ≤700 KB chunks under hostFiles/{id}/chunks (Firebase Spark has no Cloud Storage).
//    Upload/download use short-lived HMAC-signed links issued by the API (same contract as GCS signed URLs), so the
//    Android app and admin dashboard work unchanged. Clients can never read Firestore directly (rules deny all).
const CHUNK = 700 * 1024;
export const MAX_FIRESTORE_FILE = 5 * 1024 * 1024;
const b64 = (s) => Buffer.from(s).toString('base64url');
const fileId = (path) => createHash('sha256').update(path).digest('hex').slice(0, 40);

export function signToken(secret, payload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyToken(secret, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp && p.exp > Date.now() ? p : null;
}
export function sniffOk(contentType, head) {
  const sig = head.subarray(0, 12).toString('hex');
  return (contentType === 'application/pdf' && sig.startsWith('25504446'))
    || (contentType === 'image/jpeg' && sig.startsWith('ffd8ff'))
    || (contentType === 'image/png' && sig.startsWith('89504e47'))
    || (contentType === 'image/webp' && sig.startsWith('52494646') && head.subarray(8, 12).toString() === 'WEBP');
}

export function createFileStore({ config, db, storage }) {
  if (config.STORAGE_DRIVER === 'gcs') {
    if (!storage || !config.STORAGE_BUCKET) return null;
    const bucket = storage.bucket(config.STORAGE_BUCKET);
    return {
      driver: 'gcs', maxBytes: 10 * 1024 * 1024,
      async uploadTicket(path, contentType, sizeBytes) {
        const [url] = await bucket.file(path).getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + 10 * 60e3, contentType,
          extensionHeaders: { 'x-goog-content-length-range': `0,${sizeBytes}` } });
        return { uploadUrl: url, path, method: 'PUT', headers: { 'Content-Type': contentType, 'x-goog-content-length-range': `0,${sizeBytes}` } };
      },
      async inspect(path) {
        const f = bucket.file(path); const [exists] = await f.exists(); if (!exists) return null;
        const [meta] = await f.getMetadata(); const [head] = await f.download({ start: 0, end: 11 });
        return { contentType: meta.contentType, size: Number(meta.size), head };
      },
      remove: (path) => bucket.file(path).delete().catch(() => {}),
      removeOwner: (uid) => bucket.deleteFiles({ prefix: `hosts/${uid}/` }).catch(() => {}),
      readUrl: async (path) => (await bucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 10 * 60e3 }))[0],
    };
  }
  const col = db.collection('hostFiles');
  const secret = config.FILE_URL_SECRET;
  return {
    driver: 'firestore', maxBytes: MAX_FIRESTORE_FILE,
    async uploadTicket(path, contentType, sizeBytes, uid) {
      const token = signToken(secret, { op: 'put', path, uid, contentType, size: sizeBytes, exp: Date.now() + 10 * 60e3 });
      return { uploadUrl: `${config.PUBLIC_URL}/api/v1/files/upload/${token}`, path, method: 'PUT', headers: { 'Content-Type': contentType } };
    },
    // Called by the signed-link upload route. Enforces declared size/type and magic bytes before storing.
    async put(token, contentType, buf) {
      const p = verifyToken(secret, token);
      if (!p || p.op !== 'put') return { status: 403, message: 'Upload link invalid or expired.' };
      if (contentType !== p.contentType || buf.length > p.size || buf.length > MAX_FIRESTORE_FILE || !sniffOk(contentType, buf)) return { status: 400, message: 'File type or size is not allowed.' };
      const id = fileId(p.path), ref = col.doc(id);
      if ((await ref.get()).exists) return { status: 409, message: 'Already uploaded.' };
      const n = Math.ceil(buf.length / CHUNK);
      const batch = db.batch();
      for (let i = 0; i < n; i++) batch.set(ref.collection('chunks').doc(String(i).padStart(4, '0')), { data: buf.subarray(i * CHUNK, (i + 1) * CHUNK) });
      batch.set(ref, { path: p.path, ownerUid: p.uid, contentType, size: buf.length, chunks: n, sha256: createHash('sha256').update(buf).digest('hex'), createdAt: FieldValue.serverTimestamp() });
      await batch.commit(); // ≤ 9 chunk docs + meta: well within the 500-write batch limit, atomic
      return { status: 200 };
    },
    async inspect(path) {
      const s = await col.doc(fileId(path)).get(); if (!s.exists) return null;
      const m = s.data(); const first = await s.ref.collection('chunks').doc('0000').get();
      return { contentType: m.contentType, size: m.size, head: first.exists ? Buffer.from(first.data().data) : Buffer.alloc(0) };
    },
    async read(token) {
      const p = verifyToken(secret, token);
      if (!p || p.op !== 'get') return null;
      const s = await col.doc(fileId(p.path)).get(); if (!s.exists) return null;
      const chunks = await s.ref.collection('chunks').orderBy('__name__').get();
      return { contentType: s.data().contentType, data: Buffer.concat(chunks.docs.map((d) => Buffer.from(d.data().data))) };
    },
    remove: (path) => db.recursiveDelete(col.doc(fileId(path))),
    async removeOwner(uid) { const s = await col.where('ownerUid', '==', uid).get(); await Promise.all(s.docs.map((d) => db.recursiveDelete(d.ref))); },
    readUrl: async (path) => `${config.PUBLIC_URL}/api/v1/files/download/${signToken(secret, { op: 'get', path, exp: Date.now() + 10 * 60e3 })}`,
  };
}
