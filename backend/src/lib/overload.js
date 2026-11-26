import { monitorEventLoopDelay } from 'node:perf_hooks';
import { logger } from './logger.js';

// Per-instance load shedding. Cloud Run already caps concurrency per instance; this protects an instance whose
// event loop is saturated (CPU-bound) by rejecting LOW-priority work with 503 + Retry-After so it can recover.
// Emergency paths (creating/advancing charging requests, sign-in) are never shed.
const PRIORITY = [
  /^\/api\/v1\/requests(\/[^/]+\/transition)?$/, // create + state transitions
  /^\/api\/v1\/auth\/otp\//, /^\/api\/v1\/me\/session$/, /^\/api\/v1\/health$/, /^\/healthz$/, /^\/api\/v1\/internal\//,
];
export function isPriority(req) { return (req.method !== 'GET' || req.path.endsWith('/health')) && PRIORITY.some((r) => r.test(req.path)); }

export function createShedder({ maxLagMs = 250, maxInflight = 200 } = {}) {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  let lagP99 = 0, inflight = 0, shed = 0;
  const t = setInterval(() => {
    lagP99 = h.percentile(99) / 1e6; h.reset();
    if (shed) { logger.warn({ metric: 'load_shed', count: shed, lagP99, inflight }, 'shedding low-priority requests'); shed = 0; }
  }, 1000);
  t.unref();
  const mw = (req, res, next) => {
    if (!isPriority(req) && (lagP99 > maxLagMs || inflight >= maxInflight)) {
      shed++;
      res.set('Retry-After', '2');
      return res.status(503).json({ ok: false, error: { code: 'OVERLOADED', message: 'Busy right now. Please retry in a moment.' } });
    }
    inflight++;
    let done = false;
    const end = () => { if (!done) { done = true; inflight--; } };
    res.on('finish', end); res.on('close', end);
    next();
  };
  mw.stats = () => ({ lagP99, inflight });
  return mw;
}

// Hard per-request deadline so a slow dependency cannot pin an instance slot.
export const deadline = (readMs, writeMs = readMs) => (req, res, next) => {
  const ms = req.method === 'GET' ? readMs : writeMs;
  const t = setTimeout(() => {
    if (!res.headersSent) res.set('Retry-After', '1').status(503).json({ ok: false, error: { code: 'TIMEOUT', message: 'The request took too long. Please retry.' } });
  }, ms);
  res.on('finish', () => clearTimeout(t)); res.on('close', () => clearTimeout(t));
  next();
};

// Small per-instance token bucket for cheap, high-volume reads (e.g. discovery). Distributed (Firestore) limits
// remain on sensitive/costly endpoints (OTP, request creation, tickets). Bounded memory.
export function memoryLimiter({ capacity, refillPerSec, maxKeys = 50000 }) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) { if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value); b = { tokens: capacity, at: now }; }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec); b.at = now;
    buckets.delete(key); buckets.set(key, b); // LRU order
    if (b.tokens < 1) return false;
    b.tokens -= 1; return true;
  };
}

// Tiny TTL cache with bounded size (LRU eviction).
export function ttlCache({ ttlMs, max = 2000 }) {
  const m = new Map();
  // Periodic purge so expired entries never accumulate between reads.
  const t = setInterval(() => { const now = Date.now(); for (const [k, e] of m) if (now - e.at > ttlMs) m.delete(k); }, Math.max(1000, ttlMs));
  t.unref();
  return {
    get(k) { const e = m.get(k); if (!e) return undefined; if (Date.now() - e.at > ttlMs) { m.delete(k); return undefined; } return e; },
    set(k, v) { if (m.size >= max) m.delete(m.keys().next().value); m.set(k, { v, at: Date.now() }); },
    clear() { m.clear(); },
  };
}
