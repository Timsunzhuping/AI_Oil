import pino, { Logger } from 'pino';
import pinoHttp, { HttpLogger } from 'pino-http';
import type { Env } from './env.js';
import { getTraceId, getUserId } from '../lib/context.js';

/**
 * Pino logger factory.
 *
 * The `mixin` hook runs on EVERY log call and pulls the active trace_id
 * (and userId, when present) from AsyncLocalStorage — so any log line,
 * from anywhere in the async chain, is automatically correlated.
 *
 * Pretty-printing is enabled only in local/development for readability;
 * test and production emit JSON for machine parsing.
 */
export function createLogger(env: Env): Logger {
  const isPretty = env.NODE_ENV === 'local' || env.NODE_ENV === 'development';

  return pino({
    level: env.LOG_LEVEL,
    base: {
      service: env.SERVICE_NAME,
      version: env.SERVICE_VERSION,
      env: env.NODE_ENV,
    },
    mixin() {
      const traceId = getTraceId();
      const userId = getUserId();
      return {
        ...(traceId ? { traceId } : {}),
        ...(userId ? { userId } : {}),
      };
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    transport: isPretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,service,version,env',
            messageFormat: '{traceId} {msg}',
            singleLine: false,
          },
        }
      : undefined,
  });
}

export function createRequestLogger(logger: Logger, env: Env): HttpLogger {
  return pinoHttp({
    logger,
    autoLogging: env.ENABLE_REQUEST_LOGGING,
    quietReqLogger: true,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} → ${res.statusCode}: ${err.message}`,
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  });
}
