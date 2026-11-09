# NEARVOLT EV — V2 cinematic concept website

Informational website for **NEARVOLT EV**, a planned peer-to-peer EV charging discovery platform (Andhra Pradesh first). The site is a concept presentation: no database, accounts, live listings, booking or payments.

> NEARVOLT EV is currently in its pre-launch demonstration phase. Charging and booking services are not yet available.

## Highlights
- **8-second cinematic intro film** (headlights → reveal → charging connector → energy forms the logo), rendered from the site's **own real-time 3D scene**, so its last frame is the homepage's first frame. Plays once per session, muted by default, with Skip, Sound and Replay; bypassed for reduced motion; never blocks the page.
- **Live WebGL2 hero**: HDR studio lighting (analytic softboxes), clear-coat paint, floor reflections, bloom, cable and energy particles, cursor parallax, 3D hotspots.
- **Scroll story** (Find → Arrive → Connect → Charge) driving the same camera.
- Connector guide and charging-time estimator (carried over from V1), glowing feature cards, demo app screens, network illustration, Safety, FAQ, Contact, Legal & Credits.

## Commands
| | |
|---|---|
| `npm run typecheck` | TypeScript check |
| `npm run build` | build to `dist/` (relative URLs, works under any GitHub Pages base path) |
| `npm run preview` | serve `dist/` on :4173 |
| `npm run logo` | regenerate logo set (`public/brand`, `src/brand.ts`) |
| `npm run audio` | regenerate original intro sound design |
| `npm run render:intro` | render intro frames with headless Chrome (`frames/`) |
| `npm run encode:intro` | encode MP4/WebM (1080p, 720p, portrait) + posters into `public/video` |

URL flags: `?intro` forces the intro, `?nointro` skips it, `?nowebgl` shows the image fallback, `?low` forces the light renderer.

No runtime dependencies. Build needs only TypeScript (`tsc`); intro rendering needs Chrome + Playwright, ffmpeg and Python 3 with numpy (audio) / fontTools (logo).

## Structure
```
index.html, legal.html, 404.html   pages (render.html: offline intro renderer, not deployed)
src/engine/   studio.ts (WebGL2 renderer), glb.ts (glTF loader), shaders.ts, director.ts (camera/light choreography), math.ts
src/main.ts   intro controller, hero loop, scroll story, UI      src/sections.ts  interactive sections
src/content.ts  contact email setting + V1 connector data and estimator
styles/main.css   public/  model, fonts, brand, video
```

## Configuration
- `src/content.ts` → `CONTACT_EMAIL`: set a monitored business address to enable the email buttons (empty = a notice is shown instead of dead buttons).

## Deployment
`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on push to `main`. One-time: repository **Settings → Pages → Source: GitHub Actions**. Target URL: https://dhanush7921.github.io/nearvolt-ev-website/

See [ASSETS.md](ASSETS.md) for every asset and its licence.
