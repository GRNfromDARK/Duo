/**
 * Tests for God dynamic prompt generation — simplified.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  generateCoderPrompt,
  generateReviewerPrompt,
} from '../../god/god-prompt-generator.js';

vi.mock('../../god/god-audit.js', () => ({
  appendAuditLog: vi.fn(),
  GodAuditLogger: vi.fn().mockImplementation(() => ({
    log: vi.fn(),
    flush: vi.fn(),
  })),
}));

import { appendAuditLog } from '../../god/god-audit.js';
const mockAppendAuditLog = vi.mocked(appendAuditLog);

describe('God dynamically generates Coder prompt', () => {
  beforeEach(() => {
    mockAppendAuditLog.mockClear();
  });

  test('generates Coder prompt with task goal', () => {
    const prompt = generateCoderPrompt({
      dispatchType: 'code',
      taskGoal: 'Implement login',
    }, {
      sessionDir: '/tmp/test',
      seq: 1,
    });
    expect(prompt).toContain('Implement login');
    expect(prompt).toContain('## Instructions');
  });

  test('writes audit log entry for Coder prompt', () => {
    generateCoderPrompt({
      dispatchType: 'code',
      taskGoal: 'Implement login',
    }, {
      sessionDir: '/tmp/test-session',
      seq: 42,
    });

    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      '/tmp/test-session',
      expect.objectContaining({
        seq: 42,
        decisionType: 'PROMPT_GENERATION',
        decision: expect.objectContaining({ promptType: 'coder', dispatchType: 'code' }),
      }),
    );
  });
});

describe('God dynamically generates Reviewer prompt', () => {
  test('generates Reviewer prompt with task goal and coder output', () => {
    const prompt = generateReviewerPrompt({
      taskGoal: 'Implement login',
      lastCoderOutput: 'Added login endpoint',
    });
    expect(prompt).toContain('Implement login');
    expect(prompt).toContain('## Review Instructions');
    expect(prompt).toContain('Added login endpoint');
  });
});

describe('explore prompt has no execution verbs', () => {
  test('explore Coder prompt does not contain implement/create/write code', () => {
    const prompt = generateCoderPrompt({
      dispatchType: 'explore',
      taskGoal: 'Understand the auth flow',
    }, {
      sessionDir: '/tmp/test',
      seq: 1,
    });
    const lower = prompt.toLowerCase();
    expect(lower).not.toContain('implement');
    expect(lower).not.toContain('create');
    expect(lower).not.toContain('write code');
    expect(lower).toContain('analyze');
  });
});

describe('prompt summary written to audit log', () => {
  beforeEach(() => {
    mockAppendAuditLog.mockClear();
  });

  test('audit log entry contains full prompt summary without truncation', () => {
    const longGoal = 'A'.repeat(1000);
    generateCoderPrompt({
      dispatchType: 'code',
      taskGoal: longGoal,
    }, {
      sessionDir: '/tmp/test',
      seq: 10,
    });
    expect(mockAppendAuditLog).toHaveBeenCalledTimes(1);
    const entry = mockAppendAuditLog.mock.calls[0][1];
    expect(entry.outputSummary).toContain(longGoal);
  });
});
