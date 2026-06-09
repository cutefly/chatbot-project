import { InlineKeyboard } from 'grammy';
import { chat } from '../../services/llm.js';
import { getOrCreateUser } from '../../services/user.js';
import { getOrCreateActive, getWindow } from '../../services/conversation.js';
import type { Context } from 'grammy';
import type { Role } from '@prisma/client';

export function parseListFromLLMResponse(text: string): string[] {
  const lines = text.split('\n');
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = /^[-•*]?\s*\d*\.?\s*(.+)$/.exec(trimmed);
    if (match && match[1].trim().length > 0) {
      const value = match[1].trim();
      if (!value.includes(':') && value.length <= 20) {
        items.push(value);
      }
    }
  }
  return items;
}

export function buildDynamicKeyboard(
  items: string[],
  resultSubmenuId: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items.slice(0, 10)) {
    keyboard.text(item, `result:${resultSubmenuId}:${item}`).row();
  }
  return keyboard;
}

export function buildActionKeyboard(
  children: Array<{ id: number; label: string }>,
  value: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const child of children) {
    keyboard.text(child.label, `action:${child.id}:${value}`).row();
  }
  return keyboard;
}

export async function callToolPrompt(
  ctx: Context,
  prompt: string,
): Promise<string> {
  const from = ctx.from!;
  const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
  const conversation = await getOrCreateActive(user.id);
  const history = await getWindow(conversation.id);

  const messages = [
    ...history.map(m => ({ role: m.role as Role, content: m.content })),
    { role: 'user' as const, content: prompt },
  ];

  return chat(conversation.model, messages);
}
