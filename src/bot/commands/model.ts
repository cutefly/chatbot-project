import type { CommandContext, Context } from 'grammy';
import { getOrCreateUser } from '../../services/user.js';
import { getOrCreateActive, updateConversationModel } from '../../services/conversation.js';

export async function modelCommand(ctx: CommandContext<Context>): Promise<void> {
  const modelId = ctx.match?.trim();
  if (!modelId) {
    await ctx.reply('사용법: /model <model-id>\n예시: /model anthropic/claude-3-haiku');
    return;
  }

  const from = ctx.from!;
  const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
  const conversation = await getOrCreateActive(user.id);
  await updateConversationModel(conversation.id, modelId);
  await ctx.reply(`모델이 변경되었습니다 ✅\n현재 모델: ${modelId}`);
}
