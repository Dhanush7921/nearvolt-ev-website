#!/usr/bin/env bash
# Creates Cloud Scheduler jobs that call the API's internal endpoints with OIDC tokens. Idempotent.
# Usage: PROJECT_ID=... API_URL=https://nearvolt-api-prod-xxxx.a.run.app ./infra/schedule-jobs.sh
set -euo pipefail
: "${PROJECT_ID:?}" "${API_URL:?}"
REGION="${REGION:-asia-south1}"
SCH="nearvolt-scheduler@$PROJECT_ID.iam.gserviceaccount.com"
job() {
  local name=$1 schedule=$2 path=$3
  local args=(--location "$REGION" --schedule "$schedule" --time-zone "Asia/Kolkata" --uri "$API_URL/api/v1/internal/$path" --http-method POST \
    --oidc-service-account-email "$SCH" --oidc-token-audience "$API_URL" --attempt-deadline 60s)
  if gcloud scheduler jobs describe "$name" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" --project "$PROJECT_ID" "${args[@]}"
  else gcloud scheduler jobs create http "$name" --project "$PROJECT_ID" "${args[@]}"; fi
}
job nearvolt-expire-requests "* * * * *" expire-requests     # every minute: expire unanswered requests
job nearvolt-sheets-sync "*/2 * * * *" sheets-sync            # recovery sweep every 2 minutes (Cloud Tasks handles normal sync)
job nearvolt-sheets-reconcile "15 3 * * *" sheets-reconcile   # daily 03:15 IST: duplicate/backlog report
# The service allows unauthenticated ingress (the app needs it); /internal/* verifies the OIDC token and the
# scheduler service-account email itself, so no extra invoker binding is required.
echo "Scheduler jobs ready. Create the Sheets tabs once with:"
echo "  curl -X POST -H \"Authorization: Bearer \$(gcloud auth print-identity-token --impersonate-service-account=$SCH --audiences=$API_URL)\" $API_URL/api/v1/internal/sheets-setup"
