import './tools/index.js';

import { prisma } from './db/client.js';
import { config } from './config/index.js';
import { createBot } from './bot/index.js';
import { createServer } from './server/index.js';
import { seedDefaultMenus } from './services/menu.js';
import { logger } from './logger.js';

async function main() {
  try {
    await prisma.$connect();
    logger.info('Database connected');
    await seedDefaultMenus();
  } catch (error) {
    logger.error('Database connection failed', { error });
    process.exit(1);
  }

  const bot = createBot();
  // grammy retries a failing getMe forever, so bot.init() can hang instead of throwing.
  const initWatchdog = setTimeout(() => {
    logger.error('Fatal error', { error: 'bot.init() timed out — Telegram API unreachable' });
    process.exit(1);
  }, 15_000);
  await bot.init();
  clearTimeout(initWatchdog);
  const server = await createServer(bot);

  await bot.api.setWebhook(`${config.WEBHOOK_URL}/webhook`, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
  });
  logger.info(`Webhook registered: ${config.WEBHOOK_URL}/webhook`);

  await server.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info(`Server listening on port ${config.PORT}`);

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(err => {
  logger.error('Fatal error', { error: err });
  process.exit(1);
});
