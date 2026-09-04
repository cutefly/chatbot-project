import type { CommandContext, Context } from 'grammy';
import { getRootMenuItems } from '../../services/menu.js';
import { buildRootView } from '../handlers/menuHelpers.js';
import { sendView } from '../handlers/menuNav.js';

export async function menuCommand(ctx: CommandContext<Context>): Promise<void> {
  const items = await getRootMenuItems();

  if (items.length === 0) {
    await ctx.reply('메뉴 항목이 없습니다.');
    return;
  }

  await sendView(ctx, buildRootView(items));
}
