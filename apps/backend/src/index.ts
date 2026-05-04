import { createApp } from './app.js';
import { setupGracefulShutdown } from './lib/gracefulShutdown.js';

function main(): void {
  const { app, logger, env, integration } = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        apiPrefix: env.API_PREFIX,
        swagger: env.ENABLE_SWAGGER ? `http://localhost:${env.PORT}${env.API_PREFIX}/docs` : null,
        integration: integration ? 'enabled' : 'disabled',
      },
      `🚀 ${env.SERVICE_NAME} listening on port ${env.PORT}`
    );
  });

  // Start the integration scheduler outside the test environment.
  if (integration && env.NODE_ENV !== 'test') {
    integration.scheduler.start();
  }

  setupGracefulShutdown(server, logger, async () => {
    if (integration) await integration.scheduler.stop();
  });

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
