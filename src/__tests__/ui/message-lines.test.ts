import { describe, expect, it } from 'vitest';
import { buildRenderedMessageLines } from '../../ui/message-lines.js';
import type { Message, RoleName } from '../../types/ui.js';
import { getRoleStyle, ROLE_STYLES } from '../../types/ui.js';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'claude-code',
    content: 'Hello world',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('message-lines', () => {
  it('builds multiple rendered lines for a long single message', () => {
    const lines = buildRenderedMessageLines(
      [
        makeMessage({
          content: '这是一个非常长的单条消息，用来验证消息区滚动基于渲染行而不是消息条数进行处理。'.repeat(3),
        }),
      ],
      'minimal',
      40,
    );

    expect(lines.length).toBeGreaterThan(3);
  });

  // BUG-1 regression: all 12 adapters should render without crashing
  it('test_regression_bug1_all_adapters_have_role_styles', () => {
    const adapterNames: RoleName[] = [
      'claude-code', 'codex', 'gemini', 'copilot', 'aider', 'amazon-q',
      'cursor', 'cline', 'continue', 'goose', 'amp', 'qwen',
    ];

    for (const name of adapterNames) {
      const style = ROLE_STYLES[name];
      expect(style, `ROLE_STYLES missing entry for '${name}'`).toBeDefined();
      expect(style.displayName).toBeTruthy();
      expect(style.color).toBeTruthy();
      expect(style.border).toBeTruthy();
    }
  });

  it('test_regression_bug1_renders_message_for_all_adapters', () => {
    const adapterNames: RoleName[] = [
      'aider', 'amazon-q', 'amp', 'cline', 'continue', 'copilot', 'cursor', 'goose', 'qwen',
    ];

    for (const name of adapterNames) {
      const lines = buildRenderedMessageLines(
        [makeMessage({ id: `msg-${name}`, role: name, content: 'test output' })],
        'minimal',
        80,
      );
      expect(lines.length).toBeGreaterThan(0);
      // Should not throw TypeError
      expect(lines[0].spans.length).toBeGreaterThan(0);
    }
  });

  it('test_regression_bug1_getRoleStyle_fallback_for_unknown', () => {
    const style = getRoleStyle('unknown-adapter' as any);
    expect(style).toBeDefined();
    expect(style.displayName).toBe('Agent');
    expect(style.color).toBe('gray');
  });

  it('keeps activity summary compact in minimal mode', () => {
    const lines = buildRenderedMessageLines(
      [
        makeMessage({
          content: '⏺ 12 tool updates · latest Read: Read package.json\n本项目使用 TypeScript 编写。',
        }),
      ],
      'minimal',
      80,
    );

    expect(lines.some((line) => line.spans.some((span) => span.text.includes('12 tool updates')))).toBe(true);
    expect(lines.some((line) => line.spans.some((span) => span.text.includes('TypeScript')))).toBe(true);
  });
});
