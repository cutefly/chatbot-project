import Fastify from 'fastify';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { config } from '../config/index.js';
import { buildZonedIso, isValidTimeZone } from './time.js';
import { logger } from '../logger.js';

export async function createServer(bot: Bot) {
  const app = Fastify({ logger: false });

  const handleUpdate = webhookCallback(bot, 'fastify');

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

  app.post('/webhook', async (req, reply) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (secret !== config.TELEGRAM_WEBHOOK_SECRET) {
      logger.warn('Webhook request rejected: invalid secret token');
      reply.code(401);
      return { error: 'Unauthorized' };
    }
    logger.info('Webhook update received');
    return handleUpdate(req, reply);
  });

  return app;
}
