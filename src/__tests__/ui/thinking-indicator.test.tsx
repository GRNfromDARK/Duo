import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ThinkingIndicator, shouldShowThinking } from '../../ui/components/ThinkingIndicator.js';
import type { Message, RoleName } from '../../types/ui.js';

// ── Pure function tests: shouldShowThinking ──

function msg(role: RoleName, id?: string, overrides?: Partial<Message>): Message {
  return {
    id: id ?? `msg-${role}-${Math.random()}`,
    role,
    content: `Content from ${role}`,
    timestamp: Date.now(),
    ...overrides,
  };
}

function streamingPlaceholder(role: RoleName = 'claude-code'): Message {
  return msg(role, undefined, { content: '', isStreaming: true });
}

describe('shouldShowThinking', () => {
  it('returns false when isLLMRunning is false', () => {
    expect(shouldShowThinking(false, [])).toBe(false);
    expect(shouldShowThinking(false, [msg('user')])).toBe(false);
    expect(shouldShowThinking(false, [msg('claude-code')])).toBe(false);
  });

  it('returns true when isLLMRunning and messages is empty', () => {
    expect(shouldShowThinking(true, [])).toBe(true);
  });

  it('returns true when isLLMRunning and last message is user', () => {
    expect(shouldShowThinking(true, [msg('user')])).toBe(true);
  });

  it('returns true when last message is a completed (non-streaming) assistant role', () => {
    // When isLLMRunning=true but last assistant message is completed,
    // a new round is starting and the streaming message hasn't been added yet → show
    expect(shouldShowThinking(true, [msg('user'), msg('claude-code')])).toBe(true);
    expect(shouldShowThinking(true, [msg('user'), msg('codex')])).toBe(true);
    expect(shouldShowThinking(true, [msg('user'), msg('gemini')])).toBe(true);
  });

  it('returns false when last message is an actively streaming assistant', () => {
    // Streaming with real content = LLM actively producing output → hide
    expect(shouldShowThinking(true, [msg('user'), msg('claude-code', undefined, { content: 'Hello', isStreaming: true })])).toBe(false);
    expect(shouldShowThinking(true, [msg('user'), msg('codex', undefined, { content: 'Review', isStreaming: true })])).toBe(false);
  });

  it('returns true when last message is system after user (no assistant yet)', () => {
    expect(shouldShowThinking(true, [msg('user'), msg('system')])).toBe(true);
  });

  it('returns true when completed assistant message exists after user (new round pending)', () => {
    expect(shouldShowThinking(true, [msg('user'), msg('system'), msg('claude-code')])).toBe(true);
  });

  it('returns true when only system messages exist', () => {
    expect(shouldShowThinking(true, [msg('system')])).toBe(true);
    expect(shouldShowThinking(true, [msg('system'), msg('system')])).toBe(true);
  });

  it('handles multi-turn correctly: new user message after assistant', () => {
    const messages = [msg('user'), msg('claude-code'), msg('user')];
    expect(shouldShowThinking(true, messages)).toBe(true);
  });

  it('handles multi-turn correctly: completed assistant after latest user (new round pending)', () => {
    const messages = [msg('user'), msg('claude-code'), msg('user'), msg('codex')];
    expect(shouldShowThinking(true, messages)).toBe(true);
  });

  it('handles all adapter roles as assistant (completed = show, streaming with content = hide)', () => {
    const adapterRoles: RoleName[] = [
      'claude-code', 'codex', 'gemini', 'copilot', 'aider',
      'amazon-q', 'cursor', 'cline', 'continue', 'goose', 'amp', 'qwen',
    ];
    for (const role of adapterRoles) {
      // Completed assistant → new round pending → show
      expect(shouldShowThinking(true, [msg('user'), msg(role)])).toBe(true);
      // Streaming with content → actively producing → hide
      expect(shouldShowThinking(true, [msg('user'), msg(role, undefined, { content: 'output', isStreaming: true })])).toBe(false);
    }
  });

  // ── Empty streaming placeholder tests (App.tsx real-world flow) ──

  it('returns true when assistant message is an empty streaming placeholder', () => {
    // App.tsx creates { role: 'claude-code', content: '', isStreaming: true }
    // before any tokens arrive — indicator should remain visible
    const messages = [msg('user'), streamingPlaceholder('claude-code')];
    expect(shouldShowThinking(true, messages)).toBe(true);
  });

  it('returns false once streaming message has real content', () => {
    const messages = [
      msg('user'),
      msg('claude-code', undefined, { content: 'Hello', isStreaming: true }),
    ];
    expect(shouldShowThinking(true, messages)).toBe(false);
  });

  it('returns true for non-streaming assistant with empty content (new round pending)', () => {
    // Non-streaming assistant = completed from previous round → show thinking
    const messages = [
      msg('user'),
      msg('claude-code', undefined, { content: '' }),
    ];
    expect(shouldShowThinking(true, messages)).toBe(true);
  });

  it('returns true with streaming placeholder after system message', () => {
    const messages = [
      msg('user'),
      msg('system'),
      streamingPlaceholder('codex'),
    ];
    expect(shouldShowThinking(true, messages)).toBe(true);
  });

  it('returns true with whitespace-only streaming content', () => {
    const messages = [
      msg('user'),
      msg('claude-code', undefined, { content: '   \n  ', isStreaming: true }),
    ];
    expect(shouldShowThinking(true, messages)).toBe(true);
  });

  // ── Multi-round scenarios (round 2+) ──

  it('returns true when streaming placeholder follows previous assistant output (round 2+)', () => {
    // Round 2: previous coder/reviewer output exists, new coder streaming starts
    const messages = [
      msg('user'),
      msg('claude-code'),   // round 1 coder output
      msg('codex'),         // round 1 reviewer output
      msg('system'),        // round summary
      streamingPlaceholder('claude-code'), // round 2 coder starting
    ];
    expect(shouldShowThinking(true, messages)).toBe(true);
  });

  it('returns true when reviewer streaming placeholder follows coder output (same round)', () => {
    // Reviewer starts after coder finishes in the same round
    const messages = [
      msg('user'),
      msg('claude-code'),   // coder output
      streamingPlaceholder('codex'), // reviewer starting
    ];
    expect(shouldShowThinking(true, messages)).toBe(true);
  });

  it('returns false when round 2 assistant has real content', () => {
    const messages = [
      msg('user'),
      msg('claude-code'),   // round 1 coder
      msg('codex'),         // round 1 reviewer
      msg('system'),        // round summary
      msg('claude-code', undefined, { content: 'Round 2 output', isStreaming: true }),
    ];
    expect(shouldShowThinking(true, messages)).toBe(false);
  });

  it('returns true when round 2 starts but streaming message not yet added (race condition fix)', () => {
    // This is the key bug scenario: state transitions to CODING (isLLMRunning=true)
    // but the useEffect hasn't added the empty streaming message yet.
    // The last message is a completed assistant from the previous round.
    const messages = [
      msg('user'),
      msg('claude-code', undefined, { content: 'Round 1 coder output', isStreaming: false }),
      msg('system'),        // round summary
      msg('codex', undefined, { content: 'Round 1 reviewer output', isStreaming: false }),
      msg('system'),        // god decision
    ];
    // isLLMRunning=true but no new streaming message yet → should show thinking
    expect(shouldShowThinking(true, messages)).toBe(true);
  });
});

// ── Component render tests ──

describe('ThinkingIndicator component', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders spinner and Thinking text', () => {
    const { lastFrame } = render(<ThinkingIndicator columns={80} />);
    const output = lastFrame()!;
    expect(output).toContain('Thinking...');
    // Should contain one of the spinner characters
    expect(output).toMatch(/[⣾⣽⣻⢿⡿⣟⣯⣷]/);
  });

  it('cleans up interval on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(<ThinkingIndicator columns={80} />);

    // Advance time to verify interval is running
    vi.advanceTimersByTime(200);

    // Unmount and verify no errors from dangling intervals
    unmount();

    // Advancing after unmount should not cause errors
    vi.advanceTimersByTime(500);
  });

  it('starts animation from frame 0 on fresh mount', () => {
    const { lastFrame } = render(<ThinkingIndicator columns={80} />);
    const output = lastFrame()!;
    // First frame should be ⣾ (index 0)
    expect(output).toContain('⣾');
  });

  it('renders custom message when provided', () => {
    const { lastFrame } = render(<ThinkingIndicator columns={80} message="Analyzing task..." />);
    const output = lastFrame()!;
    expect(output).toContain('Analyzing task...');
    expect(output).not.toContain('Thinking...');
  });

  it('renders default message when message prop not provided', () => {
    const { lastFrame } = render(<ThinkingIndicator columns={80} />);
    const output = lastFrame()!;
    expect(output).toContain('Thinking...');
  });

  it('shows elapsed time counter when showElapsed is true', () => {
    const { lastFrame } = render(
      <ThinkingIndicator columns={80} message="God deciding..." showElapsed={true} />,
    );
    // Initially shows (0s)
    const output = lastFrame()!;
    expect(output).toContain('(0s)');
    expect(output).toContain('God deciding...');
  });

  it('does not show elapsed time when showElapsed is false', () => {
    const { lastFrame } = render(
      <ThinkingIndicator columns={80} message="Thinking..." showElapsed={false} />,
    );
    expect(lastFrame()!).not.toContain('(0s)');
  });

  it('cleans up elapsed timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <ThinkingIndicator columns={80} showElapsed={true} />,
    );
    vi.advanceTimersByTime(2000);
    unmount();
    // No errors from dangling interval
    vi.advanceTimersByTime(5000);
  });
});
