import type { Context } from 'grammy';
import { menuConfig } from '../../config/index.js';
import { processMessage } from './message.js';

export async function callbackQueryHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  if (!data.startsWith('menu:')) {
    await ctx.answerCallbackQuery();
    return;
  }

  const itemId = data.slice(5); // strip "menu:" prefix
  const item = menuConfig.items.find(i => i.id === itemId);

  if (!item) {
    await ctx.answerCallbackQuery('항목을 찾을 수 없습니다.');
    return;
  }

  await ctx.answerCallbackQuery();
  await processMessage(ctx, item.prompt);
}
