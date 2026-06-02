import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { menuConfig } from '../../config/index.js';

export async function menuCommand(ctx: CommandContext<Context>): Promise<void> {
  if (menuConfig.items.length === 0) {
    await ctx.reply('메뉴 항목이 없습니다. src/config/menu.json에 항목을 추가하세요.');
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const item of menuConfig.items) {
    keyboard.text(item.label, `menu:${item.id}`).row();
  }

  await ctx.reply('원하는 항목을 선택하세요:', { reply_markup: keyboard });
}
