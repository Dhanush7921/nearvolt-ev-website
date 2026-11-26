import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { OAuth2Client } from 'google-auth-library';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createMsg91, createMockOtp } from './services/otpProvider.js';
import { createSheetsClient, faultySheetsClient } from './services/sheets.js';
import { CloudTasksClient } from '@google-cloud/tasks';
import { createSyncKicker } from './services/syncScheduler.js';
import { createInlineKicker } from './services/inlineSync.js';
import { logger } from './lib/logger.js';

const config = loadConfig();
// Cloud Run: runtime service account (ADC). Render: service-account JSON from a secret env var (raw or base64).
function credential() {
  const raw = config.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
  if (!raw) return applicationDefault();
  return cert(JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')));
}
initializeApp({ credential: credential(), ...(config.FIREBASE_PROJECT_ID ? { projectId: config.FIREBASE_PROJECT_ID } : {}),
  ...(config.STORAGE_DRIVER === 'gcs' && config.STORAGE_BUCKET ? { storageBucket: config.STORAGE_BUCKET } : {}) });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
// SDK clients are created once per instance and reused across requests (connection pooling over gRPC/HTTP keep-alive).
const messaging = config.FAULT_FCM ? { sendEachForMulticast: async () => { throw new Error('FAULT_FCM'); } } : getMessaging();
const otp = !config.phoneOtpEnabled ? null : config.OTP_PROVIDER === 'mock' ? createMockOtp()
  : createMsg91({ authKey: config.MSG91_AUTH_KEY, templateId: config.MSG91_TEMPLATE_ID, baseUrl: config.MSG91_BASE_URL });
const sheetsClient = config.FAULT_SHEETS ? faultySheetsClient() : config.sheetsEnabled ? createSheetsClient(config.SHEETS_SPREADSHEET_ID) : null;
const kicker = config.SYNC_DRIVER === 'inline' ? createInlineKicker({ db, client: sheetsClient }) : createSyncKicker({ tasks: config.TASKS_QUEUE ? new CloudTasksClient() : null, queuePath: config.TASKS_QUEUE,
  url: config.PUBLIC_URL ? `${config.PUBLIC_URL}/api/v1/internal/sheets-sync` : '', saEmail: config.INTERNAL_OIDC_SA_EMAIL });
const app = createApp({ config, db, auth: getAuth(), appCheck: getAppCheck(), messaging, storage: config.STORAGE_DRIVER === 'gcs' ? getStorage() : null, otp, sheetsClient, kicker, oidc: new OAuth2Client() });
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT, env: config.APP_ENV, phoneOtp: config.phoneOtpEnabled, otpProvider: config.OTP_PROVIDER, sheets: config.sheetsEnabled, tasks: kicker.enabled }, 'nearvolt api up'));
// Keep-alive longer than Google's front end idle timeout; bounded request time.
server.keepAliveTimeout = 65000; server.headersTimeout = 66000; server.requestTimeout = 30000;
process.on('SIGTERM', () => server.close(() => process.exit(0)));
