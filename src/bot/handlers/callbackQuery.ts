import type { Context } from 'grammy';
import { menuConfig } from '../../config/index.js';
import { processMessage } from './message.js';
import { getMenuItemById, getChildren } from '../../services/menu.js';
import {
  parseListFromLLMResponse,
  buildDynamicKeyboard,
  buildActionKeyboard,
  callToolPrompt,
} from './menuHelpers.js';

export async function callbackQueryHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  if (data.startsWith('menu:')) {
    await handleMenuTap(ctx, data.slice(5));
    return;
  }

  if (data.startsWith('result:')) {
    await handleResultTap(ctx, data.slice(7));
    return;
  }

  if (data.startsWith('action:')) {
    await handleActionTap(ctx, data.slice(7));
    return;
  }

  if (data.startsWith('legacy_menu:')) {
    await handleLegacyMenu(ctx, data.slice(12));
    return;
  }

  await ctx.answerCallbackQuery();
}

async function handleMenuTap(ctx: Context, idStr: string): Promise<void> {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    await ctx.answerCallbackQuery('잘못된 메뉴 항목입니다.');
    return;
  }

  const item = await getMenuItemById(id);
  if (!item) {
    await ctx.answerCallbackQuery('항목을 찾을 수 없습니다.');
    return;
  }

  await ctx.answerCallbackQuery();

  switch (item.actionType) {
    case 'submenu': {
      const children = await getChildren(id);
      if (children.length === 0) {
        await ctx.reply('하위 메뉴 항목이 없습니다.');
        return;
      }
      const { InlineKeyboard } = await import('grammy');
      const keyboard = new InlineKeyboard();
      for (const child of children) {
        keyboard.text(child.label, `menu:${child.id}`).row();
      }
      await ctx.reply(`${item.label}`, { reply_markup: keyboard });
      return;
    }

    case 'tool': {
      const [toolName, ...argParts] = item.actionValue.split(':');
      const toolArg = argParts.join(':');
      const prompt = toolArg
        ? `${toolName.replace(/_/g, ' ')} 도구로 ${toolArg}를 조회해줘`
        : item.actionValue;

      await ctx.reply('조회 중...');
      try {
        const response = await callToolPrompt(ctx, prompt);
        const listItems = parseListFromLLMResponse(response);

        if (listItems.length > 0 && item.resultSubmenuId) {
          const keyboard = buildDynamicKeyboard(listItems, item.resultSubmenuId);
          await ctx.reply(response, { reply_markup: keyboard });
        } else {
          await ctx.reply(response);
        }
      } catch {
        await ctx.reply('조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
      return;
    }

    case 'prompt': {
      await processMessage(ctx, item.actionValue);
      return;
    }

    default:
      await ctx.reply('알 수 없는 메뉴 액션입니다.');
  }
}

async function handleResultTap(ctx: Context, payload: string): Promise<void> {
  const colonIdx = payload.indexOf(':');
  if (colonIdx === -1) {
    await ctx.answerCallbackQuery();
    return;
  }

  const submenuId = parseInt(payload.slice(0, colonIdx), 10);
  const value = payload.slice(colonIdx + 1);

  if (isNaN(submenuId) || !value) {
    await ctx.answerCallbackQuery('잘못된 항목입니다.');
    return;
  }

  const children = await getChildren(submenuId);
  if (children.length === 0) {
    await ctx.answerCallbackQuery();
    await processMessage(ctx, `${value}에 대해 알려줘`);
    return;
  }

  await ctx.answerCallbackQuery();
  const keyboard = buildActionKeyboard(children, value);
  await ctx.reply(`"${value}" — 어떤 정보를 조회할까요?`, { reply_markup: keyboard });
}

async function handleActionTap(ctx: Context, payload: string): Promise<void> {
  const colonIdx = payload.indexOf(':');
  if (colonIdx === -1) {
    await ctx.answerCallbackQuery();
    return;
  }

  const menuItemId = parseInt(payload.slice(0, colonIdx), 10);
  const value = payload.slice(colonIdx + 1);

  if (isNaN(menuItemId) || !value) {
    await ctx.answerCallbackQuery('잘못된 항목입니다.');
    return;
  }

  const item = await getMenuItemById(menuItemId);
  if (!item) {
    await ctx.answerCallbackQuery('항목을 찾을 수 없습니다.');
    return;
  }

  await ctx.answerCallbackQuery();
  const prompt = item.actionValue.replace(/\{value\}/g, value);
  await processMessage(ctx, prompt);
}

async function handleLegacyMenu(ctx: Context, itemId: string): Promise<void> {
  const item = menuConfig.items.find(i => i.id === itemId);
  if (!item) {
    await ctx.answerCallbackQuery('항목을 찾을 수 없습니다.');
    return;
  }
  await ctx.answerCallbackQuery();
  await processMessage(ctx, item.prompt);
}
