// Concurrency integrity: N customers request the SAME host (capacity 2) at once; the host accepts all at once.
// Pass = exactly `capacity` accepted, the rest 409, zero 5xx. Verify counters afterwards with verify-integrity.mjs.
//   k6 run -e RACERS=200 tests/load/booking-race.js
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { req, customers, uuid } from './lib/common.js';
import { SharedArray } from 'k6/data';
const host = new SharedArray('host', () => JSON.parse(open(__ENV.TOKENS_FILE || './results/tokens.json')).filter((t) => t.uid === 'lt-race-host'))[0];
const accepted = new Counter('race_accepted'), refused = new Counter('race_refused_409'), created = new Counter('race_created');
const N = Number(__ENV.RACERS || 200);
export const options = { scenarios: { race: { executor: 'per-vu-iterations', vus: N, iterations: 1, maxDuration: '3m' } },
  thresholds: { race_accepted: ['count==2'], unexpected_errors: ['count==0'] } };
export default function () {
  const u = customers[exec.vu.idInTest - 1];
  const r = req('POST', '/api/v1/requests', u.token, { hostId: 'lt-race-host', vehicleType: 'car', connector: 'TYPE2_AC', customerLocation: { lat: 17.724, lng: 83.302 }, compatibilityConfirmed: true }, 'race_create', { 'Idempotency-Key': uuid() }, true);
  if (r.status !== 201) return;
  created.add(1);
  // Host accepts every request at the same moment; like the app, retry a retryable 503 with jitter (max 4 tries).
  let a;
  for (let i = 0; i < 4; i++) {
    a = req('POST', `/api/v1/requests/${r.json('data.id')}/transition`, host.token, { action: 'accept' }, 'race_accept');
    if (a.status !== 503) break;
    sleep((0.5 + Math.random()) * 2 ** i);
  }
  if (a.status === 200) accepted.add(1); else if (a.status === 409) refused.add(1);
  check(a, { 'accept is 200 or 409': (x) => x.status === 200 || x.status === 409 });
}
