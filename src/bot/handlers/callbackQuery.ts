import type { Context } from 'grammy';
import { menuConfig } from '../../config/index.js';
import { processMessage } from './message.js';
import { getMenuItemById, getChildren, getRootMenuItems } from '../../services/menu.js';
import { logger } from '../../logger.js';
import type { MenuItem } from '../../services/menu.js';
import {
  parseListFromLLMResponse,
  buildDynamicRows,
  buildActionRows,
  buildRootView,
  buildSubmenuView,
  hasMenuButtons,
  callToolPrompt,
} from './menuHelpers.js';
import {
  closeMenu,
  navTargetOf,
  peekView,
  popView,
  restoreView,
  showStatus,
  showView,
} from './menuNav.js';

const LOADING_NOTICE = '조회 중...';
const TOOL_ERROR_NOTICE = '⚠️ 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
const EXPIRED_NOTICE = '메뉴가 만료되었습니다. /menu 로 다시 시작해주세요.';

/** Telegram rejects stale/duplicate query ids — a failed ack must not abort the navigation. */
async function ack(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text);
  } catch (error) {
    logger.warn(`Callback ack failed`, { error: String(error) });
  }
}

export async function callbackQueryHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const userId = ctx.from?.id;
  const userTag = ctx.from?.username ? `@${ctx.from.username}` : `id:${userId}`;

  try {
    if (data.startsWith('menu:')) {
      logger.info(`Menu tap`, { user: userTag, data });
      await handleMenuTap(ctx, data.slice(5));
      return;
    }

    if (data.startsWith('result:')) {
      logger.info(`Result tap`, { user: userTag, data });
      await handleResultTap(ctx, data.slice(7));
      return;
    }

    if (data.startsWith('action:')) {
      logger.info(`Action tap`, { user: userTag, data });
      await handleActionTap(ctx, data.slice(7));
      return;
    }

    if (data.startsWith('back:')) {
      logger.info(`Back tap`, { user: userTag, data });
      await handleBackTap(ctx, data.slice(5));
      return;
    }

    if (data === 'close') {
      logger.info(`Close tap`, { user: userTag });
      await ack(ctx);
      await closeMenu(ctx);
      return;
    }

    if (data.startsWith('legacy_menu:')) {
      logger.info(`Legacy menu tap`, { user: userTag, data });
      await handleLegacyMenu(ctx, data.slice(12));
      return;
    }

    await ack(ctx);
  } catch (error) {
    logger.error(`Callback query failed`, { user: userTag, data, error: String(error) });
    await ctx.reply('잠시 후 다시 시도해주세요. 🙏').catch(() => undefined);
  }
}

async function handleMenuTap(ctx: Context, idStr: string): Promise<void> {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    await ack(ctx, '잘못된 메뉴 항목입니다.');
    return;
  }

  const item = await getMenuItemById(id);
  if (!item) {
    await ack(ctx, '항목을 찾을 수 없습니다.');
    return;
  }

  switch (item.actionType) {
    case 'submenu': {
      const children = await getChildren(id);
      if (children.length === 0) {
        await ack(ctx, '하위 메뉴 항목이 없습니다.');
        return;
      }
      await ack(ctx);
      await showView(ctx, buildSubmenuView(item, children));
      return;
    }

    case 'tool': {
      await ack(ctx);
      await handleToolItem(ctx, item);
      return;
    }

    case 'prompt': {
      await ack(ctx);
      await closeMenu(ctx);
      await processMessage(ctx, item.actionValue);
      return;
    }

    default:
      await ack(ctx, '알 수 없는 메뉴 액션입니다.');
  }
}

async function handleToolItem(ctx: Context, item: MenuItem): Promise<void> {
  const [toolName, ...argParts] = item.actionValue.split(':');
  const toolArg = argParts.join(':');
  const prompt = toolArg
    ? `${toolName.replace(/_/g, ' ')} 도구로 ${toolArg}를 조회해줘`
    : item.actionValue;

  await showStatus(ctx, LOADING_NOTICE);

  try {
    const response = await callToolPrompt(ctx, prompt);
    const listItems = parseListFromLLMResponse(response);
    const rows =
      item.resultSubmenuId !== null
        ? buildDynamicRows(listItems, item.resultSubmenuId, item.id)
        : null;

    if (rows && hasMenuButtons(rows)) {
      logger.info(`Dynamic menu rendered`, {
        item: item.actionValue,
        options: rows.slice(0, -1).flat().map(button => button.label),
      });
      await showView(ctx, { title: response, rows });
      return;
    }

    // Nothing left to pick — this is the final answer, so the menu closes.
    await closeMenu(ctx);
    await ctx.reply(response);
  } catch (error) {
    logger.error(`Menu tool call failed`, { item: item.actionValue, error: String(error) });
    await recoverFromToolError(ctx);
  }
}

/** Puts the previous menu back on screen (with an error note) so the user can retry. */
async function recoverFromToolError(ctx: Context): Promise<void> {
  const target = navTargetOf(ctx);
  const previous = target ? peekView(target.chatId, target.messageId) : undefined;

  if (previous) {
    await restoreView(ctx, {
      title: `${TOOL_ERROR_NOTICE}\n\n${previous.title}`,
      rows: previous.rows,
    });
    return;
  }

  await closeMenu(ctx);
  await ctx.reply(TOOL_ERROR_NOTICE);
}

async function handleResultTap(ctx: Context, payload: string): Promise<void> {
  const colonIdx = payload.indexOf(':');
  if (colonIdx === -1) {
    await ack(ctx);
    return;
  }

  const submenuId = parseInt(payload.slice(0, colonIdx), 10);
  const value = payload.slice(colonIdx + 1);

  if (isNaN(submenuId) || !value) {
    await ack(ctx, '잘못된 항목입니다.');
    return;
  }

  const children = await getChildren(submenuId);
  const rows = children.length > 0 ? buildActionRows(children, value, submenuId) : null;

  await ack(ctx);

  if (rows && hasMenuButtons(rows)) {
    await showView(ctx, { title: `"${value}" — 어떤 정보를 조회할까요?`, rows });
    return;
  }

  await closeMenu(ctx);
  await processMessage(ctx, `${value}에 대해 알려줘`);
}

async function handleActionTap(ctx: Context, payload: string): Promise<void> {
  const colonIdx = payload.indexOf(':');
  if (colonIdx === -1) {
    await ack(ctx);
    return;
  }

  const menuItemId = parseInt(payload.slice(0, colonIdx), 10);
  const value = payload.slice(colonIdx + 1);

  if (isNaN(menuItemId) || !value) {
    await ack(ctx, '잘못된 항목입니다.');
    return;
  }

  const item = await getMenuItemById(menuItemId);
  if (!item) {
    await ack(ctx, '항목을 찾을 수 없습니다.');
    return;
  }

  await ack(ctx);
  // Final step: the menu closes and only the answer remains.
  await closeMenu(ctx);
  await processMessage(ctx, item.actionValue.replace(/\{value\}/g, value));
}

async function handleBackTap(ctx: Context, idStr: string): Promise<void> {
  const target = navTargetOf(ctx);
  const previous = target ? popView(target.chatId, target.messageId) : undefined;

  await ack(ctx);

  if (previous) {
    await restoreView(ctx, previous);
    return;
  }

  await rebuildParentView(ctx, parseInt(idStr, 10));
}

/**
 * Fallback for when the snapshot stack is gone (bot restart / expired session):
 * re-render the nearest static ancestor from the DB — never re-calls the LLM.
 */
async function rebuildParentView(ctx: Context, itemId: number): Promise<void> {
  const item = isNaN(itemId) ? null : await getMenuItemById(itemId);

  if (item?.parentId != null) {
    const [parent, children] = await Promise.all([
      getMenuItemById(item.parentId),
      getChildren(item.parentId),
    ]);
    if (parent && children.length > 0) {
      await showView(ctx, buildSubmenuView(parent, children));
      return;
    }
  }

  const roots = await getRootMenuItems();
  if (roots.length > 0) {
    await showView(ctx, buildRootView(roots));
    return;
  }

  await closeMenu(ctx);
  await ctx.reply(EXPIRED_NOTICE);
}

async function handleLegacyMenu(ctx: Context, itemId: string): Promise<void> {
  const item = menuConfig.items.find(i => i.id === itemId);
  if (!item) {
    await ack(ctx, '항목을 찾을 수 없습니다.');
    return;
  }
  await ack(ctx);
  await closeMenu(ctx);
  await processMessage(ctx, item.prompt);
}
