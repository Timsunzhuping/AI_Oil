import pino from 'pino';
import pinoHttp from 'pino-http';
import { Env } from './env.js';

export function createLogger(env: Env) {
  const isDev = env.NODE_ENV === 'development';
  return pino({
    level: env.LOG_LEVEL,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: false,
          },
        }
      : undefined,
  });
}

export function createRequestLogger(logger: pino.Logger) {
  return pinoHttp({
    logger,
    customSuccessMessage: (req, res) => {
      return `${req.method} ${req.url} - ${res.statusCode}`;
    },
  });
}
