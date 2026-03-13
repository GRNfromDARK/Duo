/**
 * Tests for Card F.3: Auto Decision — GOD_DECIDING 代理决策
 * Source: FR-008 (AC-025, AC-026, AC-027)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import { GodAutoDecisionSchema } from '../../types/god-schemas.js';

// ── Helper: mock CLIAdapter ──

function createMockAdapter(output: string): CLIAdapter {
  return {
    name: 'mock-god',
    displayName: 'Mock God',
    version: '1.0.0',
    isInstalled: async () => true,
    getVersion: async () => '1.0.0',
    execute(_prompt: string, _opts: ExecOptions): AsyncIterable<OutputChunk> {
      const chunks: OutputChunk[] = [
        { type: 'text', content: output, timestamp: Date.now() },
      ];
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < chunks.length) return { value: chunks[i++], done: false };
              return { value: undefined as unknown as OutputChunk, done: true };
            },
          };
        },
      };
    },
    kill: async () => {},
    isRunning: () => false,
  };
}

// ── Test data ──

const GOD_ACCEPT_OUTPUT = `God analysis: task is complete.

\`\`\`json
{
  "action": "accept",
  "reasoning": "All criteria met, accepting output"
}
\`\`\``;

const GOD_CONTINUE_OUTPUT = `God analysis: need more work.

\`\`\`json
{
  "action": "continue_with_instruction",
  "reasoning": "Need to fix remaining issues",
  "instruction": "Please address the edge case in error handling"
}
\`\`\``;

const GOD_REQUEST_HUMAN_OUTPUT = `God analysis: need human.

\`\`\`json
{
  "action": "request_human",
  "reasoning": "Ambiguous requirement needs human clarification"
}
\`\`\``;

const GOD_MALFORMED_OUTPUT = `God analysis: garbled output here, no JSON.`;

// ── Import module under test ──

import {
  makeAutoDecision,
  makeLocalAutoDecision,
  type AutoDecisionContext,
} from '../../god/auto-decision.js';
import type { RuleEngineResult, ActionContext } from '../../god/rule-engine.js';

describe('GodAutoDecisionSchema (AI-driven)', () => {
  test('rejects request_human action', () => {
    const result = GodAutoDecisionSchema.safeParse({
      action: 'request_human',
      reasoning: 'test',
    });

    expect(result.success).toBe(false);
  });

  test('accepts accept action', () => {
    const result = GodAutoDecisionSchema.safeParse({
      action: 'accept',
      reasoning: 'task complete',
    });

    expect(result.success).toBe(true);
  });

  test('accepts continue_with_instruction action', () => {
    const result = GodAutoDecisionSchema.safeParse({
      action: 'continue_with_instruction',
      reasoning: 'needs more work',
      instruction: 'fix the bug',
    });

    expect(result.success).toBe(true);
  });
});

describe('makeAutoDecision', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'auto-decision-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeContext(overrides?: Partial<AutoDecisionContext>): AutoDecisionContext {
    return {
      round: 3,
      maxRounds: 10,
      taskGoal: 'Implement user login',
      sessionDir: tempDir,
      seq: 1,
      waitingReason: 'converged',
      ...overrides,
    };
  }

  function noBlockRuleEngine(_action: ActionContext): RuleEngineResult {
    return { blocked: false, results: [] };
  }

  function blockRuleEngine(_action: ActionContext): RuleEngineResult {
    return {
      blocked: true,
      results: [
        {
          ruleId: 'R-001',
          level: 'block',
          matched: true,
          description: 'File write outside ~/Documents',
          details: 'Blocked by test',
        },
      ],
    };
  }

  function createPromptCapturingAdapter(output: string): {
    adapter: CLIAdapter;
    getPrompt(): string;
  } {
    let capturedPrompt = '';
    const baseAdapter = createMockAdapter(output);

    return {
      adapter: {
        ...baseAdapter,
        execute(prompt: string, opts: ExecOptions): AsyncIterable<OutputChunk> {
          capturedPrompt = prompt;
          return baseAdapter.execute(prompt, opts);
        },
      },
      getPrompt: () => capturedPrompt,
    };
  }

  // AC-025: Rule engine block prevents agent decision execution
  test('AC-025: rule engine block → decision not executed, blocked=true', async () => {
    const adapter = createMockAdapter(GOD_CONTINUE_OUTPUT);
    const ctx = makeContext();

    const result = await makeAutoDecision(adapter, ctx, blockRuleEngine);

    expect(result.blocked).toBe(true);
    expect(result.ruleCheck.blocked).toBe(true);
    // Decision should still be extracted for preview but marked blocked
    expect(result.decision.action).toBeDefined();
  });

  test('accept decision with no rule block → blocked=false', async () => {
    const adapter = createMockAdapter(GOD_ACCEPT_OUTPUT);
    const ctx = makeContext();

    const result = await makeAutoDecision(adapter, ctx, noBlockRuleEngine);

    expect(result.blocked).toBe(false);
    expect(result.decision.action).toBe('accept');
    expect(result.decision.reasoning).toBe('All criteria met, accepting output');
  });

  test('continue_with_instruction extracts instruction field', async () => {
    const adapter = createMockAdapter(GOD_CONTINUE_OUTPUT);
    const ctx = makeContext();

    const result = await makeAutoDecision(adapter, ctx, noBlockRuleEngine);

    expect(result.blocked).toBe(false);
    expect(result.decision.action).toBe('continue_with_instruction');
    expect(result.decision.instruction).toBe('Please address the edge case in error handling');
  });

  test('request_human output falls back to an autonomous local decision', async () => {
    const adapter = createMockAdapter(GOD_REQUEST_HUMAN_OUTPUT);
    const ctx = makeContext({
      waitingReason: 'loop_detected',
      unresolvedIssues: ['Resolve the API direction and continue implementation'],
    });

    const result = await makeAutoDecision(adapter, ctx, noBlockRuleEngine);

    expect(result.blocked).toBe(false);
    expect(result.decision.action).toBe('continue_with_instruction');
    expect(result.decision.instruction).toContain('Resolve the API direction');
  });

  test('malformed God output falls back to autonomous continuation', async () => {
    const adapter = createMockAdapter(GOD_MALFORMED_OUTPUT);
    const ctx = makeContext({
      currentPhaseId: 'phase-2',
      currentPhaseType: 'code',
    });

    const result = await makeAutoDecision(adapter, ctx, noBlockRuleEngine);

    expect(result.decision.action).toBe('continue_with_instruction');
    expect(result.decision.reasoning).toContain('Local fallback');
  });

  // AC-027: reasoning written to audit log
  test('AC-027: reasoning written to audit log', async () => {
    const adapter = createMockAdapter(GOD_ACCEPT_OUTPUT);
    const ctx = makeContext();

    await makeAutoDecision(adapter, ctx, noBlockRuleEngine);

    const logPath = join(tempDir, 'god-audit.jsonl');
    const logContent = readFileSync(logPath, 'utf-8');
    const entry = JSON.parse(logContent.trim());

    expect(entry.decisionType).toBe('AUTO_DECISION');
    expect(entry.outputSummary).toContain('accept');
    expect(entry.round).toBe(3);
  });

  test('blocked decision also writes audit log with blocked flag', async () => {
    const adapter = createMockAdapter(GOD_CONTINUE_OUTPUT);
    const ctx = makeContext();

    await makeAutoDecision(adapter, ctx, blockRuleEngine);

    const logPath = join(tempDir, 'god-audit.jsonl');
    const logContent = readFileSync(logPath, 'utf-8');
    const entry = JSON.parse(logContent.trim());

    expect(entry.decisionType).toBe('AUTO_DECISION');
    expect(entry.decision.blocked).toBe(true);
  });

  test('includes phase and output context in the God prompt', async () => {
    const { adapter, getPrompt } = createPromptCapturingAdapter(GOD_ACCEPT_OUTPUT);
    const ctx = makeContext({
      currentPhaseId: 'phase-2',
      currentPhaseType: 'code',
      phases: [
        { id: 'phase-1', name: 'Explore', type: 'explore', description: 'Explore the codebase' },
        { id: 'phase-2', name: 'Code', type: 'code', description: 'Implement the change' },
      ],
      lastCoderOutput: 'Coder chose REST and implemented the endpoint.',
      lastReviewerOutput: '[CHANGES_REQUESTED] Add null checks.',
    });

    await makeAutoDecision(adapter, ctx, noBlockRuleEngine);

    expect(getPrompt()).toContain('Current Phase: phase-2');
    expect(getPrompt()).toContain('Last Coder Output');
    expect(getPrompt()).toContain('Last Reviewer Output');
  });
});

describe('makeLocalAutoDecision', () => {
  test('accepts when reviewer approved and no unresolved issues remain', () => {
    const result = makeLocalAutoDecision({
      round: 1,
      maxRounds: 10,
      taskGoal: 'Implement feature',
      sessionDir: '/tmp/test',
      seq: 1,
      waitingReason: 'converged',
      lastReviewerOutput: '[APPROVED] Looks good',
      unresolvedIssues: [],
    }, () => ({ blocked: false, results: [] }));

    expect(result.decision.action).toBe('accept');
  });

  test('continues with instruction when unresolved issues remain', () => {
    const result = makeLocalAutoDecision({
      round: 2,
      maxRounds: 10,
      taskGoal: 'Implement feature',
      sessionDir: '/tmp/test',
      seq: 1,
      waitingReason: 'loop_detected',
      unresolvedIssues: ['Fix failing login validation'],
    }, () => ({ blocked: false, results: [] }));

    expect(result.decision.action).toBe('continue_with_instruction');
    expect(result.decision.instruction).toContain('Fix failing login validation');
  });
});
