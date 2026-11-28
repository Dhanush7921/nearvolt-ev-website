# NEARVOLT EV Android V1.3.0 — EV Intelligence & Experience Update

| | |
|---|---|
| Branch | `upgrade/v1.3-ev-intelligence`, based on `upgrade/v1.2.1-map-startup-fix` (`ce7b6eb`) |
| Version | versionName **1.3.0**, versionCode **5**, package `com.nearvolt.ev` (unchanged) |
| Signing | Original release key, signed on the owner's PC (section 8). No new key was generated. |
| Backend / website | **Not changed and not deployed.** Not merged into `main` or `production/v1`. |
| Additional cost | **₹0** (no paid API, AI, SMS, maps, fonts or assets) |

## 1. What's new
### VOLT AI (knowledge-based, offline)
- **Engine:** a faithful Kotlin port of the owner's VOLT AI V1 engine and calculators (`volt/VoltEngine.kt`). It uses the same 114 knowledge records, 113 of them eligible; 1 `needs-review` record is excluded, as in the original. Knowledge loads from `assets/volt`.
- **Floating orb.** As requested:
  - A glowing, draggable orb on the main tabs.
  - Tap opens VOLT full screen, growing out of the orb.
  - **Close (✕) or Back** shrinks it back to the orb.
  - The orb is hidden on request/PIN screens and forms, so it never covers critical buttons.
- **Chat features:**
  - Animated VOLT mark (static when motion is reduced) and suggested questions.
  - Copy an answer; read an answer aloud (Android TextToSpeech, created only on first use).
  - Voice input (Android speech recogniser, shown only if the device has one).
  - Clear conversation (with confirmation), and a "Keep history on this device" switch.
- **Context and actions:**
  - Vehicle context comes from the primary Garage vehicle, or from the catalogue vehicle you opened.
  - Action chips: Map, Garage/calculator, Activity, Support, Safety and Emergency.
  - Emergency opens the dialler with 112 **only after an explicit confirmation**; nothing is ever called automatically.
- **Honest labelling:**
  - The UI says "Knowledge-based EV assistant · offline" and "not a generative AI".
  - VOLT never books, pays or contacts hosts; its actions only navigate.
  - The original "find charging requires integration" answer was reworded to point to the live map, with the same meaning: results come only from the server.

### Vehicle catalogue
- **Data:** 62 configurations (5 brands, 30 models) from `Indian_EV_Vehicle_Database.json`, built by `scripts/build-vehicle-catalogue.py`.
  - "Not publicly verified" becomes **null** (shown as "Not publicly verified" or "n/v"), never 0.
  - Legacy or proprietary connectors are **not** mapped to app connector codes.
- **Draft cross-check:** all 62 records in `nearvolt_ev_vehicle_catalogue_draft.json` were matched to the database by model and generation, with **0 numeric conflicts** (`docs/catalogue/conflicts.json`). The draft's IDs use a different order, so they were not matched by ID.
- **Guide claims:** the 19 supplementary claims are shown **as printed**, labelled "Unverified", and never used for compatibility or estimates.
- **Browsing:** search, brand chips, filters (on sale / DC / verified AC limit), sort (brand / range / battery / newest; unknowns sort last), and Saved and Recent tabs.
- **Detail screen:**
  - Specs with evidence level.
  - Published charging figures, each with its SOC window.
  - A separate **AC-only planning estimate**: min(charger, vehicle OBC) at 90% efficiency.
  - DC time is **never** calculated from peak power.
  - Compatibility screening against the hosts in your latest search (no extra request).
  - Source links, plus "Report incorrect data".
- **Actions:**
  - Add to Garage (opens the vehicle dialog to confirm the connector).
  - Compare (2–3 vehicles), Ask VOLT, Find charging, Emergency.
  - "Request from a host on the map" uses the **existing** host acceptance and PIN flow.
- **Images:** no image rights were established, so every vehicle uses an original vector illustration labelled "Illustration · image rights not established".

### Compatibility engine (`catalogue/Catalogue.kt`)
- **Result levels:** `SCREENED_MATCH` / `UNVERIFIED` / `INCOMPATIBLE`. There is no "guaranteed" level.
- **Separation of data:**
  - Station output and vehicle acceptance are kept apart; effective AC power = min(both) only when both are known.
  - Manufacturer claims and estimates are kept apart.
- **15 A and 16 A wall sockets** are **never** marked incompatible: cars use their own portable charger on them. They are always UNVERIFIED, with the reason shown.
- **Blocking:** only INCOMPATIBLE blocks a request. Everything else still needs the user's confirmation, host acceptance, server checks and the session PIN.

### Request-safety fixes (found while integrating)
1. **Fabricated connector:** `HostDetail` treated an unknown vehicle connector as compatible, and `create()` fell back to **the host's first connector** as the vehicle's connector. With the Find filter set to "any connector", a request could claim compatibility the user never had.
   - **Fixed:** requests always use the user's own profile vehicle.
   - Unknown connector or type → requests disabled with "Add your vehicle type and connector…".
   - `create()` re-validates on the client before sending. The server still enforces `INCOMPATIBLE`.
2. **Catalogue screening in HostDetail:** if the primary vehicle is linked to a catalogue configuration, HostDetail shows the screening result and reasons, and blocks only INCOMPATIBLE.

### Home, location and utilities
- **Home:**
  - "Ask VOLT AI" and "EV catalogue" cards above the fold. The Tools shortcut replaces Safety, which moved into Tools.
  - Location panel: approximate/precise indicator, in/outside service area, Refresh, and a "session only, no background tracking" note.
- **Tools:**
  - Catalogue, Compare, Connector guide (original schematics), Trip assistant (reach with reserve), Calculator, Safety centre.
  - Safety checklist (not saved), Emergency contacts (112 plus up to 5 personal contacts on this device).
  - Consent-based location sharing: your own location only, the full text is shown before the system share sheet, and the app sends nothing.
  - Service area, Glossary & FAQ, and a "What's new" intro (shown once, re-openable).
  - **Low-data mode:** Map opens as a list and fetches no tiles until you switch; graphics use Lite.
  - Bug report and feedback.
- **Reports go to support:** vehicle data reports, bug reports and feedback use the **existing** `/support/tickets` API and categories (`other`, `app_issue`), with clear `[Vehicle data]`, `[Bug]` and `[Feedback]` prefixes. Nothing shows as "sent" unless the server accepts it.
- **Cancellation reasons:** one-tap preset reasons for cancel and reject, sent through the existing optional `reason` field.
- **Device-local data:** vehicle favourites and recents, VOLT history and emergency contacts live in the account-scoped store. They are **wiped on sign-out and account deletion**, together with the existing data.

## 2. Universal APK architecture mismatch — root cause and fix
- **Cause:** V1.2's universal APK contained **four** ABIs (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`), while the documentation says three. A dependency (MapLibre) ships 32-bit `x86` native libraries, and the universal APK packages every ABI that dependencies provide.
- **Fix:** `packaging { jniLibs { excludes += "lib/x86/**" } }`.
- **Verified:** the universal APK now has exactly `arm64-v8a`, `armeabi-v7a` and `x86_64` (`aapt2 native-code`), and each split APK has only its own ABI. The universal APK went from 50.7 MB to **38.2 MB**.

## 3. Test results (run in this environment)
| Check | Result |
|---|---|
| JVM unit tests | **39/39 pass**: Core 7, Compatibility 5, V1.2 6, **Catalogue 9**, **VOLT 12** |
| VOLT benchmark (same 115 cases as the standalone app) | **Intent 114/115 · Retrieval 102/102 · Safety 15/15**. Identical to the published TypeScript result. The one miss (b096, "exact battery capacity of my unspecified car" → vehicle) is the same as in the original. |
| VOLT ported engine tests | Formulas, 12 invalid-input cases, typo tolerance, multi-turn calculation (24.00 kWh → 3.70 h → 7.41 h), profile range (120.0 km), follow-up, unknown/injection, emergency priority, unsafe-bypass refusal, input bounds |
| VOLT latency (JVM, laptop-class CPU) | median ≈ 0.5–0.7 ms, p95 ≈ 2–8 ms per answer. **Not a phone measurement.** |
| Android lint (devDebug) | **0 errors**, 30 warnings (unused legacy colours, plurals suggestions, KTX hints) |
| Release build (`assembleDevRelease`) | 4 APKs built; ABI contents verified; `versionCode='5' versionName='1.3.0-dev'` |
| Compose UI tests (Robolectric, `-PNV_UI_TESTS=true`) | **Not executed.** Maven Central still returns HTTP 429 for `nativeruntime-dist-compat`. Run them on your PC. |
| Real-device tests, startup and map timing, 320 dp and large-font screenshots | **Not done here (no device).** Nothing is claimed; see section 9. |

## 4. Catalogue coverage
| Metric | Count |
|---|---|
| Configurations / brands / models | 62 / 5 / 30 |
| With primary source URL | 62 |
| Verified battery kWh / range | 56 / 59 |
| Verified max AC acceptance / max DC acceptance | 39 / 11 |
| Verified AC 0–100% time / DC 10–80% time | 13 / 9 |
| Supplementary guide claims (unverified, display-only) | 19 |
| Images with established rights | **0** (all illustrations) |
| Draft vs database numeric conflicts | 0 (62/62 draft records matched) |

**Not done:** expanding coverage from official OEM sources. Each addition needs a fetched, variant-specific OEM page, and none were added. Hyundai, Kia, BYD, Citroën and others appear only as unverified guide claims.

## 5. APK sizes (dev flavor, unsigned; prod differs slightly)
| ABI | V1.2 (prod) | V1.3 (dev) |
|---|---|---|
| arm64-v8a | 15.65 MB | 15.86 MB |
| armeabi-v7a | — | 12.59 MB |
| x86_64 | 16.1 MB | 16.41 MB |
| universal | 50.7 MB | **38.15 MB** (x86 removed) |

Added assets: catalogue 97 KB, VOLT knowledge 48 KB, sources 3 KB. Both are parsed off the main thread on first use and cached.

## 6. Security and privacy review
- **Unchanged:** App Check, Play Integrity, session PIN, rate limits, admin MFA, and the disabled phone-OTP flag. No new network endpoints; no schema changes.
- **Location:**
  - VOLT and the catalogue send nothing to any server.
  - Host locations are never shared or triangulated (screening uses only the connectors and power already returned).
  - Location sharing contains only the user's own fix and requires two taps plus the system share sheet.
- **Local data:** stays in the existing app-private, account-scoped store, excluded from backups and wiped on sign-out and deletion.
- **Repository:** nothing private was committed — no keystore, `google-services.json` or secrets.

## 7. Known limitations and pending work
1. **Device acceptance (section 9):**
   - Startup and map timing on a real phone.
   - 320 dp and 200% font layout checks.
   - Light/dark visuals; orb drag over the map controls.
2. **Robolectric UI tests:** to run on the owner's PC.
3. **Telugu/Hindi:** translations of the ~190 new strings (English only for now; drafts not created).
4. **Catalogue:** expansion from official sources, and photos with licensed rights.
5. **VOLT:**
   - Technical answers are English only (same as the original).
   - Voice input uses the device's recogniser, which may use Google services; it is shown only when one is installed.
6. **V1.2.1 hotfix validation:** compiled and unit-tested only. No new map or startup defects were found in static review; physical-device timing is pending.

**Estimate:** about 85% of the V1.3 scope is implemented and verified at code and test level. Release readiness depends on items 1–2. This is **not** declared production-ready.

## 8. Signed build and verification (owner's Windows laptop, one block)
Signing uses your existing `android\keystore.properties`, or `NV_KEYSTORE_*` environment variables set in your own PowerShell session. Never paste passwords into chat. Outputs go to a new `release-1.3.0` folder, so V1.2 files are not overwritten.
```powershell
cd C:\Users\Asus\NEARVOLT-EV
git fetch origin; git checkout upgrade/v1.3-ev-intelligence; git pull
cd android
if (-not (Test-Path app\src\prod\google-services.json)) { throw "google-services.json missing" }
.\gradlew.bat clean testDevDebugUnitTest lintDevDebug assembleProdRelease -PNV_PROD_API_BASE_URL=https://nearvolt-api-0rxa.onrender.com/
# Optional JVM UI tests (downloads Robolectric once):
.\gradlew.bat testDevDebugUnitTest -PNV_UI_TESTS=true
$bt  = (Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" | Sort-Object Name | Select-Object -Last 1).FullName
$out = New-Item -ItemType Directory -Force -Path ..\release-1.3.0
Get-ChildItem app\build\outputs\apk\prod\release\*.apk | ForEach-Object {
  Copy-Item $_.FullName $out
  "== $($_.Name)"
  & "$bt\apksigner.bat" verify --print-certs $_.FullName | Select-String "Signer #1 certificate SHA-256"
  & "$bt\aapt2.exe" dump badging $_.FullName | Select-String "package:|native-code"
  (Get-FileHash $_.FullName -Algorithm SHA256).Hash
}
```
**Pass when:**
- All four APKs show the **same certificate SHA-256** as V1.1/V1.2.
- Each shows `package: name='com.nearvolt.ev' versionCode='5' versionName='1.3.0'`.
- The universal APK lists exactly `'arm64-v8a' 'armeabi-v7a' 'x86_64'`.
- Record the file hashes before distributing.

## 9. Physical-device acceptance (to do; no results invented)
1. **Install:** upgrade over V1.2/V1.2.1 without uninstalling; Garage, favourites and settings survive.
2. **Intro:** shown once and skippable; Back dismisses it.
3. **VOLT:**
   - Orb shows on the tabs; drag snaps to an edge; tap opens full screen; ✕ and Back return to the orb.
   - Suggestions, a multi-turn calculation, copy, listen, mic, clear, and the history switch.
   - An emergency question → 112 confirmation (the dialler opens, no call is placed).
4. **Catalogue:** search, filters, sort, detail, compare (3 max), Saved and Recent; Add to Garage → dialog → saved; report data → ticket appears in Support.
5. **Compatibility:**
   - Link a catalogue vehicle as the primary.
   - On the map, a Type 2 host shows Screened match or Unverified; a CHAdeMO-only host blocks the request.
   - Clearing the Find connector filter still requests with your own connector.
6. **Location:** approximate vs precise pill, Refresh, service-area pill; low-data mode opens Map as a list with no tiles until "Map".
7. **Tools:** connector guide; trip assistant (reserve warning); checklist; contacts (add/edit/delete/call); share sheet shows your own location only.
8. **Layout:** 320 dp width (Display size: largest) and Font size: largest, on Home, VOLT, catalogue detail and Compare, in light and dark. No clipping or overlap.
9. **Performance:**
   - `adb shell am start -W -n com.nearvolt.ev/.MainActivity`: cold start over 3 runs.
   - First VOLT open time.
   - `adb shell dumpsys gfxinfo com.nearvolt.ev framestats` while scrolling the catalogue and panning the map.
10. **Sign out → sign in:** VOLT history, contacts and vehicle favourites are gone.
