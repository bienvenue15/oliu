/**
 * Configuration — read once from the environment, validated, frozen.
 * Secrets never live in the code. See .env.example for every variable.
 */
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  /** Signs the session cookie. At least 32 random characters in production. */
  SESSION_SECRET: z.string().min(16),
  SESSION_DAYS: z.coerce.number().int().positive().default(7),
  OTP_MINUTES: z.coerce.number().int().positive().default(10),
  /** Where the web app runs; used for links in e-mails. */
  WEB_URL: z.string().url().default('http://localhost:3000'),
  /** 'memory' keeps every mail on the machine (readable at /dev/mail); 'smtp' sends through SMTP_URL. */
  MAIL_TRANSPORT: z.enum(['memory', 'smtp']).default('memory'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('OLIU <no-reply@oliu.local>'),
  /** Folder for files people attach (receipt photos); outside the web root, never served as static files. */
  UPLOAD_DIR: z.string().optional(),
  /** Set to 'true' only behind HTTPS. */
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
  throw new Error(`Configuration is incomplete:\n  ${issues}`);
}

export const config = Object.freeze({
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
});
export type Config = typeof config;
