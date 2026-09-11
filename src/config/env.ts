import 'dotenv/config';
import cron from 'node-cron';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  /** HS256 signing key for access tokens. */
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** When the overdue-task sweep runs (cron syntax, UTC). Default: every hour, on the hour. */
  OVERDUE_SWEEP_CRON: z
    .string()
    .default('0 * * * *')
    .refine((expression) => cron.validate(expression), 'must be a valid cron expression'),
  /** "false" runs this instance without background jobs (e.g. extra API replicas). */
  JOBS_ENABLED: z.stringbool().default(true),
});

const result = EnvSchema.safeParse(process.env);
if (!result.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
}

export const env = result.data;
