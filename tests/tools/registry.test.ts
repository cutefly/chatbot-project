import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

const mockTool: Tool = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => ({ result: 'ok' }),
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves a tool by name', () => {
    registry.register(mockTool);
    expect(registry.get('test_tool')).toBe(mockTool);
  });

  it('throws when retrieving an unregistered tool', () => {
    expect(() => registry.get('nonexistent')).toThrow('Tool not found: nonexistent');
  });

  it('returns all registered tools', () => {
    registry.register(mockTool);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0]).toBe(mockTool);
  });

  it('converts tools to OpenRouter function definitions', () => {
    registry.register(mockTool);
    const defs = registry.toFunctionDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe('function');
    expect(defs[0].function.name).toBe('test_tool');
    expect(defs[0].function.description).toBe('A test tool');
  });
});
