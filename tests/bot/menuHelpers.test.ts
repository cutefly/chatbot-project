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

import {
  BACK_LABEL,
  CLOSE_LABEL,
  ROOT_TITLE,
  buildActionRows,
  buildDynamicRows,
  buildRootView,
  buildSubmenuView,
  chunkIntoRows,
  hasMenuButtons,
  parseListFromLLMResponse,
} from '../../src/bot/handlers/menuHelpers.js';

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

const item = (id: number, label: string) => ({ id, label });
const labelsOf = (rows: Array<Array<{ label: string }>>) =>
  rows.map(row => row.map(button => button.label));

describe('chunkIntoRows', () => {
  it('packs two buttons per row and leaves an odd tail alone', () => {
    const buttons = ['A', 'B', 'C', 'D', 'E'].map(label => ({ label, data: label }));
    expect(labelsOf(chunkIntoRows(buttons))).toEqual([['A', 'B'], ['C', 'D'], ['E']]);
  });

  it('returns no rows for no buttons', () => {
    expect(chunkIntoRows([])).toEqual([]);
  });
});

describe('buildRootView', () => {
  it('lays items out 2 per row with a close-only control row', () => {
    const view = buildRootView([item(1, 'A'), item(2, 'B'), item(3, 'C')]);

    expect(view.title).toBe(ROOT_TITLE);
    expect(labelsOf(view.rows)).toEqual([['A', 'B'], ['C'], [CLOSE_LABEL]]);
    expect(view.rows[0].map(b => b.data)).toEqual(['menu:1', 'menu:2']);
  });
});

describe('buildSubmenuView', () => {
  it('titles the view with the parent label and adds back + close', () => {
    const view = buildSubmenuView(item(11, '지역 조회'), [item(21, '한국'), item(22, '일본')]);

    expect(view.title).toBe('지역 조회');
    expect(labelsOf(view.rows)).toEqual([['한국', '일본'], [BACK_LABEL, CLOSE_LABEL]]);
  });

  it('points the back button at the parent item', () => {
    const view = buildSubmenuView(item(11, '지역 조회'), [item(21, '한국')]);
    const control = view.rows[view.rows.length - 1];

    expect(control.map(b => b.data)).toEqual(['back:11', 'close']);
  });
});

describe('buildDynamicRows', () => {
  it('lays LLM list items out 2 per row with back + close last', () => {
    const rows = buildDynamicRows(['서울', '부산', '인천'], 10, 21);

    expect(labelsOf(rows)).toEqual([['서울', '부산'], ['인천'], [BACK_LABEL, CLOSE_LABEL]]);
    expect(rows[0][0].data).toBe('result:10:서울');
    expect(rows[rows.length - 1][0].data).toBe('back:21');
  });

  it('caps the list at 10 items', () => {
    const items = Array.from({ length: 14 }, (_, i) => `c${i}`);
    const rows = buildDynamicRows(items, 10, 21);

    expect(rows).toHaveLength(6); // 5 item rows + control row
  });

  it('drops items whose callback_data would exceed 64 bytes', () => {
    const tooLong = '가나다라마바사아자차카타파하가나다라마바'; // 20 chars = 60 bytes
    const rows = buildDynamicRows(['서울', tooLong], 10, 21);

    expect(labelsOf(rows)).toEqual([['서울'], [BACK_LABEL, CLOSE_LABEL]]);
  });
});

describe('buildActionRows', () => {
  it('substitutes the selected value into each callback and adds controls', () => {
    const rows = buildActionRows([item(31, '기온'), item(32, '시간')], '서울', 10);

    expect(labelsOf(rows)).toEqual([['기온', '시간'], [BACK_LABEL, CLOSE_LABEL]]);
    expect(rows[0].map(b => b.data)).toEqual(['action:31:서울', 'action:32:서울']);
  });
});

describe('hasMenuButtons', () => {
  it('is false when only the control row is left', () => {
    expect(hasMenuButtons(buildDynamicRows([], 10, 21))).toBe(false);
  });

  it('is true when at least one item row exists', () => {
    expect(hasMenuButtons(buildDynamicRows(['서울'], 10, 21))).toBe(true);
  });
});
