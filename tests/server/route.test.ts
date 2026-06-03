import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: {
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
  },
}));

vi.mock('grammy', () => ({
  webhookCallback: vi.fn(() => async () => ({})),
}));

import { createServer } from '../../src/server/index.js';
import type { Bot } from 'grammy';

const fakeBot = {} as Bot;

describe('GET /api/get-time-by-region', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns region, datetime (ISO with offset), and timezone for a valid region', async () => {
    const app = await createServer(fakeBot);

    const res = await app.inject({
      method: 'GET',
      url: '/api/get-time-by-region?region=Asia/Seoul',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.region).toBe('Asia/Seoul');
    expect(body.timezone).toBe('Asia/Seoul');
    expect(body.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });

  it('returns 400 when region is missing', async () => {
    const app = await createServer(fakeBot);

    const res = await app.inject({ method: 'GET', url: '/api/get-time-by-region' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  it('returns 400 for an invalid region', async () => {
    const app = await createServer(fakeBot);

    const res = await app.inject({
      method: 'GET',
      url: '/api/get-time-by-region?region=Invalid/Zone',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });
});
