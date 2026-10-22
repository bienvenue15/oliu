/** Parse a request body with a zod schema; a failure is a 400 with the field list, never a crash. */
import type { ZodType } from 'zod';
import { badRequest } from './errors.ts';

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('Check the highlighted fields', details);
  }
  return r.data;
}
