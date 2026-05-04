import { Server } from 'http';
import pino from 'pino';

export type ShutdownHook = () => Promise<void> | void;

export function setupGracefulShutdown(
  server: Server,
  logger: pino.Logger,
  beforeServerClose?: ShutdownHook
): void {
  const signals = ['SIGTERM', 'SIGINT'];

  signals.forEach((signal) => {
    process.on(signal, async () => {
      logger.info({ signal }, 'Received shutdown signal, gracefully closing...');

      try {
        if (beforeServerClose) await beforeServerClose();
      } catch (err) {
        logger.error({ err }, 'shutdown hook failed');
      }

      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    });
  });
}
