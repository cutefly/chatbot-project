// Register all tools before anything else
import './tools/index.js';

import { prisma } from './db/client.js';
import { config } from './config/index.js';
import { createBot } from './bot/index.js';
import { createServer } from './server/index.js';

async function main() {
  // Verify database connectivity at startup
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }

  const bot = createBot();
  const server = await createServer(bot);

  // Register webhook with Telegram
  await bot.api.setWebhook(`${config.WEBHOOK_URL}/webhook`, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
  });
  console.log(`✅ Webhook registered: ${config.WEBHOOK_URL}/webhook`);

  // Start HTTP server
  await server.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`✅ Server listening on port ${config.PORT}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
