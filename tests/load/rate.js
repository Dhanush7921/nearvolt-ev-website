// Fixed arrival rate (iterations/s, no think time) to measure latency at a known throughput.
//   k6 run -e NOTHINK=1 -e RATE=100 -e DURATION=90s tests/load/rate.js
import { mixed } from './lib/common.js';
export const options = {
  scenarios: { rate: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 50), timeUnit: '1s', duration: __ENV.DURATION || '90s', preAllocatedVUs: Number(__ENV.VUS || 150), maxVUs: Number(__ENV.VUS || 150) } },
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: { http_req_duration: ['p(95)<500'], 'http_req_duration{name:nearby}': ['p(95)<500'], 'http_req_duration{name:request_create}': ['p(95)<500'],
    'http_req_duration{name:me}': ['p(95)<500'], 'http_req_duration{name:history}': ['p(95)<500'], unexpected_errors: ['count<=0'], shed_503: ['count<=0'] },
};
export default function () { mixed(); }
export function handleSummary(data) { return { [`tests/load/results/summary-rate${__ENV.RATE}-${Date.now()}.json`]: JSON.stringify(data), stdout: '' }; }
