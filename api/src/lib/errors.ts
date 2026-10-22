/** Errors a route may throw; the error handler turns them into JSON. Anything else is a 500 with no detail leaked. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'Sign in first') => new HttpError(401, m);
export const forbidden = (m = 'Not allowed for your role') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
