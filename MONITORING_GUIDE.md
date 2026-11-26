# Monitoring guide

Setup: `PROJECT_ID=… SERVICE=nearvolt-api-prod API_URL=… ALERT_EMAIL=… ./infra/monitoring/setup-monitoring.sh`
(log-based metrics + 12 alert policies in `infra/monitoring/policy-*.json` + uptime check), then
`./infra/monitoring/setup-budget.sh` (needs Billing Account Administrator). Not yet run (no project access).

| Alert | Signal | Threshold (initial) | First response |
|---|---|---|---|
| Backend unavailable | Uptime check `/api/v1/health` (create alert on the check in the console) | 2 failed regions | Check Cloud Run revisions, roll back |
| High CPU / memory | `run.googleapis.com/container/{cpu,memory}/utilizations` p99 | > 80 % / > 85 % for 5 min | Check instance count vs max; memory leak → roll back |
| High latency | `request_latencies` p95 | > 1,000 ms for 5 min | Firestore errors? load shedding? recent deploy? |
| 5xx | `request_count` 5xx | > 1/s for 5 min (critical) | Logs Explorer `severity>=ERROR` |
| 429 | `request_count` 429 | > 5/s | Abuse vs limits too tight |
| Auth failures | `request_count` 401 | > 5/s | Bad release or credential stuffing |
| Abnormal traffic | total request rate | > 300 req/s for 5 min | Identify sources; consider Cloud Armor |
| Load shedding | log metric `nearvolt_load_shed` | any sustained | Raise `MAX_INSTANCES`, find slow dependency |
| Excessive OTP | log metric `nearvolt_otp_send` | > 1/s | SMS cost/abuse; inspect lockouts |
| Firestore contention/quota | log metric `nearvolt_firestore_errors` | > 0.05/s | Hot documents; follow 500/50/5 ramp |
| Cloud Tasks backlog | `cloudtasks.googleapis.com/queue/depth` | > 50 for 15 min | Sheets failing; data safe in Firestore |
| Sheets sync delayed | log metric `nearvolt_sheets_delayed` (oldest row > 15 min) | any | Sheet sharing/quota; admin → Google Sheets tab |
| Spend | Billing budget | 50 / 90 / 100 % + forecast | Review instance count, SMS, Firestore reads |
| Android crashes / ANRs | Firebase Crashlytics alerts (new fatal, regressed, velocity) + Play Console Android vitals | console | Halt staged rollout |

Dashboards: Cloud Run service page (requests, latency, instances), Firestore usage tab, Cloud Tasks queue page, admin dashboard
→ Overview (`sheetsPending`) and → Google Sheets (backlog, oldest pending, duplicates).
Runbooks: rollback and restore in DEPLOYMENT_GUIDE.md and BACKUP_RECOVERY.md; maintenance mode in admin → Settings.
