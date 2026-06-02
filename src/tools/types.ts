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

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string; // JSON-encoded result
}
