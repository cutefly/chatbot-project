import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from 'grammy';
import {
  clearNav,
  closeMenu,
  navSessionCount,
  navTargetOf,
  peekView,
  popView,
  pushView,
  resetNavStore,
  restoreView,
  sendView,
  showStatus,
  showView,
  toInlineKeyboard,
  type ViewSnapshot,
} from '../../src/bot/handlers/menuNav.js';

const CHAT_ID = 7;
const MESSAGE_ID = 100;

const view = (title: string): ViewSnapshot => ({
  title,
  rows: [[{ label: title, data: `menu:${title}` }], [{ label: '❌ 닫기', data: 'close' }]],
});

function makeCtx(overrides: Record<string, unknown> = {}) {
  const mocks = {
    editMessageText: vi.fn().mockResolvedValue(true),
    reply: vi.fn().mockResolvedValue({ chat: { id: CHAT_ID }, message_id: 555 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
  };
  const ctx = {
    callbackQuery: { data: 'x', message: { chat: { id: CHAT_ID }, message_id: MESSAGE_ID } },
    ...mocks,
    ...overrides,
  };
  return { ctx: ctx as unknown as Context, mocks };
}

describe('menuNav store', () => {
  beforeEach(() => {
    resetNavStore();
    vi.clearAllMocks();
  });

  it('pushes and peeks the current view', () => {
    pushView(CHAT_ID, MESSAGE_ID, view('root'));
    pushView(CHAT_ID, MESSAGE_ID, view('sub'));

    expect(peekView(CHAT_ID, MESSAGE_ID)?.title).toBe('sub');
  });

  it('pops the current view and returns the previous one', () => {
    pushView(CHAT_ID, MESSAGE_ID, view('root'));
    pushView(CHAT_ID, MESSAGE_ID, view('sub'));

    expect(popView(CHAT_ID, MESSAGE_ID)?.title).toBe('root');
    expect(peekView(CHAT_ID, MESSAGE_ID)?.title).toBe('root');
  });

  it('drops the session when popping past the root view', () => {
    pushView(CHAT_ID, MESSAGE_ID, view('root'));

    expect(popView(CHAT_ID, MESSAGE_ID)).toBeUndefined();
    expect(navSessionCount()).toBe(0);
  });

  it('returns undefined when the session is unknown', () => {
    expect(popView(CHAT_ID, 999)).toBeUndefined();
    expect(peekView(CHAT_ID, 999)).toBeUndefined();
  });

  it('clears a session', () => {
    pushView(CHAT_ID, MESSAGE_ID, view('root'));
    clearNav(CHAT_ID, MESSAGE_ID);

    expect(peekView(CHAT_ID, MESSAGE_ID)).toBeUndefined();
  });

  it('caps the number of tracked sessions', () => {
    for (let i = 0; i < 520; i++) pushView(CHAT_ID, i, view(`v${i}`));

    expect(navSessionCount()).toBe(500);
    expect(peekView(CHAT_ID, 0)).toBeUndefined();
    expect(peekView(CHAT_ID, 519)?.title).toBe('v519');
  });

  it('expires sessions older than the TTL', () => {
    vi.useFakeTimers();
    try {
      pushView(CHAT_ID, MESSAGE_ID, view('root'));
      vi.advanceTimersByTime(31 * 60 * 1000);
      pushView(CHAT_ID, 101, view('other'));

      expect(peekView(CHAT_ID, MESSAGE_ID)).toBeUndefined();
      expect(peekView(CHAT_ID, 101)?.title).toBe('other');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('toInlineKeyboard', () => {
  it('maps rows one-to-one without a trailing empty row', () => {
    const keyboard = toInlineKeyboard([
      [
        { label: 'A', data: 'menu:1' },
        { label: 'B', data: 'menu:2' },
      ],
      [{ label: '❌ 닫기', data: 'close' }],
    ]);

    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: 'A', callback_data: 'menu:1' },
        { text: 'B', callback_data: 'menu:2' },
      ],
      [{ text: '❌ 닫기', callback_data: 'close' }],
    ]);
  });
});

describe('menuNav rendering', () => {
  beforeEach(() => {
    resetNavStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetNavStore();
  });

  it('navTargetOf reads the tapped message', () => {
    const { ctx } = makeCtx();
    expect(navTargetOf(ctx)).toEqual({ chatId: CHAT_ID, messageId: MESSAGE_ID });
  });

  it('showView edits the menu message in place and stacks the view', async () => {
    const { ctx, mocks } = makeCtx();

    await showView(ctx, view('sub'));

    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    expect(mocks.reply).not.toHaveBeenCalled();
    expect(peekView(CHAT_ID, MESSAGE_ID)?.title).toBe('sub');
  });

  it('showView falls back to a new message when the edit fails', async () => {
    const { ctx, mocks } = makeCtx({
      editMessageText: vi.fn().mockRejectedValue(new Error('message to edit not found')),
    });

    await showView(ctx, view('sub'));

    expect(mocks.reply).toHaveBeenCalledTimes(1);
    expect(peekView(CHAT_ID, 555)?.title).toBe('sub');
  });

  it('showView treats an unmodified edit as success', async () => {
    const { ctx, mocks } = makeCtx({
      editMessageText: vi
        .fn()
        .mockRejectedValue(new Error('Bad Request: message is not modified')),
    });

    await showView(ctx, view('sub'));

    expect(mocks.reply).not.toHaveBeenCalled();
    expect(peekView(CHAT_ID, MESSAGE_ID)?.title).toBe('sub');
  });

  it('restoreView re-renders without stacking another entry', async () => {
    pushView(CHAT_ID, MESSAGE_ID, view('root'));
    const { ctx, mocks } = makeCtx();

    await restoreView(ctx, view('root'));

    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    expect(popView(CHAT_ID, MESSAGE_ID)).toBeUndefined();
  });

  it('showStatus edits without a keyboard', async () => {
    const { ctx, mocks } = makeCtx();

    await showStatus(ctx, '조회 중...');

    expect(mocks.editMessageText).toHaveBeenCalledWith('조회 중...', undefined);
  });

  it('sendView sends a new message and stacks it under the new message id', async () => {
    const { ctx, mocks } = makeCtx();

    await sendView(ctx, view('root'));

    expect(mocks.reply).toHaveBeenCalledTimes(1);
    expect(peekView(CHAT_ID, 555)?.title).toBe('root');
  });

  it('closeMenu deletes the message and forgets the session', async () => {
    pushView(CHAT_ID, MESSAGE_ID, view('root'));
    const { ctx, mocks } = makeCtx();

    await closeMenu(ctx);

    expect(mocks.deleteMessage).toHaveBeenCalledTimes(1);
    expect(peekView(CHAT_ID, MESSAGE_ID)).toBeUndefined();
  });

  it('closeMenu strips the keyboard when the message cannot be deleted', async () => {
    const { ctx, mocks } = makeCtx({
      deleteMessage: vi.fn().mockRejectedValue(new Error('message can not be deleted')),
    });

    await closeMenu(ctx);

    expect(mocks.editMessageReplyMarkup).toHaveBeenCalledTimes(1);
  });
});
