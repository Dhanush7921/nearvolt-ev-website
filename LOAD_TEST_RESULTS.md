# Load test results — 26 Nov 2026

> **Scope of this evidence.** All runs below were executed on one **local** machine (2 vCPU, ~8 GB RAM, memory-limited
> container): one API process (production build, `APP_ENV=staging`, mock OTP), the **Firestore + Auth emulators**
> (single Java process) and **k6 2.1.0 on the same machine** (run at lower CPU priority). No Google Cloud staging project
> was available. These numbers prove correctness under concurrency and expose bottlenecks; they are **not** a measurement
> of Cloud Run + real Firestore capacity. Raw k6 summaries and resource samples: `tests/load/results/`.

## Data set
`tests/load/seed.mjs` created **10,201 synthetic accounts** (10,000 customers + 201 approved hosts on a grid in
Visakhapatnam) in 5–8 s, with ID tokens for 1,200 customers + all hosts. All tests ran against this 10k-user data set.

## Results (final code)
| Test | Profile | Requests | Throughput | Latency avg / p95 / p99 | Unexpected errors | Shed (503) | Result |
|---|---|---|---|---|---|---|---|
| Realistic journeys | 500 simultaneous users, think time 2–8 s, 4 min | 51,321 | **218.8 req/s** | 13 / **39** / 107 ms | **0** | 0 | ✅ all thresholds |
| — discovery (`/hosts/nearby`) | | | | 8 / 20 / 88 ms | | | ✅ |
| — booking create | | 733 acknowledged | | 40 / 81 / 428 ms | | | ✅ |
| Fixed rate | 100 journeys/s, no think time, 90 s | 30,125 | **332 req/s** | 34 / 136 / 526 ms | 0 | 0 | ⚠️ history p95 506 ms (threshold 500) |
| Fixed rate (saturation) | 130 journeys/s, 90 s | 38,726 | 426 req/s | 261 / 1,443 / 2,881 ms | 0 | 11,794 (low-priority reads only) | ❌ over capacity — protection worked |
| Booking race | 300 customers → 1 host (capacity 2), simultaneous accepts | 900 | — | accept p95 5.3 s (serialised) | **0** | — | ✅ exactly **2** accepted, 298 × 409 |
| Crash recovery | 200 users; API `kill -9` at 70 s, restarted after 10 s | 14,409 | 83 req/s | p95 26 ms | 1,078 during outage (connection refused, single instance) | 44 | ✅ no lost/duplicate data (below) |
| OTP sign-in throughput | 30 VUs, mock provider, 1 min | 27,340 | **455 req/s** | verify p95 117 ms | 0 (0 % failed) | 0 | ✅ **227 sign-ins/s** |
| Data-integrity audit | after race + recovery | 522 requests | — | — | — | — | ✅ 522 acknowledged = 522 stored, 0 over-capacity, 0 counter mismatch, 0 customers with >1 active, 0 bad histories |

Earlier runs (before the fixes listed below, kept for reference): 100 users 42 req/s p95 13 ms; ramping stress 20→300 journeys/s
for 6 min: 157,021 requests, 436 req/s average, **0 unexpected errors**, 14 % low-priority requests shed at saturation.

## Not measured
- **1,000 / 2,500 / 5,000 / 10,000 simultaneous users** — k6 needs ~4.7 MB per virtual user; at 1,000 users k6 used 4.7 GB and the
  container's OOM killer stopped the Firestore emulator. Scripts are ready (`PROFILE=ramp1000 … ramp10000`, `spike`, `peak`, `soak`)
  and must be run from a separate load-generator machine against staging.
- Soak (45 min), spike, Android slow-network on device, real Firestore/Auth/FCM/MSG91/Sheets behaviour, Cloud Tasks backlog.

## Bottlenecks found and fixed during load testing
| # | Symptom under load | Cause | Fix | Re-test |
|---|---|---|---|---|
| 1 | API RSS 2.2 GB, GC stalls, requests shed at 41 req/s | Discovery cache keyed per user location held up to 2,000 copies of host lists | Cache per **geohash range** (shared), max 500 entries, periodic purge | RSS 176 MB; p95 59 → 13 ms; 0 shed |
| 2 | Simultaneous accepts on one host → 500s / zero accepted | Create transactions read-locked the hot host doc; 150–300 concurrent transactions convoyed until lock timeout | Host read moved **outside** the create transaction; **per-host in-process mutex** for transitions; Firestore `ABORTED` → `503 BUSY_RETRY` + `Retry-After` | Exactly capacity accepted, 0 unexpected |
| 3 | `ERR_HTTP_HEADERS_SENT`; client told "timeout" while transaction later committed | 15 s deadline answered, error handler answered again | Error handler guards `headersSent`; writes get a 28 s deadline so responses reflect the real outcome | Clean logs |
| 4 | OTP throughput 3.7 req/s, 77 % failures | Rate-limit counter = **one transactional doc per IP** → hot document (and CGNAT would lock out real users) | **Sharded, non-transactional** counters (10 shards for IP keys); per-IP OTP cap 10 → 60/h (per-number limit stays primary) | 455 req/s, 0 % failures |
| 5 | (integration test) Sheets *read* outage threw 500 | `readKeys` outside the try block | Whole sync in try → rows stay pending, 503 so Cloud Tasks retries | Outage test passes |

## How to reproduce (staging)
```
# 1. Seed synthetic data (refuses non demo/dev/staging/test projects)
GOOGLE_APPLICATION_CREDENTIALS=… PROJECT_ID=nearvolt-ev-staging WEB_API_KEY=… USERS=10000 HOSTS=200 TOKENS=10000 node tests/load/seed.mjs
# 2. Staging API env: APP_ENV=staging OTP_PROVIDER=mock IP_LIMIT_PER_15MIN=1000000 OTP_IP_LIMIT_PER_HOUR=1000000 (load generator = 1 IP)
# 3. Run from a separate VM (e.g. e2-standard-8 in asia-south1; ~US$0.3/hour), one profile at a time:
k6 run -e BASE_URL=$STAGING -e PROFILE=ramp1000 tests/load/load.js     # then ramp2500, ramp5000, ramp10000, spike, peak, soak
k6 run -e BASE_URL=$STAGING -e RACERS=500 tests/load/booking-race.js
k6 run -e BASE_URL=$STAGING -e VUS=200 tests/load/auth-throughput.js
k6 run -e BASE_URL=$STAGING -e NOTHINK=1 -e START=50 -e PEAK=2000 -e STEP=2m tests/load/stress.js
ACK=<acknowledged count> PROJECT_ID=nearvolt-ev-staging node tests/load/verify-integrity.mjs
```
10,000 virtual users need roughly 40–50 GB RAM on the load generator (or k6 distributed across several machines).
Record Cloud Monitoring (instances, CPU, memory, p95, 5xx), Firestore usage and billing for each run.
