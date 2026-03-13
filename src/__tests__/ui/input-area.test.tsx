import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { InputArea, processInput, getDisplayLines } from '../../ui/components/InputArea.js';
import type { Key } from 'ink';

// Helper: create a Key object with all false defaults
function key(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

// ── processInput (pure function) tests ──

describe('processInput', () => {
  it('appends regular character input', () => {
    const result = processInput('hel', 'l', key(), 5);
    expect(result).toEqual({ type: 'update', value: 'hell' });
  });

  it('appends multi-character input', () => {
    const result = processInput('', 'hello', key(), 5);
    expect(result).toEqual({ type: 'update', value: 'hello' });
  });

  it('submits on Enter when value is non-empty', () => {
    const result = processInput('fix the bug', '', key({ return: true }), 5);
    expect(result).toEqual({ type: 'submit', value: 'fix the bug' });
  });

  it('returns noop on Enter when value is empty', () => {
    const result = processInput('', '', key({ return: true }), 5);
    expect(result).toEqual({ type: 'noop' });
  });

  it('returns noop on Enter when value is whitespace-only', () => {
    const result = processInput('   ', '', key({ return: true }), 5);
    expect(result).toEqual({ type: 'noop' });
  });

  it('adds newline on Alt+Enter (meta+return)', () => {
    const result = processInput('line1', '', key({ return: true, meta: true }), 5);
    expect(result).toEqual({ type: 'update', value: 'line1\n' });
  });

  it('does not add newline when at maxLines', () => {
    const fourLines = 'a\nb\nc\nd\ne'; // 5 lines
    const result = processInput(fourLines, '', key({ return: true, meta: true }), 5);
    expect(result).toEqual({ type: 'noop' });
  });

  it('handles backspace', () => {
    const result = processInput('hello', '', key({ backspace: true }), 5);
    expect(result).toEqual({ type: 'update', value: 'hell' });
  });

  it('handles backspace on empty string', () => {
    const result = processInput('', '', key({ backspace: true }), 5);
    expect(result).toEqual({ type: 'update', value: '' });
  });

  it('handles delete key', () => {
    const result = processInput('hello', '', key({ delete: true }), 5);
    expect(result).toEqual({ type: 'update', value: 'hell' });
  });

  it('ignores arrow keys', () => {
    expect(processInput('x', '', key({ upArrow: true }), 5)).toEqual({ type: 'noop' });
    expect(processInput('x', '', key({ downArrow: true }), 5)).toEqual({ type: 'noop' });
    expect(processInput('x', '', key({ leftArrow: true }), 5)).toEqual({ type: 'noop' });
    expect(processInput('x', '', key({ rightArrow: true }), 5)).toEqual({ type: 'noop' });
  });

  it('ignores tab and escape', () => {
    expect(processInput('x', '', key({ tab: true }), 5)).toEqual({ type: 'noop' });
    expect(processInput('x', '', key({ escape: true }), 5)).toEqual({ type: 'noop' });
  });

  it('ignores page up/down', () => {
    expect(processInput('x', '', key({ pageUp: true }), 5)).toEqual({ type: 'noop' });
    expect(processInput('x', '', key({ pageDown: true }), 5)).toEqual({ type: 'noop' });
  });

  it('returns noop for empty input with no special keys', () => {
    const result = processInput('hello', '', key(), 5);
    expect(result).toEqual({ type: 'noop' });
  });

  // AC-2: LLM 运行中输入回车触发打断
  it('submits multiline text on Enter', () => {
    const result = processInput('line1\nline2', '', key({ return: true }), 5);
    expect(result).toEqual({ type: 'submit', value: 'line1\nline2' });
  });
});

// ── getDisplayLines tests ──

describe('getDisplayLines', () => {
  it('returns single line for simple text', () => {
    expect(getDisplayLines('hello', 5)).toEqual(['hello']);
  });

  it('splits multiline text', () => {
    expect(getDisplayLines('a\nb\nc', 5)).toEqual(['a', 'b', 'c']);
  });

  // AC-4: 输入框高度自适应（最多 5 行）
  it('caps at maxLines', () => {
    const text = 'a\nb\nc\nd\ne\nf\ng';
    const result = getDisplayLines(text, 5);
    expect(result).toHaveLength(5);
    expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns empty first line for empty string', () => {
    expect(getDisplayLines('', 5)).toEqual(['']);
  });

  it('handles trailing newline', () => {
    expect(getDisplayLines('a\n', 5)).toEqual(['a', '']);
  });
});

// ── Component rendering tests ──

describe('InputArea', () => {
  // AC-1: 输入区域始终可见
  it('renders placeholder when LLM is running', () => {
    const { lastFrame } = render(
      <InputArea isLLMRunning={true} onSubmit={vi.fn()} />
    );
    const output = lastFrame()!;
    expect(output).toContain('Type to interrupt, or wait for completion...');
    expect(output).toContain('◆');
  });

  it('renders cursor when not running LLM (waiting for input)', () => {
    const { lastFrame } = render(
      <InputArea isLLMRunning={false} onSubmit={vi.fn()} />
    );
    const output = lastFrame()!;
    expect(output).toContain('▸');
    // Should show cursor block, not placeholder
    expect(output).not.toContain('Type to interrupt');
  });

  it('renders without crashing with maxLines prop', () => {
    const { lastFrame } = render(
      <InputArea isLLMRunning={false} onSubmit={vi.fn()} maxLines={3} />
    );
    expect(lastFrame()).toBeDefined();
  });

  it('defaults maxLines to 5', () => {
    // Verify component renders without explicit maxLines
    const { lastFrame } = render(
      <InputArea isLLMRunning={false} onSubmit={vi.fn()} />
    );
    expect(lastFrame()).toBeDefined();
  });

  // Verify stdin interaction doesn't crash (integration smoke tests)
  it('handles stdin input without crashing', () => {
    const { lastFrame, stdin } = render(
      <InputArea isLLMRunning={false} onSubmit={vi.fn()} />
    );
    stdin.write('a');
    stdin.write('\r');
    expect(lastFrame()).toBeDefined();
  });

  it('handles Alt+Enter sequence without crashing', () => {
    const { lastFrame, stdin } = render(
      <InputArea isLLMRunning={false} onSubmit={vi.fn()} />
    );
    stdin.write('x');
    stdin.write('\x1B\r');
    stdin.write('y');
    expect(lastFrame()).toBeDefined();
  });
});
