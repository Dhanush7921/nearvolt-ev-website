import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { OAuth2Client } from 'google-auth-library';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createMsg91 } from './services/otpProvider.js';
import { createSheetsClient } from './services/sheets.js';
import { logger } from './lib/logger.js';

const config = loadConfig();
initializeApp({ credential: applicationDefault(), ...(config.STORAGE_BUCKET ? { storageBucket: config.STORAGE_BUCKET } : {}) });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const app = createApp({
  config, db, auth: getAuth(), appCheck: getAppCheck(), messaging: getMessaging(), storage: getStorage(),
  otp: config.phoneOtpEnabled ? createMsg91({ authKey: config.MSG91_AUTH_KEY, templateId: config.MSG91_TEMPLATE_ID, baseUrl: config.MSG91_BASE_URL }) : null,
  sheetsClient: config.sheetsEnabled ? createSheetsClient(config.SHEETS_SPREADSHEET_ID) : null,
  oidc: new OAuth2Client(),
});
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT, env: config.APP_ENV, phoneOtp: config.phoneOtpEnabled, sheets: config.sheetsEnabled }, 'nearvolt api up'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
