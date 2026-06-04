import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

vi.mock('../../src/config/index.js', () => ({
  config: {
    PORT: 3000,
    TOOL_ENDPOINT_ALLOWLIST: 'localhost:3000,api.open-meteo.com',
    TOOL_VARS: {},
  },
  getToolSubstitutionVars: () => ({ PORT: '3000' }),
}));

import { buildToolFromSpec, frontmatterSchema } from '../../src/tools/loader.js';
import { parse as parseYaml } from 'yaml';
import type { Tool } from '../../src/tools/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTempTool(): Tool {
  const raw = readFileSync(
    join(__dirname, '../../src/tools/defs/temp_by_region.yaml'),
    'utf-8',
  );
  const spec = frontmatterSchema.parse(parseYaml(raw));
  return buildToolFromSpec(spec, {
    allowlist: ['localhost:3000', 'api.open-meteo.com'],
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

const SEOUL_FORECAST = {
  current_units: { temperature_2m: '°C' },
  current: { time: '2026-06-04T08:15', temperature_2m: 20.5 },
};

describe('temp_by_region (declarative .yaml tool)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the expected name and required lat/lon parameters', () => {
    const tool = loadTempTool();
    expect(tool.name).toBe('temp_by_region');
    expect(tool.parameters.required).toContain('latitude');
    expect(tool.parameters.required).toContain('longitude');
  });

  it('carries the Korean responseGuidance from response_guidance', () => {
    const tool = loadTempTool();
    expect(tool.responseGuidance).toContain('현재 {지역}의 기온은');
  });

  it('merges lat/lon query params with the endpoint\'s existing query string', async () => {
    mockFetch(SEOUL_FORECAST);

    const tool = loadTempTool();
    await tool.execute({ latitude: 37.5665, longitude: 126.978 });

    expect(global.fetch).toHaveBeenCalledOnce();
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const url = new URL(calls[0][0] as string);
    expect(url.host).toBe('api.open-meteo.com');
    expect(url.searchParams.get('current')).toBe('temperature_2m');
    expect(url.searchParams.get('latitude')).toBe('37.5665');
    expect(url.searchParams.get('longitude')).toBe('126.978');
    expect((calls[0][1] as { method: string }).method).toBe('GET');
  });

  it('flattens the Open-Meteo response to { temperature, unit } via the transform', async () => {
    mockFetch(SEOUL_FORECAST);

    const tool = loadTempTool();
    const result = (await tool.execute({ latitude: 37.5665, longitude: 126.978 })) as {
      temperature: number;
      unit: string;
    };

    expect(result).toEqual({ temperature: 20.5, unit: '°C' });
  });

  it('throws when a required coordinate is missing', async () => {
    mockFetch(SEOUL_FORECAST);

    const tool = loadTempTool();
    await expect(tool.execute({ latitude: 37.5665 })).rejects.toThrow(/longitude/);
  });

  it('throws when the response is missing the temperature field', async () => {
    mockFetch({ current_units: { temperature_2m: '°C' }, current: {} });

    const tool = loadTempTool();
    await expect(
      tool.execute({ latitude: 37.5665, longitude: 126.978 }),
    ).rejects.toThrow(/temperature_2m/);
  });

  it('throws with the status code on a non-OK response', async () => {
    mockFetch({ error: 'bad request' }, false, 400);

    const tool = loadTempTool();
    await expect(
      tool.execute({ latitude: 999, longitude: 999 }),
    ).rejects.toThrow('400');
  });
});
