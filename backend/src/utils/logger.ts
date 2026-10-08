import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.isTest ? 'silent' : 'info',
  redact: ['req.headers.authorization', 'password', '*.password'],
});
