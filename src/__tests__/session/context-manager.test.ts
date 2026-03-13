/**
 * Tests for ContextManager — builds prompts for Coder/Reviewer LLMs.
 * Source: FR-003 (AC-009, AC-010, AC-011)
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { ContextManager } from '../../session/context-manager.js';
import type { RoundRecord } from '../../session/context-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Helper to create a round record
function makeRound(index: number, opts?: Partial<RoundRecord>): RoundRecord {
  return {
    index,
    coderOutput: opts?.coderOutput ?? `Coder output for round ${index}`,
    reviewerOutput: opts?.reviewerOutput ?? `Reviewer output for round ${index}`,
    summary: opts?.summary,
    timestamp: opts?.timestamp ?? Date.now(),
  };
}

describe('ContextManager', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager({ contextWindowSize: 8000 });
  });

  // ============================================================
  // AC-1: Coder/Reviewer prompt templates
  // ============================================================
  describe('Coder prompt template', () => {
    test('contains system role definition', () => {
      const prompt = cm.buildCoderPrompt('Implement login feature', []);
      expect(prompt).toContain('Coder');
    });

    test('contains task description', () => {
      const prompt = cm.buildCoderPrompt('Implement login feature', []);
      expect(prompt).toContain('Implement login feature');
    });

    test('contains "do not ask questions" instruction', () => {
      const prompt = cm.buildCoderPrompt('Fix bug', []);
      // The prompt should instruct the coder not to ask questions
      expect(prompt.toLowerCase()).toMatch(/不要提问|do not ask|don't ask/i);
    });

    test('includes reviewer feedback when provided', () => {
      const prompt = cm.buildCoderPrompt('Fix bug', [], {
        reviewerFeedback: 'Line 42: missing null check',
      });
      expect(prompt).toContain('Line 42: missing null check');
    });

    test('includes interrupt instruction when provided', () => {
      const prompt = cm.buildCoderPrompt('Fix bug', [], {
        interruptInstruction: 'Stop and use a different approach',
      });
      expect(prompt).toContain('Stop and use a different approach');
    });
  });

  describe('Reviewer prompt template', () => {
    test('contains system role definition', () => {
      const prompt = cm.buildReviewerPrompt('Implement login', [], 'code output');
      expect(prompt).toContain('Reviewer');
    });

    test('contains task description', () => {
      const prompt = cm.buildReviewerPrompt('Implement login', [], 'code output');
      expect(prompt).toContain('Implement login');
    });

    test('contains review criteria with location/problem/fix structure', () => {
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'code output');
      expect(prompt.toLowerCase()).toMatch(/location|problem|fix/i);
    });

    test('includes current coder output', () => {
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'function add(a, b) { return a + b; }');
      expect(prompt).toContain('function add(a, b) { return a + b; }');
    });

    test('includes interrupt instruction when provided', () => {
      const prompt = cm.buildReviewerPrompt(
        'Fix bug',
        [],
        'function add(a, b) { return a + b; }',
        { interruptInstruction: 'Re-review with a security focus' },
      );
      expect(prompt).toContain('Re-review with a security focus');
    });

    test('includes round number in reviewer prompt', () => {
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'code output', { roundNumber: 3 });
      expect(prompt).toContain('Round 3');
    });

    test('defaults round number to 1 when not provided', () => {
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'code output');
      expect(prompt).toContain('Round 1');
    });

    test('includes previous feedback checklist when previousReviewerOutput provided', () => {
      const previousOutput = '1. **Location**: foo.ts:42\n   **Problem**: missing null check\n\n**Blocking**: SQL injection\n\n[CHANGES_REQUESTED]';
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'new code', {
        roundNumber: 2,
        previousReviewerOutput: previousOutput,
      });
      expect(prompt).toContain('Previous Round Feedback');
      expect(prompt).toContain('foo.ts:42');
    });

    test('groups multi-line issues into single checklist entries (no double-numbering)', () => {
      const previousOutput = [
        '1. **Location**: foo.ts:42',
        '   **Problem**: missing null check',
        '   **Fix**: add guard',
        '',
        '2. **Location**: bar.ts:9',
        '   **Problem**: SQL injection',
        '   **Fix**: parameterize query',
        '',
        'Blocking: 2',
        '[CHANGES_REQUESTED]',
      ].join('\n');
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'new code', {
        roundNumber: 2,
        previousReviewerOutput: previousOutput,
      });
      // Should have exactly 2 checklist entries, not 6 individual lines
      expect(prompt).toContain('1. ');
      expect(prompt).toContain('2. ');
      // No double-numbering like "1. 1. **Location**"
      expect(prompt).not.toMatch(/\d+\.\s+\d+\.\s+\*\*/);
      // Should contain grouped summary with location and problem
      expect(prompt).toContain('foo.ts:42');
      expect(prompt).toContain('missing null check');
      expect(prompt).toContain('bar.ts:9');
      expect(prompt).toContain('SQL injection');
    });

    test('does not include previous feedback checklist for round 1', () => {
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'code output', { roundNumber: 1 });
      expect(prompt).not.toContain('Previous Round Feedback');
    });

    test('contains verdict decision tree with Blocking count → verdict', () => {
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'code output');
      expect(prompt).toContain('Blocking count = 0');
      expect(prompt).toContain('[APPROVED]');
      expect(prompt).toContain('[CHANGES_REQUESTED]');
    });

    test('contains structured blocking count instruction', () => {
      const prompt = cm.buildReviewerPrompt('Fix bug', [], 'code output');
      expect(prompt).toMatch(/Blocking:\s*N/);
    });
  });

  // ============================================================
  // AC-2: Round summary generation ≤200 tokens
  // ============================================================
  describe('Round summary generation', () => {
    test('generates summary from text', () => {
      const summary = cm.generateSummary('This is a long output from the coder about implementing login with JWT tokens and password hashing.');
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    });

    test('summary does not exceed 200 tokens (approximate: 800 chars)', () => {
      const longText = 'word '.repeat(500); // ~500 words
      const summary = cm.generateSummary(longText);
      // Approximate token count: 1 token ≈ 4 chars in English
      // 200 tokens ≈ 800 chars max
      expect(summary.length).toBeLessThanOrEqual(800);
    });

    test('short text is returned as-is when under limit', () => {
      const shortText = 'Fixed the bug in login.';
      const summary = cm.generateSummary(shortText);
      expect(summary).toBe(shortText);
    });
  });

  // ============================================================
  // AC-4: Token budget management
  // ============================================================
  describe('Token budget management', () => {
    test('last 3 rounds are included in full', () => {
      const rounds = [
        makeRound(1),
        makeRound(2),
        makeRound(3),
        makeRound(4),
        makeRound(5),
      ];
      const prompt = cm.buildCoderPrompt('Task', rounds);
      // Rounds 3, 4, 5 (last 3) should be in full
      expect(prompt).toContain('Coder output for round 3');
      expect(prompt).toContain('Coder output for round 4');
      expect(prompt).toContain('Coder output for round 5');
    });

    test('older rounds use summaries instead of full content', () => {
      const rounds = [
        makeRound(1, { summary: 'Summary of round 1' }),
        makeRound(2, { summary: 'Summary of round 2' }),
        makeRound(3),
        makeRound(4),
        makeRound(5),
      ];
      const prompt = cm.buildCoderPrompt('Task', rounds);
      // Older rounds should use summaries
      expect(prompt).toContain('Summary of round 1');
      expect(prompt).toContain('Summary of round 2');
      // Older rounds should NOT include full output
      expect(prompt).not.toContain('Coder output for round 1');
      expect(prompt).not.toContain('Coder output for round 2');
    });

    test('total prompt does not exceed 80% of context window', () => {
      // contextWindowSize is in tokens; budget = tokens * CHARS_PER_TOKEN(4) * 0.8
      const cm80 = new ContextManager({ contextWindowSize: 1000 });
      const longOutput = 'x'.repeat(2000);
      const rounds = [
        makeRound(1, { coderOutput: longOutput, reviewerOutput: longOutput }),
        makeRound(2, { coderOutput: longOutput, reviewerOutput: longOutput }),
        makeRound(3, { coderOutput: longOutput, reviewerOutput: longOutput }),
      ];
      const prompt = cm80.buildCoderPrompt('Task', rounds);
      // 80% of 1000 tokens * 4 chars/token = 3200 chars max
      // The prompt should be truncated to fit
      expect(prompt.length).toBeLessThanOrEqual(3200);
    });

    test('with fewer than 3 rounds, all are included in full', () => {
      const rounds = [makeRound(1), makeRound(2)];
      const prompt = cm.buildCoderPrompt('Task', rounds);
      expect(prompt).toContain('Coder output for round 1');
      expect(prompt).toContain('Coder output for round 2');
    });
  });

  // ============================================================
  // AC-3: Prompt template files in .duo/prompts/
  // ============================================================
  describe('Prompt template customization', () => {
    const testPromptsDir = '/tmp/duo-test-prompts-' + Date.now();

    beforeEach(() => {
      fs.mkdirSync(testPromptsDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(testPromptsDir, { recursive: true, force: true });
    });

    test('loads custom coder template from promptsDir', () => {
      const customTemplate = 'You are a custom coder. Task: {{task}}. Do not ask questions.';
      fs.writeFileSync(path.join(testPromptsDir, 'coder.md'), customTemplate);

      const cmCustom = new ContextManager({
        contextWindowSize: 8000,
        promptsDir: testPromptsDir,
      });
      const prompt = cmCustom.buildCoderPrompt('Build a widget', []);
      expect(prompt).toContain('You are a custom coder');
      expect(prompt).toContain('Build a widget');
    });

    test('loads custom reviewer template from promptsDir', () => {
      const customTemplate = 'You are a custom reviewer. Task: {{task}}. Give line-level feedback.';
      fs.writeFileSync(path.join(testPromptsDir, 'reviewer.md'), customTemplate);

      const cmCustom = new ContextManager({
        contextWindowSize: 8000,
        promptsDir: testPromptsDir,
      });
      const prompt = cmCustom.buildReviewerPrompt('Build a widget', [], 'output');
      expect(prompt).toContain('You are a custom reviewer');
      expect(prompt).toContain('Build a widget');
    });

    test('falls back to default template when custom file not found', () => {
      const cmCustom = new ContextManager({
        contextWindowSize: 8000,
        promptsDir: testPromptsDir, // empty dir
      });
      const prompt = cmCustom.buildCoderPrompt('Build a widget', []);
      // Should still produce a valid prompt with defaults
      expect(prompt).toContain('Build a widget');
      expect(prompt.toLowerCase()).toMatch(/不要提问|do not ask|don't ask/i);
    });

    test('getDefaultTemplatesDir returns .duo/prompts path', () => {
      expect(ContextManager.getDefaultTemplatesDir()).toBe('.duo/prompts');
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================
  describe('Edge cases', () => {
    test('empty rounds array produces valid prompt', () => {
      const prompt = cm.buildCoderPrompt('Task', []);
      expect(prompt).toContain('Task');
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('empty task string is handled', () => {
      const prompt = cm.buildCoderPrompt('', []);
      expect(typeof prompt).toBe('string');
    });

    test('task containing {{history}} is not double-replaced (P0-1 regression)', () => {
      const maliciousTask = 'Fix the {{history}} display bug in the template engine';
      const prompt = cm.buildCoderPrompt(maliciousTask, []);
      // The literal {{history}} in the task should survive as-is, not be replaced
      expect(prompt).toContain('Fix the {{history}} display bug in the template engine');
    });

    test('task containing {{interruptInstruction}} is not double-replaced (P0-1 regression)', () => {
      const task = 'Debug the {{interruptInstruction}} placeholder';
      const prompt = cm.buildCoderPrompt(task, []);
      expect(prompt).toContain('Debug the {{interruptInstruction}} placeholder');
    });

    test('coderOutput containing {{task}} is not double-replaced in reviewer prompt (P0-1 regression)', () => {
      const output = 'I fixed the {{task}} rendering issue';
      const prompt = cm.buildReviewerPrompt('Build widget', [], output);
      expect(prompt).toContain('I fixed the {{task}} rendering issue');
      expect(prompt).toContain('Build widget');
    });

    test('custom template with repeated placeholder {{task}} ... {{task}} works', () => {
      const testPromptsDir2 = '/tmp/duo-test-prompts-repeat-' + Date.now();
      fs.mkdirSync(testPromptsDir2, { recursive: true });
      fs.writeFileSync(
        path.join(testPromptsDir2, 'coder.md'),
        'Task: {{task}}\nReminder: {{task}}\n{{history}}',
      );
      const cmRepeat = new ContextManager({
        contextWindowSize: 8000,
        promptsDir: testPromptsDir2,
      });
      const prompt = cmRepeat.buildCoderPrompt('fix login', []);
      // Both placeholders should be replaced
      expect(prompt).toBe('Task: fix login\nReminder: fix login\n');
      fs.rmSync(testPromptsDir2, { recursive: true, force: true });
    });

    test('unknown placeholder {{unknownVar}} is preserved', () => {
      const testPromptsDir3 = '/tmp/duo-test-prompts-unknown-' + Date.now();
      fs.mkdirSync(testPromptsDir3, { recursive: true });
      fs.writeFileSync(
        path.join(testPromptsDir3, 'coder.md'),
        '{{task}} and {{unknownVar}}',
      );
      const cmUnknown = new ContextManager({
        contextWindowSize: 8000,
        promptsDir: testPromptsDir3,
      });
      const prompt = cmUnknown.buildCoderPrompt('test', []);
      expect(prompt).toContain('{{unknownVar}}');
      expect(prompt).toContain('test');
      fs.rmSync(testPromptsDir3, { recursive: true, force: true });
    });

    test('skipHistory omits history section in coder prompt', () => {
      const rounds = [makeRound(1), makeRound(2)];
      const prompt = cm.buildCoderPrompt('Task', rounds, { skipHistory: true });
      expect(prompt).not.toContain('## History');
      expect(prompt).not.toContain('Coder output for round 1');
      expect(prompt).not.toContain('Coder output for round 2');
      expect(prompt).toContain('Task');
    });

    test('skipHistory omits history section in reviewer prompt', () => {
      const rounds = [makeRound(1), makeRound(2)];
      const prompt = cm.buildReviewerPrompt('Task', rounds, 'code output', { skipHistory: true });
      expect(prompt).not.toContain('## History');
      expect(prompt).not.toContain('Coder output for round 1');
      expect(prompt).toContain('code output');
    });

    test('history is included when skipHistory is not set', () => {
      const rounds = [makeRound(1)];
      const prompt = cm.buildCoderPrompt('Task', rounds);
      expect(prompt).toContain('## History');
      expect(prompt).toContain('Coder output for round 1');
    });

    test('rounds without summaries get auto-generated summaries for older rounds', () => {
      const rounds = [
        makeRound(1), // no summary, older than 3
        makeRound(2),
        makeRound(3),
        makeRound(4),
        makeRound(5),
      ];
      const prompt = cm.buildCoderPrompt('Task', rounds);
      // Round 1 & 2 are older, should appear as "(Summary)" not as full "**Coder:**" format
      expect(prompt).toContain('Round 1 (Summary)');
      expect(prompt).toContain('Round 2 (Summary)');
      // Recent rounds should use full format
      expect(prompt).toContain('**Coder:** Coder output for round 3');
      // Should not have reviewer output for summarized rounds
      expect(prompt).not.toContain('Reviewer output for round 1');
    });
  });
});
