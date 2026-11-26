import { unavailable, ApiError } from '../lib/errors.js';
// Blocks app traffic in maintenance mode (admins and health exempt) and enforces minimum app version.
export function gate(settings) {
  return async (req, _res, next) => {
    try {
      const s = await settings.get();
      const vc = Number(req.get('X-App-Version-Code') || 0);
      const platform = req.get('X-App-Platform');
      if (platform === 'android' && vc && vc < (s.minSupportedVersionCode || 0)) {
        throw new ApiError(426, 'UPGRADE_REQUIRED', 'Please update NEARVOLT EV to continue.');
      }
      if (s.maintenance?.enabled && !req.path.startsWith('/admin')) {
        throw unavailable(s.maintenance.message || 'NEARVOLT EV is under maintenance. Please try again shortly.', 'MAINTENANCE');
      }
      next();
    } catch (e) { next(e); }
  };
}
