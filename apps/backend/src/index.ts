import { createApp } from './app.js';
import { setupGracefulShutdown } from './lib/gracefulShutdown.js';

function main(): void {
  const { app, logger, env } = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        apiPrefix: env.API_PREFIX,
        swagger: env.ENABLE_SWAGGER ? `http://localhost:${env.PORT}${env.API_PREFIX}/docs` : null,
      },
      `🚀 ${env.SERVICE_NAME} listening on port ${env.PORT}`
    );
  });

  setupGracefulShutdown(server, logger);

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandledRejection');
    process.exit(1);
  });
}

main();
