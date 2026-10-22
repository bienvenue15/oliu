import { createApp } from './app.ts';
import { config } from './config.ts';
import { logger } from './lib/logger.ts';
import { prisma } from './db.ts';

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'OLIU API listening');
  if (!config.isProd) logger.info(`development mail inbox: http://localhost:${config.PORT}/dev/mail`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
