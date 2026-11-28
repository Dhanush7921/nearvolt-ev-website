// Read-only client for the PUBLIC NEARVOLT EV API endpoints the website may use without signing in.
// Host discovery (/hosts/nearby) needs a signed-in app user and App Check, so the website never calls it.
import { site } from '../config/site';

export type ServiceArea = { id: string; name: string; center: { lat: number; lng: number }; radiusKm: number };
export type PublicConfig = {
  maintenance?: { enabled: boolean; message: string };
  featureFlags?: Record<string, boolean>;
  serviceAreas: ServiceArea[];
  supportContact?: { email?: string; phone?: string };
};

let inflight: Promise<PublicConfig> | null = null;
let cached: { at: number; v: PublicConfig } | null = null;
const TTL = 60_000;

/** De-duplicated, cached for 60 s (matches the server's Cache-Control). Render Free can cold-start, so allow ~45 s. */
export function getPublicConfig(): Promise<PublicConfig> {
  if (!site.apiBase) return Promise.reject(new Error('NO_API'));
  if (cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.v);
  if (inflight) return inflight;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 45_000);
  inflight = fetch(`${site.apiBase}/api/v1/public/config`, { signal: ctrl.signal, credentials: 'omit' })
    .then(async (r) => {
      const j = (await r.json().catch(() => null)) as { ok?: boolean; data?: PublicConfig; error?: { code?: string } } | null;
      if (!r.ok || !j?.ok || !j.data) throw new Error(j?.error?.code || `HTTP_${r.status}`);
      const v = { ...j.data, serviceAreas: Array.isArray(j.data.serviceAreas) ? j.data.serviceAreas : [] };
      cached = { at: Date.now(), v };
      return v;
    })
    .finally(() => {
      window.clearTimeout(timer);
      inflight = null;
    });
  return inflight;
}

/** Great-circle (straight-line) distance in km. Always labelled as straight-line in the UI. */
export function straightLineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
