# V3 “Home Plug” intro film — source

Original 3D CGI film (18 s) rendered offline in headless Chromium with three.js, frame by frame (`window.__film.seek(t)`).

| file | role |
|---|---|
| `film.ts` | scene (procedural Indian residential neighbourhood, houses, trees, wall-mounted 7.4 kW Type 2 home charger, car with hub-pivoted wheels), camera, timing, overlays |
| `index.html` | interface layers: low-battery chip, map + nearby home chargers, reservation phone, charging chip, captions, logo (the site's own `public/brand/logo-on-dark.svg`), landscape + portrait layouts |
| `render.cjs` | renders JPEG frames. `W`/`H`/`DPR` env: landscape 1920×1080 (`DPR=2` → native 3840×2160), portrait `W=1080 H=1920` |
| `hero3.mjs` | captures the live hero (desktop + portrait) used as the film's last frame, so the hand-off is seamless |
| `audio.py` | original synthesised score (numpy), loudness-normalised to −16 LUFS |
| `encode-v3.sh` | web encodes → `public/video/v3/` (MP4 H.264 + WebM VP9, posters) and the 4K60 master |

`film.ts` imports the car loader, CCS2 connector parts and the concept car model (`Car Concept`, CC BY 4.0, credited on `legal.html`) from the NEARVOLT V1 repository (`green-plug-ev-website`); adjust the absolute import paths before rendering elsewhere.

Demo values in the film (battery, distances, places, slots, booking) are illustrative only.
