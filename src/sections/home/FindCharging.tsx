import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { getPublicConfig, straightLineKm, type ServiceArea } from '../../lib/api';
import { Link } from '../../lib/router';
import { useReveal } from '../../lib/reveal';

const VEHICLES = ['Electric car', 'Electric scooter or bike'] as const;
type Vehicle = (typeof VEHICLES)[number];
const CONNECTORS: Record<Vehicle, string[]> = {
  'Electric car': ['Type 2 (AC)', 'CCS2 (DC)', 'Bharat AC-001', 'Not sure'],
  'Electric scooter or bike': ['Type 7 (LECCS)', 'Brand-specific charger', 'Not sure'],
};
const CHIPS = ['Available now', 'Compatible hosts', 'Nearby', 'Emergency assistance'] as const;

type Where = { kind: 'gps'; lat: number; lng: number; accuracy: number } | { kind: 'text'; text: string } | null;
type Result =
  | { status: 'inside'; area: ServiceArea; km: number | null }
  | { status: 'outside'; nearest: { area: ServiceArea; km: number } | null; text?: string }
  | { status: 'unknown-text'; text: string; areas: ServiceArea[] }
  | { status: 'error'; message: string }
  | { status: 'maintenance'; message: string };

export function FindCharging() {
  const ref = useRef<HTMLElement>(null);
  const uid = useId();
  const [vehicle, setVehicle] = useState<Vehicle>('Electric car');
  const [connector, setConnector] = useState('Type 2 (AC)');
  const [battery, setBattery] = useState(35);
  const [emergency, setEmergency] = useState(false);
  const [chips, setChips] = useState<string[]>(['Compatible hosts', 'Nearby']);
  const [text, setText] = useState('');
  const [where, setWhere] = useState<Where>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [areaNames, setAreaNames] = useState<string[]>([]);
  const resultRef = useRef<HTMLDivElement>(null);
  useReveal(ref);

  useEffect(() => setConnector(CONNECTORS[vehicle][0]), [vehicle]);
  useEffect(() => {
    // Warm the (possibly cold-starting) API and fill the area suggestions. Failure is handled on submit.
    getPublicConfig()
      .then((c) => setAreaNames(c.serviceAreas.map((a) => a.name)))
      .catch(() => {});
  }, []);
  const isOn = (c: string) => (c === 'Emergency assistance' ? emergency : chips.includes(c));
  const toggleChip = (c: string) => {
    if (c === 'Emergency assistance') return setEmergency((e) => !e);
    setChips((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  };

  const locate = () => {
    setLocError('');
    if (!('geolocation' in navigator)) return setLocError('This browser cannot share your location. Type your city instead.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setWhere({ kind: 'gps', lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        setText('');
      },
      (e) => {
        setLocating(false);
        setLocError(e.code === e.PERMISSION_DENIED ? 'Location permission was declined. Type your city or locality instead.' : 'We could not get your location. Type your city instead.');
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const loc: Where = where?.kind === 'gps' ? where : text.trim() ? { kind: 'text', text: text.trim() } : null;
    if (!loc) {
      setLocError('Use your location or type a city to check coverage.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const cfg = await getPublicConfig();
      if (cfg.maintenance?.enabled) setResult({ status: 'maintenance', message: cfg.maintenance.message || 'NEARVOLT EV is under maintenance. Please try again later.' });
      else if (loc.kind === 'gps') {
        const ranked = cfg.serviceAreas.map((area) => ({ area, km: straightLineKm(loc, area.center) })).sort((a, b) => a.km - b.km);
        const inside = ranked.find((r) => r.km <= r.area.radiusKm);
        setResult(inside ? { status: 'inside', area: inside.area, km: inside.km } : { status: 'outside', nearest: ranked[0] ?? null });
      } else {
        const t = loc.text.toLowerCase();
        const match = cfg.serviceAreas.find((a) => t.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(t) || (a.id === 'vizag' && /\bvizag\b|visakha/.test(t)));
        setResult(match ? { status: 'inside', area: match, km: null } : { status: 'unknown-text', text: loc.text, areas: cfg.serviceAreas });
      }
    } catch (err) {
      const m = (err as Error).message;
      setResult({
        status: 'error',
        message:
          m === 'NO_API'
            ? 'The live coverage check is turned off on this build.'
            : m === 'SERVER_NOT_CONFIGURED' || m.startsWith('HTTP_5')
              ? 'The NEARVOLT EV service is not answering right now. Please try again in a minute.'
              : 'We could not reach the NEARVOLT EV service. Free servers can take up to a minute to wake up — please try again.',
      });
    } finally {
      setBusy(false);
      requestAnimationFrame(() => resultRef.current?.focus());
    }
  };

  const low = battery <= 10;

  return (
    <section className="section find" id="find" ref={ref} aria-labelledby={`${uid}-t`}>
      <div className="find-aura" aria-hidden="true" />
      <div className="container find-inner">
        <div className="find-head">
          <span className="eyebrow" data-reveal>
            Smart charging discovery
          </span>
          <h2 className="h1 mask-reveal" id={`${uid}-t`}>
            <span className="mask-line">
              <span>Find your</span>
            </span>
            <span className="mask-line">
              <span className="ink-emerald">next charge.</span>
            </span>
          </h2>
          <p className="lede" data-reveal style={{ '--i': 2 } as CSSProperties}>
            Tell us your vehicle and where you are. We check live, against the NEARVOLT EV service, whether you are inside an area we serve — then hand you over to the app, where verified hosts
            are shown after you sign in.
          </p>
        </div>

        <form className="composer lg" onSubmit={onSubmit} noValidate data-reveal data-sheen style={{ '--i': 3 } as CSSProperties} aria-describedby={`${uid}-note`}>
          <span className="lg-sheen" aria-hidden="true" />
          <div className="composer-loc">
            <Icon name="map-pin" className="icon composer-pin" />
            <label className="sr-only" htmlFor={`${uid}-loc`}>
              City or locality
            </label>
            <input
              id={`${uid}-loc`}
              className="composer-input"
              list={`${uid}-areas`}
              placeholder={where?.kind === 'gps' ? `Current location (±${Math.round(where.accuracy)} m)` : 'Type a city or locality, e.g. Visakhapatnam'}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (where?.kind === 'gps') setWhere(null);
                setLocError('');
              }}
              autoComplete="address-level2"
              maxLength={80}
            />
            <datalist id={`${uid}-areas`}>
              {areaNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button type="button" className={`composer-gps${where?.kind === 'gps' ? ' is-on' : ''}`} onClick={locate} disabled={locating} aria-label="Use my location">
              <Icon name={locating ? 'loader-circle' : 'locate-fixed'} className={`icon${locating ? ' spin' : ''}`} />
              <span>{where?.kind === 'gps' ? 'Location set' : 'Use my location'}</span>
            </button>
          </div>
          {locError && (
            <p className="composer-error" role="alert">
              <Icon name="circle-alert" /> {locError}
            </p>
          )}

          <div className="composer-grid">
            <label className="cfield">
              <span>Vehicle</span>
              <select value={vehicle} onChange={(e) => setVehicle(e.target.value as Vehicle)}>
                {VEHICLES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="cfield">
              <span>Connector</span>
              <select value={connector} onChange={(e) => setConnector(e.target.value)}>
                {CONNECTORS[vehicle].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="cfield cfield-range">
              <span>
                Battery <output>{battery}%</output>
              </span>
              <input type="range" min={1} max={100} value={battery} onChange={(e) => setBattery(Number(e.target.value))} aria-valuetext={`${battery} percent, as you see it on your vehicle`} style={{ '--v': `${battery}%` } as CSSProperties} />
            </label>
            <label className="cfield cfield-switch">
              <span>Emergency</span>
              <button type="button" role="switch" aria-checked={emergency} className="cswitch" onClick={() => setEmergency((v) => !v)}>
                <span aria-hidden="true" />
                {emergency ? 'Priority' : 'Off'}
              </button>
            </label>
          </div>

          <div className="composer-bar">
            <div className="chips" role="group" aria-label="Preferences">
              {CHIPS.map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={isOn(c)} onClick={() => toggleChip(c)}>
                  {isOn(c) && <Icon name="check" />}
                  {c}
                </button>
              ))}
            </div>
            <button type="submit" className="composer-go" disabled={busy} data-magnetic="0.2">
              <span>{busy ? 'Checking…' : 'Find Charging'}</span>
              <span className="composer-go-ico">
                <Icon name={busy ? 'loader-circle' : 'arrow-right'} className={`icon${busy ? ' spin' : ''}`} />
              </span>
            </button>
          </div>
          <p className="composer-note" id={`${uid}-note`}>
            Battery level is what you read on your vehicle; the website does not connect to it. Distances are straight-line, not road distance. Host addresses are never shown here.
          </p>
        </form>

        <div className="find-result" ref={resultRef} tabIndex={-1} aria-live="polite">
          {busy && (
            <div className="result lg is-loading" aria-label="Checking coverage">
              <span className="skel skel-a" />
              <span className="skel skel-b" />
              <span className="skel skel-c" />
            </div>
          )}
          {result && <ResultCard r={result} low={low} emergency={emergency} vehicle={vehicle} connector={connector} />}
        </div>
      </div>
    </section>
  );
}

function ResultCard({ r, low, emergency, vehicle, connector }: { r: Result; low: boolean; emergency: boolean; vehicle: string; connector: string }) {
  const safety = (low || emergency) && r.status !== 'error' && (
    <div className="result-safety" role="note">
      <Icon name="triangle-alert" />
      <p>
        <b>If you or your vehicle are in danger, call 112.</b> NEARVOLT EV helps only when your vehicle can still reach a host. Do not drive the battery to zero — if the vehicle cannot move, use
        your manufacturer’s or insurer’s roadside assistance.
      </p>
    </div>
  );
  if (r.status === 'inside')
    return (
      <div className="result lg is-in">
        <span className="result-badge ok">
          <Icon name="circle-check" /> Live check · inside service area
        </span>
        <h3 className="h3">NEARVOLT EV serves {r.area.name}.</h3>
        <p className="muted">
          {r.km !== null ? `You are about ${r.km < 1 ? '<1' : r.km.toFixed(1)} km (straight line) from the ${r.area.name} area centre, within its ${r.area.radiusKm} km service radius.` : `“${r.area.name}” matches an active service area. Use your location for a precise check.`}{' '}
          Verified hosts that fit a {vehicle.toLowerCase()} with {connector === 'Not sure' ? 'your connector' : connector} are shown in the app after you sign in.
        </p>
        {safety}
        <div className="result-actions">
          <ButtonLink to="/#download" icon="smartphone">
            Continue in the app
          </ButtonLink>
          <ButtonLink to="/how-it-works" variant="glass">
            How a request works
          </ButtonLink>
        </div>
      </div>
    );
  if (r.status === 'outside')
    return (
      <div className="result lg is-in">
        <span className="result-badge warn">
          <Icon name="map-pinned" /> Live check · not served yet
        </span>
        <h3 className="h3">NEARVOLT EV is not available where you are yet.</h3>
        <p className="muted">
          {r.nearest ? `The nearest service area is ${r.nearest.area.name}, about ${Math.round(r.nearest.km)} km away in a straight line.` : 'No service areas are active right now.'} We are starting in
          Visakhapatnam and will expand only after the pilot.
        </p>
        {safety}
        <div className="result-actions">
          <ButtonLink to="/contact?form=driver" icon="arrow-right">
            Tell me when it arrives
          </ButtonLink>
        </div>
      </div>
    );
  if (r.status === 'unknown-text')
    return (
      <div className="result lg is-in">
        <span className="result-badge warn">
          <Icon name="info" /> We could not confirm that place
        </span>
        <h3 className="h3">“{r.text}” is not one of our active areas.</h3>
        <p className="muted">
          Active today: {r.areas.map((a) => a.name).join(', ') || 'none'}. If you are inside one of these, use <b>Use my location</b> for an exact check — the website does not look up typed
          addresses.
        </p>
        {safety}
        <div className="result-actions">
          <ButtonLink to="/contact?form=driver" variant="glass" icon="arrow-right">
            Ask for my city
          </ButtonLink>
        </div>
      </div>
    );
  return (
    <div className="result lg is-in">
      <span className="result-badge err">
        <Icon name="circle-alert" /> {r.status === 'maintenance' ? 'Maintenance' : 'Service unavailable'}
      </span>
      <p className="muted">{r.message}</p>
      {r.status === 'error' && (
        <p className="muted small">
          Nothing is shown instead — we never display sample hosts as if they were real. <Link to="/contact" className="text-link">Contact us</Link> if this keeps happening.
        </p>
      )}
    </div>
  );
}
