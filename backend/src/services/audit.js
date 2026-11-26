import { FieldValue } from 'firebase-admin/firestore';
// Append-only audit trail. Writes through a transaction when given one.
export function auditEntry(actor, action, target, meta = {}) {
  return { actorUid: actor?.uid || 'system', actorType: actor?.admin ? 'admin' : actor?.role || 'system',
    action, target, meta, at: FieldValue.serverTimestamp() };
}
export function writeAudit(db, tx, entry) {
  const ref = db.collection('auditLogs').doc();
  tx ? tx.set(ref, entry) : ref.set(entry);
  return ref.id;
}
