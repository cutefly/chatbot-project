import type { Context, NextFunction } from 'grammy';
import { getOrCreateUser, isUserAllowed } from '../../services/user.js';

export async function whitelistMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('사용자 정보를 확인할 수 없습니다.');
    return;
  }

  const telegramId = BigInt(from.id);
  await getOrCreateUser(telegramId, from.username, from.first_name);

  const allowed = await isUserAllowed(telegramId);
  if (!allowed) {
    await ctx.reply('접근 권한이 없습니다. 관리자에게 문의하세요.');
    return;
  }

  await next();
}
