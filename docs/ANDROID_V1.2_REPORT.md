# NEARVOLT EV Android V1.2.0: implementation report

Branch: `upgrade/v1.2-premium-android`, based on V1.1 `4369b7a`.
Android details: `com.nearvolt.ev`, versionName **1.2.0**, versionCode **3**, same Firebase project and the same release signing key.
No backend change. No website change. Not merged into `main` or `production/v1`.

## 1. New screens
| Screen | Route | Notes |
|---|---|---|
| Home dashboard | `home` (tab) | Real profile data, location chip, server status, vehicle card with a manual battery entry, emergency CTA, shortcuts, nearby discovery, active request, recent activity, tips |
| Map | `map` (tab) | Full-screen map with map/list views, filters, clustering, compass, recenter, host sheet, favourites |
| My Garage | `garage` | Primary vehicle synced to the server, extra vehicles stored on the device, charging estimator |
| Favourites and recent searches | `favourites` | Stored per account on the device and checked against live search results |
| Emergency mode | `emergency` | Uses the normal compatibility, acceptance and PIN flow; 112 opens the dialler only |
| Safety centre and FAQ | `safety` | Expandable sections; report and support actions |

Existing screens were extended, not replaced:
- **Activity:** status filters.
- **Alerts:** category filters.
- **Request:** completion animation and summary.
- **Host dashboard:** statistics from the host's own records, plus a responsibilities card.
- **Account:** garage, favourites, safety centre, graphics quality, notification and location settings, clearing device data.
- **Sign-in:** password visibility toggle.
- **Consent and Setup:** onboarding progress bar.

## 2. Integration changes (minimal, as allowed)
- **Customer bottom navigation** is now Home, Map, Activity, Alerts, Account.
  - The old `find` tab remains as a route: Home's "Nearby discovery" opens it, and "find another host" opens `find?exclude=`.
  - Host navigation is unchanged.
- **`HostCard`, `HostDetail`, `Filters` and `ManualLocationDialog`** changed from `private` to `internal` so the Map and Emergency screens can reuse them. `HostDetail` gained an optional favourite toggle.
- **`HostMap`** gained a `fullScreen` mode (clustering, compass, recenter, failure callback). The embedded map in the existing Find screen behaves exactly as before.
- **`FindViewModel`** gained `setRadius` (clamped to 1–50 km, inside the server's 0.5–50 km limit) and `adoptCachedFix`. It also writes to an in-memory discovery cache.
- **`ApiClient`**: `/api/v1/public/*` requests no longer wait for an ID token or App Check token. This is safe because the server mounts the public routes without `authenticate()`. Every protected route is unchanged.
- **`AppViewModel.refresh`**:
  - Only one refresh runs at a time.
  - `/me` now starts in parallel with `/config`, and its result is used only after the update and maintenance checks pass.
  - Sign-out and account deletion wipe the account's data on the device.
- **Theme**:
  - Uses the V1.2 brand colours.
  - In light mode, primary text and buttons use emerald-700 `#047857`, because white on `#059669` has 3.8:1 contrast, below the 4.5:1 that WCAG AA requires. `#059669` is used for accents.
  - Dark mode uses neon mint `#6BFFCB` as primary.
  - Theme changes animate over 300 ms.
- **Bug fix (V1.1):** the charging timer always showed 0:00:00, because `Time.secondsUntil` clamps past times to zero. It now uses a new `Time.secondsSince`.

## 3. Map implementation
- **Engine:** the existing MapLibre 13.8.0 with OpenFreeMap positron (light) and fiord (dark). No second map engine and no API key.
- **Lifecycle:**
  - The map is composed only while the Map tab is open, and its `MapView` is destroyed when you leave (lifecycle observer and `onDispose`).
  - No tiles are fetched in the background, and nothing is bulk-downloaded or cached offline.
- **Data:**
  - Results come from the existing authorized `/hosts/nearby` endpoint.
  - Markers sit at the server's privacy-safe ~1 km area centres; exact coordinates are never available before the host accepts.
  - The server already filters by vehicle and connector. Power and availability filters run on the device over the server's results.
  - The search radius slider sends 1–50 km to the server.
- **Tools:**
  - Clustering (zooms in when you tap a cluster).
  - Compass (shown when the map is rotated).
  - Recenter / my-location button.
  - Map/list toggle.
  - "Updated X ago" from the server's `checkedAt`.
  - Straight-line distance labels.
  - Attribution shown on the map.
- **Failure handling:**
  - If the style or tiles fail to load, the screen switches to list view with a message.
  - Offline states use the existing `ErrorState`.
  - Loading shows skeletons.
- **Navigation:** an accepted session still hands off to the Google Maps app through a URL. No paid Directions, Places or Maps Platform API is used.
- **Tile use:** OpenFreeMap publishes no hard per-user quota. Normal browsing is fine; bulk downloading is not used.

## 4. Original animations kept unchanged
Untouched:
- Logo reveal and splash.
- Energy-flow bar and the EV illustration.
- Shared-element transitions.
- Screen transitions, tab icon spring and hero pulses.
- The skeleton shimmer.

The graphics setting (Adaptive, Ultra, Lite) gates only the new decorative layer (ambient glow, glass highlights) and the decorative pulse loops. The system "Remove animations" setting always wins.

## 5. Data handling
| Data | Where it is stored | Synced |
|---|---|---|
| Primary vehicle (type, connector, model) | Server profile (existing API) | Yes |
| Extra vehicles, battery capacity, battery % | App-private DataStore, keyed by hashed uid | No; labelled "Saved on this device only" |
| Favourites | Same store: host id and name only, no coordinates or availability | No |
| Recent searches | Same store: typed area names only; coordinates and map links rejected; can be turned off | No |
| Last location fix and nearby results | Memory only, cleared on sign-out | No |

`allowBackup=false` (unchanged). Device-stored data is wiped on sign-out, on account deletion, and with "Clear data stored on this device".

## 6. Tests run here (actual)
| Check | Result |
|---|---|
| Android JVM unit tests | **18/18**: CoreTest 7, CompatibilityTest 5 (V1.0 backend), V12Test 6 (estimator maths and validation, favourites privacy, recent searches reject coordinates and respect opt-out, garage persistence round-trip, map filters) |
| Android lint | **0 errors**, 22 warnings |
| Debug build and minified release build | Pass |
| Backend regression (unchanged code) | **50/50** |
| Compose UI tests (`src/testUi`: light/dark rendering, battery meter, reduced motion, graphics modes, onboarding, emergency button) | Compile, but **not executed here**: Maven Central rate-limited (HTTP 429) the shared IP for Robolectric's runtime jar. Run them on your PC with `-PNV_UI_TESTS=true`. |
| Navigation, map lifecycle, permissions, offline, frame timing, memory | Need a phone or emulator; none is available here (no KVM) |

## 7. APK sizes (minified, unsigned dev flavor; same code as prod)
| ABI | V1.1 | V1.2 | Change |
|---|---|---|---|
| arm64-v8a | 15.6 MB | 15.68 MB | +0.1 MB |
| armeabi-v7a | 12.3 MB | 12.41 MB | +0.1 MB |
| x86_64 | 16.1 MB | 16.24 MB | +0.1 MB |
| universal | 50.7 MB | 50.83 MB | +0.1 MB |

## 8. Signed build and verification (owner's Windows laptop, one block)
Signing uses your existing `android\keystore.properties`, or `NV_KEYSTORE_*` environment variables set in your own PowerShell session. Never paste passwords into chat. The signed V1.1 APK is not overwritten: the outputs are copied to a new `release-1.2.0` folder.
```powershell
cd C:\Users\Asus\NEARVOLT-EV
git fetch origin; git checkout upgrade/v1.2-premium-android; git pull
cd android
if (-not (Test-Path app\src\prod\google-services.json)) { throw "google-services.json missing" }
.\gradlew.bat clean testDevDebugUnitTest lintDevDebug assembleProdRelease -PNV_PROD_API_BASE_URL=https://nearvolt-api-0rxa.onrender.com/
# Optional JVM UI tests (downloads Robolectric once):
.\gradlew.bat testDevDebugUnitTest -PNV_UI_TESTS=true
$bt  = (Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" | Sort-Object Name | Select-Object -Last 1).FullName
$out = New-Item -ItemType Directory -Force -Path ..\release-1.2.0
Get-ChildItem app\build\outputs\apk\prod\release\*.apk | ForEach-Object {
  Copy-Item $_.FullName $out
  "== $($_.Name)"
  & "$bt\apksigner.bat" verify --print-certs $_.FullName | Select-String "Signer #1 certificate SHA-256"
  & "$bt\aapt2.exe" dump badging $_.FullName | Select-String "package:|native-code"
  (Get-FileHash $_.FullName -Algorithm SHA256).Hash
}
```
**Pass when:**
- All four APKs show the **same certificate SHA-256** as the V1.1 release key, which is registered in Firebase.
- Each shows `package: name='com.nearvolt.ev' versionCode='3' versionName='1.2.0'`.
- Each ABI APK lists its own architecture in `native-code`, and the universal APK lists all three.
- Record the SHA-256 file hashes before you distribute the APKs.

## 9. Physical-device acceptance (to be done; no results invented)
1. **Install and upgrade:** a fresh install of `app-prod-arm64-v8a-release.apk`, and an upgrade over the signed V1.1 without uninstalling (the same key and a higher versionCode make this possible).
2. **Sign-in:** Google login; email login; password visibility toggle; forgot-password email.
3. **App lifecycle:** reopen the app and send it to the background and back during a search, an active request and the map.
4. **Map:** tiles load in light and dark mode; pinch, pan and rotate work and the compass appears; recenter; clusters split when tapped; filters; radius; list view; airplane mode falls back to list.
5. **Permissions:** deny, then allow, location; enter a location manually.
6. **Garage and favourites:** add, edit and remove vehicles; make primary (server profile updates); battery %; estimator; favourite a host, then check its status after a new search; sign out and back in, and the device data is gone.
7. **Emergency and session:** emergency → nearest host → request → host accepts → PIN → charging timer counts up → complete → summary → rating.
8. **Visuals:** themes switch smoothly; Remove animations makes everything static; the Lite graphics setting.
9. **Performance:**
   - **Frame timing:** Profile GPU rendering, or run `adb shell dumpsys gfxinfo com.nearvolt.ev framestats` on a test phone, while scrolling Home and panning the map.
   - **Memory:** use the Android Studio profiler.
   - **Phones to test:** a low-memory phone (graphics should resolve to Lite), a mid-range phone and a high-refresh phone.

## 10. Rollback
- V1.2 is an Android-only change. Keep the V1.1 APK, and distribute V1.1 again if needed. Android needs an uninstall to go back to versionCode 2.
- No backend or database change, and no settings change is required. V1.2 works with the V1.0 and V1.1 backends, gated by the capability flags.
- To discard the branch: `git push origin --delete upgrade/v1.2-premium-android`. `main` and `production/v1` were never touched.

## 11. Not built (would need a backend or paid service)
| Item | Reason |
|---|---|
| Server-synced garage and favourites | No endpoint exists; device-only storage is clearly labelled |
| Road routes and ETA ("≈ 12 min") | Needs a routing API; only straight-line distance is shown, and navigation hands off to Google Maps |
| Host photos in cards | The API returns no public host photos, so a code-drawn illustration and icons are used |
| "Share app" | No public distribution link exists yet; it will be added when one does |
| Real SMS OTP | Still behind the disabled flag until an approved provider exists |
| Host earnings or energy charts | No such data exists; statistics use request counts only |
