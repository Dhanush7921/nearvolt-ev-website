import { Router } from 'express';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { validate } from '../middleware/validate.js';
import { ok } from '../middleware/errors.js';
import { bad, conflict, tooMany, unavailable } from '../lib/errors.js';
import { otpSendSchema, otpVerifySchema } from '../lib/schemas.js';
import { normalizeIndianMobile } from '../lib/sanitize.js';
import { hitLimit, IP_SHARDS } from '../lib/limiter.js';
import { logger } from '../lib/logger.js';

const COOLDOWN_S = 30, MAX_SENDS_PER_HOUR = 5, MAX_VERIFY_FAILS = 5, LOCK_S = 3600, SEND_VALID_S = 300;

// Phone OTP via MSG91 → Firebase custom token. Throttle state is keyed by a salted hash (no raw numbers stored).
export function otpRoutes({ db, auth, config, otp, authOptional }) {
  const r = Router();
  const throttleRef = (phone) => db.collection('otpThrottle').doc(createHash('sha256').update(`${config.OTP_HASH_SALT}:${phone}`).digest('hex'));
  const ensure = () => { if (!config.phoneOtpEnabled || !otp) throw unavailable('Phone sign-in is temporarily unavailable. Use Google or email.', 'PHONE_AUTH_DISABLED'); };

  r.post('/send', validate(otpSendSchema), async (req, res, next) => {
    try {
      ensure();
      const phone = normalizeIndianMobile(req.body.phone);
      if (!phone) throw bad('Enter a valid 10-digit Indian mobile number.');
      await hitLimit(db, `otpip_${req.ip}`, config.OTP_IP_LIMIT_PER_HOUR, 3600, IP_SHARDS);
      const ref = throttleRef(phone);
      const now = Date.now();
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const t = s.exists ? s.data() : {};
        if (t.lockedUntil && t.lockedUntil.toMillis() > now) throw tooMany('Too many wrong codes. Try again in an hour.');
        if (t.lastSentAt && now - t.lastSentAt.toMillis() < COOLDOWN_S * 1000) throw tooMany(`Please wait ${COOLDOWN_S} seconds before requesting another code.`);
        const sends = (t.sends || []).filter((x) => now - x.toMillis() < 3600e3);
        if (sends.length >= MAX_SENDS_PER_HOUR) throw tooMany('Too many codes requested. Try again later.');
        tx.set(ref, { sends: [...sends, Timestamp.fromMillis(now)], lastSentAt: Timestamp.fromMillis(now), verifyFails: 0, consumed: false,
          expireAt: Timestamp.fromMillis(now + 2 * 3600e3) }, { merge: true });
      });
      const out = await otp.send(phone);
      if (!out.ok) { logger.warn({ provider: 'msg91', msg: out.message }, 'otp send failed'); throw unavailable('Could not send the code right now. Please try again.', 'OTP_SEND_FAILED'); }
      logger.info({ metric: 'otp_send' }, 'otp sent');
      ok(res, { sent: true, resendAfterSeconds: COOLDOWN_S, expiresInSeconds: SEND_VALID_S });
    } catch (e) { next(e); }
  });

  r.post('/verify', authOptional, validate(otpVerifySchema), async (req, res, next) => {
    try {
      ensure();
      const phone = normalizeIndianMobile(req.body.phone);
      if (!phone) throw bad('Enter a valid 10-digit Indian mobile number.');
      const ref = throttleRef(phone);
      const s = await ref.get();
      const t = s.exists ? s.data() : null;
      const now = Date.now();
      if (!t?.lastSentAt || t.consumed || now - t.lastSentAt.toMillis() > SEND_VALID_S * 1000) throw bad('Code expired. Request a new one.');
      if (t.lockedUntil && t.lockedUntil.toMillis() > now) throw tooMany('Too many wrong codes. Try again in an hour.');
      const result = await otp.verify(phone, req.body.otp);
      if (!result.ok) {
        const fails = (t.verifyFails || 0) + 1;
        await ref.update({ verifyFails: fails, ...(fails >= MAX_VERIFY_FAILS ? { lockedUntil: Timestamp.fromMillis(now + LOCK_S * 1000) } : {}) });
        throw bad('Incorrect code.');
      }
      // Replay prevention: mark this send as consumed atomically; a second verify of the same send fails.
      await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        if (cur.data().consumed) throw bad('Code already used. Request a new one.');
        tx.update(ref, { consumed: true, verifyFails: 0 });
      });
      if (req.user) {
        // Linking a phone to an existing signed-in account (ownership proven by OTP).
        const existing = await auth.getUserByPhoneNumber(phone).catch(() => null);
        if (existing && existing.uid !== req.user.uid) throw conflict('This number is already linked to another account.', 'PHONE_IN_USE');
        await auth.updateUser(req.user.uid, { phoneNumber: phone });
        await db.collection('users').doc(req.user.uid).set({ phone }, { merge: true });
        return ok(res, { linked: true });
      }
      let user = await auth.getUserByPhoneNumber(phone).catch(() => null);
      if (!user) user = await auth.createUser({ phoneNumber: phone });
      if (user.disabled) throw bad('This account is disabled. Contact support.');
      const token = await auth.createCustomToken(user.uid);
      ok(res, { customToken: token, newUser: !user.metadata?.lastSignInTime });
    } catch (e) { next(e); }
  });
  return r;
}
