import { unauth, forbidden } from '../lib/errors.js';

// Verifies Firebase ID token (with revocation check) and optional App Check token.
export function authenticate({ auth, appCheck, config }) {
  return async (req, _res, next) => {
    try {
      if (config.REQUIRE_APP_CHECK) {
        const t = req.get('X-Firebase-AppCheck');
        if (!t) throw unauth('App verification required.');
        try { await appCheck.verifyToken(t); } catch { throw unauth('App verification failed.'); }
      }
      const h = req.get('Authorization') || '';
      const m = h.match(/^Bearer (.+)$/);
      if (!m) throw unauth();
      let decoded;
      try { decoded = await auth.verifyIdToken(m[1], true); } catch { throw unauth('Session expired. Please sign in again.'); }
      req.user = {
        uid: decoded.uid,
        role: decoded.role || null, // 'customer' | 'host' (custom claim, set by server only)
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

export const requireRole = (...roles) => (req, _res, next) =>
  next(req.user && roles.includes(req.user.role) ? undefined : forbidden('This action needs a different account type.'));

export const requireAdmin = (config) => (req, _res, next) => {
  if (!req.user?.admin) return next(forbidden());
  if (config.REQUIRE_ADMIN_MFA && !req.user.mfa) return next(forbidden('Admin access requires two-step verification.'));
  next();
};
