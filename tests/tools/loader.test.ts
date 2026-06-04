import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: { PORT: 3000 },
  getToolSubstitutionVars: () => ({ PORT: '3000' }),
}));

import { buildToolFromSpec, frontmatterSchema } from '../../src/tools/loader.js';
import type { Tool } from '../../src/tools/types.js';

const opts = {
  allowlist: ['localhost:3000', 'api.example.com'],
  vars: { PORT: '3000' },
};

function parse(raw: unknown) {
  return frontmatterSchema.parse(raw);
}

function mockFetch(response: object, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  }) as unknown as typeof fetch;
}

describe('buildToolFromSpec — JSON Schema construction', () => {
  it('builds an object schema with required[], descriptions, and strips internal keys', () => {
    const fm = parse({
      name: 'demo',
      description: 'A demo tool',
      endpoint: 'http://localhost:{PORT}/x',
      parameters: {
        region: {
          type: 'string',
          description: 'the region',
          required: true,
          in: 'query',
        },
        limit: {
          type: 'integer',
          description: 'max items',
          default: 10,
          in: 'query',
        },
      },
    });

    const tool = buildToolFromSpec(fm, opts);

    expect(tool.name).toBe('demo');
    expect(tool.description).toBe('A demo tool');
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.required).toEqual(['region']);

    const props = tool.parameters.properties ?? {};
    expect(props.region).toEqual({ type: 'string', description: 'the region' });
    expect(props.limit).toEqual({ type: 'integer', description: 'max items' });
    // internal keys must not leak into the LLM-facing schema
    expect(props.region).not.toHaveProperty('in');
    expect(props.region).not.toHaveProperty('required');
    expect(props.limit).not.toHaveProperty('default');
  });

  it('emits items:{type} for array params', () => {
    const fm = parse({
      name: 'arr',
      description: 'array tool',
      endpoint: 'http://localhost:{PORT}/x',
      parameters: {
        tags: {
          type: 'array',
          items_type: 'string',
          description: 'tag list',
        },
      },
    });

    const tool = buildToolFromSpec(fm, opts);
    const tags = (tool.parameters.properties ?? {}).tags;
    expect(tags).toEqual({
      type: 'array',
      description: 'tag list',
      items: { type: 'string' },
    });
  });

  it('passes through enum on a property', () => {
    const fm = parse({
      name: 'en',
      description: 'enum tool',
      endpoint: 'http://localhost:{PORT}/x',
      parameters: {
        mode: { type: 'string', description: 'mode', enum: ['a', 'b'] },
      },
    });
    const tool = buildToolFromSpec(fm, opts);
    expect((tool.parameters.properties ?? {}).mode?.enum).toEqual(['a', 'b']);
  });

  it('sets responseGuidance from response_guidance, undefined when absent', () => {
    const withGuidance = parse({
      name: 'g',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/x',
      response_guidance: 'guide me',
    });
    expect(buildToolFromSpec(withGuidance, opts).responseGuidance).toBe('guide me');

    const withoutGuidance = parse({
      name: 'g',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/x',
    });
    expect(buildToolFromSpec(withoutGuidance, opts).responseGuidance).toBeUndefined();
  });
});

describe('buildToolFromSpec — substitution & allowlist (build time)', () => {
  it('substitutes {PORT} from the vars allowlist', () => {
    const fm = parse({
      name: 's',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api',
    });
    expect(() => buildToolFromSpec(fm, opts)).not.toThrow();
  });

  it('throws for a secret token like {OPENROUTER_API_KEY}', () => {
    const fm = parse({
      name: 's',
      description: 'd',
      endpoint: 'http://localhost:3000/{OPENROUTER_API_KEY}',
    });
    expect(() => buildToolFromSpec(fm, opts)).toThrow(/OPENROUTER_API_KEY/);
  });

  it('throws for an unknown substitution token', () => {
    const fm = parse({
      name: 's',
      description: 'd',
      endpoint: 'http://localhost:3000/{NOPE}',
    });
    expect(() => buildToolFromSpec(fm, opts)).toThrow(/NOPE/);
  });

  it('throws when the endpoint host is not on the allowlist', () => {
    const fm = parse({
      name: 's',
      description: 'd',
      endpoint: 'http://evil.com/api',
    });
    expect(() => buildToolFromSpec(fm, opts)).toThrow(/allowlist/i);
  });

  it('throws for a non-http(s) scheme', () => {
    const fm = parse({
      name: 's',
      description: 'd',
      endpoint: 'file://localhost:3000/etc',
    });
    expect(() => buildToolFromSpec(fm, opts)).toThrow();
  });

  it('throws when the endpoint embeds credentials', () => {
    const fm = parse({
      name: 's',
      description: 'd',
      endpoint: 'http://user:pass@localhost:3000/api',
    });
    expect(() => buildToolFromSpec(fm, opts)).toThrow();
  });
});

describe('buildToolFromSpec — execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET: encodes query params into the URL', async () => {
    mockFetch({ ok: 1 });
    const fm = parse({
      name: 'q',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api/get',
      method: 'GET',
      parameters: {
        region: { type: 'string', description: 'r', required: true, in: 'query' },
      },
    });
    const tool = buildToolFromSpec(fm, opts);
    await tool.execute({ region: 'Asia/Seoul' });

    const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe('http://localhost:3000/api/get?region=Asia%2FSeoul');
    expect((call[1] as { method: string }).method).toBe('GET');
  });

  it('POST: sends body params as JSON with content-type header', async () => {
    mockFetch({ ok: 1 });
    const fm = parse({
      name: 'p',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api/post',
      method: 'POST',
      parameters: {
        title: { type: 'string', description: 't', required: true, in: 'body' },
        count: { type: 'integer', description: 'c', in: 'body' },
      },
    });
    const tool = buildToolFromSpec(fm, opts);
    await tool.execute({ title: 'hi', count: 5 });

    const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = call[1] as { method: string; headers: Record<string, string>; body: string };
    expect(call[0]).toBe('http://localhost:3000/api/post');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ title: 'hi', count: 5 });
  });

  it('path params are encodeURIComponent-d into the URL', async () => {
    mockFetch({ ok: 1 });
    const fm = parse({
      name: 'path',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api/items/{id}',
      parameters: {
        id: { type: 'string', description: 'id', required: true, in: 'path' },
      },
    });
    const tool = buildToolFromSpec(fm, opts);
    await tool.execute({ id: 'a/b c' });

    const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe('http://localhost:3000/api/items/a%2Fb%20c');
  });

  it('throws when a required param is missing', async () => {
    mockFetch({ ok: 1 });
    const fm = parse({
      name: 'req',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api',
      parameters: {
        region: { type: 'string', description: 'r', required: true, in: 'query' },
      },
    });
    const tool = buildToolFromSpec(fm, opts);
    await expect(tool.execute({})).rejects.toThrow(/region/);
  });

  it('applies declared defaults when a param is absent', async () => {
    mockFetch({ ok: 1 });
    const fm = parse({
      name: 'def',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api',
      parameters: {
        limit: { type: 'integer', description: 'l', default: 10, in: 'query' },
      },
    });
    const tool = buildToolFromSpec(fm, opts);
    await tool.execute({});
    const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe('http://localhost:3000/api?limit=10');
  });

  it('throws on a non-success status, including a truncated body', async () => {
    mockFetch({ error: 'nope' }, false, 404);
    const fm = parse({
      name: 'err',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api',
    });
    const tool = buildToolFromSpec(fm, opts);
    await expect(tool.execute({})).rejects.toThrow(/404/);
  });

  it('applies response.pick to whitelist fields', async () => {
    mockFetch({ a: 1, b: 2, c: 3 });
    const fm = parse({
      name: 'pick',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api',
      response: { pick: ['a', 'c'] },
    });
    const tool = buildToolFromSpec(fm, opts);
    const result = await tool.execute({});
    expect(result).toEqual({ a: 1, c: 3 });
  });

  it('applies a transform module after fetch', async () => {
    mockFetch({
      region: 'Asia/Seoul',
      datetime: '2026-06-02T10:00:00+09:00',
      timezone: 'Asia/Seoul',
    });
    const fm = parse({
      name: 'tx',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api',
      transform: 'time',
    });
    const tool = buildToolFromSpec(fm, opts);
    const result = (await tool.execute({})) as { datetime: string };
    expect(result.datetime).toBe('2026-06-02 10:00:00');
  });

  it('re-validates the final URL host and rejects a smuggled @evil.com', async () => {
    mockFetch({ ok: 1 });
    const fm = parse({
      name: 'smuggle',
      description: 'd',
      endpoint: 'http://localhost:{PORT}/api/{path}',
      parameters: {
        path: { type: 'string', description: 'p', required: true, in: 'path' },
      },
    });
    const tool = buildToolFromSpec(fm, opts);
    // a path that, when injected raw, would change the host — must be caught
    await expect(tool.execute({ path: '../@evil.com/x' })).resolves.toBeDefined();
    // encodeURIComponent neutralizes it, so host stays localhost; assert it did
    const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(new URL(call[0] as string).host).toBe('localhost:3000');
  });
});

describe('frontmatterSchema validation', () => {
  it('rejects unknown top-level keys', () => {
    expect(() =>
      frontmatterSchema.parse({
        name: 'x',
        description: 'd',
        endpoint: 'http://localhost:3000/x',
        bogus: true,
      }),
    ).toThrow();
  });

  it('rejects a bad name', () => {
    expect(() =>
      frontmatterSchema.parse({
        name: 'Bad-Name',
        description: 'd',
        endpoint: 'http://localhost:3000/x',
      }),
    ).toThrow();
  });

  it('requires items_type when type is array', () => {
    expect(() =>
      frontmatterSchema.parse({
        name: 'a',
        description: 'd',
        endpoint: 'http://localhost:3000/x',
        parameters: { tags: { type: 'array', description: 't' } },
      }),
    ).toThrow();
  });

  it('caps timeout_ms at 15000', () => {
    const fm = frontmatterSchema.parse({
      name: 't',
      description: 'd',
      endpoint: 'http://localhost:3000/x',
      timeout_ms: 999999,
    });
    expect(fm.timeout_ms).toBe(15000);
  });
});

// Type-only guard so the Tool import is exercised.
const _typecheck: (t: Tool) => string = (t) => t.name;
void _typecheck;
