/**
 * Tests for phase-transition.ts — FR-010 (AC-033, AC-034)
 * Verifies compound task phase transition logic.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluatePhaseTransition,
  type PhaseTransitionResult,
  type Phase,
} from '../../god/phase-transition.js';
import type { ConvergenceLogEntry } from '../../god/god-convergence.js';
import type { GodPostReviewerDecision } from '../../types/god-schemas.js';

// ── Helpers ──

function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: 'explore',
    name: 'Exploration',
    type: 'explore',
    description: 'Explore the codebase',
    ...overrides,
  };
}

function makeLogEntry(overrides: Partial<ConvergenceLogEntry> & { round: number }): ConvergenceLogEntry {
  return {
    timestamp: new Date().toISOString(),
    classification: 'approved',
    shouldTerminate: false,
    blockingIssueCount: 0,
    criteriaProgress: [
      { criterion: 'code compiles', satisfied: true },
      { criterion: 'tests pass', satisfied: true },
    ],
    summary: `Round ${overrides.round}`,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<GodPostReviewerDecision> = {}): GodPostReviewerDecision {
  return {
    action: 'phase_transition',
    reasoning: 'Phase criteria met, transitioning to next phase',
    confidenceScore: 0.9,
    progressTrend: 'improving',
    ...overrides,
  };
}

// ── AC-033: compound 型任务阶段转换正确触发 ──

describe('evaluatePhaseTransition — AC-033: transition trigger', () => {
  it('should transition when God decision is phase_transition and phase has a next phase', () => {
    const currentPhase = makePhase({ id: 'explore', type: 'explore' });
    const phases: Phase[] = [
      currentPhase,
      makePhase({ id: 'code', name: 'Implementation', type: 'code', description: 'Implement features' }),
    ];
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1, classification: 'approved', blockingIssueCount: 0 }),
    ];
    const decision = makeDecision({ action: 'phase_transition' });

    const result = evaluatePhaseTransition(currentPhase, phases, log, decision);

    expect(result.shouldTransition).toBe(true);
    expect(result.nextPhaseId).toBe('code');
    expect(result.previousPhaseSummary).toBeDefined();
  });

  it('should NOT transition when God decision is not phase_transition', () => {
    const currentPhase = makePhase({ id: 'explore' });
    const phases: Phase[] = [
      currentPhase,
      makePhase({ id: 'code', type: 'code' }),
    ];
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1 }),
    ];
    const decision = makeDecision({ action: 'route_to_coder' });

    const result = evaluatePhaseTransition(currentPhase, phases, log, decision);

    expect(result.shouldTransition).toBe(false);
  });

  it('should NOT transition when current phase is the last phase', () => {
    const currentPhase = makePhase({ id: 'code', type: 'code' });
    const phases: Phase[] = [
      makePhase({ id: 'explore', type: 'explore' }),
      currentPhase,
    ];
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({ round: 1 }),
    ];
    const decision = makeDecision({ action: 'phase_transition' });

    const result = evaluatePhaseTransition(currentPhase, phases, log, decision);

    expect(result.shouldTransition).toBe(false);
  });

  it('should transition through multiple phases sequentially', () => {
    const phases: Phase[] = [
      makePhase({ id: 'explore', type: 'explore' }),
      makePhase({ id: 'code', name: 'Implementation', type: 'code', description: 'Code it' }),
      makePhase({ id: 'review', name: 'Review', type: 'review', description: 'Review it' }),
    ];

    // Transition from explore → code
    const result1 = evaluatePhaseTransition(
      phases[0],
      phases,
      [makeLogEntry({ round: 1 })],
      makeDecision({ action: 'phase_transition' }),
    );
    expect(result1.shouldTransition).toBe(true);
    expect(result1.nextPhaseId).toBe('code');

    // Transition from code → review
    const result2 = evaluatePhaseTransition(
      phases[1],
      phases,
      [makeLogEntry({ round: 2 })],
      makeDecision({ action: 'phase_transition' }),
    );
    expect(result2.shouldTransition).toBe(true);
    expect(result2.nextPhaseId).toBe('review');
  });
});

// ── BUG-2 R13 regression: self-transition guard ──

describe('test_regression_bug2_r13: self-transition prevented', () => {
  it('should NOT transition when God nextPhaseId equals current phase id', () => {
    const currentPhase = makePhase({ id: 'explore', type: 'explore' });
    const phases: Phase[] = [
      currentPhase,
      makePhase({ id: 'code', type: 'code' }),
    ];
    const log: ConvergenceLogEntry[] = [makeLogEntry({ round: 1 })];
    const decision = makeDecision({
      action: 'phase_transition',
      nextPhaseId: 'explore', // same as current — hallucinated self-transition
    });

    const result = evaluatePhaseTransition(currentPhase, phases, log, decision);

    expect(result.shouldTransition).toBe(false);
  });

  it('should transition normally when nextPhaseId differs from current phase', () => {
    const currentPhase = makePhase({ id: 'explore', type: 'explore' });
    const phases: Phase[] = [
      currentPhase,
      makePhase({ id: 'code', type: 'code' }),
      makePhase({ id: 'review', type: 'review' }),
    ];
    const log: ConvergenceLogEntry[] = [makeLogEntry({ round: 1 })];
    const decision = makeDecision({
      action: 'phase_transition',
      nextPhaseId: 'review', // skip to review — valid non-self transition
    });

    const result = evaluatePhaseTransition(currentPhase, phases, log, decision);

    expect(result.shouldTransition).toBe(true);
    expect(result.nextPhaseId).toBe('review');
  });
});

// ── AC-034: 阶段转换前后 RoundRecord 均保留 ──

describe('evaluatePhaseTransition — AC-034: RoundRecord preservation', () => {
  it('should include previousPhaseSummary capturing convergence log data', () => {
    const currentPhase = makePhase({ id: 'explore', type: 'explore' });
    const phases: Phase[] = [
      currentPhase,
      makePhase({ id: 'code', type: 'code' }),
    ];
    const log: ConvergenceLogEntry[] = [
      makeLogEntry({
        round: 1,
        classification: 'changes_requested',
        blockingIssueCount: 2,
        summary: 'Round 1: 2 blocking issues',
      }),
      makeLogEntry({
        round: 2,
        classification: 'approved',
        blockingIssueCount: 0,
        summary: 'Round 2: approved',
      }),
    ];
    const decision = makeDecision({ action: 'phase_transition' });

    const result = evaluatePhaseTransition(currentPhase, phases, log, decision);

    expect(result.shouldTransition).toBe(true);
    expect(result.previousPhaseSummary).toBeDefined();
    expect(result.previousPhaseSummary!.length).toBeGreaterThan(0);
    // Summary should reference the completed phase
    expect(result.previousPhaseSummary).toContain('explore');
  });

  it('should generate summary even with empty convergence log', () => {
    const currentPhase = makePhase({ id: 'explore', type: 'explore' });
    const phases: Phase[] = [
      currentPhase,
      makePhase({ id: 'code', type: 'code' }),
    ];
    const decision = makeDecision({ action: 'phase_transition' });

    const result = evaluatePhaseTransition(currentPhase, phases, [], decision);

    expect(result.shouldTransition).toBe(true);
    expect(result.previousPhaseSummary).toBeDefined();
  });
});

// ── XState event mapping ──

describe('evaluatePhaseTransition — XState event mapping', () => {
  it('should provide nextPhaseId for PHASE_TRANSITION event payload', () => {
    const phases: Phase[] = [
      makePhase({ id: 'explore', type: 'explore' }),
      makePhase({ id: 'code', type: 'code' }),
    ];
    const decision = makeDecision({ action: 'phase_transition' });

    const result = evaluatePhaseTransition(phases[0], phases, [], decision);

    expect(result.shouldTransition).toBe(true);
    expect(result.nextPhaseId).toBe('code');
    // nextPhaseId is used as payload for PHASE_TRANSITION XState event
  });
});
