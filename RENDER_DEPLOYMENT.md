# Render deployment (interim, while Google Cloud billing is postponed)

**Live API:** https://nearvolt-api-0rxa.onrender.com · health: `/api/v1/health` · Render service `srv-dc40juqjnfac73b51g30`
(blueprint `exs-dc40jrec6qcc73c5a030`, region Singapore, Free plan, auto-deploys every push to `production/v1`).
Status on 26 Nov 2026: **running, `ready:false`** — every data endpoint answers `503 SERVER_NOT_CONFIGURED` until Firebase credentials are added.

## What changed vs Cloud Run (all switchable by env, code supports both)
| Cloud Run / Blaze | Render / Firebase Spark | Setting |
|---|---|---|
| Runtime service account | Service-account key in a Render secret env var | `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_ID` |
| Cloud Storage signed URLs | Private chunked storage in Firestore via 10-min HMAC links (max 5 MB/file) | `STORAGE_DRIVER=firestore`, `FILE_URL_SECRET` |
| Cloud Tasks | In-process worker + Firestore lease (one sync at a time) | `SYNC_DRIVER=inline` |
| Cloud Scheduler (OIDC) | GitHub Actions cron every 5 min with a bearer secret | `INTERNAL_TASK_TOKEN`, `.github/workflows/render-jobs.yml` |
Return to Cloud Run: deploy with `deploy-backend.yml`, set `STORAGE_DRIVER=gcs`, `SYNC_DRIVER=cloudtasks`, OIDC vars; no code change.

## Owner steps to make it fully work (secrets are entered in the Render dashboard, never in chat or Git)
1. Firebase console (Spark is fine) → Project settings → **Service accounts → Generate new private key**. In Render → `nearvolt-api-0rxa` → Environment: set
   `FIREBASE_SERVICE_ACCOUNT_JSON` (paste the JSON) and `FIREBASE_PROJECT_ID`. Save → redeploys → `/api/v1/health` shows `ready:true`.
2. Firebase: enable Google + Email-link sign-in; add the Android app(s) with SHA-1/SHA-256; put `google-services.json` in `android/app/src/{prod,dev}/`;
   build with `-PNV_GOOGLE_WEB_CLIENT_ID=<web client id>`. Register App Check (Play Integrity) and the debug token, or real requests are rejected
   (`REQUIRE_APP_CHECK=true`). Deploy `firebase/firestore.rules` and indexes (`firebase deploy --only firestore`, works on Spark).
3. Google Sheet `NEARVOLT_EV_PRODUCTION`: share as **Editor** with the service account's `client_email`; set `SHEETS_SPREADSHEET_ID`; then call
   `/internal/sheets-setup` once with the token (Render → Environment → `INTERNAL_TASK_TOKEN`).
4. MSG91 (after KYC + DLT approval): set `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`. Phone login appears automatically when configured.
5. GitHub → Settings → Secrets → Actions: `NV_API_URL=https://nearvolt-api-0rxa.onrender.com`, `NV_INTERNAL_TASK_TOKEN=<same token>`.
   **Scheduled workflows only run from the default branch**, so merge `.github/workflows/render-jobs.yml` into `main` (or merge the branch) to activate it.
6. Admin dashboard origin: when it is hosted (Firebase Hosting works on Spark), add its URL to `CORS_ORIGINS`.
7. The older service `nearvolt-ev-website` (Oregon) failed its last deploy and is now pointed at `production/v1` with a root build that has no
   `start` script — delete or repoint it; the website itself stays on GitHub Pages.

## Free-tier limitations (verified from Render/Firebase docs, 26 Nov 2026)
- Spins down after **15 min without traffic**; spin-up takes **up to a minute** (the 5-min cron keeps it warm; the Android app waits up to 60 s and retries).
- **750 free instance hours per workspace per month** (one service 24/7 ≈ 720 h); exceeding suspends free services until next month.
- **Single instance, 512 MB RAM / 0.1 CPU**, no autoscaling, ephemeral disk, Render may restart free services at any time.
- Firebase Spark: no Cloud Storage (files kept in Firestore, 1 GiB total free storage), Firestore 50k reads / 20k writes per day; exceeding
  these **stops** the feature for the day (no overage billing on Spark).
- **10K-user target is not achievable on this tier**: measured locally one instance handled ~330 req/s on 2 vCPU; Render Free has 0.1 CPU and
  one instance. A paid Render plan with autoscaling (Pro and above) or Cloud Run + Blaze is required, and capacity must be load-tested there.
