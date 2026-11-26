import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { syncOutbox, backlog } from './sheets.js';
import { logger } from '../lib/logger.js';
import { outboxState } from './outbox.js';

// Sheets sync without Cloud Tasks (Render / Spark). A Firestore lease guarantees only ONE sync runs at a time across
// all instances (keyed upserts rely on serial execution). Triggered by: writes (debounced), a periodic timer while the
// instance is awake, and the external scheduler calling /internal/sheets-sync (GitHub Actions cron) as recovery.
export async function withLease(db, name, ttlMs, fn) {
  const ref = db.collection('locks').doc(name);
  const me = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const got = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.data().until.toMillis() > Date.now() && s.data().holder !== me) return false;
    tx.set(ref, { holder: me, until: Timestamp.fromMillis(Date.now() + ttlMs), at: FieldValue.serverTimestamp() });
    return true;
  });
  if (!got) return { skipped: true };
  try { return await fn(); } finally { await ref.delete().catch(() => {}); }
}

export async function runSheetsSync({ db, client, maxBatches = 10 }) {
  return withLease(db, 'sheets-sync', 120000, async () => {
    let processed = 0, error = false;
    for (let i = 0; i < maxBatches; i++) {
      const r = await syncOutbox({ db, client });
      processed += r.processed; if (r.error) { error = true; break; } if (!r.more) break;
    }
    const b = await backlog(db);
    logger.info({ metric: 'sheets_backlog', pending: b.pending, oldestPendingSeconds: b.oldestPendingSeconds, processed, failed: error ? 1 : 0 }, 'sheets sync');
    return { processed, error, ...b };
  });
}

export function createInlineKicker({ db, client, debounceMs = 3000, intervalMs = 60000 }) {
  if (!client) return { enabled: false, kick: async () => false };
  let timer = null, running = false;
  const run = async () => {
    timer = null; if (running) return; running = true;
    try { await runSheetsSync({ db, client }); } catch (e) { logger.warn({ err: e.message }, 'inline sheets sync failed; will retry'); } finally { running = false; }
  };
  const iv = setInterval(() => { if (!running) run(); }, intervalMs); iv.unref();
  return { enabled: true, kick: async () => { if (!timer) { timer = setTimeout(run, debounceMs); timer.unref(); } return true; } };
}
export { outboxState };
