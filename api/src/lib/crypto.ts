/** Hashing and signing in one place, so the choice of algorithm is made once. */
import argon2 from 'argon2';
import { createHmac, randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';

export const hashPassword = (plain: string) => argon2.hash(plain, { type: argon2.argon2id });
export const verifyPassword = (hash: string, plain: string) => argon2.verify(hash, plain);

/** Six digits, from a cryptographic source. */
export const newOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** One-use link tokens: random, stored only as a hash. */
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The cookie holds `sessionId.signature`; the signature stops a forged id from being tried. */
export function signSessionId(id: string): string {
  const sig = createHmac('sha256', config.SESSION_SECRET).update(id).digest('base64url');
  return `${id}.${sig}`;
}
export function verifySignedSessionId(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const expected = signSessionId(id);
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}
