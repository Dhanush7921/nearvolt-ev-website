# Test report — 26 Nov 2026

Environment: Linux CI-like workspace, Node 22.23, JDK 21, Android SDK 37.1, Firebase emulators (firebase-tools 15.37). **No physical device or Android emulator was available (no KVM)**, and no Google Cloud project credentials were available, so nothing was run against production services.

## Backend — `cd backend && npm test` → **28 / 28 passed**
Unit (8): state machine rules · formula-injection guard · Indian mobile normalisation · geo/distance/maps URL/service area · IST opening hours incl. overnight · host power vs V×A · MSG91 request format · production config refuses unsafe defaults.
Integration on Firestore + Auth emulators (20): health · auth required / bad tokens / no self-admin / role lock · admin MFA enforcement · unverified hosts hidden + full checklist required + suspension hides host + audit entries · connector & service-area filtering · **full customer↔host workflow** (idempotent create, one active request, IDOR blocked, location hidden→shown→hidden, feedback once, ratings, Sheets outbox rows) · **concurrent accepts cannot double-book** · expiry, rejection and alternatives · maintenance mode and min-version 426 · account deletion blocked then completes · support/urgent complaints/admin resolution/public deletion request · settings validation · CORS allow-list · OTP disabled without provider · OTP send/cooldown/verify→custom token/replay rejection/hashed storage · OTP lockout · phone-link conflict · distributed limiter · Sheets keyed upsert/collapse/outage retry/reconcile · Firestore rules deny all client access.
Bug found and fixed by tests: opening hours stored as nested arrays are rejected by Firestore → changed to `{open, close}` objects.

## Security scan
`npm audit --omit=dev`: **0 vulnerabilities** (after upgrading firebase-admin 13 → 14.5.1). Dev-only tools (firebase-tools, rules-unit-testing) report advisories; they are not deployed.

## Android
- `testDevDebugUnitTest`: **6 / 6 passed** (coordinate/Maps-link parsing, labels, envelope unwrapping with unknown fields, server error codes + Idempotency-Key header, 5xx retry with backoff, no retry on 503 maintenance).
- `lintDevDebug`: **0 errors**, 12 warnings (unused resources, KTX suggestions, newer target API available).
- `assembleDevDebug`: OK. `assembleDevRelease` + `bundleDevRelease` with R8 minify + resource shrinking, signed with a throwaway test key: OK (APK 3.0 MB, AAB 7.2 MB, `apksigner verify` OK).
- Instrumentation smoke test (`LaunchTest`) written but **not run** (no device/emulator).

## Website
`npm run typecheck` OK · `npm run build` OK · `npm run verify` **166 / 166 checks passed** (existing headless-browser suite) · new admin, privacy, terms and delete-account pages rendered in headless Chromium with no console errors (one mobile overflow bug found and fixed).

## Not yet tested (release gates)
Real Google/email/phone sign-in · FCM delivery · App Check enforcement · Cloud Storage uploads · Google Sheets API writes · deployed Cloud Run behaviour · physical-device and low-end-device runs · slow-network behaviour on device · staging load test · accessibility pass with TalkBack.
