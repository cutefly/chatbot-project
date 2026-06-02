import type { ToolCall, ToolResult } from './types.js';
import { toolRegistry } from './registry.js';

export async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  return Promise.all(
    toolCalls.map(async (call): Promise<ToolResult> => {
      try {
        const tool = toolRegistry.get(call.function.name);
        const args = JSON.parse(call.function.arguments) as unknown;
        const result = await tool.execute(args);
        return {
          tool_call_id: call.id,
          role: 'tool',
          content: JSON.stringify(result),
        };
      } catch (error) {
        return {
          tool_call_id: call.id,
          role: 'tool',
          content: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        };
      }
    }),
  );
}
