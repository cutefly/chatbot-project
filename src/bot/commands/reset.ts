import type { CommandContext, Context } from 'grammy';
import { getOrCreateUser } from '../../services/user.js';
import { createConversation } from '../../services/conversation.js';

export async function resetCommand(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from!;
  const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
  await createConversation(user.id);
  await ctx.reply('대화가 초기화되었습니다. 새로운 대화를 시작합니다. ✅');
}
