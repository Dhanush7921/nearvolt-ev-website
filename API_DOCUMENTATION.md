# API — /api/v1

All responses: `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "details?" } }`.
Auth: `Authorization: Bearer <Firebase ID token>`. In production also `X-Firebase-AppCheck`. Android sends `X-App-Platform: android` and `X-App-Version-Code`; versions below `minSupportedVersionCode` get **426 UPGRADE_REQUIRED**. Maintenance mode returns **503 MAINTENANCE** (admin and public routes exempt). Lists use `?cursor=&limit=` (≤100) and return `nextCursor`.

| Method & path | Who | Notes |
|---|---|---|
| GET `/health` | public | status, version |
| GET `/public/config` | public | maintenance, versions, flags, active service areas, request TTL |
| POST `/public/deletion-requests` | public | `{contact, details?}`; honeypot; 3/hour/IP |
| POST `/auth/otp/send` | public | `{phone}` Indian mobile; 30 s cooldown, 5/hour/number, 10/hour/IP |
| POST `/auth/otp/verify` | public / signed-in | `{phone, otp}` → `{customToken}`; if signed in, links the number (`409 PHONE_IN_USE` if owned by another account). 5 wrong codes → 1 h lock; codes single-use |
| GET `/me` | user | profile, role, admin flag, activeRequestId |
| PUT `/me/consents` | user | terms/privacy versions, location & notification consent |
| PUT `/me/profile` | user | `{name, vehicle{type,model?,connector}}` (needs consent) |
| POST `/me/role` | user | `{role: customer|host}`; once (`409 ROLE_LOCKED`) |
| POST `/me/session` | user | login log `{method}` |
| POST/DELETE `/me/devices[/:token]` | user | FCM token register/remove |
| GET `/me/notifications`, POST `/me/notifications/read-all` | user | |
| DELETE `/me` | user | blocked during active request/session (`409`) |
| GET `/hosts/nearby?lat&lng&radiusKm&connector&vehicleType&exclude` | user | approved hosts only; no address/coordinates; `straightLineKm`, `bookableNow` (approved + online + open + capacity) |
| GET/PUT `/hosts/me` | host | listing incl. private address/location; power validated against V×A; editing location/equipment of an approved listing returns it to review |
| POST `/hosts/me/submit` | host | needs ≥2 photos, ≥1 document |
| PUT `/hosts/me/availability` | host (approved) | `{available, until?}` ≤24 h |
| POST `/hosts/me/uploads`, `/hosts/me/uploads/confirm` | host | V4 signed PUT URL (10 min, size-limited); confirm checks magic bytes |
| POST `/requests` | customer/host | header `Idempotency-Key` (16–64); `{hostId, vehicleType, connector, customerLocation, compatibilityConfirmed: true, note?}`; 10/hour/user |
| GET `/requests?as=customer|host&status=active` | participant | |
| GET `/requests/:id` | participant | 404 for non-participants; `hostLocation` (+`mapsUrl`) only for the customer while ACCEPTED/ARRIVED/CHARGING |
| POST `/requests/:id/transition` | participant | `{action: accept|reject|cancel|arrive|start|complete|dispute, reason?}` |
| POST `/requests/:id/feedback` | participant | once per side after COMPLETED |
| POST/GET `/support/tickets` | user | `unsafe_charging` → URGENT |
| `/admin/*` | admin claim + MFA | overview, users (disable/enable), hosts (approve with full checklist / reject / suspend / restore→review), requests (close pending), complaints, deletion-requests, audit, security-events, settings, notifications, sheets/status, reports/requests.csv |
| `/internal/*` | Cloud Scheduler OIDC | expire-requests, sheets-sync, sheets-reconcile, sheets-setup |

### Transition rules
| action | from | by |
|---|---|---|
| accept | REQUESTED (not expired) | host (capacity checked) |
| reject | REQUESTED | host |
| cancel | REQUESTED, ACCEPTED, ARRIVED | either |
| arrive | ACCEPTED | either |
| start | ARRIVED | host |
| complete | CHARGING | either |
| dispute | ACCEPTED, ARRIVED, CHARGING, COMPLETED | either |
| expire | REQUESTED | system only |
