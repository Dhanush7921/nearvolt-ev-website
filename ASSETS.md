# Asset and licence inventory

| Asset | Path | Source | Licence | Notes |
|---|---|---|---|---|
| Concept car 3D model | `public/models/ev-concept.glb` | “Car Concept”, Khronos glTF Sample Assets — © 2024 Darmstadt Graphics Group GmbH, artist Eric Chadwick; based on a CC0 model by Unity Fan | CC BY 4.0 | Reused from V1 (already stripped of Khronos/3D Commerce logos, plate and parts; textures recompressed; quantised). Recoloured at runtime. Credited on `legal.html`. Logo-free, not a production vehicle. |
| Intro film (MP4/WebM, 1080p/720p/portrait) and posters | `public/video/` | Original — rendered from this site's WebGL scene by `scripts/render-intro.mjs` | Project | Contains the CC BY car above (credited). |
| Intro sound design | `assets-src/intro-audio.wav` (muxed into the videos) | Original — synthesised by `scripts/make_audio.py` | Project | No samples, no third-party music. |
| Logo, symbol, favicon, app icons | `public/brand/*`, `public/favicon.svg`, `src/brand.ts` | Original — `scripts/build_logo.py` | Project | Wordmark outlined from Unbounded (OFL permits outlining). |
| Charger, connector, cable, inlet ring, energy particles, floor | `src/engine/studio.ts`, `shaders.ts` | Original procedural | Project | |
| Unbounded font | `public/fonts/unbounded-var.woff` | Google Fonts | SIL OFL 1.1 (`public/fonts/UNBOUNDED-OFL.txt`) | Reused from V1. |
| Instrument Sans font | `public/fonts/instrument-sans-var.woff` | Google Fonts | SIL OFL 1.1 (`public/fonts/INSTRUMENT-SANS-OFL.txt`) | Reused from V1. |
| Interface icons | inline SVG in `index.html` | Original simple strokes | Project | |

No paid assets, APIs or generation services were used. MotionSite reference prompts (VEYRA, NORVA, Glowing Cards) informed techniques only (image-relative hotspots, scroll-scrubbed camera storytelling, gradient-border glow cards); none of their media, branding or layouts are included.
