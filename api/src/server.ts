import { createApp } from './app.ts';
import { config } from './config.ts';
import { logger } from './lib/logger.ts';
import { prisma } from './db.ts';

const app = createApp();
/**
 * In development the API binds both loopback addresses explicitly, not the wildcard: Windows lets another
 * process take [::1]:3001 beside a wildcard listener, and a Nuxt dev worker looking for a free port did exactly
 * that, so every "localhost:3001" call looped into the web app. In production the wildcard is right.
 */
const hosts = config.isProd ? [undefined] : ['127.0.0.1', '::1'];
const servers = hosts.map((host) =>
  app.listen(config.PORT, host as string, () => {
    logger.info(
      { port: config.PORT, host: host ?? 'all', env: config.NODE_ENV },
      'OLIU API listening',
    );
  }),
);
if (!config.isProd) logger.info(`development mail inbox: http://localhost:${config.PORT}/dev/mail`);

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  for (const s of servers) s.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
