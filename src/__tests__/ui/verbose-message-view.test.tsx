/**
 * Tests for MessageView verbose mode rendering.
 * Source: FR-021 (AC-071) — Verbose mode shows CLI command details, timestamps, token counts.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { MessageView } from '../../ui/components/MessageView.js';
import type { Message } from '../../types/ui.js';

describe('MessageView verbose mode', () => {
  it('in verbose mode, shows CLI command details from metadata', () => {
    const msg: Message = {
      id: 'v1',
      role: 'claude-code',
      content: 'Done implementing',
      timestamp: Date.now(),
      metadata: {
        cliCommand: 'claude --print --output-format stream-json',
        tokenCount: 1500,
      },
    };
    const { lastFrame } = render(
      <MessageView message={msg} displayMode="verbose" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('claude --print --output-format stream-json');
    expect(frame).toContain('1.5k');
  });

  it('in minimal mode, does not show CLI command details', () => {
    const msg: Message = {
      id: 'v2',
      role: 'claude-code',
      content: 'Done',
      timestamp: Date.now(),
      metadata: {
        cliCommand: 'claude --print',
        tokenCount: 500,
      },
    };
    const { lastFrame } = render(
      <MessageView message={msg} displayMode="minimal" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('claude --print');
  });

  it('in verbose mode, shows full timestamp with seconds', () => {
    const ts = new Date(2026, 2, 10, 14, 30, 45).getTime();
    const msg: Message = {
      id: 'v3',
      role: 'codex',
      content: 'Review complete',
      timestamp: ts,
    };
    const { lastFrame } = render(
      <MessageView message={msg} displayMode="verbose" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('14:30:45');
  });

  it('in minimal mode, shows HH:MM only (default behavior)', () => {
    const ts = new Date(2026, 2, 10, 14, 30, 45).getTime();
    const msg: Message = {
      id: 'v4',
      role: 'codex',
      content: 'Review complete',
      timestamp: ts,
    };
    const { lastFrame } = render(
      <MessageView message={msg} displayMode="minimal" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('14:30');
    expect(frame).not.toContain('14:30:45');
  });

  it('defaults to minimal mode when displayMode not provided', () => {
    const msg: Message = {
      id: 'v5',
      role: 'claude-code',
      content: 'Hello',
      timestamp: Date.now(),
      metadata: { cliCommand: 'claude --print' },
    };
    const { lastFrame } = render(
      <MessageView message={msg} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('claude --print');
  });
});
