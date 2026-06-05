import { config } from '../config/index.js';
import { toolRegistry } from '../tools/index.js';
import { executeToolCalls } from '../tools/executor.js';
import type { ToolCall } from '../tools/types.js';

interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface OpenRouterChoice {
  finish_reason: string;
  message: {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
  };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
}

const MAX_TOOL_ITERATIONS = 5;
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export async function chat(model: string, messages: LLMMessage[]): Promise<string> {
  const tools = toolRegistry.toFunctionDefinitions();
  let currentMessages: LLMMessage[] = [...messages];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callOpenRouter(model, currentMessages, tools);
    const choice = response.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      currentMessages.push({
        role: 'assistant',
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });

      const results = await executeToolCalls(choice.message.tool_calls);
      currentMessages.push(...results);

      const successfulCalls = choice.message.tool_calls.filter(
        (call, i) => !results[i].isError,
      );
      for (const guidance of collectGuidance(successfulCalls)) {
        currentMessages.push({ role: 'system', content: guidance });
      }
    } else {
      return choice.message.content ?? '';
    }
  }

  throw new Error('Max tool call iterations reached without a final response');
}

function collectGuidance(toolCalls: ToolCall[]): string[] {
  const guidance = new Set<string>();
  for (const call of toolCalls) {
    let tool;
    try {
      tool = toolRegistry.get(call.function.name);
    } catch {
      continue;
    }
    if (tool.responseGuidance) {
      guidance.add(tool.responseGuidance);
    }
  }
  return [...guidance];
}

async function callOpenRouter(
  model: string,
  messages: LLMMessage[],
  tools: ReturnType<typeof toolRegistry.toFunctionDefinitions>,
): Promise<OpenRouterResponse> {
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
      'HTTP-Referer': config.WEBHOOK_URL,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<OpenRouterResponse>;
}
