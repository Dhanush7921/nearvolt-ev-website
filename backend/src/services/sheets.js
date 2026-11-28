import { sheets as sheetsApi, auth as gauth } from '@googleapis/sheets';
import { FieldValue } from 'firebase-admin/firestore';
import { sheetSafe } from '../lib/sanitize.js';
import { logger } from '../lib/logger.js';

// Column layout per tab. Column A is always the stable key (Firebase UID or record ID).
export const COLUMNS = {
  USERS: ['uid', 'role', 'name', 'phone', 'email', 'vehicleType', 'connector', 'createdAt', 'updatedAt', 'status', 'capabilities'],
  HOSTS: ['uid', 'displayName', 'status', 'serviceArea', 'connectors', 'powerKw', 'submittedAt', 'reviewedAt', 'reviewedBy'],
  LOGIN_LOGS: ['eventId', 'uid', 'method', 'at'],
  CHARGING_REQUESTS: ['requestId', 'customerUid', 'hostUid', 'status', 'connector', 'createdAt', 'updatedAt'],
  CHARGING_HISTORY: ['requestId', 'customerUid', 'hostUid', 'finalStatus', 'completedAt'],
  COMPLAINTS: ['ticketId', 'uid', 'category', 'status', 'requestId', 'createdAt'],
  FEEDBACK: ['requestId', 'customerUid', 'hostUid', 'rating', 'at'],
  AUDIT_LOGS: ['auditId', 'actorUid', 'action', 'target', 'at'],
  SETTINGS: ['key', 'value', 'updatedAt'],
};

export function toRow(tab, row) {
  return COLUMNS[tab].map((c) => sheetSafe(row[c]));
}

export function createSheetsClient(spreadsheetId) {
  const client = sheetsApi({ version: 'v4', auth: new gauth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
  return {
    async ensureTabs() {
      const meta = await client.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      const have = new Set(meta.data.sheets.map((s) => s.properties.title));
      const missing = Object.keys(COLUMNS).filter((t) => !have.has(t));
      if (missing.length) {
        await client.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) } });
      }
      await client.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW',
        data: Object.entries(COLUMNS).map(([t, cols]) => ({ range: `${t}!A1`, values: [cols] })) } });
    },
    async readKeys(tab) {
      const r = await client.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A2:A` });
      return (r.data.values || []).map((v) => v[0]);
    },
    async writeRows(updates, appends) {
      if (updates.length) {
        await client.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW',
          data: updates.map((u) => ({ range: `${u.tab}!A${u.rowNumber}`, values: [u.values] })) } });
      }
      for (const [tab, rows] of Object.entries(appends)) {
        if (rows.length) await client.spreadsheets.values.append({ spreadsheetId, range: `${tab}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows } });
      }
    },
  };
}

// Drains the outbox in batches. Keyed upsert: existing key → overwrite its row, new key → append.
// Index is rebuilt from the sheet on every run, so a crash between write and ack never creates a second row
// for the same key on the next run (the key will be found and updated instead).
export async function syncOutbox({ db, client, batchSize = 200 }) {
  const pending = await db.collection('sheetsOutbox').where('status', '==', 'PENDING').orderBy('createdAt').limit(batchSize).get();
  if (pending.empty) return { processed: 0, more: false };
  const byTab = {};
  for (const d of pending.docs) (byTab[d.data().tab] ||= []).push(d);
  const updates = [], appends = {};
  try {
    for (const [tab, docs] of Object.entries(byTab)) {
      const keys = await client.readKeys(tab);
      const index = new Map(keys.map((k, i) => [k, i + 2]));
      const latest = new Map(); // collapse multiple queued versions of the same key
      for (const d of docs) latest.set(d.data().key, d.data().row);
      for (const [key, row] of latest) {
        const values = toRow(tab, row);
        if (index.has(key)) updates.push({ tab, rowNumber: index.get(key), values });
        else (appends[tab] ||= []).push(values);
      }
    }
    await client.writeRows(updates, appends);
  } catch (e) {
    // Read or write failure: keep rows PENDING (nothing lost), record the attempt, caller returns 503 so Cloud Tasks retries.
    logger.warn({ err: e.message }, 'sheets sync failed; will retry');
    const b = db.batch();
    pending.docs.forEach((d) => b.update(d.ref, { attempts: FieldValue.increment(1), lastError: String(e.message).slice(0, 300) }));
    await b.commit();
    return { processed: 0, failed: pending.size, error: true };
  }
  const b = db.batch();
  pending.docs.forEach((d) => b.update(d.ref, { status: 'DONE', doneAt: FieldValue.serverTimestamp() }));
  await b.commit();
  return { processed: pending.size, updated: updates.length, appended: Object.values(appends).flat().length, more: pending.size === batchSize };
}

// Reconciliation: reports duplicate keys per tab (should be zero) and outbox backlog.
export async function reconcile({ db, client }) {
  const report = {};
  for (const tab of Object.keys(COLUMNS)) {
    const keys = await client.readKeys(tab);
    const seen = new Set(), dups = new Set();
    keys.forEach((k) => (seen.has(k) ? dups.add(k) : seen.add(k)));
    report[tab] = { rows: keys.length, duplicateKeys: [...dups].slice(0, 50) };
  }
  return { tabs: report, ...(await backlog(db)) };
}

// Backlog size and age of the oldest pending row (drives the "sync delayed" alert).
export async function backlog(db) {
  const q = db.collection('sheetsOutbox').where('status', '==', 'PENDING');
  const [count, oldest] = await Promise.all([q.count().get(), q.orderBy('createdAt').limit(1).get()]);
  const at = oldest.docs[0]?.data().createdAt?.toMillis?.();
  return { pending: count.data().count, oldestPendingSeconds: at ? Math.round((Date.now() - at) / 1000) : 0 };
}
// Fault-injection wrapper (staging only) to prove a Sheets outage never blocks the app and recovers without loss.
export const faultySheetsClient = () => ({ readKeys: async () => { throw new Error('FAULT_SHEETS'); }, writeRows: async () => { throw new Error('FAULT_SHEETS'); }, ensureTabs: async () => { throw new Error('FAULT_SHEETS'); } });
