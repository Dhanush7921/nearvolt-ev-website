# V1.2.1 targeted mobile hotfix (not device-validated)
Base: 19dea5e. Version 1.2.1 (code 4). Keep original release key.
- System splash no longer blocks Compose loading screen; connection message after 2 seconds. Token acquisition starts concurrently; protected API checks remain intact.
- Dedicated map uses configured service-area center without presenting it as user location, non-overlapping segmented labels, wrapping controls, separate top/map/bottom layout, scrollable draft filters with one Apply request, reset includes radius. Camera no longer resets on host-only updates. List fallback and attribution preserved.
- Nearby request cancellation / latest results, no reuse of mismatched cached results; Home offers explicit GPS or manual location entry; no background permission/tracking.
- No website, backend, Firebase or signing changes. Original animation assets unchanged.
- Requires local compile, unit tests, lint, signed APK and phone acceptance. Startup/dashboard latency and map FPS not measured. Test denied/off GPS, filter apply/reset/dismiss, no-location map, map/list failure, 320dp + large font, theme, account switch and old backend compatibility.
- Universal ABI mismatch remains a separate packaging investigation. Do not distribute failing artifact.
- VOLT AI and vehicle catalogue are not included here; separate integration after review.
