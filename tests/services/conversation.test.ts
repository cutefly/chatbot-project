import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    OPENROUTER_DEFAULT_MODEL: 'openai/gpt-4o-mini',
    CONVERSATION_WINDOW_SIZE: 20,
  },
}));

import { prisma } from '../../src/db/client.js';
import {
  getWindow,
  getOrCreateActive,
  saveMessages,
  updateConversationModel,
} from '../../src/services/conversation.js';

describe('ConversationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWindow', () => {
    it('returns messages in chronological order', async () => {
      const descMessages = [
        { id: 3, role: 'assistant', content: 'c', createdAt: new Date('2024-01-03') },
        { id: 2, role: 'user', content: 'b', createdAt: new Date('2024-01-02') },
        { id: 1, role: 'user', content: 'a', createdAt: new Date('2024-01-01') },
      ];
      vi.mocked(prisma.message.findMany).mockResolvedValue(descMessages as any);

      const result = await getWindow(1, 3);

      expect(result[0].content).toBe('a');
      expect(result[1].content).toBe('b');
      expect(result[2].content).toBe('c');
    });

    it('queries with the given windowSize as take', async () => {
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);
      await getWindow(42, 5);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { conversationId: 42 }, take: 5 }),
      );
    });

    it('uses default CONVERSATION_WINDOW_SIZE when not specified', async () => {
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);
      await getWindow(1);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });

  describe('getOrCreateActive', () => {
    it('returns existing conversation without creating a new one', async () => {
      const existing = { id: 1, userId: 1, model: 'openai/gpt-4o-mini', createdAt: new Date() };
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(existing as any);

      const result = await getOrCreateActive(1);
      expect(result).toBe(existing);
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('creates a new conversation when none exists', async () => {
      const newConv = { id: 2, userId: 1, model: 'openai/gpt-4o-mini', createdAt: new Date() };
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.conversation.create).mockResolvedValue(newConv as any);

      const result = await getOrCreateActive(1);
      expect(result).toBe(newConv);
      expect(prisma.conversation.create).toHaveBeenCalledOnce();
    });
  });

  describe('saveMessages', () => {
    it('calls createMany with mapped message data', async () => {
      vi.mocked(prisma.message.createMany).mockResolvedValue({ count: 2 });
      await saveMessages(1, [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]);
      expect(prisma.message.createMany).toHaveBeenCalledWith({
        data: [
          { conversationId: 1, role: 'user', content: 'hello' },
          { conversationId: 1, role: 'assistant', content: 'hi' },
        ],
      });
    });
  });

  describe('updateConversationModel', () => {
    it('updates the model field for a given conversation id', async () => {
      vi.mocked(prisma.conversation.update).mockResolvedValue({} as any);
      await updateConversationModel(5, 'anthropic/claude-3-haiku');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { model: 'anthropic/claude-3-haiku' },
      });
    });
  });
});
