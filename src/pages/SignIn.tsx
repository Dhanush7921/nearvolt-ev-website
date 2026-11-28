import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ButtonLink } from '../components/Button';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { site } from '../config/site';
import { Link } from '../lib/router';
import { useReveal } from '../lib/reveal';

// Web sign-in PREVIEW. The website has no customer authentication backend: accounts are created in the
// NEARVOLT EV Android app (Firebase Authentication + App Check). Nothing typed here is sent anywhere, and the
// page never reports a successful sign-in. Phone OTP stays disabled until an approved SMS provider exists.

type Mode = 'signin' | 'create';
type Method = 'email' | 'phone';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STEPS = ['Create your account', 'Select your role', 'Complete your profile'];

export default function SignIn() {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();
  const [mode, setMode] = useState<Mode>('signin');
  const [method, setMethod] = useState<Method>('email');
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useReveal(ref);

  useEffect(() => {
    setErrors({});
    setNotice(null);
  }, [mode, method]);

  const handoff = (what: string) => {
    setNotice(`${what} on the website is not available yet, so nothing was sent and you are not signed in. Sign in or create your account in the NEARVOLT EV Android app.`);
    requestAnimationFrame(() => noticeRef.current?.focus());
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!EMAIL.test(email.trim())) errs.email = 'Enter an email address like name@example.com.';
    if (mode === 'create' ? password.length < 8 : !password) errs.password = mode === 'create' ? 'Use at least 8 characters.' : 'Enter your password.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    handoff(mode === 'create' ? 'Creating an account' : 'Email sign-in');
  };

  return (
    <div className="page auth" ref={ref}>
      <div className="auth-shell">
        <aside className="auth-cine" aria-label="NEARVOLT EV">
          <picture>
            {/* phones get a 1 px placeholder instead of the 1080p poster (no hidden background download) */}
            <source media="(max-width: 900px)" srcSet="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
            <img className="auth-cine-bg" src={`${site.base}media/home-plug-poster-land.jpg`} alt="" loading="eager" decoding="async" />
          </picture>
          <div className="auth-cine-veil" aria-hidden="true" />
          <div className="auth-cine-copy">
            <Link to="/" className="auth-logo" aria-label="NEARVOLT EV home">
              <Logo decorative />
            </Link>
            <h1 className="auth-title mask-reveal">
              <span className="mask-line">
                <span>Your charging journey</span>
              </span>
              <span className="mask-line">
                <span className="ink-emerald">starts here.</span>
              </span>
            </h1>
            <p data-reveal>Join NEARVOLT EV and discover charging assistance closer to you.</p>
            <ol className="auth-steps" role="list">
              {STEPS.map((s, i) => (
                <li key={s} className={i === 0 ? 'is-active' : undefined} data-reveal style={{ '--i': i + 2 } as CSSProperties}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <section className="auth-panel" aria-labelledby={`${uid}-h`}>
          <div className="auth-form-wrap" data-reveal>
            <p className="auth-preview" role="note">
              <Icon name="info" /> Preview — web sign-in is not live yet. Use the Android app to sign in.
            </p>
            <div className="seg" role="tablist" aria-label="Account">
              {(['signin', 'create'] as Mode[]).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} className="seg-btn" onClick={() => setMode(m)}>
                  {m === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>
            <h2 className="h2" id={`${uid}-h`}>
              {mode === 'signin' ? 'Welcome back.' : 'Create your profile.'}
            </h2>
            <p className="muted">{mode === 'signin' ? 'Sign in to see your requests and charging history.' : 'Drivers and hosts use the same account; you choose your role next.'}</p>

            <div className="auth-social">
              <button type="button" className="social-btn" onClick={() => handoff('Google sign-in')}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
                  <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
                  <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9l4-3.1Z" />
                  <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
                </svg>
                Continue with Google
              </button>
              <button type="button" className="social-btn" aria-pressed={method === 'phone'} onClick={() => setMethod((m) => (m === 'phone' ? 'email' : 'phone'))}>
                <Icon name={method === 'phone' ? 'mail' : 'smartphone'} />
                {method === 'phone' ? 'Use email instead' : 'Use mobile number'}
              </button>
            </div>
            <div className="or" aria-hidden="true">
              <span>or</span>
            </div>

            {method === 'email' ? (
              <form className="auth-form" onSubmit={onSubmit} noValidate>
                <label className="afield">
                  <span>Email</span>
                  <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? `${uid}-ee` : undefined} placeholder="name@example.com" />
                  {errors.email && (
                    <small id={`${uid}-ee`} className="ferr">
                      {errors.email}
                    </small>
                  )}
                </label>
                <label className="afield">
                  <span>
                    Password
                    {mode === 'signin' && (
                      <button type="button" className="text-link" onClick={() => handoff('Password reset')}>
                        Forgot password?
                      </button>
                    )}
                  </span>
                  <span className="pw">
                    <input
                      type={show ? 'text' : 'password'}
                      autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!errors.password}
                      aria-describedby={`${uid}-ph${errors.password ? ` ${uid}-pe` : ''}`}
                    />
                    <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                      <Icon name={show ? 'eye-off' : 'eye'} />
                    </button>
                  </span>
                  <small id={`${uid}-ph`} className="fhelp">
                    {mode === 'create' ? 'At least 8 characters. You will verify your email before continuing.' : 'Accounts with an unverified email are asked to verify first.'}
                  </small>
                  {errors.password && (
                    <small id={`${uid}-pe`} className="ferr">
                      {errors.password}
                    </small>
                  )}
                </label>
                <button type="submit" className="auth-submit">
                  {mode === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              </form>
            ) : (
              <div className="auth-form">
                <label className="afield">
                  <span>Mobile number</span>
                  <span className="tel">
                    <span className="tel-cc" aria-label="Country code India plus 91">
                      IN +91
                    </span>
                    <input type="tel" inputMode="numeric" disabled placeholder="98765 43210" aria-describedby={`${uid}-otp`} />
                  </span>
                </label>
                <div className="otp" aria-label="Six-digit code (disabled preview)">
                  {Array.from({ length: 6 }, (_, i) => (
                    <input key={i} disabled inputMode="numeric" maxLength={1} aria-label={`Digit ${i + 1}`} />
                  ))}
                </div>
                <p className="fhelp" id={`${uid}-otp`}>
                  <Icon name="lock" /> Phone sign-in is switched off: no SMS provider is approved yet, so no codes are sent. When enabled, codes expire after a few minutes and can be resent after a
                  short countdown.
                </p>
                <button type="button" className="auth-submit" disabled>
                  Send code
                </button>
              </div>
            )}

            {notice && (
              <div className="auth-notice" ref={noticeRef} tabIndex={-1} role="status">
                <Icon name="smartphone" />
                <div>
                  <p>{notice}</p>
                  <ButtonLink to="/#download" size="sm" icon="arrow-right">
                    Get the App
                  </ButtonLink>
                </div>
              </div>
            )}

            <p className="auth-legal">
              By continuing you agree to the <a href={`${site.base}terms.html`}>Terms</a> and <a href={`${site.base}privacy.html`}>Privacy Policy</a>.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
