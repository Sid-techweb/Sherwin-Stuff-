import { createApp } from './app';
import { config } from './config';
import { pool } from './db/pool';
import { connectRedis, redis } from './db/redis';
import { scan } from './services/alertService';
import { logger } from './utils/logger';

async function main() {
  await connectRedis();
  const app = createApp();
  const server = app.listen(config.port, () => logger.info(`API listening on :${config.port}`));

  const timer = setInterval(() => {
    scan().catch((err) => logger.error({ err }, 'alert scan failed'));
  }, config.alertScanIntervalMs);

  const shutdown = async () => {
    clearInterval(timer);
    server.close();
    await pool.end();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
