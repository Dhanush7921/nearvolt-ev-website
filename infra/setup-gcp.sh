#!/usr/bin/env bash
# One-time, idempotent Google Cloud setup for one NEARVOLT EV environment.
# Run by a project Owner from Cloud Shell:  ENV=prod PROJECT_ID=nearvolt-ev-prod GITHUB_REPO=Dhanush7921/nearvolt-ev-website ./infra/setup-gcp.sh
# It never creates billing accounts, never buys anything and never deletes data. Review before running.
set -euo pipefail
: "${ENV:?dev|prod}" "${PROJECT_ID:?}" "${GITHUB_REPO:?owner/repo}"
REGION="${REGION:-asia-south1}"   # Mumbai, closest Google Cloud region to Visakhapatnam
gcloud config set project "$PROJECT_ID"

echo "== Enable APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com cloudtasks.googleapis.com sheets.googleapis.com iamcredentials.googleapis.com \
  firebase.googleapis.com identitytoolkit.googleapis.com fcm.googleapis.com firebaseappcheck.googleapis.com \
  storage.googleapis.com logging.googleapis.com monitoring.googleapis.com

echo "== Firestore (Native mode) with point-in-time recovery"
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || gcloud firestore databases create --location="$REGION" --type=firestore-native
gcloud firestore databases update --database='(default)' --enable-pitr
gcloud firestore backups schedules list --database='(default)' --format='value(name)' | grep -q . || \
  gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d

echo "== Private bucket for host photos and safety documents"
BUCKET="${PROJECT_ID}-host-files"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --cors-file=infra/storage-cors.json

echo "== Service accounts (least privilege)"
mk() { gcloud iam service-accounts describe "$1@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || gcloud iam service-accounts create "$1" --display-name "$2"; }
mk nearvolt-api "NEARVOLT API runtime"; mk nearvolt-scheduler "NEARVOLT scheduled jobs"; mk nearvolt-deployer "NEARVOLT GitHub deployer"
API="nearvolt-api@$PROJECT_ID.iam.gserviceaccount.com"; SCH="nearvolt-scheduler@$PROJECT_ID.iam.gserviceaccount.com"; DEP="nearvolt-deployer@$PROJECT_ID.iam.gserviceaccount.com"
bind() { gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" --role="$2" --condition=None >/dev/null; }
for r in roles/datastore.user roles/firebaseauth.admin roles/firebasecloudmessaging.admin roles/firebaseappcheck.tokenVerifier roles/logging.logWriter roles/monitoring.metricWriter; do bind "$API" "$r"; done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$API" --role=roles/storage.objectAdmin >/dev/null
# Custom tokens (phone OTP) and V4 signed URLs need the runtime SA to sign as itself.
gcloud iam service-accounts add-iam-policy-binding "$API" --member="serviceAccount:$API" --role=roles/iam.serviceAccountTokenCreator >/dev/null
for r in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer roles/storage.admin roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.indexAdmin roles/serviceusage.serviceUsageConsumer; do bind "$DEP" "$r"; done
gcloud iam service-accounts add-iam-policy-binding "$API" --member="serviceAccount:$DEP" --role=roles/iam.serviceAccountUser >/dev/null

echo "== Cloud Tasks queue for Google Sheets sync (serial, within Sheets API quotas, exponential retry)"
gcloud tasks queues describe sheets-sync --location="$REGION" >/dev/null 2>&1 || gcloud tasks queues create sheets-sync --location="$REGION"
gcloud tasks queues update sheets-sync --location="$REGION" --max-dispatches-per-second=1 --max-concurrent-dispatches=1 \
  --max-attempts=-1 --min-backoff=10s --max-backoff=600s --max-doublings=6 --max-retry-duration=0s
bind "$API" roles/cloudtasks.enqueuer
# The API creates tasks that carry an OIDC token for the scheduler SA.
gcloud iam service-accounts add-iam-policy-binding "$SCH" --member="serviceAccount:$API" --role=roles/iam.serviceAccountUser >/dev/null
echo "  TASKS_QUEUE=projects/$PROJECT_ID/locations/$REGION/queues/sheets-sync"

echo "== GitHub Actions Workload Identity Federation (keyless)"
POOL=github; PROVIDER=github
gcloud iam workload-identity-pools describe $POOL --location=global >/dev/null 2>&1 || gcloud iam workload-identity-pools create $POOL --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe $PROVIDER --location=global --workload-identity-pool=$POOL >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc $PROVIDER --location=global --workload-identity-pool=$POOL \
    --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment" \
    --attribute-condition="assertion.repository=='$GITHUB_REPO' && assertion.environment=='$ENV'"
PN=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "$DEP" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/$POOL/attribute.repository/$GITHUB_REPO" >/dev/null

echo "== Secrets (values are added by you, never committed)"
for s in msg91-auth-key msg91-template-id otp-hash-salt; do gcloud secrets describe $s >/dev/null 2>&1 || gcloud secrets create $s --replication-policy=automatic; done
gcloud secrets versions list otp-hash-salt --format='value(name)' | grep -q . || openssl rand -hex 32 | gcloud secrets versions add otp-hash-salt --data-file=-
for s in msg91-auth-key msg91-template-id otp-hash-salt; do gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$API" --role=roles/secretmanager.secretAccessor >/dev/null; done

cat <<NEXT

Done. Remaining manual steps (see DEPLOYMENT_GUIDE.md):
  1. Add MSG91 values:  printf '%s' 'KEY' | gcloud secrets versions add msg91-auth-key --data-file=-   (same for msg91-template-id)
  2. Deploy the backend via the "Deploy backend" GitHub workflow, then run infra/schedule-jobs.sh with the service URL.
  3. Share the NEARVOLT_EV_PRODUCTION sheet with $API (Editor).
  4. Create a budget alert in Billing → Budgets (needs a billing admin).
  GitHub environment variables: GCP_WIF_PROVIDER=projects/$PN/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER
                                GCP_DEPLOY_SA=$DEP  API_RUNTIME_SA=$API  SCHEDULER_SA_EMAIL=$SCH  STORAGE_BUCKET=$BUCKET
NEXT
