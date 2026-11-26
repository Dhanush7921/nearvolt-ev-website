// NEARVOLT EV workload. Run ONLY against local emulators or an authorised staging project.
//   k6 run -e PROFILE=ramp1000 -e BASE_URL=https://nearvolt-api-staging-…run.app tests/load/load.js
// Profiles (VUs = simultaneous active users following realistic journeys with think time):
//   ramp100 | ramp500 | ramp1000 | ramp2500 | ramp5000 | ramp10000 — gradual ramp, hold, ramp down
//   spike   — 0 → 1000 VUs in 30 s, hold 2 min, drop      peak   — 1000 VUs (normal peak target) for 10 min
//   soak    — 300 VUs for 45 min (ID tokens last 60 min; re-seed for longer soaks)
// Workload mix per iteration: 65 % browse (config, me, 2× nearby), 20 % activity (history, alerts),
// 10 % host dashboard, 5 % booking (nearby → create with Idempotency-Key → cancel). Think time 2–8 s between screens.
import { mixed } from './lib/common.js';

const ramp = (vus, holdMin = 5) => ({ executor: 'ramping-vus', startVUs: 0, gracefulRampDown: '30s',
  stages: [{ duration: `${Math.max(1, Math.round(vus / 500))}m`, target: Math.round(vus / 2) }, { duration: '2m', target: vus }, { duration: `${holdMin}m`, target: vus }, { duration: '1m', target: 0 }] });
const PROFILES = {
  ramp100: ramp(100, 3), ramp500: ramp(500), ramp1000: ramp(1000), ramp2500: ramp(2500), ramp5000: ramp(5000, 10), ramp10000: ramp(10000, 10),
  spike: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '30s', target: 1000 }, { duration: '2m', target: 1000 }, { duration: '10s', target: 0 }] },
  peak: { executor: 'constant-vus', vus: 1000, duration: '10m' },
  soak: { executor: 'constant-vus', vus: 300, duration: '45m' },
  quick: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '30s', target: Number(__ENV.VUS || 100) }, { duration: __ENV.HOLD || '2m', target: Number(__ENV.VUS || 100) }, { duration: '15s', target: 0 }] },
};
const profile = __ENV.PROFILE || 'ramp100';
const peakish = /2500|5000|10000|spike|peak/.test(profile);
export const options = {
  scenarios: { users: PROFILES[profile] },
  discardResponseBodies: true,
  thresholds: {
    // Release criteria (normal vs peak). Failing thresholds make k6 exit non-zero.
    'http_req_duration{name:nearby}': [`p(95)<${peakish ? 1000 : 500}`],
    'http_req_duration{name:request_create}': [`p(95)<${peakish ? 1000 : 500}`],
    http_req_duration: [`p(95)<${peakish ? 1000 : 500}`],
    unexpected_errors: ['count<=0'], // use rate in the summary; any unexpected 5xx needs investigation
    checks: ['rate>0.999'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
export default function () { mixed(); }
export function handleSummary(data) {
  return { [`tests/load/results/summary-${profile}-${Date.now()}.json`]: JSON.stringify(data), stdout: '' };
}
