#!/usr/bin/env bash
# OPTIONAL — NOT ACTIVATED. Puts the API behind a global external HTTPS load balancer with a Cloud Armor policy and
# restricts Cloud Run ingress so the protection cannot be bypassed via the *.run.app URL.
# Prerequisites: a domain you control (Google-managed certificates need one; custom domain is currently out of scope),
#                written billing approval (~US$25–30/month base + US$0.75 per million requests, see SCALABILITY_REPORT.md).
# Usage: PROJECT_ID=... REGION=asia-south1 SERVICE=nearvolt-api-prod DOMAIN=api.example.in ./infra/cloud-armor.sh
set -euo pipefail
: "${PROJECT_ID:?}" "${SERVICE:?}" "${DOMAIN:?}"
REGION="${REGION:-asia-south1}"
read -r -p "This creates billable resources. Type YES to continue: " ok; [ "$ok" = YES ] || exit 1
gcloud config set project "$PROJECT_ID"
gcloud compute network-endpoint-groups create nearvolt-neg --region="$REGION" --network-endpoint-type=serverless --cloud-run-service="$SERVICE"
gcloud compute security-policies create nearvolt-armor --description="NEARVOLT API protection"
# Per-IP rate limit (tune from load tests): 300 requests / 60 s, then 429 for 5 minutes.
gcloud compute security-policies rules create 1000 --security-policy=nearvolt-armor --expression="true" --action=rate-based-ban \
  --rate-limit-threshold-count=300 --rate-limit-threshold-interval-sec=60 --ban-duration-sec=300 --conform-action=allow --exceed-action=deny-429 --enforce-on-key=IP
# Preconfigured OWASP rules (start in preview mode, then enforce after reviewing logs).
gcloud compute security-policies rules create 2000 --security-policy=nearvolt-armor --expression="evaluatePreconfiguredWaf('sqli-v33-stable') || evaluatePreconfiguredWaf('xss-v33-stable')" --action=deny-403 --preview
gcloud compute backend-services create nearvolt-be --global --load-balancing-scheme=EXTERNAL_MANAGED --security-policy=nearvolt-armor
gcloud compute backend-services add-backend nearvolt-be --global --network-endpoint-group=nearvolt-neg --network-endpoint-group-region="$REGION"
gcloud compute url-maps create nearvolt-lb --default-service=nearvolt-be
gcloud compute ssl-certificates create nearvolt-cert --domains="$DOMAIN" --global
gcloud compute target-https-proxies create nearvolt-proxy --url-map=nearvolt-lb --ssl-certificates=nearvolt-cert
gcloud compute addresses create nearvolt-ip --global
gcloud compute forwarding-rules create nearvolt-fr --global --load-balancing-scheme=EXTERNAL_MANAGED --address=nearvolt-ip --target-https-proxy=nearvolt-proxy --ports=443
echo "Point $DOMAIN (A record) to: $(gcloud compute addresses describe nearvolt-ip --global --format='value(address)')"
echo "After the certificate is ACTIVE and the app uses https://$DOMAIN, lock ingress:"
echo "  gcloud run services update $SERVICE --region $REGION --ingress internal-and-cloud-load-balancing"
echo "NOTE: Cloud Scheduler/Cloud Tasks must then target https://$DOMAIN (update PUBLIC_URL / INTERNAL_OIDC_AUDIENCE)."
