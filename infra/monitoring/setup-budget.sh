#!/usr/bin/env bash
# Monthly budget with email alerts at 50/90/100 % (+ forecast). Alerts only — it does NOT cap spending.
# Usage: BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX PROJECT_ID=nearvolt-ev-prod AMOUNT_INR=5000 ./infra/monitoring/setup-budget.sh
set -euo pipefail
: "${BILLING_ACCOUNT:?}" "${PROJECT_ID:?}" "${AMOUNT_INR:?}"
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name="NEARVOLT $PROJECT_ID monthly" \
  --budget-amount="${AMOUNT_INR}INR" --filter-projects="projects/$PROJECT_ID" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 --threshold-rule=percent=1.0,basis=forecasted-spend
