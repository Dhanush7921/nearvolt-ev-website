# Production status — NEARVOLT EV v1.0.0

**Release readiness: BLOCKED** — code is built and tested locally; external accounts, deployment and device/safety validation are pending. Updated 26 Nov 2026 (14:00 IST). Deadline 29 Nov 2026.

## Done (verified locally)
- Scalability upgrade: Cloud Tasks Sheets sync, load shedding with emergency priority, hot-document fixes, sharded rate limits, discovery cache, compression, deadlines, k6 suite, monitoring/alert/budget scripts, Cloud Armor evaluation. Local load tests on 10,201 users: 500 simultaneous users p95 39 ms, 0 unexpected errors; zero double-booking; zero lost acknowledged requests after crash. See SCALABILITY_REPORT.md.
- Backend `/api/v1` (Cloud Run-ready): auth, roles, host onboarding/verification, discovery, transactional request state machine, OTP (MSG91), Sheets outbox, admin APIs, internal jobs. 28/28 tests on emulators; 0 prod dependency vulnerabilities.
- Firestore/Storage rules (deny-all) + indexes + TTL; rules tested.
- Android app (Kotlin, Compose, Material 3, MVVM): customer + host roles in one app, all screens listed in the spec; debug and R8 release builds succeed; 6/6 unit tests; lint 0 errors.
- Admin web dashboard, privacy policy, terms, public account-deletion page (Firebase Hosting build); existing website verified 166/166.
- CI (tests, lint, gitleaks) and manual deploy workflows (keyless WIF); GCP setup + scheduler scripts.

## Release gates (pending)
| # | Gate | Owner | Status |
|---|---|---|---|
| 1 | Firebase dev/prod projects, billing (Blaze), run `infra/setup-gcp.sh` | Owner | ⏳ |
| 2 | `google-services.json`, SHA-1/SHA-256 (debug, upload, Play signing), Google web client ID | Owner | ⏳ |
| 3 | Deploy backend + schedulers; deploy Hosting; set GitHub environment variables | Owner / CI | ⏳ |
| 4 | MSG91 account, KYC, DLT entity + OTP template approval, secrets added | Owner | ⏳ |
| 5 | Google Sheet created and shared with runtime SA; `/internal/sheets-setup` run | Owner | ⏳ |
| 6 | Upload keystore created by owner; Play App Signing enrolled; signed prod AAB built | Owner | ⏳ |
| 7 | End-to-end test on real devices (incl. low-end Android, slow network, TalkBack) | QA | ⏳ |
| 8 | Real host electrical inspections by a qualified electrician; first hosts approved | Operations | ⏳ |
| 9 | Legal review of privacy policy & terms; operator/grievance details published | Legal | ⏳ |
| 10 | Play Console: listing, Data Safety, content rating, real screenshots, closed testing | Owner | ⏳ |
| 11 | Staging load test, restore drill, budget alert, App Check enforcement | Owner / Eng | ⏳ |
| 12 | **10k scalability:** staging project; k6 ramp1000→ramp10000, spike, peak, soak, race, auth, stress from a separate VM; record results in LOAD_TEST_RESULTS.md; tune MIN/MAX_INSTANCES, CONCURRENCY, MAX_INFLIGHT | Owner / Eng | ⏳ (local evidence only) |
| 13 | Billing approval for `MIN_INSTANCES=1` (≈ ₹1,100/month) and staging test spend; monitoring + budget scripts run | Owner | ⏳ |
| 14 | Merge `production/v1` to `main`; tag `v1.0.0` only after gates 1–13 pass | Eng | ⏳ |

## Follow-ups (non-blocking)
- Migrate FCM registration tokens to Installation IDs (firebase-messaging 25.1.2 deprecation; tokens still supported).
- Telugu and Hindi translations (`values-te`, `values-hi`; all UI strings are already in resources).
- Host opening hours: per-day different times (API supports it; app editor uses one time range for selected days).
- Roborazzi screenshot tests; Cloud Armor if abuse appears.

## Execution attempt — 26 Nov 2026, 14:00 IST
Checked for usable credentials before deploying: this workspace has **no** Google Cloud, Firebase, GitHub-push, MSG91 or signing
credentials; the linked Windows PC is reachable only through folders the owner connects, and access to `~/NEARVOLT-EV` was not granted
in this session. Therefore **nothing was deployed and no real-account test was run**. Completed: standalone bundle
`nearvolt-complete-v1.bundle` (`git bundle create --all`), restored into a fresh directory and verified (22 commits, both branches, fsck clean).

## Owner action checklist (in order — everything else is ready in the repo)
1. **Push code:** `git clone nearvolt-complete-v1.bundle NEARVOLT-EV` (or `git fetch <bundle> production/v1:production/v1`) → `git push origin production/v1 main`.
2. **Firebase projects** `nearvolt-ev-staging` and `nearvolt-ev-prod` on the Blaze plan; enable Google + Email-link sign-in; upgrade to Identity Platform and enable TOTP MFA.
3. **Run** `infra/setup-gcp.sh` for each (Cloud Shell, project Owner). Approve billing for `MIN_INSTANCES=1` (≈ ₹1,100/month) or set `MIN_INSTANCES=0`.
4. **Android app registration:** add `com.nearvolt.ev` / `.dev`; download `google-services.json` into `android/app/src/{prod,dev}/`; note the Google **web client ID**.
5. **Signing:** create the upload keystore yourself (ANDROID_STUDIO_SETUP.md), keep it offline; enrol in Play App Signing; register debug/upload/Play SHA-1 + SHA-256 in Firebase.
6. **GitHub:** create environments `staging`/`prod` with the variables in DEPLOYMENT_GUIDE.md; run **Deploy backend** then **Deploy website + admin**; run `infra/schedule-jobs.sh`, `infra/monitoring/setup-monitoring.sh`, `setup-budget.sh`.
7. **Google Sheet** `NEARVOLT_EV_PRODUCTION`: share (Editor) with the runtime service account; set `SHEETS_SPREADSHEET_ID`; call `/internal/sheets-setup`.
8. **MSG91:** KYC + DLT entity and OTP template approval; add `msg91-auth-key` / `msg91-template-id` secrets. Test with your own number only.
9. **First admin:** `node backend/scripts/grant-admin.mjs <email>`; enrol TOTP.
10. **Build:** `NV_PROD_API_BASE_URL=<Cloud Run URL> NV_GOOGLE_WEB_CLIENT_ID=… NV_AUTH_LINK_HOST=nearvolt-ev-prod.firebaseapp.com ./gradlew bundleProdRelease assembleProdRelease`.
11. **Device tests:** install on 2+ physical phones (one low-end); run Google, email-link and OTP sign-in, full customer↔host flow, Sheets row check, push, account deletion; TalkBack pass.
12. **10k load tests on staging** (LOAD_TEST_RESULTS.md → "How to reproduce") from a separate VM, within your approved spend; update the reports with measured numbers.
13. **Operations/legal:** electrician inspections for first hosts; legal review of privacy/terms + operator & grievance details; Play Console listing, Data Safety, content rating, closed testing.
14. Then merge to `main` and tag `v1.0.0`.

## Hosting change — Render (26 Nov 2026, 16:05 IST)
- **API deployed on Render Free:** https://nearvolt-api-0rxa.onrender.com — health 200, `ready:false` until the Firebase service-account key is
  added (data endpoints return `503 SERVER_NOT_CONFIGURED` in ~1 s). Branch `production/v1` pushed to GitHub; Render auto-deploys it.
- Code adapted for Firebase Spark (no Cloud Storage / Tasks / Scheduler): Firestore file storage via signed links, inline Sheets sync with lease,
  token-authenticated internal jobs + GitHub Actions cron. 41/41 backend tests. Cloud Run path retained.
- Android: `NV_PROD_API_BASE_URL` (and dev default) = the Render URL; cold-start tolerant; APK rebuilt. Real login **not verified**: no
  `google-services.json`, so the app stops at "App not configured" and the server has no Firebase credentials yet.
- Startup connection error cause found: the app was pointing at the old `nearvolt-ev-website` Render service (failed deploy, no API) or at
  `10.0.2.2` (emulator-only address) on a phone. Both fixed in build config.
- Owner steps: RENDER_DEPLOYMENT.md. Free-tier limits there; **10K scalability not achievable or verified on Render Free**.

## Zero-billing decision — 26 Nov 2026, 16:40 IST
- **Cloudflare Workers evaluated, not adopted for V1 (owner chose Render):** the official Firebase Admin SDK needs gRPC, which Workers does not
  support, so migration would mean rewriting the Firestore/Auth/FCM data layer onto REST; Workers Free also caps the API at 100k requests/day and
  10 ms CPU per request. Cloudflare Queues are on the free plan (24 h retention). Revisit for a later release if needed.
- **Backend stays on Render Free** (no card, no Google billing): https://nearvolt-api-0rxa.onrender.com, `FIREBASE_PROJECT_ID=nearvolt-ev` set.
- "No connection" on the phone: the local checkout predates the commit that sets `NV_PROD_API_BASE_URL`, so the build targets `https://api.invalid/`.
  Fix = pull `production/v1` and rebuild.
- Spark gaps handled: Google web client ID read from google-services.json; expired technical records purged by the scheduled job (no free TTL).
  Backend 42/42 tests.
- Real Google/email/OTP login, Sheets sync and FCM on the live server: **not yet verified** (needs the service-account key on Render).

## Auth incident — 26 Nov 2026 (Google sign-in spinner)
- **Root cause (log evidence):** Render logs at 17:09:58–17:10:20Z show every authenticated call rejected with `auth_fail code=APP_CHECK_REQUIRED`. The app is not sending an App Check token, because the debug-build App Check token is not registered in Firebase. Firebase sign-in on the device succeeded.
- **Client defects that turned this into an endless spinner (fixed in 9c99950):**
  - Login waited for the session call and FCM registration to finish before completing.
  - A `/me` 401 caused a silent sign-out loop.
  - There were no overall timeouts.
- **Fixes:**
  - Backend (2d1f328): distinct rejection codes. App Check and authorization are still enforced.
  - Android (9c99950): login is non-blocking with bounded timeouts, and each server code shows an explicit error state. Email links are replaced by verified email/password sign-in.
- **Tests:** backend 43/43 passing; Android unit tests 7/7 (dev) and 7/7 (prod); lint 0 errors; prodDebug APK built.
- **Pending (owner):** register the App Check debug token, enable the Email/Password provider, and verify on a device.
