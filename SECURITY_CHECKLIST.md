# Security checklist (v1.0.0)

Status key: ✅ implemented and covered by automated tests · 🟢 implemented, not yet verified in a deployed environment · ⏳ requires an external step.

| Area | Control | Status |
|---|---|---|
| AuthN | Firebase ID tokens verified with revocation check on every request | ✅ |
| AuthZ | Roles from server-set custom claims; users cannot self-assign admin; role locked after first choice | ✅ |
| AuthZ | Participant-only access to requests; non-participants get 404 (no IDOR oracle) | ✅ |
| AuthZ | Admin routes need `admin` claim **and** a second factor (`REQUIRE_ADMIN_MFA=true`) | ✅ (MFA enforcement); ⏳ TOTP enrolment |
| Data | Firestore + Storage rules deny all client access (Admin SDK only) | ✅ rules tests |
| Privacy | Host address/coordinates never in search; disclosed only to accepted customer during the visit; push bodies contain no address | ✅ |
| Workflow | Server-side state machine, transactions, capacity checks, idempotency keys, duplicate active-request prevention | ✅ incl. concurrency test |
| OTP | Provider-generated OTP, never stored; 30 s cooldown, 5 sends/h/number, 60/h/IP backstop (CGNAT-safe), 5 wrong → 1 h lock, single-use, salted-hash keys, no test numbers | ✅ (fake provider); ⏳ live MSG91 |
| Abuse | Per-IP in-memory backstop + Firestore-backed distributed limits (sharded counters; per-IP keys 10 shards because of mobile CGNAT) for OTP, request creation, tickets, deletion requests, sessions; per-user discovery bucket; load shedding of low-priority reads | ✅ incl. load test |
| Input | zod validation on every body/query (strict objects, length limits); 64 KB JSON limit | ✅ |
| Injection | No string-built queries; Sheets `RAW` input + `'` prefix; CSV export escaped | ✅ |
| XSS/CSRF | Admin renders with DOM APIs only (no innerHTML) + strict CSP; bearer tokens (no cookies) so CSRF does not apply | 🟢 |
| Uploads | Signed V4 URLs (10 min, size-capped, type-fixed), magic-byte check on confirm, private bucket with public-access prevention, admin read links 10 min | 🟢 (needs real bucket) |
| Transport | HTTPS only; Android cleartext disabled (dev flavor allows only 10.0.2.2/localhost); HSTS on Hosting | 🟢 |
| App integrity | App Check (Play Integrity) verified server-side when `REQUIRE_APP_CHECK=true`; debug provider only in debug builds | 🟢 ⏳ console registration |
| CORS | Exact-origin allow-list; production refuses to start without it | ✅ |
| Secrets | Secret Manager for MSG91/OTP salt; keyless GitHub deploys (WIF); keystores & google-services.json git-ignored; gitleaks in CI | 🟢 |
| IAM | Dedicated runtime / scheduler / deployer service accounts with scoped roles; internal jobs verify OIDC audience + SA email | 🟢 |
| Logging | Structured JSON logs with redaction of tokens, OTPs, phone, email, coordinates, addresses; admin actions audit-logged | ✅ audit; 🟢 redaction |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities (firebase-admin 14.5.1). Dev-only tooling has advisories (not shipped) | ✅ |
| Limits | Cloud Run max 5 instances, 30 s timeout, 512 MiB; billing budget alerts | ⏳ budget |
| Backups | Firestore PITR (7 days) + daily backups kept 14 days | 🟢 script; ⏳ run |

Test-only switches (`OTP_PROVIDER=mock`, `FAULT_SHEETS`, `FAULT_FCM`) make the server refuse to start when `APP_ENV=prod` (tested).

Known gaps / not claimed: no penetration test has been performed; App Check is not a complete defence against scripted abuse; WAF (Cloud Armor) is not configured (needs a load balancer, extra cost). The app is not "unhackable".
