import { useRef, type CSSProperties } from 'react';
import { ButtonLink } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { useReveal } from '../../lib/reveal';

// Status is stated per feature so nothing reads as more finished than it is.
type Status = 'live' | 'built' | 'required';
const STATUS: Record<Status, string> = {
  live: 'Live on this website',
  built: 'Built · app in testing',
  required: 'Required before launch',
};

const CARDS: { icon: IconName; title: string; text: string; status: Status; wide?: boolean }[] = [
  { icon: 'user-check', title: 'Verified charging hosts', text: 'A host is listed only after an admin reviews identity, property permission and equipment details. Hosts can be suspended at any time.', status: 'built', wide: true },
  { icon: 'zap', title: 'Electrical safety verification', text: 'Inspection by a qualified electrician is required before a host is approved. No host has completed this yet, so no host is live.', status: 'required', wide: true },
  { icon: 'badge-check', title: 'Secure Google sign-in', text: 'Accounts use Firebase Authentication with Google or email — NEARVOLT EV never sees your Google password.', status: 'built' },
  { icon: 'shield-check', title: 'Firebase App Check', text: 'The API checks that requests come from a genuine copy of the app before it answers.', status: 'built' },
  { icon: 'eye-off', title: 'Private host locations', text: 'Before acceptance the app shows only a ~1 km area and straight-line distance. The exact address is shared after the host accepts.', status: 'built' },
  { icon: 'key-round', title: 'Session PIN', text: 'The driver gets a private 4-digit PIN; charging starts only when the host enters it. Five wrong tries lock it.', status: 'built' },
  { icon: 'lock', title: 'Protected booking workflow', text: 'Requests move through a server-side state machine, so one host cannot be double-booked.', status: 'built' },
  { icon: 'headset', title: 'Customer support', text: 'Questions go through in-app support or the contact form on this website.', status: 'live' },
  { icon: 'flag', title: 'Complaint reporting', text: 'Report a problem with a session from the app; complaints are reviewed by the admin team.', status: 'built' },
  { icon: 'file-check', title: 'Account privacy', text: 'Request account and data deletion at any time, including from this website.', status: 'live' },
];

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'send', title: 'Request', text: 'Pick a compatible host and send a request with your battery level.' },
  { icon: 'circle-check', title: 'Host acceptance', text: 'The host has a few minutes to accept; if not, try the next host.' },
  { icon: 'scan-line', title: 'Arrival verification', text: 'The exact address unlocks. On arrival, you share your private PIN.' },
  { icon: 'battery-charging', title: 'Charging', text: 'A limited top-up on the host’s own, listed equipment.' },
  { icon: 'clipboard-check', title: 'Completion', text: 'The session closes and both sides can rate it.' },
];

export function TrustSection() {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref);
  return (
    <section className="section trust" id="trust" ref={ref} aria-labelledby="trust-title">
      <div className="container">
        <div className="trust-head">
          <span className="eyebrow" data-reveal>
            Security and trust
          </span>
          <h2 className="h1 mask-reveal" id="trust-title">
            <span className="mask-line">
              <span>Trust, built into</span>
            </span>
            <span className="mask-line">
              <span className="ink-emerald">every session.</span>
            </span>
          </h2>
          <p className="lede" data-reveal>
            Charging at someone’s home only works if both sides feel safe. Each protection below says exactly where it stands today.
          </p>
          <ul className="trust-legend" role="list" data-reveal>
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <li key={s} className={`st st-${s}`}>
                <span aria-hidden="true" /> {STATUS[s]}
              </li>
            ))}
          </ul>
        </div>

        <div className="trust-grid">
          {CARDS.map((c, i) => (
            <article key={c.title} className={`tcard lg${c.wide ? ' is-wide' : ''}`} data-reveal style={{ '--i': i % 4 } as CSSProperties}>
              <div className="tcard-top">
                <span className="tcard-ico">
                  <Icon name={c.icon} />
                </span>
                <span className={`st st-${c.status}`}>
                  <span aria-hidden="true" /> {STATUS[c.status]}
                </span>
              </div>
              <h3 className="h3">{c.title}</h3>
              <p>{c.text}</p>
            </article>
          ))}
        </div>

        <div className="session lg" id="session" data-reveal data-sheen>
          <span className="lg-sheen" aria-hidden="true" />
          <div className="session-head">
            <h3 className="h2">One charging session, five checkpoints.</h3>
            <span className="preview-tag">
              <Icon name="info" /> Illustrative timeline
            </span>
          </div>
          <ol className="timeline" role="list">
            {STEPS.map((s, i) => (
              <li key={s.title} style={{ '--i': i } as CSSProperties}>
                <span className="tl-node">
                  <Icon name={s.icon} />
                </span>
                <span className="tl-no">{String(i + 1).padStart(2, '0')}</span>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="emergency lg" id="emergency" data-reveal>
          <div className="emergency-copy">
            <span className="eyebrow">Emergency assistance</span>
            <h3 className="h2">Running low? Act early, stay safe.</h3>
            <p>
              The app’s emergency button opens the nearest available compatible host and keeps a one-tap call to 112. It cannot help a vehicle that can no longer move, and a home top-up is slow —
              plan for a limited charge, not a full one.
            </p>
            <p className="emergency-112">
              <Icon name="phone" /> In danger on the road? <a href="tel:112">Call 112</a> — the national emergency number.
            </p>
          </div>
          <div className="emergency-actions">
            <ButtonLink to="/#find" icon="locate-fixed">
              Check coverage
            </ButtonLink>
            <ButtonLink to="/safety" variant="glass">
              Safety principles
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
