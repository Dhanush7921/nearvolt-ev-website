# Architecture — NEARVOLT EV v1.0.0

```
 Android app (Kotlin/Compose)        Website + Admin (Firebase Hosting, *.web.app)
        │  Firebase Auth ID token + App Check token            │
        └──────────────── HTTPS /api/v1 ───────────────────────┘
                               │
                 Cloud Run: nearvolt-api (Node 22, Express 5)
     ┌───────────────┬─────────────┼──────────────┬──────────────────┐
 Firestore       Firebase Auth   Cloud Storage    FCM            MSG91 (OTP)
 (canonical DB)  (identity,      (private host    (push)         via Secret Manager
                  custom claims)  files, signed URLs)
     │
 sheetsOutbox ──(Cloud Scheduler, OIDC, every 5 min)──► Google Sheets NEARVOLT_EV_PRODUCTION
 requests     ──(Cloud Scheduler, every minute)──────► expiry job
```

## Key decisions
| Decision | Why |
|---|---|
| Clients never touch Firestore/Storage directly; rules deny all | One enforcement point (the API) for roles, ownership, state transitions and location privacy. Removes rule-bypass/IDOR risk. |
| Single role-based Android app (customer / host), web admin | As specified; fewer apps to secure and release. |
| Roles are Firebase custom claims set only by the server | `role` set once via `/me/role`; `admin` only via `backend/scripts/grant-admin.mjs` (no API endpoint). |
| Server-validated state machine in Firestore transactions | `REQUESTED→ACCEPTED→ARRIVED→CHARGING→COMPLETED` + `REJECTED/EXPIRED/CANCELLED/DISPUTED`. Capacity (`activeSessions` vs `capacity`) is checked and incremented in the same transaction as acceptance, so concurrent accepts cannot double-book (tested). |
| Idempotency-Key required on request creation | Mobile retries on flaky networks never create duplicates (tested). |
| Transactional outbox for Google Sheets | Sheets is a reporting mirror. A Sheets outage never blocks the app; rows are keyed upserts (Firebase UID / record ID in column A), `RAW` input plus `'` prefix guards against formula injection (tested). |
| Exact host location disclosed only to the accepted customer during ACCEPTED/ARRIVED/CHARGING | Residential privacy. Search returns straight-line distance only. |
| Phone OTP: MSG91 → server verify → Firebase custom token | Cheaper than Firebase SMS in India; OTP is never stored by us; throttle state keyed by salted hash. |
| Email link sign-in on the Firebase Hosting domain + App Links | Firebase Dynamic Links are discontinued. |
| Cloud Run `asia-south1`, min 0 / max 5 instances | Low cost, capped blast radius. |

## Data model (Firestore)
`users/{uid}` (+ `devices/{fcmToken}`, `notifications/{id}`) · `hosts/{uid}` (status DRAFT→PENDING_REVIEW→APPROVED/REJECTED/SUSPENDED, private address/location, geohash, equipment, hours, verification) · `requests/{id}` (state, history[], timestamps, feedback) · `complaints`, `deletionRequests`, `auditLogs`, `loginLogs`, `settings/app` (maintenance, versions, flags, service areas) · `sheetsOutbox`, `idempotency`, `rateLimits`, `otpThrottle` (TTL-expired).

## Android app
MVVM with a small manual DI container (`AppContainer`). `AppViewModel` gates the whole app: config → update/maintenance gate → onboarding → sign-in → consent → profile/role setup → role-based shell. All network calls go through `ApiClient` (OkHttp interceptor adds ID token, App Check token and version headers; 401 triggers one forced token refresh). Reads retry with exponential backoff; request creation reuses one idempotency key per user action. Location is one-shot foreground only; manual entry accepts coordinates, Google Maps links or an address (on-device Geocoder, no paid Maps API). Navigation hands off to Google Maps via `https://www.google.com/maps/dir/?api=1&destination=lat,lng`.

## Extension points (not implemented, by design)
`featureFlags.payments` (false) and the `Ack`/request model leave room for Razorpay; `serviceAreas` is admin-editable for expansion; `/api/v1` is versioned for backward compatibility; custom domain needs only `CORS_ORIGINS`, `NV_AUTH_LINK_HOST` and `Links.SITE` changes.
