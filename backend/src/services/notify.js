import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '../lib/logger.js';
// Stores an in-app notification and sends an FCM push. Push bodies never contain addresses or phone numbers.
export function createNotifier({ db, messaging }) {
  return async function notify(uid, { type, title, body, requestId }) {
    try {
      await db.collection('users').doc(uid).collection('notifications').add({
        type, title, body, requestId: requestId || null, read: false, at: FieldValue.serverTimestamp(),
      });
      const devs = await db.collection('users').doc(uid).collection('devices').limit(10).get();
      const tokens = devs.docs.map((d) => d.id);
      if (!tokens.length || !messaging) return;
      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { type, requestId: requestId || '' },
        android: { priority: 'high', notification: { channelId: 'requests', visibility: 'private' } },
      });
      // Remove tokens FCM reports as dead.
      await Promise.all(res.responses.map((r, i) => {
        const code = r.error?.code || '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          return db.collection('users').doc(uid).collection('devices').doc(tokens[i]).delete();
        }
        return null;
      }));
    } catch (e) { logger.warn({ err: e.message, type }, 'notify failed'); }
  };
}
