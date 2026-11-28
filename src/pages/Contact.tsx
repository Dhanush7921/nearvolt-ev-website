import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { LeadForm } from '../components/LeadForm';
import { ContactForm } from '../components/ContactForm';
import { site } from '../config/site';
import { gsap } from '../lib/gsap';
import { leadsMode, type LeadType } from '../lib/leads';
import { prefersReducedMotion } from '../lib/prefs';
import { useNavigate, useSearchParam } from '../lib/router';
import { useReveal } from '../lib/reveal';
import { useMotion } from '../motion/kinetic';

const TABS: { id: LeadType; label: string; icon: IconName; blurb: string }[] = [
  { id: 'driver', label: 'Driver early access', icon: 'car', blurb: 'Tell us what you drive and where, and we will let you know when the app is ready to try.' },
  { id: 'host', label: 'Host interest', icon: 'house', blurb: 'Have a charger or a suitable socket where vehicles can park? Register interest; it is not a commitment.' },
  { id: 'partner', label: 'Partnerships', icon: 'handshake', blurb: 'Charge point operators, vehicle makers, fleets, property owners and public bodies.' },
  { id: 'general', label: 'General enquiry', icon: 'message-circle', blurb: 'Questions, feedback, media or anything else.' },
];

export default function Contact() {
  const ref = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const param = useSearchParam('form');
  const navigate = useNavigate();
  const initial = (TABS.find((t) => t.id === param)?.id ?? 'driver') as LeadType;
  const [tab, setTab] = useState<LeadType>(initial);
  useMotion(ref);
  useReveal(ref);
  useEffect(() => {
    // Deep links like /contact?form=host land on the specific forms below the contact card.
    if (!param) return;
    const t = window.setTimeout(() => document.getElementById('forms')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }), 500);
    return () => window.clearTimeout(t);
  }, [param]);

  useEffect(() => {
    const p = TABS.find((t) => t.id === param)?.id;
    if (p && p !== tab) setTab(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  useLayoutEffect(() => {
    const btn = tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    const glow = glowRef.current;
    if (!btn || !glow) return;
    const vars = { x: btn.offsetLeft, y: btn.offsetTop, width: btn.offsetWidth, height: btn.offsetHeight };
    if (prefersReducedMotion() || !glow.dataset.ready) gsap.set(glow, vars);
    else gsap.to(glow, { ...vars, duration: 0.6, ease: 'expo.out' });
    glow.dataset.ready = '1';
    if (panelRef.current && !prefersReducedMotion()) gsap.fromTo(panelRef.current, { autoAlpha: 0, y: 24, rotationX: -6, transformPerspective: 1000 }, { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.7, ease: 'expo.out' });
  }, [tab]);

  const select = (id: LeadType) => {
    setTab(id);
    navigate(`/contact?form=${id}`, { replace: true });
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!n) return;
    e.preventDefault();
    const next = TABS[(i + n + TABS.length) % TABS.length];
    select(next.id);
    tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="page" ref={ref}>
      <section className="cine-contact" aria-labelledby="cc-title">
        <div className="cc-card">
          <picture>
            {/* phones get a 1 px placeholder instead of the 1080p poster (no hidden background download) */}
            <source media="(max-width: 640px)" srcSet="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
            <img className="cc-bg" src={`${site.base}media/home-plug-poster-land.jpg`} alt="" decoding="async" />
          </picture>
          <div className="cc-veil" aria-hidden="true" />
          <div className="cc-grid">
            <div className="cc-copy">
              <span className="eyebrow cc-eyebrow">Contact NEARVOLT EV</span>
              <h1 className="cc-title mask-reveal" id="cc-title">
                <span className="mask-line">
                  <span>Let’s power a</span>
                </span>
                <span className="mask-line">
                  <span className="ink-emerald">better journey.</span>
                </span>
              </h1>
              <p className="cc-lede" data-reveal>
                Questions about emergency charging, becoming a host or partnering with NEARVOLT EV? Get in touch.
              </p>
              {site.contactEmail && (
                <a className="cc-mail" href={`mailto:${site.contactEmail}`} data-reveal>
                  <Icon name="mail" /> {site.contactEmail}
                </a>
              )}
              <p className="cc-sos" data-reveal>
                <Icon name="phone" /> Roadside or medical emergency? Call <a href="tel:112">112</a>.
              </p>
            </div>
            <div className="cc-form lg" data-reveal>
              <h2 className="h3">Send us a message</h2>
              <ContactForm />
            </div>
          </div>
        </div>
      </section>
      <section className="section contact" id="forms" aria-labelledby="forms-title">
        <div className="container section-head contact-forms-head">
          <span className="kicker">Early access and host interest</span>
          <h2 className="h2" id="forms-title">Prefer a specific form?</h2>
        </div>
        <div className="container contact-grid">
          <div className="contact-side">
            <div className="tabs" role="tablist" aria-label="Choose a form" aria-orientation="vertical" ref={tabsRef}>
              <span className="tab-glow" ref={glowRef} aria-hidden="true" />
              {TABS.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  data-tab={t.id}
                  aria-selected={tab === t.id}
                  aria-controls="form-panel"
                  tabIndex={tab === t.id ? 0 : -1}
                  className="tab"
                  onClick={() => select(t.id)}
                  onKeyDown={(e) => onKey(e, i)}
                >
                  <Icon name={t.icon} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <div className="contact-note card">
              <h2 className="h3">
                <Icon name="lock" /> How your details are handled
              </h2>
              <p>
                We ask only for what we need to reply. {leadsMode === 'live' ? 'Submissions go to a private spreadsheet.' : 'On this build the form service is not configured, so nothing you enter leaves your browser.'} You
                can ask us to delete your details at any time.
              </p>
            </div>
          </div>
          <div className="form-panel glass" id="form-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} ref={panelRef} data-gloss>
            <div className="form-panel-head">
              <span className="icon-tile">
                <Icon name={active.icon} />
              </span>
              <div>
                <h2 className="h2">{active.label}</h2>
                <p className="muted">{active.blurb}</p>
              </div>
            </div>
            <LeadForm type={tab} key={tab} />
          </div>
        </div>
      </section>
    </div>
  );
}
