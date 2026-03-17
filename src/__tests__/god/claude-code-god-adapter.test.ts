import { describe, expect, it } from 'vitest';

import { ClaudeCodeGodAdapter } from '../../god/adapters/claude-code-god-adapter.js';

describe('ClaudeCodeGodAdapter', () => {
  it('builds a God-only Claude command with system prompt and tools disabled', () => {
    const adapter = new ClaudeCodeGodAdapter();
    const args = adapter.buildArgs('Return JSON', {
      cwd: '/test/project',
      systemPrompt: 'You are God.',
      timeoutMs: 30_000,
    });

    expect(args).toContain('-p');
    expect(args).toContain('Return JSON');
    expect(args).toContain('--system-prompt');
    expect(args).toContain('You are God.');
    expect(args).toContain('--tools');
    expect(args).toContain('');
    expect(args).toContain('--add-dir');
    expect(args).toContain('/test/project');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--continue');
  });

  it('includes --dangerously-skip-permissions for autonomous God operation', () => {
    const adapter = new ClaudeCodeGodAdapter();
    const args = adapter.buildArgs('Return JSON', {
      cwd: '/test/project',
      systemPrompt: 'You are God.',
      timeoutMs: 30_000,
    });

    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('includes --add-dir when resuming a session', () => {
    const adapter = new ClaudeCodeGodAdapter();
    // Simulate having an active session
    adapter.restoreSessionId('test-session-123');

    const args = adapter.buildArgs('Return JSON', {
      cwd: '/test/project',
      systemPrompt: 'You are God.',
      timeoutMs: 30_000,
    });

    // Should resume the session
    expect(args).toContain('--resume');
    expect(args).toContain('test-session-123');
    // Must still include --add-dir even when resuming
    expect(args).toContain('--add-dir');
    expect(args).toContain('/test/project');
    // Must still include --dangerously-skip-permissions
    expect(args).toContain('--dangerously-skip-permissions');
  });
});
