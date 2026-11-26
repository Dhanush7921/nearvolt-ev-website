// Central, validated configuration. Secrets come from env vars that Cloud Run maps from Secret Manager.
import { z } from 'zod';

const bool = (d) => z.enum(['true', 'false']).default(d).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  APP_ENV: z.enum(['dev', 'staging', 'prod', 'test']).default('dev'),
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
  // Cloud Tasks queue for Sheets sync, e.g. projects/p/locations/asia-south1/queues/sheets-sync
  TASKS_QUEUE: z.string().default(''),
  PUBLIC_URL: z.string().default(''), // this service's URL (Cloud Tasks target)
  // Capacity protection (tune from load tests)
  MAX_INFLIGHT: z.coerce.number().int().min(10).max(1000).default(120),
  MAX_LAG_MS: z.coerce.number().int().min(50).max(5000).default(250),
  REQUEST_DEADLINE_MS: z.coerce.number().int().min(1000).max(60000).default(15000), // reads
  WRITE_DEADLINE_MS: z.coerce.number().int().min(1000).max(29000).default(28000), // writes: let transactions finish so the response reflects the real outcome
  IP_LIMIT_PER_15MIN: z.coerce.number().int().min(50).max(1000000).default(600), // per-instance per-IP backstop
  OTP_IP_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(1000000).default(60), // backstop only: CGNAT puts many users on one IP; per-number limits are primary
  NEARBY_CACHE_MS: z.coerce.number().int().min(0).max(10000).default(5000),
  // Test-only switches (refused in prod): simulate provider outages and avoid paid SMS during load tests.
  OTP_PROVIDER: z.enum(['msg91', 'mock']).default('msg91'),
  FAULT_SHEETS: bool('false'),
  FAULT_FCM: bool('false'),
});

export function loadConfig(env = process.env) {
  const cfg = schema.parse(env);
  cfg.corsOrigins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (cfg.APP_ENV === 'prod' && (cfg.OTP_PROVIDER === 'mock' || cfg.FAULT_SHEETS || cfg.FAULT_FCM)) throw new Error('Test switches are not allowed in prod');
  cfg.phoneOtpEnabled = cfg.OTP_PROVIDER === 'mock' ? Boolean(cfg.OTP_HASH_SALT) : Boolean(cfg.MSG91_AUTH_KEY && cfg.MSG91_TEMPLATE_ID && cfg.OTP_HASH_SALT);
  cfg.sheetsEnabled = Boolean(cfg.SHEETS_SPREADSHEET_ID);
  if (cfg.NODE_ENV === 'production') {
    if (!cfg.corsOrigins.length) throw new Error('CORS_ORIGINS is required in production');
    if (!cfg.INTERNAL_OIDC_AUDIENCE || !cfg.INTERNAL_OIDC_SA_EMAIL) throw new Error('Internal OIDC config required in production');
  }
  return cfg;
}
