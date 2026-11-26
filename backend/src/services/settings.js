// Remote config stored in settings/app. Cached for 30 s per instance.
export const DEFAULT_SETTINGS = Object.freeze({
  maintenance: { enabled: false, message: '' },
  minSupportedVersionCode: 1,
  latestVersionCode: 1,
  featureFlags: { payments: false, phoneLogin: true },
  serviceAreas: [
    // Initial market. Radius covers Greater Visakhapatnam; admins can edit in the dashboard.
    { id: 'vizag', name: 'Visakhapatnam', active: true, center: { lat: 17.6868, lng: 83.2185 }, radiusKm: 30 },
  ],
  supportContact: { email: '', phone: '' },
});

export function createSettings(db, ttlMs = 30000) {
  let cache = null, at = 0;
  const ref = db.collection('settings').doc('app');
  return {
    async get() {
      if (cache && Date.now() - at < ttlMs) return cache;
      const snap = await ref.get();
      cache = { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) };
      at = Date.now();
      return cache;
    },
    async update(patch) { await ref.set(patch, { merge: true }); cache = null; return this.get(); },
    invalidate() { cache = null; },
  };
}
