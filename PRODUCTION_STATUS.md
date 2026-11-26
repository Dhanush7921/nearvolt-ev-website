# Production status — NEARVOLT EV v1.0.0

**Release readiness: BLOCKED** — code is built and tested locally; external accounts, deployment and device/safety validation are pending. Updated 26 Nov 2026. Deadline 29 Nov 2026.

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
