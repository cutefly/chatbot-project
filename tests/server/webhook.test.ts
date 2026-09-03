import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: { TELEGRAM_WEBHOOK_SECRET: 'test-secret' },
}));
vi.mock('../../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createServer } from '../../src/server/index.js';
import type { Bot } from 'grammy';
import { logger } from '../../src/logger.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(res => setImmediate(res));

const makeUpdate = (id: number) => ({
  update_id: id,
  message: { message_id: 1, date: 1750000000, chat: { id: 1, type: 'private' }, text: 'hi' },
});

describe('POST /webhook (ack-first)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('S1: returns 200 with an empty body before update processing completes', async () => {
    const gate = deferred<void>();
    const handleUpdate = vi.fn(() => gate.promise);
    const fakeBot = { handleUpdate } as unknown as Bot;
    const app = await createServer(fakeBot);

    let settled = false;
    void gate.promise.then(() => {
      settled = true;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
      payload: makeUpdate(1),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(handleUpdate).toHaveBeenCalledTimes(1);

    await flush();
    expect(settled).toBe(false);

    gate.resolve();
    await flush();
  });

  it('S2: drops a duplicate update_id without running the pipeline twice', async () => {
    const gate = deferred<void>();
    const handleUpdate = vi.fn(() => gate.promise);
    const fakeBot = { handleUpdate } as unknown as Bot;
    const app = await createServer(fakeBot);

    const res1 = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
      payload: makeUpdate(42),
    });
    const res2 = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
      payload: makeUpdate(42),
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(handleUpdate).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Duplicate webhook update dropped',
      expect.objectContaining({ updateId: 42, type: 'message' }),
    );

    gate.resolve();
    await flush();
  });

  it('S3: does not crash the process when the detached pipeline rejects', async () => {
    const handleUpdate = vi.fn(() => Promise.reject(new Error('boom')));
    const fakeBot = { handleUpdate } as unknown as Bot;
    const app = await createServer(fakeBot);

    const onUnhandled = vi.fn();
    process.once('unhandledRejection', onUnhandled);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
      payload: makeUpdate(2),
    });

    await flush();

    expect(res.statusCode).toBe(200);
    expect(onUnhandled).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('Update processing failed', expect.anything());

    process.removeListener('unhandledRejection', onUnhandled);
  });

  describe('S4: rejects bad auth and malformed bodies', () => {
    it('rejects a wrong secret header value', async () => {
      const handleUpdate = vi.fn(() => Promise.resolve());
      const fakeBot = { handleUpdate } as unknown as Bot;
      const app = await createServer(fakeBot);

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret' },
        payload: makeUpdate(3),
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Unauthorized' });
      expect(handleUpdate).not.toHaveBeenCalled();
    });

    it('rejects a request with no secret header at all', async () => {
      const handleUpdate = vi.fn(() => Promise.resolve());
      const fakeBot = { handleUpdate } as unknown as Bot;
      const app = await createServer(fakeBot);

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: makeUpdate(4),
      });

      expect(res.statusCode).toBe(401);
      expect(handleUpdate).not.toHaveBeenCalled();
    });

    it('rejects a valid secret with a malformed body (no numeric update_id)', async () => {
      const handleUpdate = vi.fn(() => Promise.resolve());
      const fakeBot = { handleUpdate } as unknown as Bot;
      const app = await createServer(fakeBot);

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
        payload: { foo: 1 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Bad Request' });
      expect(handleUpdate).not.toHaveBeenCalled();
    });
  });
});
