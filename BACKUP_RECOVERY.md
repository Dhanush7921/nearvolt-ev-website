# Backup and recovery

| Asset | Protection | Recovery |
|---|---|---|
| Firestore (canonical data) | Point-in-time recovery (7-day window) + daily scheduled backups retained 14 days (`infra/setup-gcp.sh`) | PITR: `gcloud firestore databases clone --source-database='(default)' --snapshot-time=<RFC3339> --destination-database=restore-<date>` then verify and switch/copy. Backup: `gcloud firestore databases restore --source-backup=<backup> --destination-database=restore-<date>` |
| Host files (Cloud Storage) | Private bucket; enable object versioning for 30 days if desired (`gcloud storage buckets update gs://<bucket> --versioning`) | Restore a noncurrent version |
| Google Sheets mirror | Rebuildable from Firestore; outbox keeps rows until synced; nightly reconcile reports duplicates/backlog | Clear the tab and re-enqueue, or rely on keyed upserts |
| Auth users | Managed by Firebase; export periodically: `firebase auth:export users.json --project <id>` (store encrypted) | `auth:import` |
| Config | `settings/app` in Firestore (covered by PITR/backups); infrastructure as scripts in `infra/` | Re-run scripts |
| Code & releases | Git history, release tags, Play App Signing (Google keeps the app signing key) | Redeploy a previous tag / roll back Cloud Run revision |
| Upload keystore | **Owner responsibility**: keep the keystore + passwords in two secure places | If lost: Play Console upload-key reset |

**Restore drill (do before launch, then quarterly):** clone the production database to a test database with PITR, point a dev API at it, run a smoke test (sign in, list hosts, view a request), record time taken. Target RPO ≤ 1 minute (PITR), RTO ≤ 2 hours.

**Incident basics:** maintenance mode (admin → Settings) to stop traffic safely; Cloud Run revision rollback; suspend unsafe hosts immediately from the admin dashboard; all admin actions are in the audit log.
