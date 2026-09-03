import type { Context, NextFunction } from 'grammy';
import { getOrCreateUser, isUserAllowed } from '../../services/user.js';
import { logger } from '../../logger.js';

export async function whitelistMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('사용자 정보를 확인할 수 없습니다.');
    return;
  }

  const telegramId = BigInt(from.id);
  let allowed: boolean;
  try {
    await getOrCreateUser(telegramId, from.username, from.first_name);
    allowed = await isUserAllowed(telegramId);
  } catch (error) {
    // Updates are acked before processing, so nothing retries this failure.
    logger.error(`Whitelist check failed`, { user: `id:${from.id}`, error: String(error) });
    await ctx.reply('잠시 후 다시 시도해주세요. 🙏').catch(() => undefined);
    return;
  }

  if (!allowed) {
    await ctx.reply('접근 권한이 없습니다. 관리자에게 문의하세요.');
    return;
  }

  await next();
}
