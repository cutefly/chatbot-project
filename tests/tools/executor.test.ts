import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: { PORT: 3000 },
  getToolSubstitutionVars: () => ({ PORT: '3000' }),
}));

vi.mock('../../src/tools/registry.js', () => {
  const successTool = {
    name: 'success_tool',
    description: 'returns data',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: vi.fn().mockResolvedValue({ temperature: 20.5, unit: '°C' }),
  };
  const failingTool = {
    name: 'failing_tool',
    description: 'always throws',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: vi.fn().mockRejectedValue(new Error('API unavailable')),
  };
  return {
    toolRegistry: {
      get: vi.fn((name: string) => {
        if (name === 'success_tool') return successTool;
        if (name === 'failing_tool') return failingTool;
        throw new Error(`Tool not found: ${name}`);
      }),
    },
  };
});

import { executeToolCalls } from '../../src/tools/executor.js';

describe('executeToolCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns isError:false and content with serialised data on success', async () => {
    const results = await executeToolCalls([{
      id: 'call_1',
      type: 'function',
      function: { name: 'success_tool', arguments: '{}' },
    }]);

    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(false);
    expect(results[0].tool_call_id).toBe('call_1');
    expect(results[0].role).toBe('tool');

    const parsed = JSON.parse(results[0].content) as { content: { type: string; text: string }[]; isError: boolean };
    expect(parsed.isError).toBe(false);
    expect(parsed.content).toHaveLength(1);
    expect(parsed.content[0].type).toBe('text');
    expect(JSON.parse(parsed.content[0].text)).toEqual({ temperature: 20.5, unit: '°C' });
  });

  it('returns isError:true and the error message (not a JSON object) on tool failure', async () => {
    const results = await executeToolCalls([{
      id: 'call_2',
      type: 'function',
      function: { name: 'failing_tool', arguments: '{}' },
    }]);

    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(true);

    const parsed = JSON.parse(results[0].content) as { content: { type: string; text: string }[]; isError: boolean };
    expect(parsed.isError).toBe(true);
    expect(parsed.content[0].text).toBe('API unavailable');
  });

  it('returns isError:true when the tool is not registered', async () => {
    const results = await executeToolCalls([{
      id: 'call_3',
      type: 'function',
      function: { name: 'unknown_tool', arguments: '{}' },
    }]);

    expect(results[0].isError).toBe(true);
    const parsed = JSON.parse(results[0].content) as { content: { type: string; text: string }[]; isError: boolean };
    expect(parsed.content[0].text).toContain('Tool not found');
  });

  it('runs multiple tool calls in parallel and preserves order', async () => {
    const results = await executeToolCalls([
      { id: 'call_a', type: 'function', function: { name: 'success_tool', arguments: '{}' } },
      { id: 'call_b', type: 'function', function: { name: 'failing_tool', arguments: '{}' } },
      { id: 'call_c', type: 'function', function: { name: 'success_tool', arguments: '{}' } },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].tool_call_id).toBe('call_a');
    expect(results[0].isError).toBe(false);
    expect(results[1].tool_call_id).toBe('call_b');
    expect(results[1].isError).toBe(true);
    expect(results[2].tool_call_id).toBe('call_c');
    expect(results[2].isError).toBe(false);
  });
});
