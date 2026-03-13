/**
 * Tests for Card B.3: God Convergence — Reviewer-Authority
 * Source: FR-005 (AC-019, AC-019a, AC-019b, AC-020)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import type { GodConvergenceJudgment } from '../../types/god-schemas.js';

// ── Helper: create a mock CLIAdapter ──

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

const CONVERGENCE_APPROVED = `God convergence analysis: all criteria met.

\`\`\`json
{
  "classification": "approved",
  "shouldTerminate": true,
  "reason": "approved",
  "blockingIssueCount": 0,
  "criteriaProgress": [
    { "criterion": "Login form renders correctly", "satisfied": true },
    { "criterion": "Auth API integration works", "satisfied": true }
  ],
  "reviewerVerdict": "Reviewer approved with no blocking issues"
}
\`\`\``;

const CONVERGENCE_CHANGES_REQUESTED = `God convergence analysis: issues remain.

\`\`\`json
{
  "classification": "changes_requested",
  "shouldTerminate": false,
  "reason": null,
  "blockingIssueCount": 2,
  "criteriaProgress": [
    { "criterion": "Login form renders correctly", "satisfied": true },
    { "criterion": "Auth API integration works", "satisfied": false }
  ],
  "reviewerVerdict": "Reviewer found 2 blocking issues: missing error handling, no input validation"
}
\`\`\``;

const CONVERGENCE_INCONSISTENT_TERMINATE_WITH_BLOCKING = `God convergence (inconsistent).

\`\`\`json
{
  "classification": "approved",
  "shouldTerminate": true,
  "reason": "approved",
  "blockingIssueCount": 3,
  "criteriaProgress": [
    { "criterion": "Feature complete", "satisfied": true }
  ],
  "reviewerVerdict": "Reviewer found issues but God approved anyway"
}
\`\`\``;

const CONVERGENCE_INCONSISTENT_TERMINATE_WITH_UNSATISFIED = `God convergence (inconsistent).

\`\`\`json
{
  "classification": "approved",
  "shouldTerminate": true,
  "reason": "approved",
  "blockingIssueCount": 0,
  "criteriaProgress": [
    { "criterion": "Feature A", "satisfied": true },
    { "criterion": "Feature B", "satisfied": false }
  ],
  "reviewerVerdict": "Reviewer approved"
}
\`\`\``;

const CONVERGENCE_MAX_ROUNDS_FORCED = `God convergence: forced by max rounds.

\`\`\`json
{
  "classification": "changes_requested",
  "shouldTerminate": true,
  "reason": "max_rounds",
  "blockingIssueCount": 1,
  "criteriaProgress": [
    { "criterion": "Feature A", "satisfied": true },
    { "criterion": "Feature B", "satisfied": false }
  ],
  "reviewerVerdict": "Reviewer still has issues"
}
\`\`\``;

const CONVERGENCE_LOOP_FORCED = `God convergence: loop detected forced termination.

\`\`\`json
{
  "classification": "changes_requested",
  "shouldTerminate": true,
  "reason": "loop_detected",
  "blockingIssueCount": 1,
  "criteriaProgress": [
    { "criterion": "Feature A", "satisfied": true },
    { "criterion": "Feature B", "satisfied": false }
  ],
  "reviewerVerdict": "Same issues keep recurring"
}
\`\`\``;

// ── Tests ──

describe('God Convergence', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = join(tmpdir(), `god-convergence-test-${Date.now()}`);
    mkdirSync(sessionDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  // ── AC-1: shouldTerminate: true when blockingIssueCount is 0 ──

  describe('AC-019: shouldTerminate + blockingIssueCount invariant', () => {
    test('approved convergence: shouldTerminate true with blockingIssueCount 0', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_APPROVED);

      const result = await evaluateConvergence(adapter, '[APPROVED] All good', {
        round: 3,
        maxRounds: 10,
        taskGoal: 'Implement login',
        terminationCriteria: ['Login form renders correctly', 'Auth API integration works'],
        convergenceLog: [],
        sessionDir,
        seq: 1,
      });

      expect(result.shouldTerminate).toBe(true);
      expect(result.judgment.blockingIssueCount).toBe(0);
    });

    test('inconsistent: shouldTerminate true with blockingIssueCount > 0 is corrected', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_INCONSISTENT_TERMINATE_WITH_BLOCKING);

      const result = await evaluateConvergence(adapter, 'Reviewer found issues', {
        round: 3,
        maxRounds: 10,
        taskGoal: 'Implement login',
        terminationCriteria: ['Feature complete'],
        convergenceLog: [],
        sessionDir,
        seq: 2,
      });

      // Consistency enforcement: should NOT terminate when blocking issues exist
      expect(result.shouldTerminate).toBe(false);
    });
  });

  // ── AC-2: shouldTerminate: true when all criteriaProgress satisfied ──

  describe('AC-019a: criteriaProgress invariant', () => {
    test('all criteria satisfied allows termination', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_APPROVED);

      const result = await evaluateConvergence(adapter, '[APPROVED]', {
        round: 3,
        maxRounds: 10,
        taskGoal: 'Implement login',
        terminationCriteria: ['Login form renders correctly', 'Auth API integration works'],
        convergenceLog: [],
        sessionDir,
        seq: 3,
      });

      expect(result.shouldTerminate).toBe(true);
      expect(result.judgment.criteriaProgress.every(c => c.satisfied)).toBe(true);
    });

    test('unsatisfied criteria with shouldTerminate true is corrected (non-exception)', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_INCONSISTENT_TERMINATE_WITH_UNSATISFIED);

      const result = await evaluateConvergence(adapter, '[APPROVED]', {
        round: 3,
        maxRounds: 10,
        taskGoal: 'Implement features',
        terminationCriteria: ['Feature A', 'Feature B'],
        convergenceLog: [],
        sessionDir,
        seq: 4,
      });

      // Consistency enforcement: should NOT terminate with unsatisfied criteria
      expect(result.shouldTerminate).toBe(false);
    });

    test('max_rounds exception: terminates even with unsatisfied criteria', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_MAX_ROUNDS_FORCED);

      const result = await evaluateConvergence(adapter, 'Still has issues', {
        round: 10,
        maxRounds: 10,
        taskGoal: 'Implement features',
        terminationCriteria: ['Feature A', 'Feature B'],
        convergenceLog: [],
        sessionDir,
        seq: 5,
      });

      // max_rounds exception: forced termination
      expect(result.shouldTerminate).toBe(true);
      expect(result.terminationReason).toBe('max_rounds');
    });

    test('loop_detected with 3 rounds no improvement: forced termination', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_LOOP_FORCED);

      // 3 prior rounds of stagnation in convergenceLog
      const stagnantLog = [
        { round: 3, timestamp: '2026-01-01T00:00:00Z', classification: 'changes_requested', shouldTerminate: false, blockingIssueCount: 2, criteriaProgress: [{ criterion: 'Feature B', satisfied: false }], summary: 'Round 3: 2 blocking issues' },
        { round: 4, timestamp: '2026-01-01T00:01:00Z', classification: 'changes_requested', shouldTerminate: false, blockingIssueCount: 2, criteriaProgress: [{ criterion: 'Feature B', satisfied: false }], summary: 'Round 4: 2 blocking issues' },
        { round: 5, timestamp: '2026-01-01T00:02:00Z', classification: 'changes_requested', shouldTerminate: false, blockingIssueCount: 2, criteriaProgress: [{ criterion: 'Feature B', satisfied: false }], summary: 'Round 5: 2 blocking issues' },
      ];

      const result = await evaluateConvergence(adapter, 'Same issues again', {
        round: 6,
        maxRounds: 10,
        taskGoal: 'Implement features',
        terminationCriteria: ['Feature A', 'Feature B'],
        convergenceLog: stagnantLog,
        sessionDir,
        seq: 6,
      });

      // loop_detected with 3 rounds no improvement: forced termination
      expect(result.shouldTerminate).toBe(true);
      expect(result.terminationReason).toBe('loop_detected');
    });
  });

  // ── AC-3: God cannot terminate without Reviewer review ──

  describe('AC-019b: Reviewer-authority', () => {
    test('empty reviewer output prevents shouldTerminate: true', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_APPROVED);

      const result = await evaluateConvergence(adapter, '', {
        round: 3,
        maxRounds: 10,
        taskGoal: 'Implement login',
        terminationCriteria: ['Login form renders correctly', 'Auth API integration works'],
        convergenceLog: [],
        sessionDir,
        seq: 7,
      });

      // Without Reviewer output, cannot terminate
      expect(result.shouldTerminate).toBe(false);
    });
  });

  // ── AC-4: convergenceLog correctly appended ──

  describe('AC-020: convergenceLog recording', () => {
    test('convergence result is appended to convergenceLog', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_CHANGES_REQUESTED);

      const convergenceLog: any[] = [];

      await evaluateConvergence(adapter, 'Found 2 blocking issues', {
        round: 2,
        maxRounds: 10,
        taskGoal: 'Implement login',
        terminationCriteria: ['Login form renders correctly', 'Auth API integration works'],
        convergenceLog,
        sessionDir,
        seq: 8,
      });

      // convergenceLog should now have 1 entry
      expect(convergenceLog).toHaveLength(1);
      expect(convergenceLog[0].round).toBe(2);
      expect(convergenceLog[0].classification).toBe('changes_requested');
      expect(convergenceLog[0].shouldTerminate).toBe(false);
      expect(convergenceLog[0].blockingIssueCount).toBe(2);
      expect(convergenceLog[0].criteriaProgress).toHaveLength(2);
      expect(typeof convergenceLog[0].timestamp).toBe('string');
      expect(convergenceLog[0].summary.length).toBeLessThanOrEqual(200);
    });

    test('convergenceLog preserves previous entries', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter(CONVERGENCE_APPROVED);

      const convergenceLog: any[] = [
        { round: 1, timestamp: '2026-01-01T00:00:00Z', classification: 'changes_requested', shouldTerminate: false, blockingIssueCount: 3, criteriaProgress: [], summary: 'Round 1' },
      ];

      await evaluateConvergence(adapter, '[APPROVED]', {
        round: 2,
        maxRounds: 10,
        taskGoal: 'Implement login',
        terminationCriteria: ['Login form renders correctly', 'Auth API integration works'],
        convergenceLog,
        sessionDir,
        seq: 9,
      });

      expect(convergenceLog).toHaveLength(2);
      expect(convergenceLog[0].round).toBe(1);
      expect(convergenceLog[1].round).toBe(2);
    });
  });

  // ── AC-5: max_rounds forced termination ──

  describe('AC-019a exception: max_rounds', () => {
    test('max_rounds reached forces termination regardless of criteria', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      // Even if God says shouldTerminate: false, max_rounds overrides
      const adapter = createMockAdapter(CONVERGENCE_CHANGES_REQUESTED);

      const result = await evaluateConvergence(adapter, 'Still has issues', {
        round: 10,
        maxRounds: 10,
        taskGoal: 'Implement features',
        terminationCriteria: ['Feature A'],
        convergenceLog: [],
        sessionDir,
        seq: 10,
      });

      expect(result.shouldTerminate).toBe(true);
      expect(result.terminationReason).toBe('max_rounds');
    });
  });

  // ── AC-6: validateConvergenceConsistency detects contradictions ──

  describe('validateConvergenceConsistency', () => {
    test('shouldTerminate true with blockingIssueCount > 0 is violation', async () => {
      const { validateConvergenceConsistency } = await import('../../god/god-convergence.js');

      const judgment: GodConvergenceJudgment = {
        classification: 'approved',
        shouldTerminate: true,
        reason: 'approved',
        blockingIssueCount: 3,
        criteriaProgress: [{ criterion: 'Feature A', satisfied: true }],
        reviewerVerdict: 'Approved',
      };

      const result = validateConvergenceConsistency(judgment);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some(v => v.includes('blockingIssueCount'))).toBe(true);
    });

    test('shouldTerminate true with unsatisfied criteria is violation', async () => {
      const { validateConvergenceConsistency } = await import('../../god/god-convergence.js');

      const judgment: GodConvergenceJudgment = {
        classification: 'approved',
        shouldTerminate: true,
        reason: 'approved',
        blockingIssueCount: 0,
        criteriaProgress: [
          { criterion: 'Feature A', satisfied: true },
          { criterion: 'Feature B', satisfied: false },
        ],
        reviewerVerdict: 'Approved',
      };

      const result = validateConvergenceConsistency(judgment);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes('criteriaProgress'))).toBe(true);
    });

    test('max_rounds exception: not a violation', async () => {
      const { validateConvergenceConsistency } = await import('../../god/god-convergence.js');

      const judgment: GodConvergenceJudgment = {
        classification: 'changes_requested',
        shouldTerminate: true,
        reason: 'max_rounds',
        blockingIssueCount: 1,
        criteriaProgress: [{ criterion: 'Feature A', satisfied: false }],
        reviewerVerdict: 'Issues remain',
      };

      const result = validateConvergenceConsistency(judgment);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test('loop_detected exception: not a violation', async () => {
      const { validateConvergenceConsistency } = await import('../../god/god-convergence.js');

      const judgment: GodConvergenceJudgment = {
        classification: 'changes_requested',
        shouldTerminate: true,
        reason: 'loop_detected',
        blockingIssueCount: 1,
        criteriaProgress: [{ criterion: 'Feature A', satisfied: false }],
        reviewerVerdict: 'Loop detected',
      };

      const result = validateConvergenceConsistency(judgment);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test('consistent judgment: shouldTerminate false with issues is valid', async () => {
      const { validateConvergenceConsistency } = await import('../../god/god-convergence.js');

      const judgment: GodConvergenceJudgment = {
        classification: 'changes_requested',
        shouldTerminate: false,
        reason: null,
        blockingIssueCount: 2,
        criteriaProgress: [{ criterion: 'Feature A', satisfied: false }],
        reviewerVerdict: 'Changes requested',
      };

      const result = validateConvergenceConsistency(judgment);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test('approved with blockingIssueCount > 0 is classification violation', async () => {
      const { validateConvergenceConsistency } = await import('../../god/god-convergence.js');

      const judgment: GodConvergenceJudgment = {
        classification: 'approved',
        shouldTerminate: false,
        reason: null,
        blockingIssueCount: 2,
        criteriaProgress: [{ criterion: 'Feature A', satisfied: true }],
        reviewerVerdict: 'Approved somehow',
      };

      const result = validateConvergenceConsistency(judgment);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes('approved') && v.includes('blockingIssueCount'))).toBe(true);
    });
  });

  // ── Extraction failure fallback ──

  describe('extraction failure', () => {
    test('falls back to changes_requested on extraction failure', async () => {
      const { evaluateConvergence } = await import('../../god/god-convergence.js');
      const adapter = createMockAdapter('No JSON here, just text.');

      const result = await evaluateConvergence(adapter, 'Reviewer output', {
        round: 3,
        maxRounds: 10,
        taskGoal: 'Implement login',
        terminationCriteria: ['Feature A'],
        convergenceLog: [],
        sessionDir,
        seq: 20,
      });

      // Safe fallback: do not terminate
      expect(result.shouldTerminate).toBe(false);
      expect(result.judgment.classification).toBe('changes_requested');
    });
  });
});
