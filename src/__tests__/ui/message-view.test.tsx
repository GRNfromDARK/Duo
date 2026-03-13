import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { MessageView } from '../../ui/components/MessageView.js';
import type { Message } from '../../types/ui.js';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '1',
    role: 'claude-code',
    content: 'Hello world',
    timestamp: new Date('2026-03-10T14:32:00Z').getTime(),
    ...overrides,
  };
}

describe('MessageView', () => {
  it('renders message with role border marker', () => {
    const { lastFrame } = render(<MessageView message={makeMessage()} />);
    const output = lastFrame()!;
    expect(output).toContain('┃');
  });

  it('renders role display name', () => {
    const { lastFrame } = render(<MessageView message={makeMessage()} />);
    const output = lastFrame()!;
    expect(output).toContain('Claude');
  });

  it('renders message content', () => {
    const { lastFrame } = render(<MessageView message={makeMessage({ content: 'Test content here' })} />);
    const output = lastFrame()!;
    expect(output).toContain('Test content here');
  });

  it('renders timestamp', () => {
    const { lastFrame } = render(<MessageView message={makeMessage()} />);
    const output = lastFrame()!;
    // Should contain time portion
    expect(output).toMatch(/\d{2}:\d{2}/);
  });

  it('renders role label when provided', () => {
    const { lastFrame } = render(
      <MessageView message={makeMessage({ roleLabel: 'Coder' })} />
    );
    const output = lastFrame()!;
    expect(output).toContain('Coder');
  });

  it('renders Codex style correctly', () => {
    const { lastFrame } = render(
      <MessageView message={makeMessage({ role: 'codex' })} />
    );
    const output = lastFrame()!;
    expect(output).toContain('║');
    expect(output).toContain('Codex');
  });

  it('renders Gemini style correctly', () => {
    const { lastFrame } = render(
      <MessageView message={makeMessage({ role: 'gemini' })} />
    );
    const output = lastFrame()!;
    expect(output).toContain('│');
    expect(output).toContain('Gemini');
  });

  it('renders System style correctly', () => {
    const { lastFrame } = render(
      <MessageView message={makeMessage({ role: 'system' })} />
    );
    const output = lastFrame()!;
    expect(output).toContain('·');
    expect(output).toContain('System');
  });

  it('renders User style correctly', () => {
    const { lastFrame } = render(
      <MessageView message={makeMessage({ role: 'user' })} />
    );
    const output = lastFrame()!;
    expect(output).toContain('>');
    expect(output).toContain('You');
  });

  it('renders multi-line content', () => {
    const { lastFrame } = render(
      <MessageView message={makeMessage({ content: 'Line 1\nLine 2\nLine 3' })} />
    );
    const output = lastFrame()!;
    expect(output).toContain('Line 1');
    expect(output).toContain('Line 2');
    expect(output).toContain('Line 3');
  });
});
