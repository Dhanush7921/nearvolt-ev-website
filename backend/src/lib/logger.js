import pino from 'pino';
// Cloud Logging reads JSON from stdout. Sensitive fields are redacted.
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  messageKey: 'message',
  formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-firebase-appcheck"]', '*.otp', '*.token', '*.idToken',
      '*.phone', '*.phoneNumber', '*.pin', 'pin', 'req.body.pin', '*.email', '*.lat', '*.lng', '*.address', 'err.config.headers'],
    censor: '[redacted]',
  },
});
