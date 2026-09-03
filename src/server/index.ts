import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { config } from '../config/index.js';
import { buildZonedIso, isValidTimeZone } from './time.js';
import { logger } from '../logger.js';
import { createUpdateDedupe } from './updateDedupe.js';

function secretMatches(header: unknown, expected: string): boolean {
  if (typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function processDetached(bot: Bot, update: Update): Promise<void> {
  try {
    await bot.handleUpdate(update);
  } catch (error) {
    // Required: grammy's bot.catch is never consulted in webhook mode, so an
    // unhandled rejection here would kill the process.
    logger.error('Update processing failed', {
      updateId: update.update_id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export async function createServer(bot: Bot) {
  const app = Fastify({ logger: false });
  const dedupe = createUpdateDedupe();

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
    if (!secretMatches(req.headers['x-telegram-bot-api-secret-token'], config.TELEGRAM_WEBHOOK_SECRET)) {
      logger.warn('Webhook rejected: invalid secret token', {
        ip: req.headers['x-forwarded-for'] ?? req.ip,
      });
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || typeof (body as Update).update_id !== 'number') {
      return reply.code(400).send({ error: 'Bad Request' });
    }

    const update = body as Update;
    const updateType = Object.keys(update).filter(k => k !== 'update_id')[0] ?? 'unknown';

    // Claim must stay synchronous: any await between check and mark would let
    // concurrent retries of the same update_id both pass.
    if (!dedupe.claim(update.update_id)) {
      logger.warn('Duplicate webhook update dropped', { updateId: update.update_id, type: updateType });
      return reply.code(200).send();
    }

    logger.info('Webhook update received', { updateId: update.update_id, type: updateType });

    // Ack before slow work: Telegram retries until it sees a 2xx and its own
    // webhook timeout (~60s) is shorter than an LLM turn. Body must stay empty —
    // Telegram reads a non-empty JSON body as an inline API method call.
    reply.code(200).send();
    void processDetached(bot, update);
    return reply;
  });

  return app;
}
