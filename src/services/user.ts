import { prisma } from '../db/client.js';
import type { User } from '@prisma/client';

export async function getOrCreateUser(
  telegramId: bigint,
  username?: string,
  firstName?: string,
): Promise<User> {
  return prisma.user.upsert({
    where: { telegramId },
    update: { username: username ?? null, firstName: firstName ?? null },
    create: { telegramId, username: username ?? null, firstName: firstName ?? null, isAllowed: false },
  });
}

export async function isUserAllowed(telegramId: bigint): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { isAllowed: true },
  });
  return user?.isAllowed ?? false;
}
