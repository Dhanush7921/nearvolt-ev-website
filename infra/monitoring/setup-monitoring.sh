#!/usr/bin/env bash
# Creates log-based metrics, an uptime check and alert policies for one environment. Idempotent for metrics;
# re-running creates duplicate policies, so delete old ones first if you edit them.
# Usage: PROJECT_ID=nearvolt-ev-prod SERVICE=nearvolt-api-prod API_URL=https://... ALERT_EMAIL=ops@example.com ./infra/monitoring/setup-monitoring.sh
set -euo pipefail
: "${PROJECT_ID:?}" "${SERVICE:?}" "${API_URL:?}" "${ALERT_EMAIL:?}"
cd "$(dirname "$0")"
gcloud config set project "$PROJECT_ID" >/dev/null
RUN="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\""
metric() { gcloud logging metrics describe "$1" >/dev/null 2>&1 || gcloud logging metrics create "$1" --description="$2" --log-filter="$RUN AND $3"; }
metric nearvolt_load_shed "Load-shedding events" 'jsonPayload.metric="load_shed"'
metric nearvolt_otp_send "OTP sends" 'jsonPayload.metric="otp_send"'
metric nearvolt_sheets_delayed "Sheets outbox older than 15 min" 'jsonPayload.metric="sheets_backlog" AND jsonPayload.oldestPendingSeconds>900'
metric nearvolt_firestore_errors "Firestore contention/quota errors" '(jsonPayload.err.message:"ABORTED" OR jsonPayload.err.message:"RESOURCE_EXHAUSTED" OR jsonPayload.err.message:"DEADLINE_EXCEEDED")'

CHANNEL=$(gcloud beta monitoring channels list --filter="labels.email_address=\"$ALERT_EMAIL\"" --format='value(name)' | head -1)
[ -n "$CHANNEL" ] || CHANNEL=$(gcloud beta monitoring channels create --display-name="NEARVOLT ops" --type=email --channel-labels=email_address="$ALERT_EMAIL" --format='value(name)')
HOST=$(echo "$API_URL" | sed -E 's#https?://##; s#/.*##')
export SERVICE CHANNEL HOST PROJECT_ID
gcloud monitoring uptime create "NEARVOLT $SERVICE health" --resource-type=uptime-url --resource-labels=host="$HOST",project_id="$PROJECT_ID" \
  --path=/api/v1/health --protocol=https --period=1 --timeout=10 2>/dev/null || echo "uptime check exists or needs console setup"
for f in policy-*.json; do envsubst < "$f" > "/tmp/$f"; gcloud alpha monitoring policies create --policy-from-file="/tmp/$f" >/dev/null && echo "created $f"; done
cat <<NEXT
Also configure (console):
 - Uptime-check alert: Monitoring → Uptime checks → "NEARVOLT $SERVICE health" → Create alert (backend unavailability).
 - Firebase Crashlytics → Alerts: new fatal issues, regressed issues, velocity alerts; Android vitals (crash & ANR rate) in Play Console.
 - Billing budget: ./infra/monitoring/setup-budget.sh (needs Billing Account Administrator).
NEXT
