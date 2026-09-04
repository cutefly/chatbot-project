import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'grammy';

vi.mock('../../src/config/index.js', () => ({
  config: {
    PORT: 3000,
    OPENROUTER_API_KEY: 'test-key',
    WEBHOOK_URL: 'https://example.com',
    OPENROUTER_DEFAULT_MODEL: 'openai/gpt-4o-mini',
    CONVERSATION_WINDOW_SIZE: 20,
  },
  getToolSubstitutionVars: () => ({ PORT: '3000' }),
  menuConfig: { items: [{ id: 'legacy1', label: 'Legacy', prompt: '레거시 프롬프트' }] },
}));

vi.mock('../../src/tools/index.js', () => ({
  toolRegistry: { toFunctionDefinitions: vi.fn(() => []) },
}));

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }));
vi.mock('../../src/db/client.js', () => ({ prisma: {} }));

vi.mock('../../src/services/menu.js', () => ({
  getMenuItemById: vi.fn(),
  getChildren: vi.fn(),
  getRootMenuItems: vi.fn(),
}));

vi.mock('../../src/bot/handlers/message.js', () => ({
  processMessage: vi.fn(),
}));

vi.mock('../../src/bot/handlers/menuHelpers.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/bot/handlers/menuHelpers.js')>();
  return { ...actual, callToolPrompt: vi.fn() };
});

import { callbackQueryHandler } from '../../src/bot/handlers/callbackQuery.js';
import { getChildren, getMenuItemById, getRootMenuItems } from '../../src/services/menu.js';
import { processMessage } from '../../src/bot/handlers/message.js';
import { callToolPrompt } from '../../src/bot/handlers/menuHelpers.js';
import {
  peekView,
  pushView,
  resetNavStore,
  type MenuRows,
} from '../../src/bot/handlers/menuNav.js';

const CHAT_ID = 42;
const MESSAGE_ID = 500;

const menuItem = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  label: 'Item',
  parentId: null,
  sortOrder: 0,
  isActive: true,
  actionType: 'submenu',
  actionValue: '',
  resultSubmenuId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function makeCtx(data: string) {
  const mocks = {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    reply: vi.fn().mockResolvedValue({ chat: { id: CHAT_ID }, message_id: 900 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  };
  const ctx = {
    callbackQuery: { data, message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID } },
    from: { id: 1234, username: 'tester', first_name: 'Test' },
    ...mocks,
  };
  return { ctx: ctx as unknown as Context, mocks };
}

const rowsOf = (mock: ReturnType<typeof vi.fn>, call = 0): string[][] => {
  const markup = mock.mock.calls[call][1] as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } };
  return markup.reply_markup.inline_keyboard.map(row => row.map(b => b.callback_data));
};

const rootRows: MenuRows = [
  [{ label: 'A', data: 'menu:11' }],
  [{ label: '❌ 닫기', data: 'close' }],
];

describe('callbackQueryHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNavStore();
  });

  describe('menu: submenu tap', () => {
    it('replaces the current menu message instead of sending a new one', async () => {
      vi.mocked(getMenuItemById).mockResolvedValue(
        menuItem({ id: 11, label: '지역 조회', actionType: 'submenu' }),
      );
      vi.mocked(getChildren).mockResolvedValue([
        menuItem({ id: 21, label: '한국', parentId: 11 }),
        menuItem({ id: 22, label: '일본', parentId: 11 }),
        menuItem({ id: 23, label: '미국', parentId: 11 }),
      ]);
      const { ctx, mocks } = makeCtx('menu:11');

      await callbackQueryHandler(ctx);

      expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
      expect(mocks.reply).not.toHaveBeenCalled();
      expect(mocks.editMessageText.mock.calls[0][0]).toBe('지역 조회');
      expect(rowsOf(mocks.editMessageText)).toEqual([
        ['menu:21', 'menu:22'],
        ['menu:23'],
        ['back:11', 'close'],
      ]);
    });

    it('keeps the current screen and alerts when a submenu is empty', async () => {
      vi.mocked(getMenuItemById).mockResolvedValue(menuItem({ id: 11, actionType: 'submenu' }));
      vi.mocked(getChildren).mockResolvedValue([]);
      const { ctx, mocks } = makeCtx('menu:11');

      await callbackQueryHandler(ctx);

      expect(mocks.answerCallbackQuery).toHaveBeenCalledWith('하위 메뉴 항목이 없습니다.');
      expect(mocks.editMessageText).not.toHaveBeenCalled();
      expect(mocks.reply).not.toHaveBeenCalled();
    });
  });

  describe('menu: tool tap', () => {
    it('shows a keyboard-less loading state then the dynamic list in the same message', async () => {
      vi.mocked(getMenuItemById).mockResolvedValue(
        menuItem({ id: 21, label: '한국', actionType: 'tool', actionValue: 'cities_by_country:KR', resultSubmenuId: 10 }),
      );
      vi.mocked(callToolPrompt).mockResolvedValue('- 서울\n- 부산\n- 인천');
      const { ctx, mocks } = makeCtx('menu:21');

      await callbackQueryHandler(ctx);

      expect(mocks.editMessageText).toHaveBeenCalledTimes(2);
      expect(mocks.editMessageText.mock.calls[0]).toEqual(['조회 중...', undefined]);
      expect(rowsOf(mocks.editMessageText, 1)).toEqual([
        ['result:10:서울', 'result:10:부산'],
        ['result:10:인천'],
        ['back:21', 'close'],
      ]);
      expect(mocks.reply).not.toHaveBeenCalled();
    });

    it('closes the menu and answers directly when there is nothing to pick', async () => {
      vi.mocked(getMenuItemById).mockResolvedValue(
        menuItem({ id: 21, actionType: 'tool', actionValue: 'temp_by_region:Seoul', resultSubmenuId: null }),
      );
      vi.mocked(callToolPrompt).mockResolvedValue('서울은 21도입니다.');
      const { ctx, mocks } = makeCtx('menu:21');

      await callbackQueryHandler(ctx);

      expect(mocks.deleteMessage).toHaveBeenCalledTimes(1);
      expect(mocks.reply).toHaveBeenCalledWith('서울은 21도입니다.');
    });

    it('restores the previous menu with an error note when the tool call fails', async () => {
      pushView(CHAT_ID, MESSAGE_ID, { title: '지역 조회', rows: rootRows });
      vi.mocked(getMenuItemById).mockResolvedValue(
        menuItem({ id: 21, actionType: 'tool', actionValue: 'cities_by_country:KR', resultSubmenuId: 10 }),
      );
      vi.mocked(callToolPrompt).mockRejectedValue(new Error('LLM down'));
      const { ctx, mocks } = makeCtx('menu:21');

      await callbackQueryHandler(ctx);

      const lastCall = mocks.editMessageText.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain('조회 중 오류가 발생했습니다');
      expect(String(lastCall?.[0])).toContain('지역 조회');
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
    });
  });

  describe('result: tap', () => {
    it('swaps the dynamic list for the action submenu in place', async () => {
      vi.mocked(getChildren).mockResolvedValue([
        menuItem({ id: 31, label: '🌡 기온 조회', parentId: 10 }),
        menuItem({ id: 32, label: '🕐 시간 조회', parentId: 10 }),
      ]);
      const { ctx, mocks } = makeCtx('result:10:서울');

      await callbackQueryHandler(ctx);

      expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
      expect(rowsOf(mocks.editMessageText)).toEqual([
        ['action:31:서울', 'action:32:서울'],
        ['back:10', 'close'],
      ]);
      expect(processMessage).not.toHaveBeenCalled();
    });
  });

  describe('final actions', () => {
    it('closes the menu before answering an action tap', async () => {
      vi.mocked(getMenuItemById).mockResolvedValue(
        menuItem({ id: 31, actionType: 'action', actionValue: '{value}의 현재 기온을 알려줘' }),
      );
      const { ctx, mocks } = makeCtx('action:31:서울');

      await callbackQueryHandler(ctx);

      expect(mocks.deleteMessage).toHaveBeenCalledTimes(1);
      expect(processMessage).toHaveBeenCalledWith(ctx, '서울의 현재 기온을 알려줘');
      expect(mocks.editMessageText).not.toHaveBeenCalled();
    });

    it('closes the menu before answering a prompt item', async () => {
      vi.mocked(getMenuItemById).mockResolvedValue(
        menuItem({ id: 41, actionType: 'prompt', actionValue: '오늘 날씨 알려줘' }),
      );
      const { ctx, mocks } = makeCtx('menu:41');

      await callbackQueryHandler(ctx);

      expect(mocks.deleteMessage).toHaveBeenCalledTimes(1);
      expect(processMessage).toHaveBeenCalledWith(ctx, '오늘 날씨 알려줘');
    });

    it('closes the menu on a legacy menu tap', async () => {
      const { ctx, mocks } = makeCtx('legacy_menu:legacy1');

      await callbackQueryHandler(ctx);

      expect(mocks.deleteMessage).toHaveBeenCalledTimes(1);
      expect(processMessage).toHaveBeenCalledWith(ctx, '레거시 프롬프트');
    });
  });

  describe('close tap', () => {
    it('removes the menu message and its navigation state', async () => {
      pushView(CHAT_ID, MESSAGE_ID, { title: '지역 조회', rows: rootRows });
      const { ctx, mocks } = makeCtx('close');

      await callbackQueryHandler(ctx);

      expect(mocks.deleteMessage).toHaveBeenCalledTimes(1);
      expect(peekView(CHAT_ID, MESSAGE_ID)).toBeUndefined();
      expect(processMessage).not.toHaveBeenCalled();
    });
  });

  describe('back tap', () => {
    it('restores the stored previous screen without calling the LLM again', async () => {
      pushView(CHAT_ID, MESSAGE_ID, { title: '원하는 항목을 선택하세요:', rows: rootRows });
      pushView(CHAT_ID, MESSAGE_ID, {
        title: '- 서울\n- 부산',
        rows: [
          [{ label: '서울', data: 'result:10:서울' }],
          [{ label: '⬅️ 이전', data: 'back:21' }],
        ],
      });
      const { ctx, mocks } = makeCtx('back:21');

      await callbackQueryHandler(ctx);

      expect(mocks.editMessageText.mock.calls[0][0]).toBe('원하는 항목을 선택하세요:');
      expect(rowsOf(mocks.editMessageText)).toEqual([['menu:11'], ['close']]);
      expect(callToolPrompt).not.toHaveBeenCalled();
      expect(getMenuItemById).not.toHaveBeenCalled();
      expect(peekView(CHAT_ID, MESSAGE_ID)?.title).toBe('원하는 항목을 선택하세요:');
    });

    it('rebuilds the parent submenu from the DB when the stack is gone', async () => {
      vi.mocked(getMenuItemById).mockImplementation(async (id: number) =>
        id === 21 ? menuItem({ id: 21, label: '한국', parentId: 11 }) : menuItem({ id: 11, label: '지역 조회' }),
      );
      vi.mocked(getChildren).mockResolvedValue([menuItem({ id: 21, label: '한국', parentId: 11 })]);
      const { ctx, mocks } = makeCtx('back:21');

      await callbackQueryHandler(ctx);

      expect(mocks.editMessageText.mock.calls[0][0]).toBe('지역 조회');
      expect(rowsOf(mocks.editMessageText)).toEqual([['menu:21'], ['back:11', 'close']]);
      expect(callToolPrompt).not.toHaveBeenCalled();
    });

    it('falls back to the root menu when the item has no parent', async () => {
      vi.mocked(getMenuItemById).mockResolvedValue(menuItem({ id: 11, parentId: null }));
      vi.mocked(getRootMenuItems).mockResolvedValue([menuItem({ id: 11, label: '지역 조회' })]);
      const { ctx, mocks } = makeCtx('back:11');

      await callbackQueryHandler(ctx);

      expect(mocks.editMessageText.mock.calls[0][0]).toBe('원하는 항목을 선택하세요:');
      expect(rowsOf(mocks.editMessageText)).toEqual([['menu:11'], ['close']]);
    });
  });
});
