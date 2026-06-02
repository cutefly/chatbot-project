import Fastify from 'fastify';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { config } from '../config/index.js';

export async function createServer(bot: Bot) {
  const app = Fastify({ logger: true });

  // grammy webhook handler — created once, reused per request
  const handleUpdate = webhookCallback(bot, 'fastify');

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Telegram webhook — validates secret token before passing to grammy
  app.post('/webhook', async (req, reply) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (secret !== config.TELEGRAM_WEBHOOK_SECRET) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }
    return handleUpdate(req, reply);
  });

  return app;
}
