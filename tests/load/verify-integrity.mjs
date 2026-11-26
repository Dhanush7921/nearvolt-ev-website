// Post-test data-integrity audit (emulator or staging). Checks: no host over capacity, activeSessions equals the
// number of capacity-holding requests per host, no customer with >1 active request, every request has a consistent
// history, and no acknowledged request was lost (count of request docs >= acknowledged count passed via ACK=).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const PROJECT_ID = process.env.PROJECT_ID || '';
if (!/^(demo-|.*-(dev|staging|test|loadtest)$)/.test(PROJECT_ID)) { console.error('Refusing non-test project'); process.exit(1); }
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const HOLD = new Set(['ACCEPTED', 'ARRIVED', 'CHARGING']), ACTIVE = new Set(['REQUESTED', 'ACCEPTED', 'ARRIVED', 'CHARGING']);
const reqs = await db.collection('requests').get();
const holding = new Map(), activeByCustomer = new Map(); let badHistory = 0;
for (const d of reqs.docs) {
  const r = d.data();
  if (HOLD.has(r.status)) holding.set(r.hostUid, (holding.get(r.hostUid) || 0) + 1);
  if (ACTIVE.has(r.status) && !(r.status === 'REQUESTED' && r.expiresAt.toMillis() < Date.now())) activeByCustomer.set(r.customerUid, (activeByCustomer.get(r.customerUid) || 0) + 1);
  const h = r.history || [];
  if (!h.length || h[h.length - 1].to !== r.status || h[0].to !== 'REQUESTED') badHistory++;
}
const hosts = await db.collection('hosts').get();
let overCapacity = 0, counterMismatch = 0;
for (const d of hosts.docs) {
  const h = d.data(); const n = holding.get(d.id) || 0;
  if ((h.activeSessions || 0) > (h.equipment?.capacity || 1)) overCapacity++;
  if ((h.activeSessions || 0) !== n) counterMismatch++;
}
const multiActive = [...activeByCustomer.values()].filter((n) => n > 1).length;
const ack = Number(process.env.ACK || 0);
const out = { requests: reqs.size, acknowledgedReported: ack, lostAcknowledged: Math.max(0, ack - reqs.size), hostsChecked: hosts.size, overCapacity, counterMismatch, customersWithMultipleActive: multiActive, inconsistentHistory: badHistory };
out.pass = !out.lostAcknowledged && !overCapacity && !counterMismatch && !multiActive && !badHistory;
console.log(JSON.stringify(out));
process.exit(out.pass ? 0 : 1);
