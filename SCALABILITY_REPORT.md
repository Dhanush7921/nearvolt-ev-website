# Scalability report — NEARVOLT EV v1.0.0 (10k-user upgrade)

**Status: implemented, partially verified, release BLOCKED** until the staging load tests in LOAD_TEST_RESULTS.md pass.

## What changed for scale
| Area | Implementation | Verified |
|---|---|---|
| Cloud Run | Stateless API; deploy defaults **1 vCPU, 1 GiB, min 1, max 50, concurrency 40**, 30 s timeout, startup CPU boost, gen2 — all overridable per environment (`MIN_INSTANCES`, `MAX_INSTANCES`, `CONCURRENCY`, `MEMORY`, `MAX_INFLIGHT`) in `.github/workflows/deploy-backend.yml`. Region `asia-south1` (Mumbai). | Config only — autoscaling not yet observed |
| Overload protection | Per-instance load shedder (event-loop lag p99 > 250 ms or in-flight ≥ `MAX_INFLIGHT`) returns `503 OVERLOADED` + `Retry-After` for low-priority reads; **booking, transitions, sign-in and internal jobs are never shed**. Request deadlines 15 s (reads) / 28 s (writes). | ✅ unit + saturation run: 11,794 reads shed, 0 bookings lost |
| Hot documents | Per-host in-process mutex for capacity transitions; booking creation no longer locks the host doc; Firestore `ABORTED` → `503 BUSY_RETRY`; rate-limit counters sharded (10 shards per IP key), non-transactional. | ✅ 300-way race, 455 req/s sign-in |
| Discovery | Geohash range queries (bounded, indexed `status+geohash`), 5 s shared range cache with invalidation on approve/suspend/listing/availability changes; `checkedAt` on every response; booking re-checks in a transaction (stale data can never confirm a booking). | ✅ |
| Google Sheets | Durable outbox in Firestore (written in the same transaction as the business write) → **Cloud Tasks** queue `sheets-sync` (1 dispatch/s, 1 concurrent, unlimited retries with 10 s–10 min exponential backoff, named tasks de-duplicate kicks) → keyed upserts, batched per tab. Cloud Scheduler sweep every 2 min recovers anything missed; nightly reconcile reports duplicates; delay alert when oldest row > 15 min. | ✅ outage test (no loss, no duplicates); Cloud Tasks itself not yet run |
| Rate limiting | Per-IP (in-memory backstop), per-account (Firestore, shared across instances: OTP, bookings, tickets, sessions), per-device via App Check tokens, per-user discovery bucket. | ✅ |
| Clients | Android retries transient errors (5xx, `OVERLOADED`, `TIMEOUT`, `BUSY_RETRY`) with exponential backoff + full jitter, honours `Retry-After`; idempotency keys on booking; no background GPS; request screen refreshes every 15 s only while visible and active, plus push. | ✅ 7 Android unit tests |
| Other | gzip compression; 64 KB body limit; SDK clients reused; keep-alive tuned; bounded expiry job (≤ 10 × 100 docs, 20 s budget); fault-injection switches (`FAULT_SHEETS`, `FAULT_FCM`, `OTP_PROVIDER=mock`) refused in prod. | ✅ |

## Cloud Armor evaluation
- Requires a global external Application Load Balancer. Cost (Google list prices): forwarding rule ≈ US$0.025/hour (≈ US$18/month),
  Cloud Armor Standard **US$5 per policy/month + US$1 per rule/month + US$0.75 per million requests** → ≈ US$25–30/month base (≈ ₹2,200–2,600).
- A Google-managed TLS certificate needs a **domain you own**; custom domain is out of scope for v1.0.0. Without it, the protection
  layer cannot be placed in front of the API properly.
- **Decision: prepared, not activated.** `infra/cloud-armor.sh` (interactive, requires typing YES) creates the LB, a per-IP rate-based
  ban rule, OWASP rules in preview, and documents locking Cloud Run ingress to `internal-and-cloud-load-balancing` so the
  `*.run.app` URL cannot bypass it. Recommended when the domain is purchased or if abuse alerts fire.
- Current layered protection without it: Google front-end DDoS absorption for `*.run.app`, App Check, auth on all data endpoints,
  distributed limits, load shedding, max 50 instances (cost ceiling), budget alerts. **No setup protects against every DDoS attack.**

## Billing items that need your authorisation
| Item | Why | Approx. cost |
|---|---|---|
| `MIN_INSTANCES=1` (prod) | Removes cold starts for emergency requests | ≈ US$13/month (≈ ₹1,100) idle — verify in the Google Cloud pricing calculator |
| Staging project + load tests | Required to verify the targets | Load-generator VM ≈ US$0.3/hour; Cloud Run/Firestore during tests ≈ US$5–30 per full test series (*estimate*) |
| Cloud Armor (optional, needs domain) | WAF / L7 DDoS rules | ≈ ₹2,200–2,600/month + per-request |

## Targets vs evidence
| Target | Evidence | Status |
|---|---|---|
| ≥ 10,000 registered users | 10,201 seeded and served (emulator) | ✅ locally |
| 5,000 DAU / 1,000 simultaneous | 500 simultaneous measured locally | ⏳ staging |
| 10,000 simultaneous VUs | scripts ready | ⏳ staging |
| p95 < 500 ms normal / < 1 s peak | 39 ms at 500 users locally | ⏳ staging |
| Unexpected errors < 0.1 % | 0 % locally | ⏳ staging |
| 99.9 % availability | uptime check + alerts configured in scripts; needs a month of production data | ⏳ |
| Zero lost acknowledged requests | 522/522 after crash | ✅ locally |
| Zero duplicate bookings | 300-way race | ✅ locally |
| Zero unauthorized access | authz tests (IDOR, roles, admin MFA), deny-all rules | ✅ tests; no pen-test |
