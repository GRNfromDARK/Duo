/**
 * Tests for God Prompt Generator — simplified with dispatchType.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { PromptContext } from '../../god/god-prompt-generator.js';
import {
  generateCoderPrompt,
  generateReviewerPrompt,
} from '../../god/god-prompt-generator.js';

vi.mock('../../god/god-audit.js', () => ({
  appendAuditLog: vi.fn(),
}));

import { appendAuditLog } from '../../god/god-audit.js';
const mockAppendAuditLog = vi.mocked(appendAuditLog);

function makePromptContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    dispatchType: 'code',
    taskGoal: 'Implement user authentication',
    ...overrides,
  };
}

describe('dispatchType → Prompt strategy mapping', () => {
  test('explore prompt does NOT contain execution verbs', () => {
    const ctx = makePromptContext({ dispatchType: 'explore', taskGoal: 'Understand the authentication flow' });
    const prompt = generateCoderPrompt(ctx);
    const executionVerbs = ['implement', 'create', 'write code', 'build', 'develop'];
    for (const verb of executionVerbs) {
      expect(prompt.toLowerCase()).not.toContain(verb);
    }
    expect(prompt.toLowerCase()).toMatch(/analy[sz]e|investigate|explore|suggest|recommend|examine/);
  });

  test('code prompt contains coding instructions', () => {
    const ctx = makePromptContext({ dispatchType: 'code' });
    const prompt = generateCoderPrompt(ctx);
    expect(prompt.toLowerCase()).toMatch(/implement|code|write|build|develop/);
  });

  test('debug prompt contains debugging instructions', () => {
    const ctx = makePromptContext({ dispatchType: 'debug' });
    const prompt = generateCoderPrompt(ctx);
    expect(prompt.toLowerCase()).toMatch(/debug|diagnose|fix|trace|root cause/);
  });

  test('discuss prompt contains discussion instructions', () => {
    const ctx = makePromptContext({ dispatchType: 'discuss' });
    const prompt = generateCoderPrompt(ctx);
    expect(prompt.toLowerCase()).toMatch(/discuss|consider|evaluate|weigh|pros|cons/);
  });

  test('task goal is always included', () => {
    const ctx = makePromptContext({ taskGoal: 'Build REST API' });
    const prompt = generateCoderPrompt(ctx);
    expect(prompt).toContain('Build REST API');
  });
});

describe('Prompt quality assurance', () => {
  test('prompt includes full task goal without truncation', () => {
    const taskGoal = 'A'.repeat(50000);
    const ctx = makePromptContext({ taskGoal });
    const prompt = generateCoderPrompt(ctx);
    expect(prompt).toContain(taskGoal);
  });

  test('prompt summary is written to audit log', () => {
    mockAppendAuditLog.mockClear();
    const ctx = makePromptContext({ dispatchType: 'code' });
    generateCoderPrompt(ctx, { sessionDir: '/tmp/test-session', seq: 1 });
    expect(mockAppendAuditLog).toHaveBeenCalledOnce();
    const entry = mockAppendAuditLog.mock.calls[0][1];
    expect(entry.decisionType).toBe('PROMPT_GENERATION');
  });

  test('no audit log when sessionDir not provided', () => {
    mockAppendAuditLog.mockClear();
    const ctx = makePromptContext({ dispatchType: 'code' });
    generateCoderPrompt(ctx);
    expect(mockAppendAuditLog).not.toHaveBeenCalled();
  });
});

describe('generateReviewerPrompt', () => {
  test('generates reviewer prompt with coder output', () => {
    const prompt = generateReviewerPrompt({
      taskGoal: 'Build API',
      lastCoderOutput: 'Added endpoint',
    });
    expect(prompt).toContain('Build API');
    expect(prompt).toContain('Added endpoint');
  });

  test('all reviewer prompts include anti-nitpick verdict rules', () => {
    const prompt = generateReviewerPrompt({
      taskGoal: 'Test task',
    });
    expect(prompt).toContain('do not withhold approval for non-blocking suggestions');
  });
});

describe('Reviewer Feedback Direct Forwarding', () => {
  test('injects Reviewer Feedback section when lastReviewerOutput is present', () => {
    const ctx = makePromptContext({
      dispatchType: 'code',
      lastReviewerOutput: '[CHANGES_REQUESTED]\n1. Missing null check on line 42',
      instruction: 'Fix the issues identified by the Reviewer',
    });
    const prompt = generateCoderPrompt(ctx);
    expect(prompt).toContain('Reviewer Feedback');
    expect(prompt).toContain('Missing null check on line 42');
  });
});
