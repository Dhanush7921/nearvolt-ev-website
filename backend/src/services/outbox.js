import { FieldValue } from 'firebase-admin/firestore';
// Transactional outbox for Google Sheets. Rows are queued with the business write and pushed later,
// so a Sheets outage never blocks the app. `key` makes the upsert idempotent.
export const TABS = ['USERS', 'HOSTS', 'LOGIN_LOGS', 'CHARGING_REQUESTS', 'CHARGING_HISTORY', 'COMPLAINTS', 'FEEDBACK', 'AUDIT_LOGS', 'SETTINGS'];
// Global sequence lets middleware detect that a request queued rows (to kick Cloud Tasks).
export const outboxState = { seq: 0 };
export function enqueue(db, tx, tab, key, row) {
  if (!TABS.includes(tab)) throw new Error(`unknown tab ${tab}`);
  outboxState.seq++;
  const ref = db.collection('sheetsOutbox').doc();
  const doc = { tab, key: String(key), row, status: 'PENDING', attempts: 0, createdAt: FieldValue.serverTimestamp() };
  tx ? tx.set(ref, doc) : ref.set(doc);
}
