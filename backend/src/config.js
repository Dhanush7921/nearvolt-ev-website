// Central, validated configuration. Secrets come from env vars that Cloud Run maps from Secret Manager.
import { z } from 'zod';

const bool = (d) => z.enum(['true', 'false']).default(d).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  APP_ENV: z.enum(['dev', 'prod', 'test']).default('dev'),
  CORS_ORIGINS: z.string().default(''), // comma-separated exact origins
  STORAGE_BUCKET: z.string().default(''),
  REQUIRE_APP_CHECK: bool('false'),
  REQUIRE_ADMIN_MFA: bool('true'),
  REQUEST_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  MAX_SEARCH_RADIUS_KM: z.coerce.number().min(1).max(50).default(15),
  // MSG91 (phone OTP). Empty = phone login disabled (reported as blocker, never faked).
  MSG91_AUTH_KEY: z.string().default(''),
  MSG91_TEMPLATE_ID: z.string().default(''),
  MSG91_BASE_URL: z.string().url().default('https://control.msg91.com'),
  OTP_HASH_SALT: z.string().default(''),
  // Google Sheets sync (service account of Cloud Run must be an editor of the sheet).
  SHEETS_SPREADSHEET_ID: z.string().default(''),
  // Internal job auth: Cloud Scheduler OIDC tokens.
  INTERNAL_OIDC_AUDIENCE: z.string().default(''),
  INTERNAL_OIDC_SA_EMAIL: z.string().default(''),
});

export function loadConfig(env = process.env) {
  const cfg = schema.parse(env);
  cfg.corsOrigins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  cfg.phoneOtpEnabled = Boolean(cfg.MSG91_AUTH_KEY && cfg.MSG91_TEMPLATE_ID && cfg.OTP_HASH_SALT);
  cfg.sheetsEnabled = Boolean(cfg.SHEETS_SPREADSHEET_ID);
  if (cfg.NODE_ENV === 'production') {
    if (!cfg.corsOrigins.length) throw new Error('CORS_ORIGINS is required in production');
    if (!cfg.INTERNAL_OIDC_AUDIENCE || !cfg.INTERNAL_OIDC_SA_EMAIL) throw new Error('Internal OIDC config required in production');
  }
  return cfg;
}
