import { unauth, forbidden, ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

// Distinct, actionable rejection codes (logged without token contents) so failed sign-ins can be diagnosed.
const reject = (status, code, message, extra) => { logger.warn({ metric: 'auth_fail', code, ...extra }, 'auth rejected'); return new ApiError(status, code, message); };

// Verifies Firebase ID token (with revocation check) and optional App Check token.
export function authenticate({ auth, appCheck, config }) {
  return async (req, _res, next) => {
    try {
      if (config.REQUIRE_APP_CHECK) {
        const t = req.get('X-Firebase-AppCheck');
        if (!t) throw reject(401, 'APP_CHECK_REQUIRED', 'This copy of the app could not be verified (App Check token missing).');
        try { await appCheck.verifyToken(t); } catch (e) { throw reject(401, 'APP_CHECK_FAILED', 'This copy of the app could not be verified (App Check token rejected).', { reason: e.code || e.message?.slice(0, 120) }); }
      }
      const h = req.get('Authorization') || '';
      const m = h.match(/^Bearer (.+)$/);
      if (!m) throw unauth();
      let decoded;
      try { decoded = await auth.verifyIdToken(m[1], true); } catch (e) {
        throw reject(401, 'SESSION_INVALID', 'Your session is not valid. Please sign in again.', { reason: e.code || e.message?.slice(0, 120) });
      }
      // Email/password accounts must verify their email before using the service.
      if (decoded.firebase?.sign_in_provider === 'password' && !decoded.email_verified) {
        throw reject(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to continue. Check your inbox for the verification link.');
      }
      req.user = {
        uid: decoded.uid,
        role: decoded.role || null, // legacy primary role 'customer' | 'host' (custom claim, set by server only)
        // V1.4 dual role: server-managed capability list. Tokens minted before V1.4 have no `roles`: fall back to [role].
        roles: rolesFromClaims(decoded),
        admin: decoded.admin === true,
        mfa: Boolean(decoded.firebase && decoded.firebase.sign_in_second_factor),
        phone: decoded.phone_number || null,
        email: decoded.email_verified ? decoded.email : null,
      };
      next();
    } catch (e) { next(e); }
  };
}

export const optionalAuth = (deps) => {
  const a = authenticate(deps);
  return (req, res, next) => (req.get('Authorization') ? a(req, res, next) : next());
};

const KNOWN_ROLES = new Set(['customer', 'host']);
export function rolesFromClaims(c) {
  const list = Array.isArray(c.roles) ? c.roles : c.role ? [c.role] : [];
  return [...new Set(list.filter((x) => KNOWN_ROLES.has(x)))];
}
export const hasRole = (req, role) => Boolean(req.user?.roles?.includes(role));
/** Passes when the user holds ANY of the given capabilities (a dual-role user passes both 'customer' and 'host' guards). */
export const requireRole = (...roles) => (req, _res, next) =>
  next(req.user && roles.some((r) => req.user.roles?.includes(r)) ? undefined : new ApiError(403, 'MODE_NOT_ENABLED', 'This action needs a different account mode.'));

export const requireAdmin = (config) => (req, _res, next) => {
  if (!req.user?.admin) return next(forbidden());
  if (config.REQUIRE_ADMIN_MFA && !req.user.mfa) return next(forbidden('Admin access requires two-step verification.'));
  next();
};
