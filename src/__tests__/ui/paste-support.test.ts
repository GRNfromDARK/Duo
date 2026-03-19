/**
 * Tests for paste support across input components.
 *
 * Covers:
 * - processPaste pure function (InputArea.tsx)
 * - processInput unchanged for single-character input
 * - DirectoryPicker paste sanitisation expectations
 * - SetupWizard TaskInput / ModelSelector paste sanitisation expectations
 */

import { describe, it, expect, vi } from 'vitest';

// Mock OpenTUI modules to avoid .scm file loading in test environment
vi.mock('@opentui/core', () => ({
  createTextAttributes: vi.fn(),
  decodePasteBytes: vi.fn((bytes: Uint8Array) => new TextDecoder().decode(bytes)),
  stripAnsiSequences: vi.fn((s: string) => s),
}));
vi.mock('@opentui/react', () => ({
  useAppContext: vi.fn(() => ({ keyHandler: null, renderer: null })),
  useKeyboard: vi.fn(),
}));

import { processInput, processPaste } from '../../ui/components/InputArea.js';
import type { Key } from '../../tui/primitives.js';

// ── Helper ──

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

// ── processPaste ──

describe('processPaste', () => {
  it('inserts pasted text at cursor position in empty input', () => {
    const result = processPaste('', 0, 'hello world', 5);
    expect(result).toEqual({ type: 'update', value: 'hello world', cursorPos: 11 });
  });

  it('inserts pasted text at cursor position in non-empty input', () => {
    const result = processPaste('abcdef', 3, 'XYZ', 5);
    expect(result).toEqual({ type: 'update', value: 'abcXYZdef', cursorPos: 6 });
  });

  it('inserts at end of string when cursor is at end', () => {
    const result = processPaste('hello', 5, ' world', 5);
    expect(result).toEqual({ type: 'update', value: 'hello world', cursorPos: 11 });
  });

  it('inserts at beginning when cursor is at 0', () => {
    const result = processPaste('world', 0, 'hello ', 5);
    expect(result).toEqual({ type: 'update', value: 'hello world', cursorPos: 6 });
  });

  it('handles multi-line paste within maxLines', () => {
    const result = processPaste('', 0, 'line1\nline2\nline3', 5);
    expect(result).toEqual({
      type: 'update',
      value: 'line1\nline2\nline3',
      cursorPos: 17,
    });
  });

  it('truncates lines exceeding maxLines', () => {
    const result = processPaste('', 0, 'a\nb\nc\nd\ne\nf', 3);
    expect(result).toEqual({
      type: 'update',
      value: 'a\nb\nc',
      cursorPos: 5,
    });
  });

  it('accounts for existing lines when enforcing maxLines', () => {
    const result = processPaste('line1\n', 6, 'a\nb\nc', 3);
    // combined: "line1\na\nb\nc" = 4 lines → truncated to 3: "line1\na\nb"
    expect(result).toEqual({
      type: 'update',
      value: 'line1\na\nb',
      cursorPos: 9,
    });
  });

  it('returns noop for empty paste', () => {
    expect(processPaste('abc', 1, '', 5)).toEqual({ type: 'noop' });
  });

  it('handles single-character paste', () => {
    const result = processPaste('ac', 1, 'b', 5);
    expect(result).toEqual({ type: 'update', value: 'abc', cursorPos: 2 });
  });

  it('handles paste with trailing newline that exceeds maxLines', () => {
    const result = processPaste('', 0, 'hello\n', 1);
    expect(result).toEqual({ type: 'update', value: 'hello', cursorPos: 5 });
  });

  it('handles large paste text', () => {
    const longText = 'x'.repeat(1000);
    const result = processPaste('', 0, longText, 5);
    expect(result).toEqual({ type: 'update', value: longText, cursorPos: 1000 });
  });

  it('cursor position clamped when truncation removes text after cursor', () => {
    // Paste 5 lines into empty, maxLines=2 → truncated to 2 lines
    const result = processPaste('', 0, 'a\nb\nc\nd\ne', 2);
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.value).toBe('a\nb');
      expect(result.cursorPos).toBeLessThanOrEqual(result.value.length);
    }
  });
});

// ── processInput still works for single characters ──

describe('processInput – single character input unchanged', () => {
  it('inserts a single character at cursor', () => {
    const result = processInput('hllo', 1, 'e', key(), 5);
    expect(result).toEqual({ type: 'update', value: 'hello', cursorPos: 2 });
  });

  it('submits on Enter with content', () => {
    const result = processInput('hello', 5, '', key({ return: true }), 5);
    expect(result).toEqual({ type: 'submit', value: 'hello' });
  });

  it('handles backspace', () => {
    const result = processInput('hello', 5, '', key({ backspace: true }), 5);
    expect(result).toEqual({ type: 'update', value: 'hell', cursorPos: 4 });
  });

  it('handles Ctrl+A (start of line)', () => {
    const result = processInput('hello', 3, 'a', key({ ctrl: true }), 5);
    expect(result).toEqual({ type: 'update', value: 'hello', cursorPos: 0 });
  });

  it('ignores ctrl combinations not handled', () => {
    const result = processInput('hello', 3, 'z', key({ ctrl: true }), 5);
    expect(result).toEqual({ type: 'noop' });
  });

  it('handles multi-char input string (non-bracketed paste fallback)', () => {
    const result = processInput('ab', 2, 'cde', key(), 5);
    expect(result).toEqual({ type: 'update', value: 'abcde', cursorPos: 5 });
  });
});

// ── Path paste sanitisation expectations (DirectoryPicker) ──

describe('DirectoryPicker paste sanitisation', () => {
  it('strips newlines from pasted path', () => {
    const raw = '/Users/rex/Documents\n/Program2026';
    const cleaned = raw.replace(/[\r\n]+/g, '').trim();
    expect(cleaned).toBe('/Users/rex/Documents/Program2026');
  });

  it('strips surrounding whitespace', () => {
    const raw = '  /Users/rex/code  \n';
    const cleaned = raw.replace(/[\r\n]+/g, '').trim();
    expect(cleaned).toBe('/Users/rex/code');
  });

  it('handles Windows-style line endings', () => {
    const raw = '/path/to\r\n/dir';
    const cleaned = raw.replace(/[\r\n]+/g, '').trim();
    expect(cleaned).toBe('/path/to/dir');
  });
});

// ── Task paste sanitisation expectations (SetupWizard TaskInput) ──

describe('SetupWizard TaskInput paste sanitisation', () => {
  it('collapses newlines to spaces for task text', () => {
    const raw = 'Fix the bug\nin the login page';
    const cleaned = raw.replace(/[\r\n]+/g, ' ').trim();
    expect(cleaned).toBe('Fix the bug in the login page');
  });

  it('collapses multiple newlines to single space', () => {
    const raw = 'line1\n\n\nline2';
    const cleaned = raw.replace(/[\r\n]+/g, ' ').trim();
    expect(cleaned).toBe('line1 line2');
  });

  it('trims leading/trailing whitespace', () => {
    const raw = '\n  hello world  \n';
    const cleaned = raw.replace(/[\r\n]+/g, ' ').trim();
    expect(cleaned).toBe('hello world');
  });
});

// ── ModelSelector paste sanitisation expectations ──

describe('SetupWizard ModelSelector paste sanitisation', () => {
  it('strips newlines from pasted model ID', () => {
    const raw = 'claude-opus-4-6\n';
    const cleaned = raw.replace(/[\r\n]+/g, '').trim();
    expect(cleaned).toBe('claude-opus-4-6');
  });

  it('handles model ID with surrounding whitespace', () => {
    const raw = '  gpt-4o  ';
    const cleaned = raw.replace(/[\r\n]+/g, '').trim();
    expect(cleaned).toBe('gpt-4o');
  });
});
