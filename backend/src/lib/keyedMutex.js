// Per-key async mutex (in-process). Serialises transactions that write the same Firestore document on this
// instance, avoiding lock convoys on hot documents (e.g. one host's capacity counter). Cross-instance safety is
// still guaranteed by the Firestore transaction itself; this only removes self-inflicted contention.
export function keyedMutex() {
  const tails = new Map();
  return async function run(key, fn) {
    const prev = tails.get(key) || Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    const tail = prev.then(() => mine);
    tails.set(key, tail);
    await prev;
    try { return await fn(); } finally { release(); if (tails.get(key) === tail) tails.delete(key); }
  };
}
