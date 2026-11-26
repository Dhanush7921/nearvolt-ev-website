import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { tooMany } from './errors.js';

// Distributed fixed-window limiter backed by Firestore, shared by all Cloud Run instances.
// No transaction: each hit is an atomic increment on one of `shards` documents, then the shards are summed.
// - per-user keys use 1 shard (low rate per key);
// - per-IP keys use 10 shards because many legitimate users can share one IP (mobile carrier CGNAT), which
//   would otherwise make the counter a hot document (measured: transactional counters hit lock timeouts under load).
// Counting is approximate under extreme concurrency (may admit a few extra hits) — acceptable for abuse control;
// correctness-critical logic (bookings, capacity) never relies on this.
// Docs carry expireAt so a Firestore TTL policy deletes them.
export async function hitLimit(db, key, limit, windowSec, shards = 1) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const base = `${key}_${bucket}`.replace(/\//g, '_');
  const col = db.collection('rateLimits');
  const expireAt = Timestamp.fromMillis((bucket + 2) * windowSec * 1000);
  const shard = shards > 1 ? Math.floor(Math.random() * shards) : 0;
  await col.doc(`${base}_${shard}`).set({ count: FieldValue.increment(1), expireAt }, { merge: true });
  const refs = Array.from({ length: shards }, (_, i) => col.doc(`${base}_${i}`));
  const snaps = await db.getAll(...refs);
  const count = snaps.reduce((n, s) => n + (s.exists ? s.data().count || 0 : 0), 0);
  if (count > limit) throw tooMany();
}
export const IP_SHARDS = 10;
