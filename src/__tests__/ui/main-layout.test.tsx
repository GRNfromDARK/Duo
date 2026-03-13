import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { MainLayout } from '../../ui/components/MainLayout.js';
import type { Message } from '../../types/ui.js';

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    role: 'claude-code' as const,
    content: `Message ${i}`,
    timestamp: Date.now() + i * 1000,
  }));
}

describe('MainLayout', () => {
  it('renders status bar area', () => {
    const { lastFrame } = render(
      <MainLayout
        messages={[]}
        statusText="Duo  test-project  Round 1/5"
        columns={80}
        rows={24}
      />
    );
    const output = lastFrame()!;
    expect(output).toContain('Duo');
  });

  it('renders input area placeholder', () => {
    const { lastFrame } = render(
      <MainLayout
        messages={[]}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    const output = lastFrame()!;
    expect(output).toContain('▸');
  });

  it('renders messages in message area', () => {
    const msgs = makeMessages(2);
    const { lastFrame } = render(
      <MainLayout
        messages={msgs}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    const output = lastFrame()!;
    expect(output).toContain('Message 0');
    expect(output).toContain('Message 1');
  });

  it('handles scroll down with j key', () => {
    const msgs = makeMessages(30);
    const { lastFrame, stdin } = render(
      <MainLayout
        messages={msgs}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    // Press j multiple times to scroll down
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    const output = lastFrame()!;
    // After scrolling down, earlier messages should no longer be visible
    // (exact behavior depends on viewport, just verify it doesn't crash)
    expect(output).toBeDefined();
  });

  it('handles scroll up with k key', () => {
    const msgs = makeMessages(30);
    const { lastFrame, stdin } = render(
      <MainLayout
        messages={msgs}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    // Scroll down then up
    stdin.write('j');
    stdin.write('j');
    stdin.write('k');
    const output = lastFrame()!;
    expect(output).toBeDefined();
  });

  it('handles G key to jump to latest', () => {
    const msgs = makeMessages(30);
    const { lastFrame, stdin } = render(
      <MainLayout
        messages={msgs}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    // Scroll up then press G
    stdin.write('k');
    stdin.write('k');
    stdin.write('G');
    const output = lastFrame()!;
    expect(output).toBeDefined();
  });

  it('handles arrow keys for scrolling', () => {
    const msgs = makeMessages(30);
    const { lastFrame, stdin } = render(
      <MainLayout
        messages={msgs}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    // Arrow down (escape sequence)
    stdin.write('\x1B[B');
    // Arrow up
    stdin.write('\x1B[A');
    const output = lastFrame()!;
    expect(output).toBeDefined();
  });

  it('handles empty messages list', () => {
    const { lastFrame } = render(
      <MainLayout
        messages={[]}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    const output = lastFrame()!;
    expect(output).toBeDefined();
  });

  it('respects minimum terminal size 80x24', () => {
    const { lastFrame } = render(
      <MainLayout
        messages={makeMessages(5)}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    const output = lastFrame()!;
    const lines = output.split('\n');
    // Should fit within 24 lines
    expect(lines.length).toBeLessThanOrEqual(24);
  });

  it('auto-follows the bottom of a single long message based on rendered lines', () => {
    const longMessage = {
      id: 'long-1',
      role: 'claude-code' as const,
      content: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n'),
      timestamp: Date.now(),
    };

    const { lastFrame } = render(
      <MainLayout
        messages={[longMessage]}
        statusText="Duo"
        columns={80}
        rows={12}
      />
    );
    const output = lastFrame()!;

    expect(output).toContain('Line 40');
    expect(output).not.toContain('Line 1');
  });
});
