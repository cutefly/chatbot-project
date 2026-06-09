import type { ToolCall, ToolCallResult, ToolResult } from './types.js';
import { toolRegistry } from './registry.js';
import { logger } from '../logger.js';

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
      const name = call.function.name;
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments) as unknown;
      } catch {
        args = call.function.arguments;
      }
      logger.info(`Tool call started`, { tool: name, args });
      try {
        const tool = toolRegistry.get(name);
        const data = await tool.execute(args);
        logger.info(`Tool call succeeded`, { tool: name });
        return toToolResult(call, {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          isError: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.warn(`Tool call failed`, { tool: name, error: message });
        return toToolResult(call, {
          content: [{ type: 'text', text: message }],
          isError: true,
        });
      }
    }),
  );
}
