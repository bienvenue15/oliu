/**
 * Development only: lets a headless browser on this machine open the app as a signed-in person for screenshots.
 * It logs in through the real API (password + the code read from the dev inbox) and forwards the session cookie.
 * Removed from production builds by the check below; never add a route like this without that check.
 */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') throw createError({ statusCode: 404 });
  const q = getQuery(event);
  const api = process.env.API_URL ?? 'http://localhost:3001';
  const r1 = await $fetch<{ challengeId: string }>(`${api}/api/auth/login`, { method: 'POST', body: { email: q.email, password: q.password } });
  const mail = await $fetch<{ text: string }[]>(`${api}/dev/mail.json`);
  const code = mail[0]?.text.match(/: (\d{6})/)?.[1];
  const r2 = await $fetch.raw(`${api}/api/auth/otp`, { method: 'POST', body: { challengeId: r1.challengeId, code } });
  const cookie = r2.headers.get('set-cookie');
  if (cookie) setHeader(event, 'set-cookie', cookie);
  return sendRedirect(event, String(q.to ?? '/app'));
});
