import type { ToolCall, ToolCallResult, ToolResult } from './types.js';
import { toolRegistry } from './registry.js';

function toToolResult(call: ToolCall, result: ToolCallResult): ToolResult {
  return {
    tool_call_id: call.id,
    role: 'tool',
    content: JSON.stringify(result),
    isError: result.isError,
  };
}

export async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  return Promise.all(
    toolCalls.map(async (call): Promise<ToolResult> => {
      try {
        const tool = toolRegistry.get(call.function.name);
        const args = JSON.parse(call.function.arguments) as unknown;
        const data = await tool.execute(args);
        return toToolResult(call, {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          isError: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toToolResult(call, {
          content: [{ type: 'text', text: message }],
          isError: true,
        });
      }
    }),
  );
}
