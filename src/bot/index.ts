import { Bot } from 'grammy';
import { config } from '../config/index.js';
import { whitelistMiddleware } from './middleware/whitelist.js';
import { startCommand } from './commands/start.js';
import { menuCommand } from './commands/menu.js';
import { resetCommand } from './commands/reset.js';
import { modelCommand } from './commands/model.js';
import { modelsCommand } from './commands/models.js';
import { statusCommand } from './commands/status.js';
import { messageHandler } from './handlers/message.js';
import { callbackQueryHandler } from './handlers/callbackQuery.js';

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // All updates pass through whitelist first
  bot.use(whitelistMiddleware);

  // Commands
  bot.command('start', startCommand);
  bot.command('menu', menuCommand);
  bot.command('reset', resetCommand);
  bot.command('model', modelCommand);
  bot.command('models', modelsCommand);
  bot.command('status', statusCommand);

  // Text messages (non-command)
  bot.on('message:text', messageHandler);

  // Inline keyboard button taps
  bot.on('callback_query:data', callbackQueryHandler);

  return bot;
}
