export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  /** Injected as a system message after this tool runs, to format the final answer. */
  responseGuidance?: string;
  execute(args: unknown): Promise<unknown>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON-encoded string
  };
}

/** Single content block — mirrors MCP content block shape. */
export interface ToolContent {
  type: 'text';
  text: string;
}

/**
 * Structured tool call result (MCP-aligned).
 * isError distinguishes a tool-execution failure from a successful payload —
 * the LLM uses this to decide how to respond rather than inspecting the payload shape.
 */
export interface ToolCallResult {
  content: ToolContent[];
  isError: boolean;
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string; // JSON-serialised ToolCallResult — string for OpenRouter compatibility
  isError: boolean;
}
