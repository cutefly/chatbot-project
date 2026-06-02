import type { CommandContext, Context } from 'grammy';
import { getOrCreateUser } from '../../services/user.js';
import { getOrCreateActive, getWindow } from '../../services/conversation.js';

export async function statusCommand(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from!;
  const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
  const conversation = await getOrCreateActive(user.id);
  const messages = await getWindow(conversation.id);

  await ctx.reply(
    `📊 현재 상태\n\n` +
    `모델: ${conversation.model}\n` +
    `대화 메시지 수: ${messages.length}개`,
  );
}
