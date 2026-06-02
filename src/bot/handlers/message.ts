import type { Context } from 'grammy';
import { getOrCreateUser } from '../../services/user.js';
import { getOrCreateActive, getWindow, saveMessages } from '../../services/conversation.js';
import { chat } from '../../services/llm.js';
import type { Role } from '@prisma/client';

export async function messageHandler(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;
  await processMessage(ctx, text);
}

export async function processMessage(ctx: Context, text: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  try {
    const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
    const conversation = await getOrCreateActive(user.id);
    const history = await getWindow(conversation.id);

    const messages = [
      ...history.map(m => ({ role: m.role as Role, content: m.content })),
      { role: 'user' as const, content: text },
    ];

    const response = await chat(conversation.model, messages);

    await saveMessages(conversation.id, [
      { role: 'user', content: text },
      { role: 'assistant', content: response },
    ]);

    // Try MarkdownV2 first; fall back to plain text if parsing fails
    await ctx.reply(response, { parse_mode: 'MarkdownV2' }).catch(() =>
      ctx.reply(response),
    );
  } catch (error) {
    console.error('[MessageHandler] Error processing message:', error);
    await ctx.reply('잠시 후 다시 시도해주세요. 🙏');
  }
}
