// OTP sign-in throughput using the MOCK provider (staging/test only: OTP_PROVIDER=mock; prod refuses it).
// Each VU uses unique synthetic numbers (+91 9 9xxxxxxxx range) so per-number cooldowns don't interfere.
// Requires a high IP_LIMIT_PER_15MIN on the target because traffic comes from one load generator.
//   k6 run -e VUS=50 tests/load/auth-throughput.js
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const issued = new Counter('custom_tokens_issued');
export const options = { scenarios: { otp: { executor: 'constant-vus', vus: Number(__ENV.VUS || 50), duration: __ENV.DURATION || '1m' } },
  thresholds: { 'http_req_duration{name:otp_verify}': ['p(95)<1000'], checks: ['rate>0.99'] } };
export default function () {
  const n = 9900000000 + exec.vu.idInTest * 10000 + exec.vu.iterationInScenario;
  const p = { headers: { 'Content-Type': 'application/json' } };
  const s = http.post(`${BASE}/api/v1/auth/otp/send`, JSON.stringify({ phone: String(n) }), { ...p, tags: { name: 'otp_send' } });
  const v = http.post(`${BASE}/api/v1/auth/otp/verify`, JSON.stringify({ phone: String(n), otp: '000000' }), { ...p, tags: { name: 'otp_verify' } });
  if (v.status === 200 && v.json('data.customToken')) issued.add(1);
  check(v, { 'send ok': () => s.status === 200, 'verify ok': (x) => x.status === 200 });
}
