import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ButtonLink } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { getPublicConfig, type ServiceArea } from '../lib/api';
import { Link, useLocation } from '../lib/router';
import { useReveal } from '../lib/reveal';
import { useTheme } from '../lib/theme';

// Public PREVIEW of the in-app dashboard. The only live data is the service-area list from the public API.
// Everything user-specific (requests, history, hosts) needs an app sign-in and is shown as an empty state or
// as clearly labelled illustration — never as live operational data.

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'find', label: 'Find Charging', icon: 'search' },
  { id: 'maps', label: 'Maps', icon: 'map' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'safety', label: 'Safety', icon: 'shield-check' },
  { id: 'settings', label: 'Settings', icon: 'sliders-horizontal' },
  { id: 'account', label: 'Account', icon: 'user-check' },
];
const SAMPLE_STEPS = ['Request sent', 'Host accepted', 'Arrival verified', 'Charging', 'Completed'];

export default function Dashboard() {
  const ref = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();
  const [tab, setTab] = useState(() => (TABS.some((t) => `#${t.id}` === hash) ? hash.slice(1) : 'overview'));
  const [areas, setAreas] = useState<ServiceArea[] | null>(null);
  const [apiState, setApiState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [battery, setBattery] = useState(40);
  const { theme, toggle } = useTheme();
  useReveal(ref, [tab]);

  useEffect(() => {
    if (TABS.some((t) => `#${t.id}` === hash)) setTab(hash.slice(1));
  }, [hash]);
  useEffect(() => {
    getPublicConfig()
      .then((c) => {
        setAreas(c.serviceAreas);
        setApiState('ok');
      })
      .catch(() => setApiState('error'));
  }, []);

  const area = areas?.[0];

  return (
    <div className="page dash" ref={ref}>
      <div className="dash-shell">
        <nav className="dash-side lg" aria-label="Dashboard sections">
          <span className="dash-mark" aria-hidden="true">
            <Icon name="zap" />
          </span>
          <ul role="tablist" aria-orientation="vertical">
            {TABS.map((t) => (
              <li key={t.id}>
                <button type="button" role="tab" aria-selected={tab === t.id} aria-controls="dash-main" className="dash-tab" onClick={() => setTab(t.id)} title={t.label}>
                  <Icon name={t.icon} />
                  <span>{t.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <header className="dash-head">
          <div>
            <p className="dash-hello">Welcome</p>
            <h1 className="dash-who">
              Dashboard preview <span className="preview-tag">Illustrative · not live</span>
            </h1>
          </div>
          <div className="dash-tools">
            <span className="dash-loc">
              <Icon name="map-pin" />
              {apiState === 'ok' && area ? `${area.name} service area` : apiState === 'loading' ? 'Checking service…' : 'Service status unavailable'}
            </span>
            <Link to="/#find" className="dash-tool" aria-label="Search coverage">
              <Icon name="search" />
            </Link>
            <button type="button" className="dash-tool" aria-label="Notifications" onClick={() => setTab('notifications')}>
              <Icon name="bell" />
            </button>
            <Link to="/sign-in" className="dash-tool" aria-label="Profile and sign-in">
              <Icon name="user-check" />
            </Link>
          </div>
        </header>

        <div className="dash-main" id="dash-main" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'overview' || tab === 'find' || tab === 'maps' ? (
            <>
              <section className="dash-map lg" data-reveal data-sheen aria-label="Service area schematic">
                <span className="lg-sheen" aria-hidden="true" />
                <ServiceSchematic area={area} state={apiState} />
              </section>
              <section className="dash-card lg" data-reveal style={{ '--i': 1 } as CSSProperties}>
                <h2 className="h3">Charging discovery</h2>
                <p className="muted">Compatible, verified hosts appear in the app after you sign in. The website only checks whether you are inside a service area.</p>
                <div className="dash-actions">
                  <ButtonLink to="/#find" icon="locate-fixed" size="sm">
                    Check my location
                  </ButtonLink>
                  <ButtonLink to="/#emergency" variant="glass" size="sm" iconStart="life-buoy">
                    Emergency help
                  </ButtonLink>
                </div>
              </section>
              <section className="dash-card lg" data-reveal style={{ '--i': 2 } as CSSProperties} aria-label="Sample request timeline">
                <div className="dash-card-head">
                  <h2 className="h3">Active request</h2>
                  <span className="preview-tag">Illustration</span>
                </div>
                <ol className="dash-tl" role="list">
                  {SAMPLE_STEPS.map((s, i) => (
                    <li key={s} className={i < 3 ? 'done' : i === 3 ? 'now' : undefined}>
                      <span aria-hidden="true" />
                      {s}
                    </li>
                  ))}
                </ol>
                <p className="muted small">How a request looks in the app. You have no active request on this website.</p>
              </section>
            </>
          ) : tab === 'activity' ? (
            <Empty icon="activity" title="Charging history lives in the app" text="Completed sessions, receipts and ratings appear in the Activity tab of the NEARVOLT EV app once you sign in." />
          ) : tab === 'notifications' ? (
            <Empty icon="bell" title="No notifications" text="Request updates (accepted, arriving, completed) are sent as app notifications to signed-in users." />
          ) : tab === 'safety' ? (
            <Empty icon="shield-check" title="Safety and trust" text="Verified hosts, a private session PIN and private host locations." link={{ to: '/#trust', label: 'See how each protection works' }} />
          ) : tab === 'settings' ? (
            <section className="dash-card lg" data-reveal>
              <h2 className="h3">Display</h2>
              <button type="button" className="setting" role="switch" aria-checked={theme === 'dark'} onClick={() => toggle()}>
                <span className="switch" aria-hidden="true" /> Dark theme
              </button>
              <p className="muted small">The site also follows your system theme until you choose.</p>
            </section>
          ) : (
            <Empty icon="user-check" title="Not signed in" text="Accounts are created in the NEARVOLT EV Android app. Web sign-in is a preview for now." link={{ to: '/sign-in', label: 'Open the sign-in preview' }} />
          )}
        </div>

        <aside className="dash-rail" aria-label="Vehicle and request">
          <section className="dash-card lg" data-reveal>
            <div className="dash-card-head">
              <h2 className="h3">Your vehicle</h2>
              <span className="preview-tag">Example</span>
            </div>
            <dl className="dash-dl">
              <div>
                <dt>Vehicle</dt>
                <dd>Electric car</dd>
              </div>
              <div>
                <dt>Connector</dt>
                <dd>Type 2 (AC)</dd>
              </div>
            </dl>
          </section>
          <section className="dash-card lg" data-reveal style={{ '--i': 1 } as CSSProperties}>
            <h2 className="h3">Battery (you confirm)</h2>
            <label className="dash-batt">
              <span className="dash-batt-v">{battery}%</span>
              <input type="range" min={1} max={100} value={battery} onChange={(e) => setBattery(Number(e.target.value))} aria-label="Battery percentage as shown on your vehicle" />
            </label>
            <p className="muted small">Typed by you — NEARVOLT EV does not read vehicle telemetry.</p>
          </section>
          <section className="dash-card lg" data-reveal style={{ '--i': 2 } as CSSProperties}>
            <h2 className="h3">Nearby verified hosts</h2>
            <p className="dash-big" aria-label="Not shown on the website">
              —
            </p>
            <p className="muted small">Host counts and availability are shown only in the app after sign-in. No sample numbers are shown here.</p>
          </section>
          <section className="dash-card lg" data-reveal style={{ '--i': 3 } as CSSProperties}>
            <h2 className="h3">Request status</h2>
            <p className="dash-status">
              <span aria-hidden="true" /> No active request
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Empty({ icon, title, text, link }: { icon: IconName; title: string; text: string; link?: { to: string; label: string } }) {
  return (
    <section className="dash-empty lg" data-reveal>
      <span className="tcard-ico">
        <Icon name={icon} />
      </span>
      <h2 className="h3">{title}</h2>
      <p className="muted">{text}</p>
      {link ? (
        <Link to={link.to} className="text-link">
          {link.label}
        </Link>
      ) : (
        <ButtonLink to="/#download" size="sm" icon="smartphone">
          Get the App
        </ButtonLink>
      )}
    </section>
  );
}

/** Schematic only (not a map): a service radius ring drawn from the live service-area config. */
function ServiceSchematic({ area, state }: { area?: ServiceArea; state: 'loading' | 'ok' | 'error' }) {
  return (
    <div className="schem">
      <svg viewBox="0 0 640 360" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="schem-g" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#059669" stopOpacity=".32" />
            <stop offset="1" stopColor="#059669" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="640" height="360" className="schem-bg" />
        <path d="M640 40 C 560 120, 540 220, 470 360 L640 360 Z" className="schem-sea" />
        {Array.from({ length: 9 }, (_, i) => (
          <path key={i} d={`M0 ${30 + i * 40} C 200 ${20 + i * 40}, 380 ${50 + i * 40}, 640 ${26 + i * 40}`} className="schem-road" />
        ))}
        {Array.from({ length: 8 }, (_, i) => (
          <path key={`v${i}`} d={`M${40 + i * 80} 0 L${20 + i * 80} 360`} className="schem-road" />
        ))}
        <circle cx="320" cy="180" r="150" fill="url(#schem-g)" />
        <circle cx="320" cy="180" r="130" className="schem-ring" />
        <circle cx="320" cy="180" r="6" className="schem-centre" />
      </svg>
      <div className="schem-label">
        <strong>{state === 'ok' && area ? `${area.name} · ${area.radiusKm} km radius` : state === 'loading' ? 'Loading service area…' : 'Service area unavailable'}</strong>
        <span>{state === 'ok' ? 'Live from the NEARVOLT EV service · schematic, not to scale' : 'Schematic, not to scale'}</span>
      </div>
    </div>
  );
}
