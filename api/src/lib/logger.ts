import pino from 'pino';
import { config } from '../config.ts';

export const logger = pino({
  level: config.isTest ? 'silent' : config.isProd ? 'info' : 'debug',
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.code'],
});
