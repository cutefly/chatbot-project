import { prisma } from '../db/client.js';
import { config } from '../config/index.js';
import type { Conversation, Message, Role } from '@prisma/client';

export async function getOrCreateActive(userId: number): Promise<Conversation> {
  const existing = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: { userId, model: config.OPENROUTER_DEFAULT_MODEL },
  });
}

export async function getWindow(
  conversationId: number,
  windowSize: number = config.CONVERSATION_WINDOW_SIZE,
): Promise<Message[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: windowSize,
  });
  return messages.reverse(); // Return in chronological order
}

export async function createConversation(userId: number, model?: string): Promise<Conversation> {
  return prisma.conversation.create({
    data: { userId, model: model ?? config.OPENROUTER_DEFAULT_MODEL },
  });
}

export async function saveMessages(
  conversationId: number,
  messages: Array<{ role: Role; content: string }>,
): Promise<void> {
  await prisma.message.createMany({
    data: messages.map(m => ({ conversationId, role: m.role, content: m.content })),
  });
}

export async function updateConversationModel(
  conversationId: number,
  model: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { model },
  });
}
