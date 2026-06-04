import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

vi.mock('../../src/config/index.js', () => ({
  config: {
    PORT: 3000,
    TOOL_ENDPOINT_ALLOWLIST: 'localhost:3000,api.open-meteo.com,api.geonames.org',
    TOOL_VARS: {},
  },
  getToolSubstitutionVars: () => ({ PORT: '3000', GEONAMES_USERNAME: 'testuser' }),
}));

import { buildToolFromSpec, frontmatterSchema } from '../../src/tools/loader.js';
import { parse as parseYaml } from 'yaml';
import type { Tool } from '../../src/tools/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCitiesTool(): Tool {
  const raw = readFileSync(
    join(__dirname, '../../src/tools/defs/cities_by_country.yaml'),
    'utf-8',
  );
  const spec = frontmatterSchema.parse(parseYaml(raw));
  return buildToolFromSpec(spec, {
    allowlist: ['localhost:3000', 'api.geonames.org'],
    vars: { PORT: '3000', GEONAMES_USERNAME: 'testuser' },
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

const KR_RESPONSE = {
  geonames: [
    { name: 'Seoul', population: 10349312, countryName: 'South Korea', adminName1: 'Seoul' },
    { name: 'Busan', population: 3448737, countryName: 'South Korea', adminName1: 'Busan' },
    { name: 'Incheon', population: 2628000, countryName: 'South Korea', adminName1: 'Incheon' },
  ],
};

describe('cities_by_country (declarative .yaml tool)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the expected name and required country parameter', () => {
    const tool = loadCitiesTool();
    expect(tool.name).toBe('cities_by_country');
    expect(tool.parameters.required).toContain('country');
  });

  it('carries the Korean responseGuidance', () => {
    const tool = loadCitiesTool();
    expect(tool.responseGuidance).toContain('도시 이름만');
  });

  it('merges country query param with the endpoint existing query string', async () => {
    mockFetch(KR_RESPONSE);
    const tool = loadCitiesTool();
    await tool.execute({ country: 'KR' });

    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const url = new URL(calls[0][0] as string);
    expect(url.host).toBe('api.geonames.org');
    expect(url.searchParams.get('country')).toBe('KR');
    expect(url.searchParams.get('featureClass')).toBe('P');
    expect(url.searchParams.get('orderby')).toBe('population');
    expect(url.searchParams.get('maxRows')).toBe('10');
    expect(url.searchParams.get('username')).toBe('testuser');
    expect((calls[0][1] as { method: string }).method).toBe('GET');
  });

  it('transforms geonames response to { country, cities[] }', async () => {
    mockFetch(KR_RESPONSE);
    const tool = loadCitiesTool();
    const result = (await tool.execute({ country: 'KR' })) as {
      country: string;
      cities: string[];
    };

    expect(result.country).toBe('South Korea');
    expect(result.cities).toEqual(['Seoul', 'Busan', 'Incheon']);
  });

  it('throws when the required country param is missing', async () => {
    mockFetch(KR_RESPONSE);
    const tool = loadCitiesTool();
    await expect(tool.execute({})).rejects.toThrow(/country/);
  });

  it('throws when geonames returns an error status', async () => {
    mockFetch({
      status: { message: 'invalid username', value: 10 },
    });
    const tool = loadCitiesTool();
    await expect(tool.execute({ country: 'KR' })).rejects.toThrow(/GeoNames API error/);
  });

  it('throws when geonames returns an empty city list', async () => {
    mockFetch({ geonames: [] });
    const tool = loadCitiesTool();
    await expect(tool.execute({ country: 'ZZ' })).rejects.toThrow(/No cities found/);
  });

  it('throws with the HTTP status code on a non-OK response', async () => {
    mockFetch({ error: 'bad request' }, false, 400);
    const tool = loadCitiesTool();
    await expect(tool.execute({ country: 'KR' })).rejects.toThrow('400');
  });

  it('spec has optional: true so GEONAMES_USERNAME absence only warns, not exits', () => {
    const raw = readFileSync(
      join(__dirname, '../../src/tools/defs/cities_by_country.yaml'),
      'utf-8',
    );
    const spec = frontmatterSchema.parse(parseYaml(raw));
    expect(spec.optional).toBe(true);
  });
});
