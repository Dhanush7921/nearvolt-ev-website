// Throughput ceiling: open-model arrival rate (iterations/s) with NO think time, ramped until latency or errors break.
// Uses few VUs (memory-light), so it measures server capacity rather than connection count.
//   k6 run -e NOTHINK=1 -e START=20 -e PEAK=300 -e STEP=2m tests/load/stress.js
// One iteration = one journey from the same mix as load.js (≈3 HTTP requests on average).
import { mixed } from './lib/common.js';
const START = Number(__ENV.START || 20), PEAK = Number(__ENV.PEAK || 300), STEP = __ENV.STEP || '1m';
const steps = 6;
export const options = {
  scenarios: { stress: { executor: 'ramping-arrival-rate', startRate: START, timeUnit: '1s', preAllocatedVUs: Number(__ENV.VUS || 150), maxVUs: Number(__ENV.VUS || 150),
    stages: Array.from({ length: steps }, (_, i) => ({ duration: STEP, target: Math.round(START + ((PEAK - START) * (i + 1)) / steps) })) } },
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: { http_req_duration: ['p(95)<1000'], unexpected_errors: ['count<=0'] },
};
export default function () { mixed(); }
export function handleSummary(data) { return { [`tests/load/results/summary-stress-${Date.now()}.json`]: JSON.stringify(data), stdout: '' }; }
