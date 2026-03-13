/**
 * Tests for loop-detector.ts — FR-009 (AC-031, AC-032)
 * Verifies dead loop detection based on convergence log patterns.
 */

import { describe, it, expect } from 'vitest';
import {
  detectLoop,
  type LoopDetectionResult,
  type LoopIntervention,
} from '../../god/loop-detector.js';
import type { ConvergenceLogEntry } from '../../god/god-convergence.js';
import type { GodPostReviewerDecision } from '../../types/god-schemas.js';

// ── Helpers ──

function makeLogEntry(overrides: Partial<ConvergenceLogEntry> & { round: number }): ConvergenceLogEntry {
  return {
    timestamp: new Date().toISOString(),
    classification: 'changes_requested',
    shouldTerminate: false,
    blockingIssueCount: 3,
    criteriaProgress: [],
    summary: `Round ${overrides.round}`,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<GodPostReviewerDecision> = {}): GodPostReviewerDecision {
  return {
    action: 'route_to_coder',
    reasoning: 'test',
    confidenceScore: 0.5,
    progressTrend: 'stagnant',
    ...overrides,
  };
}

// ── AC-031: 连续 3 轮停滞触发 loop_detected ──

describe('detectLoop — AC-031: stagnation detection', () => {
  it('should detect loop when 3 consecutive rounds have progressTrend === stagnant', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 3 }),
      makeLogEntry({ round: 2, blockingIssueCount: 3 }),
      makeLogEntry({ round: 3, blockingIssueCount: 3 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'stagnant' }),
    ];

    const result = detectLoop(log, decisions);

    expect(result.detected).toBe(true);
    expect(result.reason).toBeDefined();
    expect(result.suggestedAction).toBeDefined();
  });

  it('should detect loop when blockingIssueCount trend is non-decreasing for 3 rounds', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 5 }),
      makeLogEntry({ round: 2, blockingIssueCount: 5 }),
      makeLogEntry({ round: 3, blockingIssueCount: 6 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'declining' }),
    ];

    const result = detectLoop(log, decisions);

    expect(result.detected).toBe(true);
  });

  it('should detect loop on semantic repetition (same unresolvedIssues across rounds)', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 2 }),
      makeLogEntry({ round: 2, blockingIssueCount: 2 }),
      makeLogEntry({ round: 3, blockingIssueCount: 2 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'stagnant', unresolvedIssues: ['Fix auth bug', 'Add validation'] }),
      makeDecision({ progressTrend: 'stagnant', unresolvedIssues: ['Fix auth bug', 'Add validation'] }),
      makeDecision({ progressTrend: 'stagnant', unresolvedIssues: ['Fix auth bug', 'Add validation'] }),
    ];

    const result = detectLoop(log, decisions);

    expect(result.detected).toBe(true);
    expect(result.reason).toContain('semantic');
  });
});

// ── AC-032: false positive 控制 ──

describe('detectLoop — AC-032: false positive control', () => {
  it('should NOT detect loop when progressTrend is improving', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 5 }),
      makeLogEntry({ round: 2, blockingIssueCount: 3 }),
      makeLogEntry({ round: 3, blockingIssueCount: 1 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'improving' }),
      makeDecision({ progressTrend: 'improving' }),
      makeDecision({ progressTrend: 'improving' }),
    ];

    const result = detectLoop(log, decisions);

    expect(result.detected).toBe(false);
  });

  it('should NOT detect loop with fewer than 3 rounds of data', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 3 }),
      makeLogEntry({ round: 2, blockingIssueCount: 3 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'stagnant' }),
    ];

    const result = detectLoop(log, decisions);

    expect(result.detected).toBe(false);
  });

  it('should NOT detect loop when only 1 of 3 rounds is stagnant', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 5 }),
      makeLogEntry({ round: 2, blockingIssueCount: 3 }),
      makeLogEntry({ round: 3, blockingIssueCount: 3 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'improving' }),
      makeDecision({ progressTrend: 'improving' }),
      makeDecision({ progressTrend: 'stagnant' }),
    ];

    const result = detectLoop(log, decisions);

    expect(result.detected).toBe(false);
  });

  it('should NOT detect loop when blockingIssueCount is decreasing', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 5 }),
      makeLogEntry({ round: 2, blockingIssueCount: 4 }),
      makeLogEntry({ round: 3, blockingIssueCount: 3 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'stagnant' }),
    ];

    const result = detectLoop(log, decisions);

    // Even with stagnant trend labels, if blocking issues are actually decreasing, no loop
    expect(result.detected).toBe(false);
  });

  it('should NOT detect loop with empty convergence log', () => {
    const result = detectLoop([], []);
    expect(result.detected).toBe(false);
  });
});

// ── LoopIntervention ──

describe('detectLoop — intervention suggestions', () => {
  it('should suggest rephrase_prompt for stagnant loops', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 3 }),
      makeLogEntry({ round: 2, blockingIssueCount: 3 }),
      makeLogEntry({ round: 3, blockingIssueCount: 3 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'stagnant' }),
      makeDecision({ progressTrend: 'stagnant' }),
    ];

    const result = detectLoop(log, decisions);

    expect(result.detected).toBe(true);
    expect(result.intervention).toBeDefined();
    expect(['rephrase_prompt', 'skip_issue', 'force_converge']).toContain(
      result.intervention!.type,
    );
  });

  it('should suggest force_converge for declining loops (getting worse)', () => {
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, blockingIssueCount: 3 }),
      makeLogEntry({ round: 2, blockingIssueCount: 4 }),
      makeLogEntry({ round: 3, blockingIssueCount: 5 }),
    ];
    const decisions: GodPostReviewerDecision[] = [
      makeDecision({ progressTrend: 'declining' }),
      makeDecision({ progressTrend: 'declining' }),
      makeDecision({ progressTrend: 'declining' }),
    ];

    const result = detectLoop(log, decisions);

    expect(result.detected).toBe(true);
    expect(result.intervention).toBeDefined();
    expect(result.intervention!.type).toBe('force_converge');
  });
});
