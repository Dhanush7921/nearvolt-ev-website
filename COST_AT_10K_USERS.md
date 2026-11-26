# Running cost at 10,000 registered users / 5,000 DAU (estimate)

**Basis:** measured traffic of **0.44 requests/s per active user** (500-user run). Prices: Google list prices for Cloud Run
(CPU US$0.000018/vCPU-s, memory US$0.000002/GiB-s, US$0.40 per million requests after 2 M free) and Firestore Standard
(US$0.03 per 100k reads, US$0.09 per 100k writes after the free 50k reads / 20k writes per day); regional prices in Mumbai may
differ slightly. US$1 ≈ ₹88 (assumption). Firestore operations per request are estimated from the code paths, not metered.

| Scenario (5,000 DAU) | Requests/month | Firestore | Cloud Run (requests + compute) | Min instance (1) | SMS OTP (3,000/month) | **Total / month** |
|---|---|---|---|---|---|---|
| Typical — 2 active min per user per day | 7.9 M | ≈ US$18 | ≈ US$2 | ≈ US$13 | ≈ ₹890 | **≈ ₹3,800** |
| Heavy — 6 active min per user per day | 23.6 M | ≈ US$56 | ≈ US$10 | ≈ US$13 | ≈ ₹890 | **≈ ₹7,800** |

Add ≈ ₹500–1,500 headroom for Cloud Logging beyond the free allotment, Cloud Tasks/Scheduler, PITR/backup storage and Secret
Manager. Optional Cloud Armor: + ≈ ₹2,200–2,600/month. Cost ceilings: `MAX_INSTANCES=50`, discovery cache, SMS throttles, budget
alerts (`infra/monitoring/setup-budget.sh`). Replace these estimates with billing data from the staging load tests.
