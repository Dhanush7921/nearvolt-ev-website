# Performance report — NEARVOLT EV v1.0.0

All figures are **measured locally** (see LOAD_TEST_RESULTS.md for the environment and its limits) unless marked *estimate*.

## The 10 required figures
| # | Item | Result |
|---|---|---|
| 1 | Verified registered-user capacity | **10,201 accounts** seeded and served (10,000 customers + 201 hosts); all journeys ran against this data set. Firestore/Auth have no practical limit at this size; verified only on emulators. |
| 2 | Verified concurrent-user capacity | **500 simultaneous users** (realistic journeys) on one local instance with all thresholds met. 1,000+ **not verified** (load generator could not fit on the test machine). |
| 3 | Maximum measured requests per second | **332 req/s** sustained with 0 shedding and 0 unexpected errors (p95 136 ms); **426–459 req/s** served at saturation with low-priority shedding; **455 req/s** on the sign-in path. One process, shared 2 vCPU. |
| 4 | API latency (500 users) | avg **13 ms**, p95 **39 ms**, p99 **107 ms**; discovery p95 20 ms; booking p95 81 ms. |
| 5 | Unexpected error rate | **0 %** in every run on final code (0 unexpected errors across ≈ 148,000 requests), excluding connection errors during the deliberate 10-second crash test. |
| 6 | Maximum backend instance count | **1** (local). Cloud Run autoscaling to the configured max 50 is **not yet observed**. |
| 7 | Data-integrity results | ✅ Zero double-booking (300-way race → exactly capacity accepted); ✅ zero lost acknowledged requests after `kill -9` (522/522); ✅ counters consistent; ✅ one active request per customer; ✅ Sheets outage loses nothing, no duplicate rows. |
| 8 | Estimated cost under measured traffic | ≈ **₹3,800–7,800 / month** at 5,000 DAU (*estimate*, COST_AT_10K_USERS.md). |
| 9 | Remaining limitations | No staging/Cloud Run/real Firestore measurement; 1k–10k VU profiles, spike, soak, slow-network and 99.9 % availability unmeasured; single-region; Cloud Armor not active. |
| 10 | Production readiness | **BLOCKED** — the agreed 10k-scale performance tests have not been run on staging. |

## Interpreting the local numbers (projection, *not evidence*)
Measured traffic per active user: 218.8 req/s ÷ 500 = **0.44 req/s**. Targets therefore imply ≈ 440 req/s at 1,000 simultaneous
users and ≈ 4,400 req/s at 10,000. One local process sustained ~330 req/s while the API itself used only ~35 % of a core — the
Firestore **emulator** (one JVM) was the bottleneck. On Cloud Run each instance has its own vCPU and real Firestore scales
horizontally, so ≈ 2–4 instances for 1,000 users and ≈ 15–30 for 10,000 is plausible within the max of 50 — but this must be
measured. Firestore's guidance to ramp new traffic gradually (start ≤ 500 ops/s, then increase ~50 % every 5 minutes) applies
to the staging tests and to launch.

## Design properties that hold at scale (verified by tests)
Stateless instances; SDK clients reused per instance; bounded queries (geohash ranges ≤ 200 docs each, pages ≤ 100);
5-second shared discovery cache with explicit invalidation and booking re-checks inside transactions (cached data can never
confirm a booking); gzip compression; idempotent writes; load shedding that never sheds bookings/sign-in; per-request deadlines;
per-host serialisation of capacity changes; Sheets sync fully asynchronous (Cloud Tasks + recovery sweep).
