// Owner-only break-glass for app version gating while admin MFA enrolment is pending.
// Runs locally with the owner's Google credentials (never exposed as an API, never in the app):
//   gcloud auth application-default login
//   $env:GOOGLE_CLOUD_PROJECT="nearvolt-ev"; node scripts/set-app-version.mjs --min 2 --latest 2 [--dry-run]
// Every change is written to auditLogs (visible in the admin Security tab) with the previous values, so it can be reviewed and reverted.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { execSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => { const [k, v] = a.trim().split(/\s+/); return [k, v ?? true]; }));
const min = Number(args.min), latest = Number(args.latest ?? args.min);
if (!Number.isInteger(min) || min < 1 || min > 1000 || !Number.isInteger(latest) || latest < min) {
  console.error('usage: node scripts/set-app-version.mjs --min <code> [--latest <code>] [--dry-run]   (latest >= min)'); process.exit(1);
}
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) { console.error('Set GOOGLE_CLOUD_PROJECT (e.g. nearvolt-ev).'); process.exit(1); }
initializeApp({ credential: applicationDefault(), projectId: project });
const db = getFirestore();
const ref = db.collection('settings').doc('app');
const before = (await ref.get()).data() || {};
let operator = 'owner-cli';
try { operator = execSync('gcloud config get-value account', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || operator; } catch { /* gcloud optional */ }
console.log(`Project ${project}: minSupportedVersionCode ${before.minSupportedVersionCode ?? 1} -> ${min}, latestVersionCode ${before.latestVersionCode ?? 1} -> ${latest}`);
if (args['dry-run']) { console.log('Dry run: nothing written.'); process.exit(0); }
await db.runTransaction(async (tx) => {
  tx.set(ref, { minSupportedVersionCode: min, latestVersionCode: latest, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  // Same shape as API audit entries, and listed under the admin Security tab ('settings.update').
  tx.set(db.collection('auditLogs').doc(), { actorUid: operator, actorType: 'owner-cli', action: 'settings.update', target: 'settings/app',
    meta: { field: 'appVersion', before: { min: before.minSupportedVersionCode ?? null, latest: before.latestVersionCode ?? null }, after: { min, latest } }, at: FieldValue.serverTimestamp() });
});
console.log('Saved and audited. Servers pick it up within 30 seconds.');
