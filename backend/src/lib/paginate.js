import { bad } from './errors.js';
// Cursor pagination: cursor = last document id from the previous page.
export async function paginate(query, collectionRef, { cursor, limit = 20 }) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  let q = query.limit(lim + 1);
  if (cursor) {
    const c = await collectionRef.doc(String(cursor)).get();
    if (!c.exists) throw bad('Invalid cursor.');
    q = q.startAfter(c);
  }
  const snap = await q.get();
  const docs = snap.docs.slice(0, lim);
  return { items: docs, nextCursor: snap.docs.length > lim ? docs[docs.length - 1].id : null };
}
export const ts = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v ?? null);
