# Monthly running cost estimate (pilot, Visakhapatnam)

Estimate only — not a quote. Prices checked 26 Nov 2026 from public pricing pages/aggregators; Google free tiers are per billing account and change over time. Re-check before committing budget.

**Pilot assumptions:** 1,000 registered users, 3,000 charging requests/month, 2,000 OTP SMS/month (sessions are persistent, so most users verify once), 1 GB host photos/documents.

| Item | Basis | Estimated INR / month |
|---|---|---|
| Cloud Run API (asia-south1, min 0, max 5) | Monthly free tier covers ~2 M requests and a large vCPU/GiB-second allowance; pilot traffic plus the per-minute expiry job (~43k calls) stays inside it | ₹0 |
| Firestore | Free quota 50k reads / 20k writes per day; pilot uses a small fraction. PITR, backups and TTL deletes are billed outside the free tier (small at <1 GB) | ₹0–100 |
| Cloud Storage (private host files) | ~1 GB | < ₹10 |
| Cloud Scheduler | 3 jobs (free allowance is 3 jobs per billing account) | ₹0 |
| Secret Manager | 3 secrets, low access volume | ₹0–20 |
| Firebase Auth (Google + email link), FCM, Crashlytics, Hosting | No-cost tiers at pilot volume (Identity Platform MFA for a few admins is within its free MAU allowance) | ₹0 |
| MSG91 SMS OTP | ~₹0.16–0.25 per SMS by pack size + 18 % GST → 2,000 × ₹0.25 × 1.18 | ≈ ₹590 |
| **Total (pilot)** | | **≈ ₹600–750 / month** |

**One-time / external:** Google Play developer registration (US$25, one-time); MSG91 / telecom DLT entity and template registration (fees depend on the operator portal — confirm during onboarding); electrician inspections for host verification (operational cost, not cloud).

**Cost controls in place:** Cloud Run max 5 instances and 30 s timeout; no paid Maps APIs (Google Maps URL hand-off only); no continuous polling (request screen refreshes every 15 s only while open and active; push triggers immediate refresh); OTP throttling caps SMS abuse; budget alert step in DEPLOYMENT_GUIDE.md.

**At 10× scale** (10k users, 30k requests, 15k OTP/month) the main driver is SMS (~₹4,400) and Firestore may exceed the free daily quota on busy days (Firestore reads cost about US$0.03 per 100k beyond the free tier, so still low hundreds of rupees).
