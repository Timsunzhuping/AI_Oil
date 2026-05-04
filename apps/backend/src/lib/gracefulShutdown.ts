import { Server } from 'http';
import pino from 'pino';

export function setupGracefulShutdown(server: Server, logger: pino.Logger) {
  const signals = ['SIGTERM', 'SIGINT'];

  signals.forEach((signal) => {
    process.on(signal, () => {
      logger.info({ signal }, 'Received shutdown signal, gracefully closing...');

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
