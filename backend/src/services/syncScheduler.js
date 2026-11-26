import { logger } from '../lib/logger.js';
import { outboxState } from './outbox.js';

// Cloud Tasks "kick": after a request writes Sheets outbox rows, schedule one named task per 20 s window.
// Cloud Tasks rejects duplicate task names, so many instances kicking the same window create a single task.
// The queue is configured with max-concurrent-dispatches=1 and exponential retry (infra/setup-gcp.sh), so sync
// runs serially within Sheets API quotas. A Cloud Scheduler sweep remains as the recovery path.
const WINDOW_MS = 20000;
export function createSyncKicker({ tasks, queuePath, url, saEmail }) {
  if (!tasks || !queuePath || !url) return { kick: async () => false, enabled: false };
  let lastWindow = -1;
  async function kick(delaySec = 5) {
    const w = Math.floor(Date.now() / WINDOW_MS);
    if (w === lastWindow) return false;
    lastWindow = w;
    try {
      await tasks.createTask({ parent: queuePath, task: {
        name: `${queuePath}/tasks/sheets-sync-${w}`,
        scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySec },
        httpRequest: { httpMethod: 'POST', url, oidcToken: { serviceAccountEmail: saEmail, audience: new URL(url).origin } },
      } });
      return true;
    } catch (e) {
      if (e.code === 6 /* ALREADY_EXISTS */) return false;
      logger.warn({ err: e.message }, 'sheets kick failed; scheduler sweep will recover');
      return false;
    }
  }
  return { kick, enabled: true };
}

// Express middleware: if this request queued outbox rows, kick the sync (bounded wait, never blocks > capMs).
export const kickAfterWrites = (kicker, capMs = 200) => (req, res, next) => {
  if (!kicker.enabled) return next();
  const start = outboxState.seq;
  const json = res.json.bind(res);
  res.json = (body) => {
    if (outboxState.seq === start) return json(body);
    Promise.race([kicker.kick(), new Promise((r) => setTimeout(r, capMs))]).finally(() => json(body));
    return res;
  };
  next();
};
