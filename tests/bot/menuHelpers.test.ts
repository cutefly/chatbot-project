import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: {
    PORT: 3000,
    OPENROUTER_API_KEY: 'test-key',
    WEBHOOK_URL: 'https://example.com',
    OPENROUTER_DEFAULT_MODEL: 'openai/gpt-4o-mini',
    CONVERSATION_WINDOW_SIZE: 20,
  },
  getToolSubstitutionVars: () => ({ PORT: '3000' }),
}));

vi.mock('../../src/tools/index.js', () => ({
  toolRegistry: { toFunctionDefinitions: vi.fn(() => []) },
}));

import { parseListFromLLMResponse } from '../../src/bot/handlers/menuHelpers.js';

describe('parseListFromLLMResponse', () => {
  it('parses bullet list with dash prefix', () => {
    const text = '도시 목록입니다:\n- 서울\n- 부산\n- 인천';
    const result = parseListFromLLMResponse(text);
    expect(result).toEqual(['서울', '부산', '인천']);
  });

  it('parses numbered list', () => {
    const text = '1. Seoul\n2. Busan\n3. Incheon';
    expect(parseListFromLLMResponse(text)).toEqual(['Seoul', 'Busan', 'Incheon']);
  });

  it('parses bullet list with • prefix', () => {
    const text = '• 서울\n• 부산';
    expect(parseListFromLLMResponse(text)).toEqual(['서울', '부산']);
  });

  it('filters out lines longer than 20 characters', () => {
    const longName = '이것은스무자를확실히넘는아주긴도시이름임X';
    const text = `- 서울\n- ${longName}`;
    const result = parseListFromLLMResponse(text);
    expect(result).toContain('서울');
    expect(longName.length).toBeGreaterThan(20);
    expect(result).not.toContain(longName);
  });

  it('filters out lines containing colons (headers/labels)', () => {
    const text = '- 서울\n- key: value\n- 부산';
    const result = parseListFromLLMResponse(text);
    expect(result).toContain('서울');
    expect(result).toContain('부산');
    expect(result).not.toContain('key: value');
  });

  it('returns empty array for empty input', () => {
    expect(parseListFromLLMResponse('')).toEqual([]);
  });

  it('handles plain text with no list markers', () => {
    const text = '서울\n부산\n인천';
    const result = parseListFromLLMResponse(text);
    expect(result).toContain('서울');
    expect(result).toContain('부산');
    expect(result).toContain('인천');
  });
});
