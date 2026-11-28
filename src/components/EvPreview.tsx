import type { PreviewKind } from '../config/menu';

/** Small original EV illustrations for the Discover menu preview. Pure SVG, animated by CSS (static under reduced motion). */
export function EvPreview({ kind }: { kind: PreviewKind }) {
  switch (kind) {
    case 'find':
      return (
        <svg viewBox="0 0 320 240" className="evp evp-find" aria-hidden="true">
          <defs>
            <radialGradient id="evp-g1" cx="50%" cy="55%" r="60%">
              <stop offset="0" stopColor="#6BFFCB" stopOpacity=".35" />
              <stop offset="1" stopColor="#6BFFCB" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="320" height="240" className="evp-bg" />
          <g className="evp-grid">
            {[40, 80, 120, 160, 200].map((y) => (
              <path key={y} d={`M0 ${y} Q160 ${y - 18} 320 ${y}`} />
            ))}
            {[60, 130, 200, 270].map((x) => (
              <path key={x} d={`M${x} 0 L${x - 30} 240`} />
            ))}
          </g>
          <circle cx="160" cy="132" r="96" fill="url(#evp-g1)" />
          <circle cx="160" cy="132" r="64" className="evp-ring" />
          <circle cx="160" cy="132" r="34" className="evp-ring evp-ring-2" />
          <circle cx="160" cy="132" r="7" className="evp-me" />
          {[
            [92, 96],
            [218, 104],
            [204, 176],
          ].map(([x, y], i) => (
            <g key={i} className="evp-pin" style={{ animationDelay: `${0.2 + i * 0.18}s` }} transform={`translate(${x} ${y})`}>
              <path d="M0 -20c-7 0-12 5-12 12 0 9 12 20 12 20s12-11 12-20c0-7-5-12-12-12Z" />
              <path d="m1 -15-5 8h4l-2 6 6-8H0l1-6Z" className="evp-bolt" />
            </g>
          ))}
          <text x="16" y="226" className="evp-cap">Service-area check · illustration</text>
        </svg>
      );
    case 'emergency':
      return (
        <svg viewBox="0 0 320 240" className="evp evp-sos" aria-hidden="true">
          <rect width="320" height="240" className="evp-bg" />
          <rect x="70" y="58" width="180" height="96" rx="22" className="evp-batt" />
          <rect x="250" y="88" width="12" height="36" rx="4" className="evp-batt-tip" />
          <rect x="82" y="70" width="30" height="72" rx="10" className="evp-batt-fill" />
          <path d="M150 84l-14 26h14l-6 22 22-30h-14l6-18Z" className="evp-bolt-lg" />
          <path d="M40 196h240" className="evp-route" />
          <circle cx="40" cy="196" r="6" className="evp-me" />
          <circle cx="280" cy="196" r="8" className="evp-host" />
          <text x="16" y="226" className="evp-cap">Low battery → nearest compatible host</text>
        </svg>
      );
    case 'steps':
      return (
        <svg viewBox="0 0 320 240" className="evp evp-steps" aria-hidden="true">
          <rect width="320" height="240" className="evp-bg" />
          <path d="M48 120H272" className="evp-track" />
          <path d="M48 120H272" className="evp-track-on" pathLength={1} />
          {['Request', 'Accept', 'Verify', 'Charge'].map((l, i) => (
            <g key={l} transform={`translate(${48 + i * 74.6} 120)`} className="evp-step" style={{ animationDelay: `${i * 0.16}s` }}>
              <circle r="15" />
              <text y="5" textAnchor="middle" className="evp-n">
                {i + 1}
              </text>
              <text y="44" textAnchor="middle" className="evp-l">
                {l}
              </text>
            </g>
          ))}
          <text x="16" y="226" className="evp-cap">Every request follows the same four steps</text>
        </svg>
      );
    case 'connectors':
      return (
        <svg viewBox="0 0 320 240" className="evp evp-conn" aria-hidden="true">
          <rect width="320" height="240" className="evp-bg" />
          <g transform="translate(96 108)" className="evp-plug">
            <circle r="44" />
            {[
              [-16, -14],
              [16, -14],
              [-24, 8],
              [0, 8],
              [24, 8],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="7" className="evp-pinhole" />
            ))}
            <text y="72" textAnchor="middle" className="evp-l">
              Type 2 · AC
            </text>
          </g>
          <g transform="translate(224 108)" className="evp-plug">
            <circle r="44" />
            <circle cx="-14" cy="-6" r="9" className="evp-pinhole" />
            <circle cx="14" cy="-6" r="9" className="evp-pinhole" />
            <circle cx="0" cy="20" r="6" className="evp-pinhole" />
            <text y="72" textAnchor="middle" className="evp-l">
              Two-wheeler · LEV
            </text>
          </g>
          <text x="16" y="226" className="evp-cap">Matched to your vehicle before you request</text>
        </svg>
      );
  }
}
