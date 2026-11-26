import { Timestamp } from 'firebase-admin/firestore';
import { tooMany } from './errors.js';
// Distributed fixed-window limiter backed by Firestore (works across Cloud Run instances).
// Docs carry expireAt so a Firestore TTL policy can delete them.
export async function hitLimit(db, key, limit, windowSec) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const ref = db.collection('rateLimits').doc(`${key}_${bucket}`.replace(/\//g, '_'));
  const count = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const c = (s.exists ? s.data().count : 0) + 1;
    tx.set(ref, { count: c, expireAt: Timestamp.fromMillis((bucket + 2) * windowSec * 1000) });
    return c;
  });
  if (count > limit) throw tooMany();
}
