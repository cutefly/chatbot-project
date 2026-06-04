import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

vi.mock('../../src/config/index.js', () => ({
  config: { PORT: 3000, TOOL_ENDPOINT_ALLOWLIST: 'localhost:3000', TOOL_VARS: {} },
  getToolSubstitutionVars: () => ({ PORT: '3000' }),
}));

import { buildToolFromSpec, frontmatterSchema } from '../../src/tools/loader.js';
import { parse as parseYaml } from 'yaml';
import type { Tool } from '../../src/tools/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTimeTool(): Tool {
  const raw = readFileSync(
    join(__dirname, '../../src/tools/defs/time_by_region.yaml'),
    'utf-8',
  );
  const spec = frontmatterSchema.parse(parseYaml(raw));
  return buildToolFromSpec(spec, {
    allowlist: ['localhost:3000'],
    vars: { PORT: '3000' },
  });
}

function mockFetch(response: object, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  }) as unknown as typeof fetch;
}

describe('time_by_region (declarative .yaml tool)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the expected name and a required region parameter', () => {
    const tool = loadTimeTool();
    expect(tool.name).toBe('time_by_region');
    expect(tool.parameters.required).toContain('region');
  });

  it('carries the Korean responseGuidance from response_guidance', () => {
    const tool = loadTimeTool();
    expect(tool.responseGuidance).toBe(
      '시간 조회 결과를 사용자에게 전할 때는 반드시 한국어로 "현재 {지역}의 시간은 YYYY년 MM월 DD일 HH시 mm분 ss초 입니다." 형식으로 답하라. {지역}에는 사용자가 말한 표현(예: "서울", "뉴욕")을 그대로 쓰고, datetime 필드의 값을 연/월/일/시/분/초로 분해해 채워라.',
    );
  });

  it('calls the API once with region as a query string param', async () => {
    mockFetch({
      region: 'Asia/Seoul',
      datetime: '2026-06-02T10:00:00+09:00',
      timezone: 'Asia/Seoul',
    });

    const tool = loadTimeTool();
    await tool.execute({ region: 'Asia/Seoul' });

    expect(global.fetch).toHaveBeenCalledOnce();
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0][0]).toBe(
      'http://localhost:3000/api/get-time-by-region?region=Asia%2FSeoul',
    );
    expect((calls[0][1] as { method: string }).method).toBe('GET');
  });

  it('converts the ISO datetime to YYYY-MM-DD HH:mm:ss preserving local wall-clock', async () => {
    mockFetch({
      region: 'Asia/Seoul',
      datetime: '2026-06-02T10:00:00+09:00',
      timezone: 'Asia/Seoul',
    });

    const tool = loadTimeTool();
    const result = (await tool.execute({ region: 'Asia/Seoul' })) as {
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

    const tool = loadTimeTool();
    const result = (await tool.execute({ region: 'America/New_York' })) as {
      datetime: string;
    };

    expect(result.datetime).toBe('2026-06-02 21:00:00');
  });

  it('throws with status code when the API returns a non-OK response', async () => {
    mockFetch({ error: 'not found' }, false, 404);

    const tool = loadTimeTool();
    await expect(tool.execute({ region: 'Invalid/Region' })).rejects.toThrow('404');
  });

  it('throws when the response datetime is malformed', async () => {
    mockFetch({ region: 'Asia/Seoul', datetime: 'not-a-date', timezone: 'Asia/Seoul' });

    const tool = loadTimeTool();
    await expect(tool.execute({ region: 'Asia/Seoul' })).rejects.toThrow(/datetime/i);
  });
});
