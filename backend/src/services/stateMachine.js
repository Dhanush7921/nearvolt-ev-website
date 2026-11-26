// Server-validated charging workflow.
// REQUESTED → ACCEPTED → ARRIVED → CHARGING → COMPLETED; side exits REJECTED, EXPIRED, CANCELLED, DISPUTED.
export const S = Object.freeze({
  REQUESTED: 'REQUESTED', ACCEPTED: 'ACCEPTED', ARRIVED: 'ARRIVED', CHARGING: 'CHARGING',
  COMPLETED: 'COMPLETED', REJECTED: 'REJECTED', EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED', DISPUTED: 'DISPUTED',
});
export const ACTIVE = new Set([S.REQUESTED, S.ACCEPTED, S.ARRIVED, S.CHARGING]);
export const HOLDS_CAPACITY = new Set([S.ACCEPTED, S.ARRIVED, S.CHARGING]);
export const LOCATION_VISIBLE = new Set([S.ACCEPTED, S.ARRIVED, S.CHARGING]);

// action -> { from: [...], to, by: 'customer'|'host'|'either'|'system' }
export const TRANSITIONS = Object.freeze({
  accept:   { from: [S.REQUESTED], to: S.ACCEPTED, by: 'host' },
  reject:   { from: [S.REQUESTED], to: S.REJECTED, by: 'host' },
  cancel:   { from: [S.REQUESTED, S.ACCEPTED, S.ARRIVED], to: S.CANCELLED, by: 'either' },
  arrive:   { from: [S.ACCEPTED], to: S.ARRIVED, by: 'either' },
  start:    { from: [S.ARRIVED], to: S.CHARGING, by: 'host' },
  complete: { from: [S.CHARGING], to: S.COMPLETED, by: 'either' },
  dispute:  { from: [S.ACCEPTED, S.ARRIVED, S.CHARGING, S.COMPLETED], to: S.DISPUTED, by: 'either' },
  expire:   { from: [S.REQUESTED], to: S.EXPIRED, by: 'system' },
});

export function checkTransition(action, current, actorRole) {
  const t = TRANSITIONS[action];
  if (!t) return { ok: false, reason: 'UNKNOWN_ACTION' };
  if (t.by === 'system' && actorRole !== 'system') return { ok: false, reason: 'FORBIDDEN' };
  if (t.by !== 'either' && t.by !== 'system' && t.by !== actorRole) return { ok: false, reason: 'FORBIDDEN' };
  if (!t.from.includes(current)) return { ok: false, reason: 'INVALID_STATE' };
  return { ok: true, to: t.to };
}
