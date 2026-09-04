import { chat } from '../../services/llm.js';
import { getOrCreateUser } from '../../services/user.js';
import { getOrCreateActive, getWindow } from '../../services/conversation.js';
import type { Context } from 'grammy';
import type { Role } from '@prisma/client';
import type { MenuButton, MenuRows, ViewSnapshot } from './menuNav.js';

export const BACK_LABEL = '⬅️ 이전';
export const CLOSE_LABEL = '❌ 닫기';
export const CLOSE_DATA = 'close';
export const ROOT_TITLE = '원하는 항목을 선택하세요:';

const ITEMS_PER_ROW = 2;
const MAX_DYNAMIC_ITEMS = 10;
const MAX_CALLBACK_DATA_BYTES = 64;

/** Minimal shape of a MenuItem needed to render a button. */
export interface MenuItemButton {
  id: number;
  label: string;
}

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

/** Telegram hard-rejects callback_data over 64 bytes, so oversized buttons are dropped. */
function fitsCallbackLimit(button: MenuButton): boolean {
  return Buffer.byteLength(button.data, 'utf8') <= MAX_CALLBACK_DATA_BYTES;
}

export function chunkIntoRows(buttons: MenuButton[], perRow = ITEMS_PER_ROW): MenuRows {
  const rows: MenuRows = [];
  for (let i = 0; i < buttons.length; i += perRow) {
    rows.push(buttons.slice(i, i + perRow));
  }
  return rows;
}

/** Root screens get `닫기` only; every deeper screen gets `이전` + `닫기`. */
export function buildControlRow(backId: number | null): MenuButton[] {
  const row: MenuButton[] = [];
  if (backId !== null) row.push({ label: BACK_LABEL, data: `back:${backId}` });
  row.push({ label: CLOSE_LABEL, data: CLOSE_DATA });
  return row;
}

/** Menu items 2 per row, control buttons alone on the bottom row. */
export function withControlRow(buttons: MenuButton[], backId: number | null): MenuRows {
  return [...chunkIntoRows(buttons), buildControlRow(backId)];
}

/** False when only the control row survived (nothing left to pick). */
export function hasMenuButtons(rows: MenuRows): boolean {
  return rows.length > 1;
}

export function buildRootView(items: MenuItemButton[]): ViewSnapshot {
  const buttons = items.map(item => ({ label: item.label, data: `menu:${item.id}` }));
  return { title: ROOT_TITLE, rows: withControlRow(buttons, null) };
}

export function buildSubmenuView(
  parent: MenuItemButton,
  children: MenuItemButton[],
): ViewSnapshot {
  const buttons = children.map(child => ({ label: child.label, data: `menu:${child.id}` }));
  return { title: parent.label, rows: withControlRow(buttons, parent.id) };
}

export function buildDynamicRows(
  items: string[],
  resultSubmenuId: number,
  backId: number,
): MenuRows {
  const buttons = items
    .slice(0, MAX_DYNAMIC_ITEMS)
    .map(item => ({ label: item, data: `result:${resultSubmenuId}:${item}` }))
    .filter(fitsCallbackLimit);
  return withControlRow(buttons, backId);
}

export function buildActionRows(
  children: MenuItemButton[],
  value: string,
  backId: number,
): MenuRows {
  const buttons = children
    .map(child => ({ label: child.label, data: `action:${child.id}:${value}` }))
    .filter(fitsCallbackLimit);
  return withControlRow(buttons, backId);
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
