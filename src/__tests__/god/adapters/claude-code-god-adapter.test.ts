import { describe, it, expect } from 'vitest';
import { ClaudeCodeGodAdapter } from '../../../god/adapters/claude-code-god-adapter.js';

// ── Task 1: Session methods ──

describe('ClaudeCodeGodAdapter session methods', () => {
  it('hasActiveSession returns false initially', () => {
    const adapter = new ClaudeCodeGodAdapter();
    expect(adapter.hasActiveSession()).toBe(false);
  });

  it('getLastSessionId returns null initially', () => {
    const adapter = new ClaudeCodeGodAdapter();
    expect(adapter.getLastSessionId()).toBeNull();
  });

  it('restoreSessionId sets session and hasActiveSession returns true', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_abc123');
    expect(adapter.hasActiveSession()).toBe(true);
    expect(adapter.getLastSessionId()).toBe('ses_abc123');
  });

  it('restoreSessionId can be overwritten', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_first');
    adapter.restoreSessionId('ses_second');
    expect(adapter.getLastSessionId()).toBe('ses_second');
  });
});

// ── Task 2: buildArgs resume behavior ──

describe('ClaudeCodeGodAdapter buildArgs', () => {
  const baseOpts = {
    cwd: '/tmp/project',
    systemPrompt: 'You are God.',
    timeoutMs: 30000,
  };

  it('first round (no session): includes --system-prompt and --tools', () => {
    const adapter = new ClaudeCodeGodAdapter();
    const args = adapter.buildArgs('user prompt', baseOpts);
    expect(args).toContain('--system-prompt');
    expect(args).toContain('--tools');
    expect(args).not.toContain('--resume');
  });

  it('resume round (has sessionId): includes --resume and --tools, skips --system-prompt', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_god_abc');
    const args = adapter.buildArgs('user prompt', baseOpts);
    expect(args).toContain('--resume');
    expect(args).toContain('ses_god_abc');
    expect(args).not.toContain('--system-prompt');
    expect(args).toContain('--tools');
  });

  it('resume round still includes -p, --output-format, --verbose, --add-dir', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_god_abc');
    const args = adapter.buildArgs('user prompt', baseOpts);
    expect(args).toContain('-p');
    expect(args).toContain('user prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--add-dir');
  });

  it('resume round with model still includes --model', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_god_abc');
    const args = adapter.buildArgs('user prompt', { ...baseOpts, model: 'claude-opus-4-6' });
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4-6');
  });
});
