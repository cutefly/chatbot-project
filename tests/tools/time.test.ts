import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: {
    PORT: 3000,
  },
}));

import { timeByRegionTool } from '../../src/tools/time.js';

function mockFetch(response: object, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  }) as any;
}

describe('timeByRegionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the expected name and a required region parameter', () => {
    expect(timeByRegionTool.name).toBe('time_by_region');
    expect(timeByRegionTool.parameters.required).toContain('region');
  });

  it('calls the API once with region as a query string param', async () => {
    mockFetch({
      region: 'Asia/Seoul',
      datetime: '2026-06-02T10:00:00+09:00',
      timezone: 'Asia/Seoul',
    });

    await timeByRegionTool.execute({ region: 'Asia/Seoul' });

    expect(global.fetch).toHaveBeenCalledOnce();
    const url = (global.fetch as any).mock.calls[0][0] as string;
    const method = (global.fetch as any).mock.calls[0][1]?.method;
    expect(url).toBe(
      'http://localhost:3000/api/get-time-by-region?region=Asia%2FSeoul',
    );
    expect(method).toBe('GET');
  });

  it('converts the ISO datetime to YYYY-MM-DD HH:mm:ss preserving local wall-clock', async () => {
    mockFetch({
      region: 'Asia/Seoul',
      datetime: '2026-06-02T10:00:00+09:00',
      timezone: 'Asia/Seoul',
    });

    const result = (await timeByRegionTool.execute({ region: 'Asia/Seoul' })) as {
      region: string;
      datetime: string;
      timezone: string;
    };

    expect(result.region).toBe('Asia/Seoul');
    expect(result.datetime).toBe('2026-06-02 10:00:00');
    expect(result.timezone).toBe('Asia/Seoul');
  });

  it('preserves a different offset without timezone shifting', async () => {
    mockFetch({
      region: 'America/New_York',
      datetime: '2026-06-02T21:00:00-04:00',
      timezone: 'America/New_York',
    });

    const result = (await timeByRegionTool.execute({ region: 'America/New_York' })) as {
      datetime: string;
    };

    expect(result.datetime).toBe('2026-06-02 21:00:00');
  });

  it('throws with status code when the API returns a non-OK response', async () => {
    mockFetch({ error: 'not found' }, false, 404);

    await expect(timeByRegionTool.execute({ region: 'Invalid/Region' })).rejects.toThrow(
      'Time API error 404',
    );
  });

  it('throws when the response datetime is malformed', async () => {
    mockFetch({ region: 'Asia/Seoul', datetime: 'not-a-date', timezone: 'Asia/Seoul' });

    await expect(timeByRegionTool.execute({ region: 'Asia/Seoul' })).rejects.toThrow(
      /datetime/i,
    );
  });
});
