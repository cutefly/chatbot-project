import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { getRootMenuItems } from '../../services/menu.js';

export async function menuCommand(ctx: CommandContext<Context>): Promise<void> {
  const items = await getRootMenuItems();

  if (items.length === 0) {
    await ctx.reply('메뉴 항목이 없습니다.');
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const item of items) {
    keyboard.text(item.label, `menu:${item.id}`).row();
  }

  await ctx.reply('원하는 항목을 선택하세요:', { reply_markup: keyboard });
}
