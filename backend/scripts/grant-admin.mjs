// Grants or revokes the admin custom claim. Run locally by a project owner with Application Default Credentials:
//   gcloud auth application-default login && GOOGLE_CLOUD_PROJECT=nearvolt-ev-prod node scripts/grant-admin.mjs admin@example.com [--revoke]
// There is intentionally no API endpoint for this: users can never grant themselves admin.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
const [email, flag] = process.argv.slice(2);
if (!email) { console.error('usage: node scripts/grant-admin.mjs <email> [--revoke]'); process.exit(1); }
initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const u = await auth.getUserByEmail(email);
if (!u.emailVerified) { console.error('Refusing: email not verified.'); process.exit(1); }
const claims = { ...(u.customClaims || {}) };
if (flag === '--revoke') delete claims.admin; else claims.admin = true;
await auth.setCustomUserClaims(u.uid, claims);
await auth.revokeRefreshTokens(u.uid); // forces fresh tokens with the new claim
console.log(`${flag === '--revoke' ? 'Revoked' : 'Granted'} admin for ${email} (${u.uid}). Ensure TOTP MFA is enrolled before use.`);
