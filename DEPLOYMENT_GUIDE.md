# Deployment guide

Nothing here has been run against a real Google Cloud project yet (no project credentials were available during development). Steps are written to be run by the project owner. Region: `asia-south1` (Mumbai).

## 1. Firebase / Google Cloud projects (owner, once per environment)
1. Create `nearvolt-ev-dev` and `nearvolt-ev-prod` in the Firebase console; link a billing account (Blaze plan; needed for Cloud Run, Secret Manager, Scheduler, PITR).
2. Authentication → enable **Google** and **Email link (passwordless)**. Settings → *Authorized domains*: keep `<project>.firebaseapp.com` and `<project>.web.app`.
3. Upgrade to Identity Platform (Authentication → Settings) and enable **TOTP multi-factor** for admins.
4. Add an **Android app** `com.nearvolt.ev` (prod) and `com.nearvolt.ev.dev` (dev). Register SHA-1 and SHA-256 of: the debug keystore, the upload key, and the **Play App Signing** key (Play Console → Setup → App signing). Download `google-services.json` into `android/app/src/prod/` and `android/app/src/dev/` (git-ignored).
5. App Check → register the Android app with **Play Integrity**, the web app with **reCAPTCHA Enterprise**. Enforce after the first release is verified.
6. Run `infra/setup-gcp.sh` from Cloud Shell (`ENV=prod PROJECT_ID=nearvolt-ev-prod GITHUB_REPO=Dhanush7921/nearvolt-ev-website`). It enables APIs, creates Firestore with PITR + daily backups, the private host-files bucket, least-privilege service accounts, keyless GitHub federation and Secret Manager entries.
7. Add MSG91 secrets once KYC + DLT template approval are done: `printf '%s' "$KEY" | gcloud secrets versions add msg91-auth-key --data-file=-` (and `msg91-template-id`). Until then phone login stays disabled automatically (the app hides the option).

## 2. Google Sheets
Create a private sheet **NEARVOLT_EV_PRODUCTION**, share it (Editor) with `nearvolt-api@<project>.iam.gserviceaccount.com`, and put its ID in the GitHub variable `SHEETS_SPREADSHEET_ID`. After the first backend deploy, call `/internal/sheets-setup` once (command printed by `infra/schedule-jobs.sh`) to create the nine tabs and headers.

## 3. GitHub
Settings → Environments → create `dev` and `prod` (add required reviewers on `prod`). Variables (not secrets — none of these are secret): `GCP_PROJECT_ID, GCP_REGION=asia-south1, GCP_WIF_PROVIDER, GCP_DEPLOY_SA, API_RUNTIME_SA, SCHEDULER_SA_EMAIL, STORAGE_BUCKET, SHEETS_SPREADSHEET_ID, APP_ENV, CORS_ORIGINS=https://<project>.web.app,https://<project>.firebaseapp.com, API_BASE_URL, FIREBASE_WEB_API_KEY, FIREBASE_WEB_APP_ID`.

## 4. Deploy
1. Actions → **Deploy backend (Cloud Run)** → env. The job runs the test suite first, deploys, then calls `/api/v1/health`.
2. `PROJECT_ID=… API_URL=<service URL> ./infra/schedule-jobs.sh` (expiry every minute, Sheets sync every 5 min, nightly reconcile).
3. Set `API_BASE_URL` to the service URL, then Actions → **Deploy website + admin** (also deploys Firestore/Storage rules and indexes).
4. Grant the first admin: `gcloud auth application-default login && GOOGLE_CLOUD_PROJECT=nearvolt-ev-prod node backend/scripts/grant-admin.mjs you@example.com`, then enrol TOTP before signing in at `https://<project>.web.app/admin/`.
5. Budget: Billing → Budgets & alerts → e.g. ₹2,000/month with 50/90/100 % email alerts.
6. The GitHub Pages site keeps running until the Firebase Hosting site is verified; then update links and disable `deploy.yml`.

## 4b. Staging, monitoring and load tests (required before release)
1. Create `nearvolt-ev-staging` the same way (`ENV=staging`), deploy with `APP_ENV=staging OTP_PROVIDER=mock`.
2. Run `infra/monitoring/setup-monitoring.sh` and `setup-budget.sh` for staging and prod.
3. Follow LOAD_TEST_RESULTS.md → "How to reproduce" from a separate VM; update LOAD_TEST_RESULTS.md with the measured numbers.

## 5. Android release
See ANDROID_STUDIO_SETUP.md. Build with `NV_PROD_API_BASE_URL=<Cloud Run URL> NV_GOOGLE_WEB_CLIENT_ID=<web OAuth client ID> NV_AUTH_LINK_HOST=<project>.firebaseapp.com ./gradlew bundleProdRelease` (the build refuses a prod release without a real HTTPS API URL).

## Rollback
Cloud Run: `gcloud run services update-traffic nearvolt-api-prod --to-revisions=<previous>=100`. Hosting: Firebase console → Hosting → release history → Roll back. Android: halt the staged rollout in Play Console; use `minSupportedVersionCode` only for security-critical forced updates.
