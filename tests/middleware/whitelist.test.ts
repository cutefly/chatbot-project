import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/user.js', () => ({
  getOrCreateUser: vi.fn().mockResolvedValue({ id: 1 }),
  isUserAllowed: vi.fn(),
}));

import { whitelistMiddleware } from '../../src/bot/middleware/whitelist.js';
import { isUserAllowed, getOrCreateUser } from '../../src/services/user.js';

function makeCtx(userId: number | undefined) {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    from: userId
      ? { id: userId, username: 'testuser', first_name: 'Test' }
      : undefined,
    reply,
  } as any;
}

describe('WhitelistMiddleware', () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  it('calls next() when user is allowed', async () => {
    vi.mocked(isUserAllowed).mockResolvedValue(true);
    await whitelistMiddleware(makeCtx(123), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('does NOT call next() when user is not allowed', async () => {
    vi.mocked(isUserAllowed).mockResolvedValue(false);
    const ctx = makeCtx(456);
    await whitelistMiddleware(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('접근 권한이 없습니다'));
  });

  it('does NOT call next() when ctx.from is missing', async () => {
    const ctx = makeCtx(undefined);
    await whitelistMiddleware(ctx, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls getOrCreateUser to ensure user record exists', async () => {
    vi.mocked(isUserAllowed).mockResolvedValue(true);
    await whitelistMiddleware(makeCtx(789), next);
    expect(getOrCreateUser).toHaveBeenCalledWith(BigInt(789), 'testuser', 'Test');
  });
});
