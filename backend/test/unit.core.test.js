import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTransition, TRANSITIONS, S } from '../src/services/stateMachine.js';
import { sheetSafe, normalizeIndianMobile } from '../src/lib/sanitize.js';
import { distanceKm, mapsDirectionsUrl, inServiceArea } from '../src/lib/geo.js';
import { isOpenNow } from '../src/lib/hours.js';
import { hostProfileSchema } from '../src/lib/schemas.js';
import { createMsg91 } from '../src/services/otpProvider.js';
import { toRow } from '../src/services/sheets.js';
import { loadConfig } from '../src/config.js';

test('state machine: happy path and role enforcement', () => {
  assert.deepEqual(checkTransition('accept', S.REQUESTED, 'host'), { ok: true, to: S.ACCEPTED });
  assert.equal(checkTransition('accept', S.REQUESTED, 'customer').reason, 'FORBIDDEN');
  assert.equal(checkTransition('start', S.ARRIVED, 'customer').reason, 'FORBIDDEN');
  assert.equal(checkTransition('start', S.ACCEPTED, 'host').reason, 'INVALID_STATE');
  assert.equal(checkTransition('expire', S.REQUESTED, 'host').reason, 'FORBIDDEN');
  assert.equal(checkTransition('complete', S.COMPLETED, 'host').reason, 'INVALID_STATE');
  assert.equal(checkTransition('cancel', S.CHARGING, 'customer').reason, 'INVALID_STATE');
  assert.equal(checkTransition('bogus', S.REQUESTED, 'host').reason, 'UNKNOWN_ACTION');
  for (const t of Object.values(TRANSITIONS)) assert.ok(t.from.length && t.to);
});

test('formula injection guard', () => {
  for (const s of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) assert.ok(sheetSafe(s).startsWith("'"));
  assert.equal(sheetSafe('Ravi'), 'Ravi'); assert.equal(sheetSafe(5), 5); assert.equal(sheetSafe(null), '');
  assert.deepEqual(toRow('FEEDBACK', { requestId: '=bad', rating: 4 }), ["'=bad", '', '', 4, '']);
});

test('Indian mobile normalisation', () => {
  assert.equal(normalizeIndianMobile('98765 43210'), '+919876543210');
  assert.equal(normalizeIndianMobile('+91-9876543210'), '+919876543210');
  assert.equal(normalizeIndianMobile('5876543210'), null);
  assert.equal(normalizeIndianMobile('12345'), null);
});

test('geo helpers', () => {
  const km = distanceKm({ lat: 17.7231, lng: 83.3013 }, { lat: 17.7300, lng: 83.3100 });
  assert.ok(km > 1.0 && km < 1.3, String(km));
  assert.equal(mapsDirectionsUrl(17.7231, 83.3013), 'https://www.google.com/maps/dir/?api=1&destination=17.723100,83.301300');
  const areas = [{ id: 'vizag', active: true, center: { lat: 17.6868, lng: 83.2185 }, radiusKm: 30 }];
  assert.equal(inServiceArea({ lat: 17.72, lng: 83.30 }, areas).id, 'vizag');
  assert.equal(inServiceArea({ lat: 17.385, lng: 78.4867 }, areas), null); // Hyderabad
});

test('opening hours in IST incl. overnight', () => {
  const at = (iso) => new Date(iso);
  const h = { mon: [{ open: '09:00', close: '18:00' }], tue: [{ open: '22:00', close: '06:00' }] };
  assert.equal(isOpenNow(h, at('2026-11-23T05:00:00Z')), true);  // Mon 10:30 IST
  assert.equal(isOpenNow(h, at('2026-11-23T13:00:00Z')), false); // Mon 18:30 IST
  assert.equal(isOpenNow(h, at('2026-11-24T17:00:00Z')), true);  // Tue 22:30 IST
  assert.equal(isOpenNow(null), false);
});

test('host power must match V x A', () => {
  const base = { displayName: 'X', address: 'Some address 1', location: { lat: 17.7, lng: 83.3 }, hours: {},
    selfDeclaration: { earthing: true, rcdOrElcb: true, dedicatedCircuit: false, ratedCabling: true, dryCoveredArea: true, accurateInformation: true } };
  const eq = { chargerType: 'socket', connectors: ['DOMESTIC_15A'], vehicleTypes: ['two_wheeler'], voltageV: 230, currentA: 15, phase: 'single' };
  assert.equal(hostProfileSchema.safeParse({ ...base, equipment: { ...eq, powerKw: 3.3 } }).success, true);
  assert.equal(hostProfileSchema.safeParse({ ...base, equipment: { ...eq, powerKw: 7.4 } }).success, false);
  assert.equal(hostProfileSchema.safeParse({ ...base, equipment: { ...eq, powerKw: 3.3 }, selfDeclaration: { ...base.selfDeclaration, earthing: false } }).success, false);
});

test('MSG91 client builds correct requests', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, json: async () => ({ type: 'success' }) }; };
  const c = createMsg91({ authKey: 'K', templateId: 'T', baseUrl: 'https://control.msg91.com', fetchImpl });
  assert.equal((await c.send('+919876543210')).ok, true);
  assert.equal((await c.verify('+919876543210', '123456')).ok, true);
  assert.match(calls[0].url, /\/api\/v5\/otp\?template_id=T&mobile=919876543210/);
  assert.equal(calls[0].opts.method, 'POST'); assert.equal(calls[0].opts.headers.authkey, 'K');
  assert.match(calls[1].url, /\/api\/v5\/otp\/verify\?mobile=919876543210&otp=123456/);
});

test('production config refuses unsafe defaults', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /CORS_ORIGINS/);
  const c = loadConfig({ NODE_ENV: 'test' });
  assert.equal(c.phoneOtpEnabled, false); assert.equal(c.REQUIRE_ADMIN_MFA, true);
});
