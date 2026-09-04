import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { logger } from '../../logger.js';

export interface MenuButton {
  label: string;
  data: string;
}

/** Rendered keyboard layout: outer array = rows, inner = buttons in that row. */
export type MenuRows = MenuButton[][];

/**
 * A fully rendered menu screen. Stored as-is so going back restores the exact
 * same text and buttons — including LLM-generated lists — without re-calling
 * the LLM.
 */
export interface ViewSnapshot {
  title: string;
  rows: MenuRows;
}

export interface NavTarget {
  chatId: number;
  messageId: number;
}

const MAX_SESSIONS = 500;
const SESSION_TTL_MS = 30 * 60 * 1000;

interface NavSession {
  stack: ViewSnapshot[];
  touchedAt: number;
}

/**
 * Navigation stacks keyed by the menu message they belong to. The menu lives in
 * one message that is edited in place, so `chatId:messageId` stays stable for
 * the whole navigation session.
 */
const sessions = new Map<string, NavSession>();

function keyOf(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

/** Re-inserts the session so Map insertion order doubles as LRU order. */
function touch(key: string, session: NavSession): void {
  session.touchedAt = Date.now();
  sessions.delete(key);
  sessions.set(key, session);
}

function evict(): void {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.touchedAt > SESSION_TTL_MS) sessions.delete(key);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done) break;
    sessions.delete(oldest.value);
  }
}

export function pushView(chatId: number, messageId: number, view: ViewSnapshot): void {
  const key = keyOf(chatId, messageId);
  const session = sessions.get(key) ?? { stack: [], touchedAt: Date.now() };
  session.stack.push(view);
  touch(key, session);
  evict();
}

/** Drops the current view and returns the one to display, or undefined if none is left. */
export function popView(chatId: number, messageId: number): ViewSnapshot | undefined {
  const key = keyOf(chatId, messageId);
  const session = sessions.get(key);
  if (!session) return undefined;

  session.stack.pop();
  const previous = session.stack[session.stack.length - 1];
  if (!previous) {
    sessions.delete(key);
    return undefined;
  }
  touch(key, session);
  return previous;
}

export function peekView(chatId: number, messageId: number): ViewSnapshot | undefined {
  const session = sessions.get(keyOf(chatId, messageId));
  return session?.stack[session.stack.length - 1];
}

export function clearNav(chatId: number, messageId: number): void {
  sessions.delete(keyOf(chatId, messageId));
}

/** Test-only: inspect/reset the in-memory store. */
export function navSessionCount(): number {
  return sessions.size;
}

export function resetNavStore(): void {
  sessions.clear();
}

export function navTargetOf(ctx: Context): NavTarget | undefined {
  const message = ctx.callbackQuery?.message;
  if (!message) return undefined;
  return { chatId: message.chat.id, messageId: message.message_id };
}

export function toInlineKeyboard(rows: MenuRows): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  rows.forEach((row, index) => {
    if (index > 0) keyboard.row();
    for (const button of row) keyboard.text(button.label, button.data);
  });
  return keyboard;
}

/** Edits the menu message in place. Returns false when the edit could not be applied. */
async function editMenuMessage(ctx: Context, text: string, rows?: MenuRows): Promise<boolean> {
  try {
    await ctx.editMessageText(
      text,
      rows ? { reply_markup: toInlineKeyboard(rows) } : undefined,
    );
    return true;
  } catch (error) {
    const detail = String(error);
    // Telegram rejects a no-op edit; the screen already shows what we wanted.
    if (detail.includes('message is not modified')) return true;
    logger.warn('Menu message edit failed', { error: detail });
    return false;
  }
}

/** Sends a brand new menu message and starts a fresh navigation stack for it. */
export async function sendView(ctx: Context, view: ViewSnapshot): Promise<void> {
  const sent = await ctx.reply(view.title, { reply_markup: toInlineKeyboard(view.rows) });
  logger.info('Menu message opened', { chatId: sent.chat.id, messageId: sent.message_id });
  pushView(sent.chat.id, sent.message_id, view);
}

/** Forward navigation: replaces the current screen and remembers it for `이전`. */
export async function showView(ctx: Context, view: ViewSnapshot): Promise<void> {
  const target = navTargetOf(ctx);
  if (target && (await editMenuMessage(ctx, view.title, view.rows))) {
    pushView(target.chatId, target.messageId, view);
    return;
  }
  await sendView(ctx, view);
}

/** Backward navigation: re-renders a snapshot already on the stack. */
export async function restoreView(ctx: Context, view: ViewSnapshot): Promise<void> {
  if (await editMenuMessage(ctx, view.title, view.rows)) return;
  await sendView(ctx, view);
}

/** Interim state (e.g. `조회 중...`) — drops the keyboard so buttons can't be re-tapped. */
export async function showStatus(ctx: Context, text: string): Promise<void> {
  await editMenuMessage(ctx, text);
}

/** Removes the menu from the screen and forgets its navigation stack. */
export async function closeMenu(ctx: Context): Promise<void> {
  const target = navTargetOf(ctx);
  if (target) clearNav(target.chatId, target.messageId);

  try {
    await ctx.deleteMessage();
  } catch (error) {
    logger.warn('Menu delete failed; stripping keyboard instead', { error: String(error) });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  }
}
