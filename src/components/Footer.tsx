import { useRef, type CSSProperties } from 'react';
import { LAYOUT, WORD } from '../brand/brandPaths';
import { site } from '../config/site';
import { gsap, useGSAP } from '../lib/gsap';
import { prefersReducedMotion, setPointerEffects, useFinePointer, usePointerEffects, useReducedMotion } from '../lib/prefs';
import { Link, useLocation } from '../lib/router';
import { useReveal } from '../lib/reveal';
import { useTheme } from '../lib/theme';
import { ButtonLink } from './Button';
import { REPLAY_INTRO } from './Intro';
import { Logo } from './Logo';

export function Footer() {
  const { theme, toggle } = useTheme();
  const effects = usePointerEffects();
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const { pathname } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  useReveal(glassRef, [pathname]);

  // giant outlined wordmark: strokes draw, then the fill rises like a charge level
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const glyphs = ref.current?.querySelectorAll<SVGPathElement>('.fw-glyph');
      if (!glyphs?.length) return;
      gsap.set(glyphs, { strokeDasharray: 400, strokeDashoffset: 400 });
      const tl = gsap.timeline({ scrollTrigger: { trigger: '.footer-word', start: 'top 95%', end: 'bottom 75%', scrub: 0.8 } });
      tl.to(glyphs, { strokeDashoffset: 0, stagger: 0.06, ease: 'none' }).fromTo('.fw-level', { attr: { y: 10 } }, { attr: { y: -34 }, ease: 'none' }, 0.25);
    },
    [pathname],
    ref,
  );

  return (
    <footer className="footer" ref={ref}>
      <div className="container">
        <div className="footer-cta glass" data-gloss>
          <div>
            <span className="kicker">Early access</span>
            <h2 className="h2">Be first to know when charging gets closer.</h2>
          </div>
          <div className="footer-cta-actions">
            <ButtonLink to="/contact?form=driver" icon="arrow-right">
              I drive an EV
            </ButtonLink>
            <ButtonLink to="/contact?form=host" variant="glass" icon="plug">
              I could host
            </ButtonLink>
          </div>
        </div>

        <div className="footer-glass lg" ref={glassRef}>
          <div className="footer-grid footer-grid-v12">
            <div className="footer-brand" data-reveal>
              <Link to="/" aria-label="NEARVOLT EV home">
                <Logo decorative className="logo footer-logo" />
              </Link>
              <p className="muted">Emergency EV charging assistance, connecting drivers with nearby compatible charging hosts. Starting in Visakhapatnam, {site.region}.</p>
            </div>
            <nav aria-label="Discover" data-reveal style={{ '--i': 1 } as CSSProperties}>
              <h3>Discover</h3>
              <ul role="list">
                <li>
                  <Link to="/#find">Find Charging</Link>
                </li>
                <li>
                  <Link to="/how-it-works">How It Works</Link>
                </li>
                <li>
                  <Link to="/drivers">Drivers</Link>
                </li>
                <li>
                  <Link to="/hosts">Hosts</Link>
                </li>
              </ul>
            </nav>
            <nav aria-label="Support" data-reveal style={{ '--i': 2 } as CSSProperties}>
              <h3>Support</h3>
              <ul role="list">
                <li>
                  <Link to="/safety">Safety Centre</Link>
                </li>
                <li>
                  <Link to="/faq">FAQ</Link>
                </li>
                <li>
                  <Link to="/contact">Contact</Link>
                </li>
                <li>
                  <Link to="/contact?category=safety">Report a Concern</Link>
                </li>
              </ul>
            </nav>
            <nav aria-label="Legal" data-reveal style={{ '--i': 3 } as CSSProperties}>
              <h3>Legal</h3>
              <ul role="list">
                <li>
                  <a href={`${site.base}terms.html`}>Terms and Conditions</a>
                </li>
                <li>
                  <a href={`${site.base}privacy.html`}>Privacy Policy</a>
                </li>
                <li>
                  <a href={`${site.base}delete-account.html`}>Account Deletion</a>
                </li>
                <li>
                  <Link to="/legal">Charging disclaimer &amp; credits</Link>
                </li>
                <li>
                  <Link to="/safety#privacy">Privacy approach</Link>
                </li>
              </ul>
            </nav>
            <div data-reveal style={{ '--i': 4 } as CSSProperties}>
              <h3>Display</h3>
              <ul role="list">
                <li>
                  <button type="button" className="setting" role="switch" aria-checked={theme === 'dark'} onClick={() => toggle()}>
                    <span className="switch" aria-hidden="true" /> Dark theme
                  </button>
                </li>
                <li>
                  <button type="button" className="setting replay-intro" onClick={() => window.dispatchEvent(new Event(REPLAY_INTRO))}>
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
                    </svg>{' '}
                    Replay intro film
                  </button>
                </li>
                {fine && !reduced && (
                  <li>
                    <button type="button" className="setting" role="switch" aria-checked={effects} onClick={() => setPointerEffects(!effects)}>
                      <span className="switch" aria-hidden="true" /> Cursor effects
                    </button>
                  </li>
                )}
              </ul>
            </div>
          </div>
          <div className="footer-rule" aria-hidden="true" data-reveal />
          <div className="footer-bottom footer-bottom-v12" data-reveal>
            <p>{site.name} is in development — the app is not publicly available yet. Screens and locations shown are previews.</p>
            <span>
              © {new Date().getFullYear()} {site.name} ·{' '}
              <Link to="/legal" className="text-link">
                Legal &amp; credits
              </Link>
            </span>
          </div>
        </div>

        <svg className="footer-word" viewBox={`-2 -30 ${LAYOUT.wordW + 4} 34`} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
          <defs>
            <clipPath id="fw-clip">
              {WORD.map((g, i) => (
                <path key={i} d={g.d} />
              ))}
            </clipPath>
          </defs>
          <g clipPath="url(#fw-clip)">
            <rect className="fw-level" x="-2" y="10" width={LAYOUT.wordW + 4} height="60" />
          </g>
          {WORD.map((g, i) => (
            <path key={i} className="fw-glyph" d={g.d} pathLength={400} />
          ))}
        </svg>

      </div>
    </footer>
  );
}
