import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: {
    OPENROUTER_API_KEY: 'test-key',
    WEBHOOK_URL: 'https://example.com',
  },
}));

vi.mock('../../src/tools/index.js', () => ({
  toolRegistry: {
    toFunctionDefinitions: vi.fn(() => [
      { type: 'function', function: { name: 'echo', description: 'test', parameters: {} } },
    ]),
    get: vi.fn((name: string) => ({ name, responseGuidance: undefined })),
  },
}));

vi.mock('../../src/tools/executor.js', () => ({
  executeToolCalls: vi.fn(),
}));

import { chat } from '../../src/services/llm.js';
import { executeToolCalls } from '../../src/tools/executor.js';
import { toolRegistry } from '../../src/tools/index.js';

function mockFetch(responses: object[]) {
  let call = 0;
  global.fetch = vi.fn().mockImplementation(async () => {
    const resp = responses[call++];
    return {
      ok: true,
      json: async () => resp,
    };
  }) as any;
}

describe('LLMService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns text response and calls fetch once when no tool_calls', async () => {
    mockFetch([{
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello!' } }],
    }]);

    const result = await chat('openai/gpt-4o-mini', [{ role: 'user', content: 'Hi' }]);

    expect(result).toBe('Hello!');
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(executeToolCalls).not.toHaveBeenCalled();
  });

  it('calls ToolExecutor and makes a 2nd LLM call when tool_calls are returned', async () => {
    const toolCall = {
      id: 'call_1',
      type: 'function',
      function: { name: 'echo', arguments: '{"message":"hi"}' },
    };

    mockFetch([
      {
        choices: [{
          finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [toolCall] },
        }],
      },
      {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Done!' } }],
      },
    ]);

    vi.mocked(executeToolCalls).mockResolvedValue([
      { tool_call_id: 'call_1', role: 'tool', content: '{"echoed":"hi"}' },
    ]);

    const result = await chat('openai/gpt-4o-mini', [{ role: 'user', content: 'Echo hi' }]);

    expect(result).toBe('Done!');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(executeToolCalls).toHaveBeenCalledWith([toolCall]);
  });

  it('throws with status code when OpenRouter returns a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as any;

    await expect(chat('openai/gpt-4o-mini', [])).rejects.toThrow('OpenRouter API error 401');
  });

  it('sends tools array and tool_choice in the request body', async () => {
    mockFetch([{
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
    }]);

    await chat('openai/gpt-4o-mini', []);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body as string);
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBe('auto');
  });

  it('injects a called tool responseGuidance as a system message on the 2nd LLM call', async () => {
    const toolCall = {
      id: 'call_1',
      type: 'function',
      function: { name: 'time_by_region', arguments: '{"region":"Asia/Seoul"}' },
    };

    vi.mocked(toolRegistry.get).mockReturnValue({
      name: 'time_by_region',
      responseGuidance: 'ANSWER IN THIS FORMAT',
    } as any);

    mockFetch([
      {
        choices: [{
          finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [toolCall] },
        }],
      },
      {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Done!' } }],
      },
    ]);

    vi.mocked(executeToolCalls).mockResolvedValue([
      { tool_call_id: 'call_1', role: 'tool', content: '{"datetime":"2026-06-02 10:00:00"}' },
    ]);

    await chat('openai/gpt-4o-mini', [{ role: 'user', content: '서울 시간' }]);

    const secondBody = JSON.parse((global.fetch as any).mock.calls[1][1].body as string);
    const systemMessages = secondBody.messages.filter(
      (m: { role: string }) => m.role === 'system',
    );
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toBe('ANSWER IN THIS FORMAT');
  });

  it('does not inject a system message when the called tool has no responseGuidance', async () => {
    const toolCall = {
      id: 'call_1',
      type: 'function',
      function: { name: 'echo', arguments: '{"message":"hi"}' },
    };

    vi.mocked(toolRegistry.get).mockReturnValue({
      name: 'echo',
      responseGuidance: undefined,
    } as any);

    mockFetch([
      {
        choices: [{
          finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [toolCall] },
        }],
      },
      {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Done!' } }],
      },
    ]);

    vi.mocked(executeToolCalls).mockResolvedValue([
      { tool_call_id: 'call_1', role: 'tool', content: '{"echoed":"hi"}' },
    ]);

    await chat('openai/gpt-4o-mini', [{ role: 'user', content: 'echo hi' }]);

    const secondBody = JSON.parse((global.fetch as any).mock.calls[1][1].body as string);
    const systemMessages = secondBody.messages.filter(
      (m: { role: string }) => m.role === 'system',
    );
    expect(systemMessages).toHaveLength(0);
  });
});
