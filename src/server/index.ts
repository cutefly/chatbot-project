import Fastify from 'fastify';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { config } from '../config/index.js';
import { buildZonedIso, isValidTimeZone } from './time.js';

export async function createServer(bot: Bot) {
  const app = Fastify({ logger: true });

  // grammy webhook handler — created once, reused per request
  const handleUpdate = webhookCallback(bot, 'fastify');

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/get-time-by-region', async (req, reply) => {
    const region = (req.query as { region?: string }).region;
    if (!region || !isValidTimeZone(region)) {
      reply.code(400);
      return { error: 'Invalid or missing region. Provide a valid IANA timezone name.' };
    }
    return {
      region,
      datetime: buildZonedIso(region, new Date()),
      timezone: region,
    };
  });

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
