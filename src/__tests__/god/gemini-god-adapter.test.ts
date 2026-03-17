import { describe, expect, it } from 'vitest';

import { GeminiGodAdapter } from '../../god/adapters/gemini-god-adapter.js';

describe('GeminiGodAdapter', () => {
  it('has correct adapter metadata', () => {
    const adapter = new GeminiGodAdapter();
    expect(adapter.name).toBe('gemini');
    expect(adapter.displayName).toBe('Gemini CLI');
    expect(adapter.toolUsePolicy).toBe('forbid');
  });

  it('builds fresh call args with system prompt embedded in user prompt', () => {
    const adapter = new GeminiGodAdapter();
    const args = adapter.buildArgs('Classify this task', {
      cwd: '/test/project',
      systemPrompt: 'You are the Sovereign God.',
      timeoutMs: 60_000,
    });

    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--yolo');
    expect(args).toContain('--include-directories');
    expect(args).toContain('/test/project');
    // System prompt embedded in the prompt arg, not as separate flag
    expect(args).not.toContain('--system-prompt');
    const promptArg = args[args.indexOf('-p') + 1];
    expect(promptArg).toContain('You are the Sovereign God.');
    expect(promptArg).toContain('Classify this task');
    // No resume on fresh call
    expect(args).not.toContain('--resume');
  });

  it('builds resume call args with --resume and slim prompt', () => {
    const adapter = new GeminiGodAdapter();
    adapter.restoreSessionId('gemini-session-42');

    const args = adapter.buildArgs('Round 2 observations', {
      cwd: '/test/project',
      systemPrompt: 'You are the Sovereign God.',
      timeoutMs: 60_000,
    });

    expect(args).toContain('--resume');
    expect(args).toContain('gemini-session-42');
    // When resuming, prompt should NOT contain system prompt (already in session)
    const promptArg = args[args.indexOf('-p') + 1];
    expect(promptArg).not.toContain('You are the Sovereign God.');
    expect(promptArg).toContain('Round 2 observations');
    // Must still include project directory and yolo
    expect(args).toContain('--include-directories');
    expect(args).toContain('--yolo');
  });

  it('includes --model when model is specified', () => {
    const adapter = new GeminiGodAdapter();
    const args = adapter.buildArgs('test', {
      cwd: '/tmp',
      systemPrompt: 'sys',
      timeoutMs: 30_000,
      model: 'gemini-2.5-pro',
    });

    expect(args).toContain('--model');
    expect(args).toContain('gemini-2.5-pro');
  });

  it('does not include --model when not specified', () => {
    const adapter = new GeminiGodAdapter();
    const args = adapter.buildArgs('test', {
      cwd: '/tmp',
      systemPrompt: 'sys',
      timeoutMs: 30_000,
    });

    expect(args).not.toContain('--model');
  });

  // Session management interface
  it('implements session management lifecycle', () => {
    const adapter = new GeminiGodAdapter();

    // Initially no session
    expect(adapter.hasActiveSession()).toBe(false);
    expect(adapter.getLastSessionId()).toBeNull();

    // Restore a session
    adapter.restoreSessionId('session-abc');
    expect(adapter.hasActiveSession()).toBe(true);
    expect(adapter.getLastSessionId()).toBe('session-abc');

    // Clear session
    adapter.clearSession();
    expect(adapter.hasActiveSession()).toBe(false);
    expect(adapter.getLastSessionId()).toBeNull();
  });
});
