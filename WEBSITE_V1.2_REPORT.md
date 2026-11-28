# NEARVOLT EV — Website V1.2 (ultra-premium enhancement)

Branch: `upgrade/v1.2-premium-website`, created from `upgrade/v1.1-premium-zero-cost` at `4369b7a`. **Not merged and not deployed.** `production/v1` is unchanged.
Scope: website only. The Android app, backend, Firebase configuration, admin dashboard and APK signing were not modified.

## 1. What changed (eight adapted modules)
| # | Reference | Where | What it does |
|---|---|---|---|
| 1 | NAVBAR | `src/components/Nav.tsx`, `src/config/menu.ts`, `src/components/EvPreview.tsx` | Discover / Drivers / Hosts / Safety / About dropdowns share one container. Switching menus morphs its position, width and height (0.46 s). Content slides in the direction of travel with a blur crossfade. Discover shows an original SVG preview that changes per item. Right side: theme switch, Sign in, Get the App. Keyboard: Enter/Space toggles, ArrowDown focuses the first link, Escape closes and returns focus. Outside click closes. Touch uses click, not hover. Mobile keeps the existing shutter animation with a grouped glass sheet. Every link goes to an existing page or section. |
| 2 | AGENCY | `src/sections/home/Cinema.tsx` (copy only) | Hero eyebrow, headline, supporting text and CTAs updated to "Your next charge is closer." / Find Charging / Become a Host. Masked headline reveals and gradient keywords are used in the new sections. The 3D scene, camera, scroll chapters, HUD and intro are untouched. |
| 3 | AI | `src/sections/home/FindCharging.tsx`, `src/lib/api.ts` | Glass composer with location entry, Use my location (browser geolocation), vehicle, connector, battery %, emergency switch, four preference chips and Find Charging. It calls the **public** API `/api/v1/public/config` live and reports whether the user is inside an active service area. Distance is straight-line and labelled as such. Hosts and addresses are never shown on the website; there is a handoff to the app. No AI service and no paid map API are used. |
| 4 | LOGIN PAGE | `src/pages/SignIn.tsx` → `/sign-in` | Two columns, 52 / 48. Sign In / Create Account, Google, email + password with a visibility toggle, password reset, a mobile-number mode with +91 and a six-digit OTP field, plus terms and privacy links. **Clearly labelled preview**: the website has no customer authentication backend. Submitting validates input, then explains the handoff to the app. It never reports success. The phone OTP UI is disabled because no SMS provider exists, and the admin login is not linked. On mobile it is a single column and skips the background image download. |
| 5 | UTILITY | `src/pages/Dashboard.tsx` → `/dashboard` | Liquid-glass dashboard with a sidebar, header and right rail. The only live data is the service area from the public API, drawn as a schematic ring (labelled "not to scale"). Activity, notifications and account show honest empty states. The sample request timeline and vehicle are labelled "Illustration" / "Example". No host counts, telemetry, payments or revenue are shown. On mobile it uses a bottom dock. |
| 6 | CRYPTO WALLET | `src/sections/home/TrustSection.tsx` | Ten trust cards, each with an explicit status: *Live on this website*, *Built · app in testing* or *Required before launch*. Electrical verification is marked *Required*, with the line "no host has completed this yet". Also: an illustrative five-step session timeline (Request → Acceptance → Arrival verification → Charging → Completion) and an emergency-assistance block with 112. No crypto, wallet or payment content. |
| 7 | CONTACT | `src/pages/Contact.tsx`, `src/components/ContactForm.tsx` | Large rounded cinematic card using the existing Home Plug poster, headline on the left and form on the right. Fields: name, email, optional phone, seven category chips and message. Validation, loading state, honeypot, consent, a 60 s client cooldown and duplicate protection. Server-side limits in Apps Script (per email and global) still apply. A confirmation appears **only** when the form service stored the message; in demo mode it says nothing was sent. The Safety Concern category shows a 112 notice. The existing driver / host / partner / general tab forms and `?form=` deep links are kept below. |
| 8 | FOOTER | `src/components/Footer.tsx` | Translucent glass panel with a reflective gradient border and light blur. Columns: Brand, Discover, Support, Legal and Display. The Display settings are kept: theme, replay intro, cursor effects. The animated divider and staggered reveal are new. Legal links: Terms, Privacy, Account Deletion, and the disclaimer and credits page. The year is dynamic. The early-access CTA and the stroke-drawn wordmark VFX are preserved. No social links, because no verified profiles exist. |

The shared design layer is `src/styles/premium.css`, which is additive. It holds the brand tokens (#059669, #6BFFCB, #071B17, #202725, #F4F8F6), liquid-glass surfaces with a one-time specular sheen, light and dark variants, reduced-motion and forced-colours rules. No new npm packages, no Tailwind and no extra animation library. The new UI uses CSS transitions plus one IntersectionObserver per section; GSAP is used only where it already was.

## 2. Original 3D / cinematic preservation
- `git diff upgrade/v1.1-premium-zero-cost -- src/three src/components/Intro.tsx public android backend firebase web` is **empty**. Models, scenes, camera paths, VFX, video, intro film and Android are byte-identical.
- `Cinema.tsx` diff: the hero eyebrow, headline text, lede and the two CTA targets and labels only. Animation code and selectors are unchanged.
- The navbar's scroll behaviour (compact capsule, hide on scroll down) is retained. It now stays visible while a dropdown is open.
- The automated 3D checks in `npm run verify` cover scene load, plug-in sequence, scroll story, reduced-motion end state and the no-WebGL fallback (results in §4).

## 3. Honesty and security notes
- Public API calls go to `/api/v1/public/config` only: no auth, rate-limited server-side, `credentials: 'omit'`, de-duplicated and cached for 60 s. The live server's CORS allows `https://dhanush7921.github.io`; this was checked on 28 Nov 2026.
- No secrets in the bundle. `VITE_API_BASE` is a public URL.
- No local-storage authentication, no tokens and no protected endpoints called from the website.
- Firebase, App Check, Firestore rules, admin MFA and backend rate limits are unchanged.
- `npm audit`: 0 vulnerabilities (production and dev).

## 4. Verification results (28 Nov 2026, this container)
| Check | Result |
|---|---|
| `npm run typecheck` | Pass, 0 errors |
| `npm run build` | Pass. Main JS 271 → ~294 kB minified, CSS 66 → ~107 kB; new pages are lazy-loaded chunks |
| `npm run verify` (Playwright, production build) | **218 / 218 pass**. Includes 27 new V1.2 checks: menu morph, Escape, outside click, keyboard, links; Find Charging live check, unknown place, 112; sign-in has no fake success and OTP is disabled; dashboard empty states; contact validation, no fake confirmation, 112; mobile overflow and menu. Also all existing 3D, intro, reduced-motion, no-WebGL, theme, form and navigation checks |
| Responsive sweep: 320, 360, 390, 430, 768, 1024×768, 1024×600, 1440, 1920, 3840 px × 4 routes | No horizontal scroll. Two items from V1.1, left unchanged: the 3D HUD card sits 8 px past the edge at 320–360 px, and one Benefits word at 320 px |
| Themes | Light and dark screenshots checked; system theme still followed until the user chooses |
| Reduced motion | New sections render fully visible with no animation (0 hidden reveal items) |
| `npm audit` | 0 vulnerabilities |
| 3D regression | Same verify scene checks as V1.1 pass; `src/three`, intro and media are unchanged |

**Performance (lab, Playwright + Performance APIs; software WebGL, so real devices will differ):**
| Page | Mobile LCP | Mobile CLS | Desktop LCP | Desktop CLS | V1.1 desktop CLS |
|---|---|---|---|---|---|
| Home | 2.8 s (3D page; V1.1: 2.5 s) | 0.000 | 2.3 s (V1.1: 3.6 s) | 0.003 | 0.004 |
| Contact | 1.5 s | 0.000 | 0.5 s | **0.000** | 0.163 |
| Safety | 1.6 s | 0.000 | 1.6 s | **0.000** | 0.200 |
| Sign-in | 1.2 s | 0.000 | 0.5 s | 0.000 | new |
| Dashboard | 0.5 s | 0.000 | 0.5 s | 0.001 | new |

- Interaction latency for menu clicks: 32–190 ms on secondary pages. The home page is higher here only because this container renders WebGL on the CPU (V1.1 shows the same).
- A CLS of about 0.2 on every secondary page in V1.1 came from the lazy-page placeholder letting the footer flash into view; it is fixed.
- Phones no longer download the 1080p poster on /contact and /sign-in.
- Lighthouse could not be run in this environment; run it on the deployed preview.

## 5. Skipped (would cost money) and remaining blockers
| Item | Status |
|---|---|
| Paid maps / geocoding (typed address → coordinates) | Skipped. Typed text is matched only against active service-area names; GPS gives the precise check. |
| Real SMS OTP | Disabled until an approved provider exists (unchanged policy). |
| Web customer sign-in (Firebase web auth) | **Blocker / decision**: needs a web app registration in Firebase, authorised domains, role and consent onboarding on web, and App Check for web (reCAPTCHA Enterprise has paid tiers). Left as a preview with an app handoff. |
| Live host discovery on the website | Not possible without web auth; `/hosts/nearby` requires a signed-in user and App Check. |
| Store listings | No published app URLs, so "Get the App" leads to the existing "coming soon" store cards. |
| Verified social profiles | None supplied, so none shown. |
| Contact category stored as its own column | Carried inside the message text so the deployed Apps Script works unchanged. Adding a dedicated column needs an Apps Script redeploy by the owner. |
| Lighthouse on real devices | Lab numbers in this container use software WebGL. Re-measure on a real phone and desktop after deploy. |

## 6. Deploy and rollback (owner approval required)
Deploy (GitHub Pages):
1. Review the branch and its screenshots.
2. Optional: set the repository variable `VITE_API_BASE` (the default is the Render API).
3. Merge `upgrade/v1.2-premium-website` into the branch the Pages workflow deploys. `deploy.yml` builds and publishes automatically.
4. Check the live site: home 3D scene, the dropdown, Find Charging (Use my location inside and outside Vizag), contact submission (with `VITE_LEADS_ENDPOINT` set), and mobile.

Rollback:
- `git revert <merge commit>` and push. Pages redeploys the V1.1 site.
- Alternatively, re-run the Pages workflow on the previous commit.
- No backend or database change is involved, so nothing else needs rolling back.
