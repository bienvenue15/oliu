process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:5434/postgres?connection_limit=1&pgbouncer=true';
process.env.SESSION_SECRET ??= 'test-secret-not-for-production-0123456789';
process.env.MAIL_TRANSPORT = 'memory';
process.env.COOKIE_SECURE = 'false';
